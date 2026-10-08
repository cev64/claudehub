import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Job, JobEvent, JobStreamMessage, NewJobRequest } from '../../shared/types.ts';
import { dataPath } from './config.ts';
import { CLAUDE_MISSING, parseStreamLine, rateLimitText, resolveClaudeBin, type PartialEvent } from './claude.ts';
import { recordRateLimit } from './usage.ts';
import { claudeEnv, log, run, stripAnsi, truncate, warn, errMsg } from './util.ts';

const MAX_CONCURRENT = 2;
const MAX_JOBS = 200;
const MAX_EVENTS = 5000;
const MAX_EVENT_TEXT = 8000;

type Listener = (msg: JobStreamMessage) => void;

interface Runtime {
  child?: ChildProcess;
  clone?: { url: string; onCloned: () => Promise<void> };
  cancelRequested: boolean;
  killTimer?: NodeJS.Timeout;
  stderrTail: string[];
  sawResult: boolean;
  resultOk?: boolean;
  lastText: string | null;
  lastRateKey?: string;
}

export function isFinished(status: Job['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private events = new Map<string, JobEvent[]>();
  private rt = new Map<string, Runtime>();
  private queue: string[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private dir: string;

  constructor() {
    this.dir = dataPath('jobs');
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  // -- persistence ------------------------------------------------------------------------
  private jobFile(id: string) { return path.join(this.dir, `${id}.json`); }
  private eventsFile(id: string) { return path.join(this.dir, `${id}.events.jsonl`); }

  private load(): void {
    let files: string[] = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Job;
        if (!job.id) continue;
        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'failed';
          job.error = 'Agent restarted';
          job.finishedAt = new Date().toISOString();
          this.persist(job);
        }
        delete job.events;
        this.jobs.set(job.id, job);
      } catch (e) {
        warn(`skipping unreadable job file ${f}:`, errMsg(e));
      }
    }
    this.prune();
    if (this.jobs.size) log(`jobs: loaded ${this.jobs.size}`);
  }

  private persist(job: Job): void {
    try {
      const copy = { ...job };
      delete copy.events;
      fs.writeFileSync(this.jobFile(job.id), JSON.stringify(copy, null, 2));
    } catch (e) {
      warn('could not persist job', job.id, errMsg(e));
    }
  }

  private prune(): void {
    const all = [...this.jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    for (const j of all.slice(MAX_JOBS)) {
      if (!isFinished(j.status)) continue;
      this.jobs.delete(j.id);
      this.events.delete(j.id);
      for (const f of [this.jobFile(j.id), this.eventsFile(j.id)]) fs.rm(f, { force: true }, () => {});
    }
  }

  // -- queries ----------------------------------------------------------------------------
  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((j) => ({ ...j }));
  }

  get(id: string): Job | null {
    const j = this.jobs.get(id);
    return j ? { ...j } : null;
  }

  getWithEvents(id: string): Job | null {
    const j = this.get(id);
    if (!j) return null;
    j.events = this.readEvents(id);
    return j;
  }

  forProject(projectId: string): Job[] {
    return this.list().filter((j) => j.projectId === projectId);
  }

  runningCount(): number {
    return [...this.jobs.values()].filter((j) => j.status === 'running').length;
  }

  readEvents(id: string): JobEvent[] {
    const mem = this.events.get(id);
    if (mem) return [...mem];
    let evs: JobEvent[] = [];
    try {
      evs = fs.readFileSync(this.eventsFile(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JobEvent);
    } catch { /* none */ }
    return evs;
  }

  // -- streaming --------------------------------------------------------------------------
  subscribe(id: string, fn: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  private emit(id: string, msg: JobStreamMessage): void {
    for (const fn of this.listeners.get(id) ?? []) {
      try { fn(msg); } catch { /* listener gone */ }
    }
  }

  private addEvent(job: Job, e: PartialEvent): void {
    let list = this.events.get(job.id);
    if (!list) this.events.set(job.id, (list = []));
    if (list.length >= MAX_EVENTS) return;
    const ev: JobEvent = { ts: new Date().toISOString(), type: e.type, text: e.text.length > MAX_EVENT_TEXT ? e.text.slice(0, MAX_EVENT_TEXT) + '…' : e.text };
    if (e.tool) ev.tool = e.tool;
    list.push(ev);
    try { fs.appendFileSync(this.eventsFile(job.id), JSON.stringify(ev) + '\n'); } catch { /* ignore */ }
    this.emit(job.id, { kind: 'event', event: ev });
  }

  private setStatus(job: Job): void {
    this.persist(job);
    this.emit(job.id, { kind: 'status', job: { ...job } });
  }

  // -- lifecycle --------------------------------------------------------------------------
  create(
    req: NewJobRequest,
    ctx: { projectName: string | null; cwd: string; model: string | null; clone?: { url: string; onCloned: () => Promise<void> } },
  ): Job {
    const job: Job = {
      id: randomUUID(),
      projectId: req.projectId ?? null,
      projectName: ctx.projectName,
      cwd: ctx.cwd,
      prompt: req.prompt,
      permission: req.permission,
      model: ctx.model,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      sessionId: req.resumeSessionId ?? null,
      resultText: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this.events.set(job.id, []);
    this.rt.set(job.id, { cancelRequested: false, stderrTail: [], sawResult: false, lastText: null, clone: ctx.clone });
    this.queue.push(job.id);
    this.persist(job);
    this.prune();
    log(`job ${job.id.slice(0, 8)} queued (${job.permission}) ${truncate(job.prompt, 60)}`);
    setImmediate(() => this.pump());
    return { ...job };
  }

  private pump(): void {
    while (this.runningCount() < MAX_CONCURRENT && this.queue.length) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (job && job.status === 'queued') this.start(job);
    }
  }

  private fail(job: Job, error: string): void {
    job.status = 'failed';
    job.error = error;
    job.finishedAt = new Date().toISOString();
    this.addEvent(job, { type: 'error', text: error });
    this.setStatus(job);
    log(`job ${job.id.slice(0, 8)} failed: ${error}`);
    this.pump();
  }

  private start(job: Job): void {
    const rt = this.rt.get(job.id)!;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.setStatus(job);

    const bin = resolveClaudeBin();
    if (!bin) return this.fail(job, CLAUDE_MISSING);
    if (rt.clone && !fs.existsSync(job.cwd)) return void this.cloneThenSpawn(job, rt, bin);
    this.spawnClaude(job, rt, bin);
  }

  private async cloneThenSpawn(job: Job, rt: Runtime, bin: string): Promise<void> {
    const { url, onCloned } = rt.clone!;
    this.addEvent(job, { type: 'system', text: `Cloning ${url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')} into ${job.cwd}` });
    const r = await run('git', ['clone', '--', url, job.cwd], { timeoutMs: 10 * 60_000 });
    if (rt.cancelRequested) {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.addEvent(job, { type: 'system', text: 'Cancelled' });
      this.setStatus(job);
      return this.pump();
    }
    if (!r.ok) return this.fail(job, `Clone failed: ${truncate((r.stderr || r.error || '').trim().split('\n').slice(-2).join(' '), 300)}`);
    rt.clone = undefined;
    await onCloned().catch((e) => warn('rescan after clone failed:', errMsg(e)));
    this.spawnClaude(job, rt, bin);
  }

  private spawnClaude(job: Job, rt: Runtime, bin: string): void {
    if (!fs.existsSync(job.cwd)) return this.fail(job, `Folder not found: ${job.cwd}`);

    // A leading dash would be read as a flag.
    const prompt = job.prompt.startsWith('-') ? ' ' + job.prompt : job.prompt;
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', job.permission, '--permission-prompts', 'none'];
    if (job.model) args.push('--model', job.model);
    if (job.sessionId) args.push('--resume', job.sessionId);
    this.addEvent(job, { type: 'system', text: `Running in ${job.cwd}` });
    log(`job ${job.id.slice(0, 8)} starting: ${path.basename(bin)} -p (cwd ${job.cwd})`);

    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: job.cwd, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      return this.fail(job, `Could not start claude: ${errMsg(e)}`);
    }
    rt.child = child;
    let finished = false;

    const handleLine = (line: string, stream: 'out' | 'err') => {
      if (stream === 'err') {
        const t = stripAnsi(line).trim();
        if (!t) return;
        rt.stderrTail.push(t);
        if (rt.stderrTail.length > 20) rt.stderrTail.shift();
        this.addEvent(job, { type: 'error', text: truncate(t, 1000) });
        return;
      }
      const parsed = parseStreamLine(line);
      if (parsed.sessionId && parsed.sessionId !== job.sessionId) {
        job.sessionId = parsed.sessionId;
        this.persist(job);
      }
      for (const e of parsed.events) {
        if (e.type === 'text') rt.lastText = e.text;
        this.addEvent(job, e);
      }
      if (parsed.rateLimit) {
        recordRateLimit(parsed.rateLimit);
        const text = rateLimitText(parsed.rateLimit);
        const key = `${parsed.rateLimit.status}|${parsed.rateLimit.resetsAt}`;
        if (text && key !== rt.lastRateKey) this.addEvent(job, { type: 'system', text });
        rt.lastRateKey = key;
      }
      if (parsed.result) {
        rt.sawResult = true;
        job.resultText = parsed.result.text ?? rt.lastText;
        if (!parsed.result.ok) job.error = parsed.result.error;
        rt.resultOk = parsed.result.ok;
      }
    };

    const lineSplitter = (stream: 'out' | 'err') => {
      let buf = '';
      return {
        push: (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            handleLine(buf.slice(0, i), stream);
            buf = buf.slice(i + 1);
          }
        },
        flush: () => { if (buf) handleLine(buf, stream); buf = ''; },
      };
    };
    const out = lineSplitter('out');
    const err = lineSplitter('err');
    child.stdout!.on('data', out.push);
    child.stderr!.on('data', err.push);

    const finish = (code: number | null, signal: string | null, spawnError?: string) => {
      if (finished) return;
      finished = true;
      out.flush();
      err.flush();
      if (rt.killTimer) clearTimeout(rt.killTimer);
      rt.child = undefined;
      job.finishedAt = new Date().toISOString();
      const resultOk = rt.resultOk;
      if (rt.cancelRequested) {
        job.status = 'cancelled';
        job.error = null;
        this.addEvent(job, { type: 'system', text: 'Cancelled' });
      } else if (spawnError) {
        job.status = 'failed';
        job.error = spawnError;
        this.addEvent(job, { type: 'error', text: spawnError });
      } else if (rt.sawResult) {
        job.status = resultOk ? 'succeeded' : 'failed';
        if (resultOk) job.error = null;
        else job.error = job.error ?? 'Claude reported an error';
      } else if (code === 0) {
        job.status = 'succeeded';
        job.resultText = job.resultText ?? rt.lastText;
      } else {
        job.status = 'failed';
        const tail = rt.stderrTail.slice(-5).join(' | ');
        job.error = `claude exited with code ${code ?? signal}${tail ? ': ' + truncate(tail, 400) : ''}`;
        this.addEvent(job, { type: 'error', text: job.error });
      }
      this.setStatus(job);
      log(`job ${job.id.slice(0, 8)} ${job.status}${job.error ? ': ' + truncate(job.error, 120) : ''}`);
      this.pump();
    };

    child.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      finish(null, null, code === 'ENOENT' ? CLAUDE_MISSING : `Could not start claude: ${errMsg(e)}`);
    });
    child.on('close', (code, signal) => finish(code, signal));
  }

  cancel(id: string): Job | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const rt = this.rt.get(id);
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.addEvent(job, { type: 'system', text: 'Cancelled before it started' });
      this.setStatus(job);
      return { ...job };
    }
    if (job.status === 'running' && rt?.child && !rt.cancelRequested) {
      rt.cancelRequested = true;
      const child = rt.child;
      const kill = (sig: NodeJS.Signals) => {
        try { process.kill(-child.pid!, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
      };
      kill('SIGTERM');
      rt.killTimer = setTimeout(() => kill('SIGKILL'), 5000);
      log(`job ${id.slice(0, 8)} cancel requested`);
    } else if (job.status === 'running' && rt?.clone && !rt.cancelRequested) {
      rt.cancelRequested = true; // still cloning: cloneThenSpawn stops before starting Claude
      log(`job ${id.slice(0, 8)} cancel requested during clone`);
    }
    return { ...job };
  }

  /** Stop everything on shutdown. */
  shutdown(): void {
    for (const [id, rt] of this.rt) {
      if (rt.child) {
        try { process.kill(-rt.child.pid!, 'SIGTERM'); } catch { rt.child.kill('SIGTERM'); }
      }
      const job = this.jobs.get(id);
      if (job && !isFinished(job.status)) {
        job.status = 'failed';
        job.error = 'Agent restarted';
        job.finishedAt = new Date().toISOString();
        this.persist(job);
      }
    }
  }
}
