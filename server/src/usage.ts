import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type {
  ActionResult, PlanLimit, Project, RateLimitNotice, TokenTotals, Usage, UsageDay, UsageSession,
} from '../../shared/types.ts';
import { dataPath } from './config.ts';
import { readJson, writeJson } from './store.ts';
import { dayKey, errMsg, expandHome, lastDayKeys, log, warn } from './util.ts';

const DAY_MS = 86_400_000;
const SCAN_DAYS = 14;
const CACHE_MS = 30_000;
const ACTIVE_MS = 10 * 60_000;
const MAX_LINE_SKIP = 100_000; // longer lines without a "usage" field are tool output; not worth parsing
const SCRIPT_PATH = path.resolve(import.meta.dirname, '../../scripts/statusline.mjs');

// ---------------------------------------------------------------------------------------------
// locations

/** Claude Code's config folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  return env ? path.resolve(expandHome(env)) : path.join(os.homedir(), '.claude');
}

const settingsFile = () => path.join(claudeConfigDir(), 'settings.json');
const statuslineDir = () => dataPath('statusline');

// ---------------------------------------------------------------------------------------------
// transcript scan

interface Msg {
  ts: number;
  model: string | null;
  input: number;
  output: number;
  cc: number;
  cr: number;
  side: boolean;
}

interface FileParse {
  sessionId: string;
  isSub: boolean;
  cwd: string | null;
  title: string | null;
  firstTs: number | null;
  lastTs: number | null;
  msgs: Map<string, Msg>;
  lastMain: Msg | null; // last non-sidechain assistant message, for context size
}

interface CacheEntry { mtimeMs: number; size: number; parsed: FileParse }
const fileCache = new Map<string, CacheEntry>();

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function userText(content: unknown): string | null {
  const texts: string[] = [];
  if (typeof content === 'string') texts.push(content);
  else if (Array.isArray(content)) {
    for (const b of content) if (b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string') texts.push((b as any).text);
  }
  for (const t of texts) {
    const trimmed = t.trim();
    if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('[Request interrupted')) continue;
    const first = trimmed.split('\n')[0].trim();
    if (first) return first.length > 120 ? first.slice(0, 119) + '…' : first;
  }
  return null;
}

async function parseFile(file: string, sessionId: string, isSub: boolean, fallbackTs: number): Promise<FileParse> {
  const out: FileParse = { sessionId, isSub, cwd: null, title: null, firstTs: null, lastTs: null, msgs: new Map(), lastMain: null };
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of rl) {
      n++;
      if (!line || line.charCodeAt(0) !== 123 /* { */) continue;
      if (line.length > MAX_LINE_SKIP && !line.includes('"usage"')) continue;
      let o: any;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== 'object') continue;

      const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
      if (Number.isFinite(ts)) {
        if (out.firstTs === null || ts < out.firstTs) out.firstTs = ts;
        if (out.lastTs === null || ts > out.lastTs) out.lastTs = ts;
      }
      if (!out.cwd && typeof o.cwd === 'string' && o.cwd) out.cwd = o.cwd;

      if (o.type === 'assistant') {
        const m = o.message;
        const u = m?.usage;
        if (!m || typeof m !== 'object' || !u || typeof u !== 'object') continue;
        const model = typeof m.model === 'string' ? m.model : null;
        if (model === '<synthetic>') continue;
        const id = typeof m.id === 'string' && m.id ? m.id : typeof o.uuid === 'string' && o.uuid ? `uuid:${o.uuid}` : `line:${sessionId}:${n}`;
        const rec: Msg = {
          ts: Number.isFinite(ts) ? ts : fallbackTs,
          model,
          input: num(u.input_tokens),
          output: num(u.output_tokens),
          cc: num(u.cache_creation_input_tokens),
          cr: num(u.cache_read_input_tokens),
          side: o.isSidechain === true || isSub,
        };
        out.msgs.delete(id); // keep the last, in order
        out.msgs.set(id, rec);
      } else if (o.type === 'user' && !out.title && o.isSidechain !== true && o.isMeta !== true && !isSub) {
        const t = userText(o.message?.content);
        if (t) out.title = t;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  for (const m of out.msgs.values()) if (!m.side) out.lastMain = m; // iteration order = last wins
  return out;
}

