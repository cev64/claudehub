import type { Project, PullRequest, ProjectStatus } from '../../shared/types.ts';
import type { LocalScan } from './scanner.ts';
import type { GithubData } from './github.ts';
import { parseGithubRemote } from './git.ts';
import { dayKey, lastDayKeys } from './util.ts';

const DAY = 86_400_000;

export interface ProjectExtras {
  readmeExcerpt: string | null;
  claudeMdExcerpt: string | null;
  changedFiles: { path: string; status: string }[];
  dirtySince: string | null;
}

export interface Snapshot {
  generatedAt: string;
  projects: Project[];
  pulls: PullRequest[];
  extras: Record<string, ProjectExtras>;
  githubLogin: string | null;
  prsAuthored: number;
  prsMerged30: number;
}

export function emptySnapshot(): Snapshot {
  return { generatedAt: new Date(0).toISOString(), projects: [], pulls: [], extras: {}, githubLogin: null, prsAuthored: 0, prsMerged30: 0 };
}

function maxIso(...vals: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const v of vals) {
    if (!v) continue;
    const t = Date.parse(v);
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

export function statusFor(lastActivityAt: string | null, now: number): ProjectStatus {
  if (!lastActivityAt) return 'stale';
  const d = (now - Date.parse(lastActivityAt)) / DAY;
  return d < 7 ? 'active' : d < 30 ? 'idle' : 'stale';
}

export function buildSnapshot(scans: LocalScan[], gh: GithubData | null, now = new Date()): Snapshot {
  const nowMs = now.getTime();
  const keys = lastDayKeys(30, now);
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  const used = new Set<string>();
  const projects: Project[] = [];
  const extras: Record<string, ProjectExtras> = {};

  const ghByName = new Map(gh?.repos.map((r) => [r.repo.fullName.toLowerCase(), r]) ?? []);
  const matchedGh = new Set<string>();

  // Prefer the most recently active clone when two folders point at the same GitHub repo.
  const sorted = [...scans].sort((a, b) => (Date.parse(b.repo.lastCommitAt ?? '') || 0) - (Date.parse(a.repo.lastCommitAt ?? '') || 0));

  const build = (id: string, scan: LocalScan | null, ghRepoKey: string | null) => {
    const g = ghRepoKey ? ghByName.get(ghRepoKey) ?? null : null;
    const shas = new Map<string, number>();
    for (const c of scan?.commits ?? []) shas.set(c.sha, c.ts);
    for (const c of g?.commits ?? []) if (!shas.has(c.sha)) shas.set(c.sha, c.ts);
    const commitsByDay = new Array<number>(30).fill(0);
    for (const ts of shas.values()) {
      const idx = keyIndex.get(dayKey(new Date(ts)));
      if (idx !== undefined) commitsByDay[idx]++;
    }
    const commitsLast30 = commitsByDay.reduce((a, b) => a + b, 0);
    const recencyScore = commitsByDay.reduce((acc, n, i) => acc + n * Math.pow(0.93, 29 - i), 0);
    const prs = (gh?.pulls ?? []).filter((p) => p.projectId === id);
    const lastPr = prs.reduce<string | null>((acc, p) => maxIso(acc, p.updatedAt), null);
    const lastActivityAt = maxIso(scan?.repo.lastCommitAt, g?.repo.pushedAt, lastPr);
    const dirty = scan ? scan.repo.dirtyFiles + scan.repo.untrackedFiles > 0 : false;
    const openPRs = g?.repo.openPRs ?? 0;
    const activityScore = Math.round((recencyScore + 3 * openPRs + (dirty ? 2 : 0)) * 100) / 100;
    const name = g ? g.repo.fullName.split('/')[1] : scan!.folder;
    const stack = scan?.stack.length ? scan.stack : g?.repo.language ? [g.repo.language] : [];
    const project: Project = {
      id,
      name,
      description: g?.repo.description ?? scan?.readmeDescription ?? null,
      local: scan?.repo ?? null,
      github: g?.repo ?? null,
      stack,
      commitsByDay,
      commitsLast30,
      activityScore,
      lastActivityAt,
      status: statusFor(lastActivityAt, nowMs),
    };
    projects.push(project);
    extras[id] = {
      readmeExcerpt: scan?.readmeExcerpt ?? null,
      claudeMdExcerpt: scan?.claudeMdExcerpt ?? null,
      changedFiles: scan?.changedFiles ?? [],
      dirtySince: scan?.dirtySince ?? null,
    };
  };

  for (const scan of sorted) {
    const fullName = parseGithubRemote(scan.repo.remoteUrl)?.toLowerCase() ?? null;
    if (fullName && !used.has(fullName)) {
      used.add(fullName);
      if (ghByName.has(fullName)) matchedGh.add(fullName);
      build(fullName, scan, fullName);
      continue;
    }
    let id = `local:${scan.folder}`;
    for (let n = 2; used.has(id); n++) id = `local:${scan.folder}-${n}`;
    used.add(id);
    build(id, scan, null);
  }

  // GitHub repos with no local clone.
  for (const [key] of ghByName) {
    if (matchedGh.has(key) || used.has(key)) continue;
    used.add(key);
    build(key, null, key);
  }

  projects.sort((a, b) => b.activityScore - a.activityScore || a.name.localeCompare(b.name));
  return {
    generatedAt: now.toISOString(),
    projects,
    pulls: [...(gh?.pulls ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    extras,
    githubLogin: gh?.login ?? null,
    prsAuthored: gh?.prsAuthored ?? 0,
    prsMerged30: gh?.prsMerged30 ?? 0,
  };
}
