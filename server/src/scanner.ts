import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { LocalRepo } from '../../shared/types.ts';
import { getStatus, lastCommit, recentLog, remoteUrl, type LogEntry } from './git.ts';
import { mapLimit } from './util.ts';

export interface LocalScan {
  repo: LocalRepo;
  folder: string;
  commits: LogEntry[];
  stack: string[];
  readmeExcerpt: string | null;
  readmeDescription: string | null;
  claudeMdExcerpt: string | null;
  changedFiles: { path: string; status: string }[];
  /** Oldest modification time among changed files (ISO), if known. */
  dirtySince: string | null;
}

const SKIP_DIRS = new Set(['node_modules', 'Library', '.git', 'Applications', '$RECYCLE.BIN']);

/** Find git repo roots under `root`, up to `depth` levels below it. */
export async function findRepos(root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, level: number): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      found.push(dir);
      return; // do not descend into repos
    }
    if (level >= depth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      await walk(path.join(dir, e.name), level + 1);
    }
  }
  await walk(root, 0);
  return found.sort();
}

async function readIf(file: string, max = 6000): Promise<string | null> {
  try {
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await fh.read(buf, 0, max, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function cleanMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?(p|div|br|h\d|a|picture|source|center)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerpt(md: string | null, n = 600): string | null {
  if (!md) return null;
  const c = cleanMarkdown(md);
  if (!c) return null;
  return c.length > n ? c.slice(0, n).trimEnd() + '…' : c;
}

function firstParagraph(md: string | null): string | null {
  if (!md) return null;
  for (const raw of cleanMarkdown(md).split('\n')) {
    const line = raw.trim();
    if (!line || /^[#>|`\-=*_]/.test(line) || /^\[.*\]:/.test(line)) continue;
    const text = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
    if (text.length < 8) continue;
    return text.length > 160 ? text.slice(0, 159) + '…' : text;
  }
  return null;
}

async function findReadme(dir: string): Promise<string | null> {
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README.txt', 'README']) {
    const t = await readIf(path.join(dir, name));
    if (t) return t;
  }
  return null;
}

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

async function readPkg(file: string): Promise<Pkg | null> {
  const t = await readIf(file, 200_000);
  if (!t) return null;
  try {
    return JSON.parse(t) as Pkg;
  } catch {
    return null;
  }
}

const SUBDIRS = ['web', 'client', 'frontend', 'app', 'mobile', 'server', 'backend', 'api'];

export async function detectStack(dir: string): Promise<string[]> {
  const stack = new Set<string>();
  const deps = new Set<string>();
  const pkgFiles = [path.join(dir, 'package.json'), ...SUBDIRS.map((s) => path.join(dir, s, 'package.json'))];
  let hasPkg = false;
  for (const f of pkgFiles) {
    const pkg = await readPkg(f);
    if (!pkg) continue;
    hasPkg = true;
    for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) deps.add(k);
  }
  const has = (n: string) => deps.has(n);
  const hasPrefix = (p: string) => [...deps].some((d) => d.startsWith(p));
  if (has('typescript') || (await exists(path.join(dir, 'tsconfig.json')))) stack.add('TypeScript');
  if (has('react') || has('react-dom')) stack.add('React');
  if (has('next')) stack.add('Next.js');
  if (has('vite')) stack.add('Vite');
  if (has('vue') || has('nuxt')) stack.add('Vue');
  if (has('svelte') || has('@sveltejs/kit')) stack.add('Svelte');
  if (has('express')) stack.add('Express');
  if (has('fastify')) stack.add('Fastify');
  if (has('@supabase/supabase-js') || hasPrefix('@supabase/')) stack.add('Supabase');
  if (has('tailwindcss') || has('@tailwindcss/vite')) stack.add('Tailwind');
  if (has('electron')) stack.add('Electron');
  if (has('react-native') || has('expo')) stack.add('React Native');
  if (has('three') || has('@react-three/fiber')) stack.add('Three.js');
  if (hasPkg && stack.size === 0) stack.add('Node');

  const py = [(await readIf(path.join(dir, 'requirements.txt'), 20_000)) ?? '', (await readIf(path.join(dir, 'pyproject.toml'), 20_000)) ?? ''].join('\n').toLowerCase();
  if (py.trim() || (await exists(path.join(dir, 'setup.py')))) {
    stack.add('Python');
    if (/\bdjango\b/.test(py)) stack.add('Django');
    if (/\bfastapi\b/.test(py)) stack.add('FastAPI');
    if (/\bflask\b/.test(py)) stack.add('Flask');
  }
  if (await exists(path.join(dir, 'Cargo.toml'))) stack.add('Rust');
  if (await exists(path.join(dir, 'go.mod'))) stack.add('Go');
  if ((await exists(path.join(dir, 'build.gradle'))) || (await exists(path.join(dir, 'build.gradle.kts'))) || (await exists(path.join(dir, 'app', 'build.gradle'))) || (await exists(path.join(dir, 'app', 'build.gradle.kts')))) {
    stack.add('Android');
    stack.add('Kotlin');
  }
  let top: string[] = [];
  try {
    top = await fsp.readdir(dir);
  } catch {
    /* ignore */
  }
  if (top.includes('Package.swift') || top.some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'))) stack.add('Swift');
  if (await exists(path.join(dir, 'supabase'))) stack.add('Supabase');
  if (top.includes('Dockerfile') || top.includes('docker-compose.yml') || top.includes('compose.yaml')) stack.add('Docker');
  return [...stack];
}

async function oldestMtime(dir: string, files: { path: string; status: string }[]): Promise<string | null> {
  let oldest: number | null = null;
  for (const f of files.slice(0, 50)) {
    if (f.status.includes('D')) continue;
    try {
      const st = await fsp.stat(path.join(dir, f.path));
      if (!st.isFile()) continue;
      if (oldest === null || st.mtimeMs < oldest) oldest = st.mtimeMs;
    } catch {
      /* ignore */
    }
  }
  return oldest === null ? null : new Date(oldest).toISOString();
}

export async function scanRepo(dir: string): Promise<LocalScan | null> {
  const status = await getStatus(dir);
  if (!status) return null;
  const [commits, last, remote, readme, claudeMd, stack] = await Promise.all([
    recentLog(dir),
    lastCommit(dir),
    remoteUrl(dir),
    findReadme(dir),
    readIf(path.join(dir, 'CLAUDE.md')),
    detectStack(dir),
  ]);
  const claudeMdExists = claudeMd !== null || (await exists(path.join(dir, 'CLAUDE.md')));
  const changed = status.files;
  const repo: LocalRepo = {
    path: dir,
    branch: status.branch,
    dirtyFiles: status.dirtyFiles,
    untrackedFiles: status.untrackedFiles,
    ahead: status.ahead,
    behind: status.behind,
    hasUpstream: status.upstream !== null,
    lastCommitAt: last?.at ?? null,
    lastCommitMessage: last?.message ?? null,
    commitsLast30: commits.length,
    hasClaudeMd: claudeMdExists,
    remoteUrl: remote,
  };
  return {
    repo,
    folder: path.basename(dir),
    commits,
    stack,
    readmeExcerpt: excerpt(readme),
    readmeDescription: firstParagraph(readme),
    claudeMdExcerpt: excerpt(claudeMd),
    changedFiles: changed.slice(0, 50),
    dirtySince: changed.length ? await oldestMtime(dir, changed) : null,
  };
}

export async function scanAll(root: string, depth: number): Promise<{ scans: LocalScan[]; error: string | null }> {
  try {
    const st = await fsp.stat(root);
    if (!st.isDirectory()) return { scans: [], error: `${root} is not a folder` };
  } catch {
    return { scans: [], error: `${root} does not exist` };
  }
  const repos = await findRepos(root, depth);
  const scans = await mapLimit(repos, 6, (r) => scanRepo(r).catch(() => null));
  return { scans: scans.filter((s): s is LocalScan => s !== null), error: null };
}