interface FileRef { file: string; sessionId: string; isSub: boolean; mtimeMs: number; size: number }

function listTranscripts(cutoffMs: number): FileRef[] {
  const root = path.join(claudeConfigDir(), 'projects');
  const refs: FileRef[] = [];
  const consider = (file: string, sessionId: string, isSub: boolean) => {
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.mtimeMs >= cutoffMs) refs.push({ file, sessionId, isSub, mtimeMs: st.mtimeMs, size: st.size });
    } catch { /* vanished */ }
  };
  let dirs: fs.Dirent[] = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return refs; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path.join(root, d.name);
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) consider(path.join(pdir, e.name), e.name.slice(0, -6), false);
      else if (e.isDirectory()) {
        // Newer Claude Code versions keep subagent transcripts in <session>/subagents/*.jsonl.
        const sub = path.join(pdir, e.name, 'subagents');
        let subs: string[] = [];
        try { subs = fs.readdirSync(sub); } catch { continue; }
        for (const f of subs) if (f.endsWith('.jsonl')) consider(path.join(sub, f), e.name, true);
      }
    }
  }
  return refs;
}

async function scanTranscripts(cutoffMs: number): Promise<FileParse[]> {
  const refs = listTranscripts(cutoffMs);
  const seen = new Set(refs.map((r) => r.file));
  for (const k of [...fileCache.keys()]) if (!seen.has(k)) fileCache.delete(k);
  const parsed: FileParse[] = [];
  for (const r of refs) {
    const hit = fileCache.get(r.file);
    if (hit && hit.mtimeMs === r.mtimeMs && hit.size === r.size) {
      parsed.push(hit.parsed);
      continue;
    }
    try {
      const p = await parseFile(r.file, r.sessionId, r.isSub, r.mtimeMs);
      fileCache.set(r.file, { mtimeMs: r.mtimeMs, size: r.size, parsed: p });
      parsed.push(p);
    } catch (e) {
      warn(`usage: could not read ${r.file}:`, errMsg(e));
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// aggregation

function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0, sessions: 0, messages: 0 };
}

interface Bucket { t: TokenTotals; ids: Set<string> }
const bucket = (): Bucket => ({ t: emptyTotals(), ids: new Set() });

function add(b: Bucket, m: Msg, sessionId: string): void {
  b.t.input += m.input;
  b.t.output += m.output;
  b.t.cacheCreation += m.cc;
  b.t.cacheRead += m.cr;
  b.t.total += m.input + m.output + m.cc;
  b.t.messages++;
  b.ids.add(sessionId);
}

const done = (b: Bucket): TokenTotals => ({ ...b.t, sessions: b.ids.size });

/** Project whose local path is the longest prefix of cwd. */
export function matchProject(cwd: string | null, projects: Project[]): Project | null {
  if (!cwd) return null;
  let best: Project | null = null;
  let bestLen = -1;
  for (const p of projects) {
    const root = p.local?.path;
    if (!root) continue;
    const r = root.replace(/\/+$/, '');
    if ((cwd === r || cwd.startsWith(r + '/')) && r.length > bestLen) {
      best = p;
      bestLen = r.length;
    }
  }
  return best;
}

export function defaultContextWindow(model: string | null): number {
  if (!model) return 200_000;
  if (/\[1m\]$/i.test(model)) return 1_000_000;
  if (/claude-(opus|sonnet|haiku|fable)-(5|[6-9])/.test(model)) return 1_000_000;
  if (/claude-opus-4-(?:[7-9]|\d{2})(?!\d)/.test(model)) return 1_000_000;
  return 200_000;
}

interface Captured { capturedAt: number; usedPercentage: number | null; windowSize: number | null }

function readCaptured(sessionId: string): Captured | null {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(statuslineDir(), 'sessions', `${sessionId}.json`), 'utf8'));
    const cw = j?.data?.context_window;
    const at = Date.parse(j?.capturedAt);
    const up = typeof cw?.used_percentage === 'number' && Number.isFinite(cw.used_percentage) ? cw.used_percentage : null;
    const ws = typeof cw?.context_window_size === 'number' && cw.context_window_size > 0 ? cw.context_window_size : null;
    if (up === null && ws === null) return null;
    return { capturedAt: Number.isFinite(at) ? at : 0, usedPercentage: up, windowSize: ws };
  } catch {
    return null;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------------------------
// per-day ledger: keeps totals after Claude Code prunes old transcripts

interface LedgerDay { input: number; output: number; cacheCreation: number; cacheRead: number; total: number; messages: number; sessions: string[] }
interface Ledger { v: 1; days: Record<string, LedgerDay> }

const LEDGER_FILE = 'usage-days.json';
let ledger: Ledger | null = null;

function loadLedger(): Ledger {
  if (!ledger) {
    const stored = readJson<Ledger>(LEDGER_FILE);
    ledger = stored?.v === 1 && stored.days ? stored : { v: 1, days: {} };
  }
  return ledger;
}

/**
 * Fold freshly computed days into the ledger. A day's tokens only ever grow, so a smaller
 * computed total means some of its transcripts were deleted: keep what was stored.
 */
function mergeLedger(computed: Map<string, Bucket>): Ledger {
  const l = loadLedger();
  let changed = false;
  for (const [date, b] of computed) {
    if (b.t.messages === 0) continue;
    const cur = l.days[date];
    if (cur && cur.total > b.t.total) continue;
    if (cur && cur.total === b.t.total && cur.messages === b.t.messages && cur.sessions.length === b.ids.size) continue;
    const { input, output, cacheCreation, cacheRead, total, messages } = b.t;
    l.days[date] = { input, output, cacheCreation, cacheRead, total, messages, sessions: [...b.ids] };
    changed = true;
  }
  if (changed) writeJson(LEDGER_FILE, l);
  return l;
}

function sumDays(l: Ledger, keep: (date: string) => boolean): TokenTotals {
  const t = emptyTotals();
  const ids = new Set<string>();
  for (const [date, d] of Object.entries(l.days)) {
    if (!keep(date)) continue;
    t.input += d.input;
    t.output += d.output;
    t.cacheCreation += d.cacheCreation;
    t.cacheRead += d.cacheRead;
    t.total += d.total;
    t.messages += d.messages;
    for (const s of d.sessions) ids.add(s);
  }
  t.sessions = ids.size;
  return t;
}

async function computeUsage(projects: Project[]): Promise<Usage> {
  const now = new Date();
  const keys14 = lastDayKeys(SCAN_DAYS, now);
  const keys7 = new Set(keys14.slice(-7));
  const keys30 = new Set(lastDayKeys(30, now));
  const today = keys14[keys14.length - 1];
  const yearStart = `${now.getFullYear()}-01-01`;

  // Every transcript Claude Code still keeps (parsed files are cached by mtime + size).
  const files = await scanTranscripts(0);

  // Group files per session; main transcript first so its title/cwd win.
  const bySession = new Map<string, FileParse[]>();
  for (const f of files) {
    const list = bySession.get(f.sessionId) ?? [];
    if (f.isSub) list.push(f); else list.unshift(f);
    bySession.set(f.sessionId, list);
  }
  // Oldest session first so a resumed session that replays old messages does not claim them.
  const ordered = [...bySession.entries()].sort((a, b) => (a[1][0].firstTs ?? Infinity) - (b[1][0].firstTs ?? Infinity));

  const dayB = new Map<string, Bucket>();
  const modelTotals = new Map<string, number>();
  const projTotals = new Map<string, { projectId: string | null; name: string; total: number }>();
  const claimed = new Set<string>();
  const sessions: UsageSession[] = [];

  for (const [sessionId, parts] of ordered) {
    const main = parts[0].isSub ? null : parts[0];
    const cwd = parts.find((p) => p.cwd)?.cwd ?? null;
    const proj = matchProject(cwd, projects);
    const projectName = proj?.name ?? (cwd ? path.basename(cwd) || cwd : 'Unknown');
    const sb = bucket();
    let model: string | null = null;
    let modelTs = -1;
    let first: number | null = null;
    let last: number | null = null;

    for (const p of parts) {
      if (p.firstTs !== null && (first === null || p.firstTs < first)) first = p.firstTs;
      if (p.lastTs !== null && (last === null || p.lastTs > last)) last = p.lastTs;
      for (const [id, m] of p.msgs) {
        if (claimed.has(id)) continue;
        claimed.add(id);
        add(sb, m, sessionId);
        if (m.model && m.ts >= modelTs && !m.side) { model = m.model; modelTs = m.ts; }
        const key = dayKey(new Date(m.ts));
        let db = dayB.get(key);
        if (!db) dayB.set(key, (db = bucket()));
        add(db, m, sessionId);
        if (keys7.has(key)) {
          const total = m.input + m.output + m.cc;
          if (m.model) modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + total);
          const pk = proj?.id ?? `name:${projectName}`;
          const cur = projTotals.get(pk) ?? { projectId: proj?.id ?? null, name: projectName, total: 0 };
          cur.total += total;
          projTotals.set(pk, cur);
        }
      }
    }
    if (sb.t.messages === 0) continue;
    if (!model) model = main?.lastMain?.model ?? null;

    const lastActivity = last ?? Date.now();
    const lastMain = main?.lastMain ?? null;
    const contextTokens = lastMain ? lastMain.input + lastMain.cc + lastMain.cr : 0;
    const cap = readCaptured(sessionId);
    let contextWindow = cap?.windowSize ?? defaultContextWindow(lastMain?.model ?? model);
    if (!cap?.windowSize && contextTokens > contextWindow) contextWindow = 1_000_000;
    // The captured percentage is the freshest source, unless the transcript has moved on since.
    const capFresh = cap && cap.usedPercentage !== null && cap.capturedAt >= lastActivity - 60_000;
    const pctRaw = capFresh ? cap!.usedPercentage! : contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

    sessions.push({
      sessionId,
      projectId: proj?.id ?? null,
      projectName,
      cwd,
      model,
      startedAt: first !== null ? new Date(first).toISOString() : null,
      lastActivityAt: new Date(lastActivity).toISOString(),
      active: Date.now() - lastActivity < ACTIVE_MS,
      title: main?.title ?? null,
      totals: { ...done(sb), sessions: 1 },
      contextTokens,
      contextWindow,
      contextPercent: round1(Math.min(100, Math.max(0, pctRaw))),
    });
  }

  sessions.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const l = mergeLedger(dayB);
  const days: UsageDay[] = keys14.map((date) => ({ date, ...sumDays(l, (d) => d === date) }));
  const tracked = Object.keys(l.days).sort();

  return {
    generatedAt: new Date().toISOString(),
    limits: readLimits(),
    statusline: statuslineState(),
    lastRateLimit: getLastRateLimit(),
    today: sumDays(l, (d) => d === today),
    week: sumDays(l, (d) => keys7.has(d)),
    month: sumDays(l, (d) => keys30.has(d)),
    year: sumDays(l, (d) => d >= yearStart && d <= today),
    allTime: sumDays(l, () => true),
    trackedSince: tracked[0] ?? null,
    days,
    byModel: [...modelTotals].map(([model, total]) => ({ model, total })).sort((a, b) => b.total - a.total),
    byProject: [...projTotals.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    sessions: sessions.slice(0, 30),
  };
}

// ---------------------------------------------------------------------------------------------
// plan limits (captured by scripts/statusline.mjs)

function toLimit(w: any): PlanLimit | null {
  if (!w || typeof w !== 'object' || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return null;
  const secs = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at) ? w.resets_at : null;
  // A window that has already reset says nothing about the new one.
  if (secs !== null && secs * 1000 < Date.now()) return null;
  return {
    usedPercentage: round1(Math.min(100, Math.max(0, w.used_percentage))),
    resetsAt: secs !== null ? new Date(secs * 1000).toISOString() : null,
  };
}

function readLimits(): Usage['limits'] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(statuslineDir(), 'limits.json'), 'utf8'));
    const at = typeof j?.capturedAt === 'string' && !Number.isNaN(Date.parse(j.capturedAt)) ? j.capturedAt : null;
    return { fiveHour: toLimit(j?.rate_limits?.five_hour), sevenDay: toLimit(j?.rate_limits?.seven_day), capturedAt: at };
  } catch {
    return { fiveHour: null, sevenDay: null, capturedAt: null };
  }
}

