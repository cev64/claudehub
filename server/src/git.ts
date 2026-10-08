import { run } from './util.ts';
import type { CommitSummary } from '../../shared/types.ts';

const GIT_TIMEOUT = 20_000;

export function git(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT) {
  return run('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeoutMs });
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  untrackedFiles: number;
  files: { path: string; status: string }[];
}

/** Parse `git status --porcelain=v2 --branch`. */
export function parseStatus(out: string): GitStatus {
  const st: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, dirtyFiles: 0, untrackedFiles: 0, files: [] };
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const h = line.slice('# branch.head '.length).trim();
      st.branch = h === '(detached)' ? null : h;
    } else if (line.startsWith('# branch.upstream ')) {
      st.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        st.ahead = Number(m[1]);
        st.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const parts = line.split(' ');
      st.dirtyFiles++;
      st.files.push({ path: parts.slice(8).join(' '), status: xy(parts[1]) });
    } else if (line.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path\torigPath
      const parts = line.split(' ');
      const rest = parts.slice(9).join(' ');
      st.dirtyFiles++;
      st.files.push({ path: rest.split('\t')[0], status: xy(parts[1]) });
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      st.dirtyFiles++;
      st.files.push({ path: parts.slice(10).join(' '), status: 'U' });
    } else if (line.startsWith('? ')) {
      st.untrackedFiles++;
      st.files.push({ path: line.slice(2), status: '??' });
    }
  }
  return st;
}

function xy(code: string): string {
  const x = code[0] !== '.' ? code[0] : '';
  const y = code[1] !== '.' ? code[1] : '';
  return (x || y || 'M') + (x && y && x !== y ? y : '');
}

export async function getStatus(cwd: string): Promise<GitStatus | null> {
  const r = await git(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']);
  if (!r.ok) return null;
  return parseStatus(r.stdout);
}

export interface LogEntry { sha: string; ts: number }

/** Commits of the last 30 days on HEAD. */
export async function recentLog(cwd: string): Promise<LogEntry[]> {
  const r = await git(cwd, ['log', '--since=30.days', '--format=%H%x09%ct']);
  if (!r.ok) return [];
  const out: LogEntry[] = [];
  for (const line of r.stdout.split('\n')) {
    const [sha, ct] = line.split('\t');
    if (sha && ct && /^[0-9a-f]{7,64}$/.test(sha)) out.push({ sha, ts: Number(ct) * 1000 });
  }
  return out;
}

export async function lastCommit(cwd: string): Promise<{ at: string; message: string } | null> {
  const r = await git(cwd, ['log', '-1', '--format=%ct%x09%s']);
  if (!r.ok || !r.stdout.trim()) return null;
  const [ct, ...msg] = r.stdout.trim().split('\t');
  const t = Number(ct) * 1000;
  if (!Number.isFinite(t)) return null;
  return { at: new Date(t).toISOString(), message: msg.join('\t') };
}

export async function remoteUrl(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['config', '--get', 'remote.origin.url']);
  const u = r.stdout.trim();
  return r.ok && u ? u : null;
}

export async function commitList(cwd: string, n = 10): Promise<CommitSummary[]> {
  const r = await git(cwd, ['log', `-n`, String(n), '--format=%H%x1f%an%x1f%aI%x1f%s']);
  if (!r.ok) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, author, date, message] = l.split('\x1f');
      return { sha, author, date, message: message ?? '' };
    });
}

/** Parse a GitHub remote (https or ssh) into "owner/repo". */
export function parseGithubRemote(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git:\/\/|git@)github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(u);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}
