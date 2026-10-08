import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function log(...args: unknown[]): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}]`, ...args);
}

export function warn(...args: unknown[]): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.warn(`[${ts}] WARN`, ...args);
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/** execFile wrapper that never throws and never uses a shell. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30_000,
        env: opts.env ?? childEnv(),
        maxBuffer: opts.maxBuffer ?? 20 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ ok: true, code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        resolve({
          ok: false,
          code: typeof e.code === 'number' ? e.code : null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(e.killed && e.signal === 'SIGTERM'),
          error: e.message,
        });
      },
    );
  });
}

/** Run an async mapper over items with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** PATH augmented with the usual macOS tool locations (launchd starts with a minimal PATH). */
export function augmentedPath(): string {
  const home = os.homedir();
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin')];
  const parts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const e of extra) if (!parts.includes(e)) parts.push(e);
  return parts.join(path.delimiter);
}

/** Environment for child processes. */
export function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: augmentedPath(), GIT_TERMINAL_PROMPT: '0' };
}

/** Environment for the claude CLI: API keys would override the user's subscription login. */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = childEnv();
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Find an executable by name on the augmented PATH, then in extra fallback paths. */
export function findBinary(name: string, fallbacks: string[] = []): string | null {
  for (const dir of augmentedPath().split(path.delimiter)) {
    const p = path.join(dir, name);
    if (isExecutable(p)) return p;
  }
  for (const p of fallbacks) if (isExecutable(p)) return p;
  return null;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
}

export function truncate(s: string, n: number): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const DAY = 86_400_000;

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** The last `n` local calendar days as YYYY-MM-DD, oldest first, ending today. */
export function lastDayKeys(n: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    keys.push(dayKey(d));
  }
  return keys;
}

export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now - t) / DAY;
}