// ---------------------------------------------------------------------------------------------
// last rate_limit_event from a ClaudeHub run

let lastRate: RateLimitNotice | null | undefined; // undefined = not loaded yet

function getLastRateLimit(): RateLimitNotice | null {
  if (lastRate === undefined) {
    const stored = readJson<RateLimitNotice>('rate-limit.json');
    lastRate = stored && typeof stored.status === 'string' && typeof stored.at === 'string' ? stored : null;
  }
  return lastRate;
}

/** 0-1 fractions become percentages; anything else is clamped to 0-100. */
export function normalizeUtilization(u: unknown): number | null {
  if (typeof u !== 'number' || !Number.isFinite(u) || u < 0) return null;
  return round1(Math.min(100, u <= 1 ? u * 100 : u));
}

export function recordRateLimit(notice: RateLimitNotice): void {
  lastRate = notice;
  writeJson('rate-limit.json', notice);
  cached = null;
}

// ---------------------------------------------------------------------------------------------
// status line install / uninstall

function isOurs(cmd: unknown): boolean {
  return typeof cmd === 'string' && cmd.includes('statusline.mjs');
}

function shQuote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

interface Chain { command?: string; original?: unknown }

function readChain(): Chain | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(statuslineDir(), 'chain.json'), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

function readSettings(): { ok: true; settings: Record<string, any>; existed: boolean; raw: string } | { ok: false; message: string } {
  const file = settingsFile();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, settings: {}, existed: false, raw: '' };
    return { ok: false, message: `Could not read ${file}: ${errMsg(e)}` };
  }
  if (!raw.trim()) return { ok: true, settings: {}, existed: true, raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: `${file} is not a JSON object, so ClaudeHub left it alone. Fix it by hand, then try again.` };
    }
    return { ok: true, settings: parsed, existed: true, raw };
  } catch (e) {
    return { ok: false, message: `${file} is not valid JSON (${errMsg(e)}), so ClaudeHub left it alone. Fix it by hand, then try again.` };
  }
}

