import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ActionResult, Health, Job, NewJobRequest, NewProjectRequest, NewProjectResult, Overview, Project, ProjectDetail, Settings, Suggestion, Usage,
} from '../../shared/types.ts';
import { loadSettings, saveSettings, sanitize, type StoredSettings } from './config.ts';
import { readJson, writeJson } from './store.ts';
import { scanAll, scanRepo, type LocalScan } from './scanner.ts';
import { commitList } from './git.ts';
import { NO_TOKEN_HELP, resolveToken, syncGithub, type GithubData } from './github.ts';
import { buildSnapshot, emptySnapshot, type Snapshot } from './merge.ts';
import { aiSuggestions, aiSuggestionsAt, generateAiSuggestions, ruleSuggestions } from './suggestions.ts';
import { JobManager } from './jobs.ts';
import { claudeHealth } from './claude.ts';
import { runProjectAction } from './actions.ts';
import { getUsage, refreshStatuslineCommand, setStatusline } from './usage.ts';
import { errMsg, truncate, findBinary, lastDayKeys, log, run, warn } from './util.ts';

const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export { VERSION };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Hub {
  settings: StoredSettings = loadSettings();
  jobs = new JobManager();
  snapshot: Snapshot = emptySnapshot();
  private scans = new Map<string, LocalScan>();
  private scansReady = false;
  private github: GithubData | null = null;
  private githubError: string | null = null;
  private githubHasToken: boolean | null = null;
  private scanDirError: string | null = null;
  private repoCountAtScan = 0;
  scanning = false;
  lastScanAt: string | null = null;
  private current: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private gitVersion: { ok: boolean; detail: string } | null = null;

  start(): void {
    const snap = readJson<Snapshot>('snapshot.json');
    if (snap?.projects) {
      this.snapshot = snap;
      this.lastScanAt = snap.generatedAt;
      log(`loaded cached snapshot (${snap.projects.length} projects)`);
    }
    const gh = readJson<GithubData>('github-cache.json');
    if (gh?.repos) this.github = gh;
    refreshStatuslineCommand();
    void this.refresh();
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.jobs.shutdown();
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), this.settings.refreshMinutes * 60_000);
    this.timer.unref();
  }

  // -- scanning ---------------------------------------------------------------------------
  refresh(): Promise<void> {
    if (this.current) return this.current;
    this.scanning = true;
    this.current = this.doRefresh()
      .catch((e) => warn('refresh failed:', errMsg(e)))
      .finally(() => {
        this.scanning = false;
        this.current = null;
      });
    return this.current;
  }

  private async doRefresh(): Promise<void> {
    const t0 = Date.now();
    const { scans, error } = await scanAll(this.settings.projectsDir, this.settings.scanDepth);
    this.scanDirError = error;
    this.repoCountAtScan = scans.length;
    if (error) warn(`scan: ${error}`);
    this.scans = new Map(scans.map((s) => [s.repo.path, s]));
    this.scansReady = true;
    this.publish();
    log(`scan: ${scans.length} repos in ${Date.now() - t0}ms`);
    await this.syncGithubSafe();
    this.lastScanAt = new Date().toISOString();
  }

  private async syncGithubSafe(): Promise<void> {
    try {
      const token = await resolveToken();
      this.githubHasToken = Boolean(token);
      if (!token) {
        this.githubError = null;
        return;
      }
      const t0 = Date.now();
      const data = await syncGithub(token);
      this.github = data;
      this.githubError = null;
      writeJson('github-cache.json', data);
      log(`github: ${data.login}, ${data.repos.length} repos, ${data.pulls.length} PRs in ${Date.now() - t0}ms`);
      this.publish();
    } catch (e) {
      this.githubError = errMsg(e);
      warn('github sync failed (keeping last good data):', this.githubError);
    }
  }

  private publish(): void {
    this.snapshot = buildSnapshot([...this.scans.values()], this.github);
    writeJson('snapshot.json', this.snapshot);
  }

  async rescanPath(dir: string): Promise<void> {
    if (!this.scansReady) return void (await this.refresh());
    const scan = await scanRepo(dir);
    if (scan) this.scans.set(dir, scan);
    else this.scans.delete(dir);
    this.publish();
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings;
    const { githubUser: _ignored, ...rest } = patch;
    if (rest.projectsDir !== undefined) {
      const dir = path.resolve(String(rest.projectsDir).replace(/^~(?=$|\/)/, os.homedir()));
      let ok = false;
      try { ok = fs.statSync(dir).isDirectory(); } catch { /* not there */ }
      if (!ok) throw new HttpError(400, `${dir} is not a folder on this Mac.`);
    }
    this.settings = sanitize(rest, before);
    // Don't persist the PROJECTS_DIR env override unless the user explicitly picked a folder.
    const toSave = { ...this.settings };
    if (process.env.PROJECTS_DIR && rest.projectsDir === undefined) {
      const stored = readJson<Partial<StoredSettings>>('config.json');
      if (stored?.projectsDir) toSave.projectsDir = stored.projectsDir;
    }
    saveSettings(toSave);
    if (this.settings.refreshMinutes !== before.refreshMinutes) this.schedule();
    if (this.settings.projectsDir !== before.projectsDir || this.settings.scanDepth !== before.scanDepth) void this.refresh();
    return this.getSettings();
  }

  getSettings(): Settings {
    return { ...this.settings, githubUser: this.github?.login ?? this.snapshot.githubLogin };
  }

  // -- reads ------------------------------------------------------------------------------
  findProject(id: string): Project | null {
    return this.snapshot.projects.find((p) => p.id === id) ?? this.snapshot.projects.find((p) => p.id === id.toLowerCase()) ?? null;
  }

  overview(): Overview {
    const snap = this.snapshot;
    const projects = snap.projects;
    const keys = lastDayKeys(30);
    const activity = keys.map((date, i) => ({ date, commits: projects.reduce((n, p) => n + (p.commitsByDay[i] ?? 0), 0) }));
    const rules = ruleSuggestions(snap);
    const ai = aiSuggestions().filter((s) => !s.projectId || projects.some((p) => p.id === s.projectId));
    const suggestions: Suggestion[] = [...rules, ...ai].sort((a, b) => a.priority - b.priority);
    const ranked = [...projects].sort((a, b) => b.activityScore - a.activityScore);
    return {
      generatedAt: snap.generatedAt,
      stats: {
        projects: projects.length,
        localRepos: projects.filter((p) => p.local).length,
        githubRepos: projects.filter((p) => p.github).length,
        localOnly: projects.filter((p) => p.local && !p.github).length,
        notCloned: projects.filter((p) => p.github && !p.local).length,
        openPRs: projects.reduce((n, p) => n + (p.github?.openPRs ?? 0), 0),
        prsAuthored: snap.prsAuthored,
        prsMerged30: snap.prsMerged30,
        commits30: projects.reduce((n, p) => n + p.commitsLast30, 0),
        dirtyRepos: projects.filter((p) => p.local && p.local.dirtyFiles + p.local.untrackedFiles > 0).length,
        runningJobs: this.jobs.runningCount(),
      },
      mostActive: ranked[0] && ranked[0].activityScore > 0 ? ranked[0] : null,
      topProjects: ranked.slice(0, 5),
      activity,
      suggestions,
      aiSuggestionsAt: aiSuggestionsAt(),
    };
  }

  async detail(id: string): Promise<ProjectDetail | null> {
    const p = this.findProject(id);
    if (!p) return null;
    const extra = this.snapshot.extras[p.id];
    return {
      ...p,
      readmeExcerpt: extra?.readmeExcerpt ?? null,
      claudeMdExcerpt: extra?.claudeMdExcerpt ?? null,
      recentCommits: p.local ? await commitList(p.local.path, 10) : [],
      pulls: this.snapshot.pulls.filter((pr) => pr.projectId === p.id && (pr.state === 'open' || Date.now() - Date.parse(pr.updatedAt) < 30 * 86_400_000)).slice(0, 20),
      jobs: this.jobs.forProject(p.id),
      changedFiles: extra?.changedFiles ?? [],
    };
  }

  // -- writes -----------------------------------------------------------------------------
  async action(id: string, action: string) {
    const p = this.findProject(id);
    if (!p) throw new HttpError(404, 'Unknown project');
    const valid = ['open-editor', 'open-finder', 'open-terminal', 'fetch', 'pull', 'clone'];
    if (!valid.includes(action)) throw new HttpError(400, `Unknown action: ${action}`);
    const { result, rescan } = await runProjectAction(action as never, p, { editor: this.settings.editor, projectsDir: this.settings.projectsDir });
    log(`action ${action} on ${p.id}: ${result.ok ? 'ok' : 'failed'} — ${result.message}`);
    if (rescan === 'project' && p.local) await this.rescanPath(p.local.path);
    else if (rescan === 'all') await this.refresh();
    return result;
  }

  createJob(req: NewJobRequest): Job {
    if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) throw new HttpError(400, 'A prompt is required.');
    if (req.mode !== 'local' && req.mode !== 'cloud') throw new HttpError(400, 'mode must be "local" or "cloud".');
    if (!['plan', 'acceptEdits', 'auto'].includes(req.permission)) throw new HttpError(400, 'permission must be plan, acceptEdits or auto.');
    let cwd = this.settings.projectsDir;
    let name: string | null = null;
    let prompt = req.prompt.trim();
    if (req.projectId) {
      const p = this.findProject(req.projectId);
      if (!p) throw new HttpError(404, 'Unknown project');
      name = p.name;
      if (p.local) cwd = p.local.path;
      else if (req.mode === 'local') throw new HttpError(400, `${p.name} is not cloned on this Mac; clone it first or use a cloud job.`);
      else if (p.github) prompt = `In the GitHub repository ${p.github.fullName}: ${prompt}`;
    }
    const model = req.model === undefined ? this.settings.defaultModel : req.model || null;
    return this.jobs.create({ ...req, prompt }, { projectName: name, cwd, model });
  }

  async createProject(req: NewProjectRequest): Promise<NewProjectResult> {
    const name = typeof req?.name === 'string' ? req.name : '';
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name.startsWith('.') || name === '..') {
      throw new HttpError(400, 'Use letters, digits, ".", "_" or "-" for the project name (up to 100 characters, not starting with ".").');
    }
    const root = this.settings.projectsDir;
    if (!fs.existsSync(root)) throw new HttpError(400, `Projects folder ${root} does not exist.`);
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) throw new HttpError(409, `${dir} already exists.`);
    if (req.prompt && req.permission !== undefined && !['plan', 'acceptEdits', 'auto'].includes(req.permission)) {
      throw new HttpError(400, 'permission must be plan, acceptEdits or auto.');
    }

    fs.mkdirSync(dir);
    const step = async (args: string[], extra: string[] = []) => {
      const r = await run('git', [...extra, ...args], { cwd: dir, timeoutMs: 60_000 });
      if (!r.ok) throw new Error((r.stderr || r.error || 'git failed').trim().split('\n').slice(-2).join(' '));
    };
    try {
      await step(['init', '-b', 'main']);
      fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
      await step(['add', '-A']);
      const who = await Promise.all([run('git', ['config', 'user.name'], { cwd: dir }), run('git', ['config', 'user.email'], { cwd: dir })]);
      const fallback = who[0].stdout.trim() && who[1].stdout.trim() ? [] : ['-c', 'user.name=ClaudeHub', '-c', 'user.email=claudehub@localhost'];
      await step(['commit', '-m', 'Initial commit'], fallback);
    } catch (e) {
      throw new HttpError(500, `Created ${dir} but git setup failed: ${errMsg(e)}`);
    }

    let message = `Created ${name} in ${root}.`;
    let ghOk = false;
    if (req.createGithubRepo) {
      const gh = findBinary('gh', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
      if (!gh) {
        message += ' GitHub step failed: gh is not installed (brew install gh, then gh auth login).';
      } else {
        const r = await run(gh, ['repo', 'create', name, req.privateRepo ? '--private' : '--public', '--source', '.', '--remote', 'origin', '--push'], {
          cwd: dir,
          timeoutMs: 120_000,
        });
        if (r.ok) {
          ghOk = true;
          message += ` Created the ${req.privateRepo ? 'private' : 'public'} GitHub repository and pushed.`;
        } else {
          const why = truncate((r.stderr || r.error || 'unknown error').trim().split('\n').slice(-2).join(' '), 240);
          message += ` GitHub step failed: ${why}${/auth|login|token/i.test(why) ? ' (run: gh auth login)' : ''}`;
        }
      }
    }

    await this.rescanPath(dir);
    if (ghOk) void this.refresh();
    const project = this.snapshot.projects.find((p) => p.local?.path === dir) ?? null;

    let job: Job | null = null;
    if (req.prompt && req.prompt.trim()) {
      const model = req.model === undefined ? this.settings.defaultModel : req.model || null;
      job = this.jobs.create(
        { projectId: project?.id ?? null, prompt: req.prompt.trim(), mode: 'local', permission: req.permission ?? 'auto' },
        { projectName: project?.name ?? name, cwd: dir, model },
      );
    }
    log(`project created: ${dir}`);
    return { ok: true, message, project, job };
  }

  async aiSuggest(): Promise<Suggestion[]> {
    const ov = this.overview();
    return generateAiSuggestions(this.snapshot, ov, this.settings.projectsDir);
  }

  // -- usage ------------------------------------------------------------------------------
  usage(): Promise<Usage> {
    return getUsage(this.snapshot.projects);
  }

  setStatusline(enabled: boolean): ActionResult {
    return setStatusline(enabled);
  }

  // -- health -----------------------------------------------------------------------------
  async health(): Promise<Health> {
    if (!this.gitVersion) {
      const r = await run('git', ['--version'], { timeoutMs: 10_000 });
      this.gitVersion = r.ok ? { ok: true, detail: r.stdout.trim() } : { ok: false, detail: 'git not found — install Xcode command line tools: xcode-select --install' };
    }
    let projectsDir: { ok: boolean; detail: string };
    if (this.scanDirError) projectsDir = { ok: false, detail: `${this.scanDirError} — set the projects folder in Settings` };
    else if (!this.scansReady) projectsDir = { ok: true, detail: `${this.settings.projectsDir} (scanning…)` };
    else projectsDir = { ok: true, detail: `${this.settings.projectsDir} — ${this.repoCountAtScan} git ${this.repoCountAtScan === 1 ? 'repo' : 'repos'} found` };

    let github: { ok: boolean; detail: string };
    if (this.githubHasToken === false && !this.github) github = { ok: false, detail: NO_TOKEN_HELP };
    else if (this.githubHasToken === false) github = { ok: false, detail: `${NO_TOKEN_HELP} Showing cached GitHub data.` };
    else if (this.githubError) {
      github = { ok: false, detail: `${this.githubError}${this.github ? ' — showing last synced data' : ''}` };
    } else if (this.github) {
      github = { ok: true, detail: `Signed in as ${this.github.login} · ${this.github.repos.length} repos · synced ${this.github.syncedAt.slice(0, 16).replace('T', ' ')}Z` };
    } else github = { ok: true, detail: this.githubHasToken ? 'Token found, syncing…' : 'Checking for a GitHub token…' };

    const claude = await claudeHealth();
    return {
      ok: this.gitVersion.ok && projectsDir.ok,
      version: VERSION,
      hostname: os.hostname(),
      checks: { git: this.gitVersion, projectsDir, github, claude },
      lastScanAt: this.lastScanAt,
      scanning: this.scanning,
    };
  }
}