function writeSettings(settings: Record<string, any>, existed: boolean, raw: string): void {
  const file = settingsFile();
  if (existed && raw) {
    const dir = dataPath('backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `settings.${stamp}.json`), raw, { mode: 0o600 });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const trailing = !existed || !raw || raw.endsWith('\n') ? '\n' : '';
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + trailing);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function statuslineState(): Usage['statusline'] {
  const s = readSettings();
  const installed = s.ok && isOurs(s.settings.statusLine?.command);
  const chain = readChain();
  return { installed, chained: typeof chain?.command === 'string' && chain.command ? chain.command : null };
}

export function setStatusline(enabled: boolean): ActionResult {
  try {
    const r = enabled ? enableStatusline() : disableStatusline();
    cached = null;
    return r;
  } catch (e) {
    return { ok: false, message: `Could not update ${settingsFile()}: ${errMsg(e)}` };
  }
}

function enableStatusline(): ActionResult {
  if (!fs.existsSync(SCRIPT_PATH)) return { ok: false, message: `Capture script not found at ${SCRIPT_PATH}.` };
  const s = readSettings();
  if (!s.ok) return { ok: false, message: s.message };
  const { settings } = s;
  const existing = settings.statusLine;
  const command = `${shQuote(process.execPath)} ${shQuote(SCRIPT_PATH)}`;
  const next: Record<string, unknown> = { type: 'command', command };
  let note = '';

  if (existing && typeof existing === 'object' && isOurs(existing.command)) {
    if (existing.padding !== undefined) next.padding = existing.padding;
    note = ' (it was already on; refreshed).';
  } else {
    if (existing !== undefined && existing !== null) {
      const chain: Chain = { original: existing };
      if (typeof existing === 'object' && typeof existing.command === 'string' && existing.command.trim()) chain.command = existing.command;
      const dir = statuslineDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'chain.json'), JSON.stringify(chain, null, 2));
      if (chain.command) note = '. Your existing status line still runs and is shown.';
      if (typeof existing === 'object' && existing.padding !== undefined) next.padding = existing.padding;
    }
  }
  settings.statusLine = next;
  fs.mkdirSync(statuslineDir(), { recursive: true });
  writeSettings(settings, s.existed, s.raw);
  log(`usage: status line capture on (${settingsFile()})`);
  return { ok: true, message: `Usage capture is on${note || '.'} Plan limits appear after your next Claude Code response on this Mac.` };
}

function disableStatusline(): ActionResult {
  const s = readSettings();
  if (!s.ok) return { ok: false, message: s.message };
  const { settings } = s;
  const chainFile = path.join(statuslineDir(), 'chain.json');
  if (!isOurs(settings.statusLine?.command)) {
    fs.rmSync(chainFile, { force: true });
    return { ok: true, message: 'Usage capture was already off.' };
  }
  const chain = readChain();
  let restored = false;
  if (chain?.original !== undefined && chain.original !== null) {
    settings.statusLine = chain.original;
    restored = true;
  } else if (typeof chain?.command === 'string' && chain.command) {
    const padding = settings.statusLine?.padding;
    settings.statusLine = padding !== undefined ? { type: 'command', command: chain.command, padding } : { type: 'command', command: chain.command };
    restored = true;
  } else {
    delete settings.statusLine;
  }
  writeSettings(settings, s.existed, s.raw);
  fs.rmSync(chainFile, { force: true });
  log('usage: status line capture off');
  return { ok: true, message: restored ? 'Usage capture is off. Your previous status line is restored.' : 'Usage capture is off.' };
}

// The installed command pins the absolute node path (e.g. Homebrew's versioned Cellar path), which
// breaks after `brew upgrade node` or when the repo moves. Re-point it at startup when it drifts.
export function refreshStatuslineCommand(): void {
  try {
    const s = readSettings();
    if (!s.ok || !isOurs(s.settings.statusLine?.command)) return;
    const command = `${shQuote(process.execPath)} ${shQuote(SCRIPT_PATH)}`;
    if (s.settings.statusLine.command === command) return;
    s.settings.statusLine = { ...s.settings.statusLine, command };
    writeSettings(s.settings, s.existed, s.raw);
    log('usage: status line command updated to the current node and repo paths');
  } catch (e) {
    warn(`usage: could not refresh the status line command: ${errMsg(e)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// public API

let cached: { at: number; value: Usage } | null = null;
let inflight: Promise<Usage> | null = null;

export async function getUsage(projects: Project[]): Promise<Usage> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inflight) return inflight;
  inflight = computeUsage(projects)
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
