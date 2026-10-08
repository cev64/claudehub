// Fixture data for ?mock=1. Mirrors the agent's API so the dashboard can be built and checked
// without the Mac. Add &offline=1 to simulate an unreachable agent.
import type {
  ActionResult, DayCount, Health, Job, JobEvent, JobStreamMessage, NewJobRequest, NewProjectRequest, NewProjectResult, Overview, Project,
  ProjectAction, ProjectDetail, PullRequest, Settings, Suggestion, TokenTotals, Usage, UsageDay, UsageSession,
} from '../../shared/types';
import { ApiError } from './api';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const isoAt = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ROOT = '/Users/charlie/Desktop/Projects';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 30 numbers, oldest first, summing to `total`, weighted toward recent days by `recency`. */
function spread(total: number, seed: number, recency = 1, quietTail = 0): number[] {
  const r = rng(seed);
  const w = Array.from({ length: 30 }, (_, i) => {
    if (i >= 30 - quietTail) return 0;
    const base = Math.pow((i + 1) / 30, recency);
    const weekend = new Date(NOW - (29 - i) * DAY).getDay() % 6 === 0 ? 0.35 : 1;
    return r() < 0.22 ? 0 : base * weekend * (0.4 + r());
  });
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const out = w.map(x => Math.floor((x / sum) * total));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 29; rest > 0; i = (i + 29) % 30) {
    if (w[i] > 0) { out[i]++; rest--; }
    if (i === 0 && w.every(x => x === 0)) break;
  }
  return out;
}

interface Spec {
  name: string;
  description: string;
  stack: string[];
  commits: number;
  lastMs: number;
  recency?: number;
  quietTail?: number;
  local?: Partial<Project['local']> | false;
  github?: Partial<Project['github']> | false;
  language?: string;
}

const specs: Spec[] = [
  {
    name: 'claudehub', description: 'A dashboard on the Mac Mini for local repos, GitHub and Claude.',
    stack: ['React', 'Vite', 'TypeScript', 'Fastify'], commits: 46, lastMs: 14 * MIN, recency: 2.2,
    local: { dirtyFiles: 4, untrackedFiles: 2, ahead: 2, behind: 0, branch: 'main', lastCommitMessage: 'Add job stream endpoint' },
    github: { openPRs: 1, openIssues: 3, stars: 2, private: true }, language: 'TypeScript',
  },
  {
    name: 'budget-app', description: 'Monthly budget, net worth and ledger. Port of the spreadsheet.',
    stack: ['React', 'Vite', 'TypeScript', 'Supabase'], commits: 38, lastMs: 3 * HOUR, recency: 1.2,
    local: { dirtyFiles: 0, ahead: 0, behind: 0, branch: 'feat/net-worth-chart', lastCommitMessage: 'Net worth chart scrub tooltip' },
    github: { openPRs: 2, openIssues: 5, stars: 4, private: true }, language: 'TypeScript',
  },
  {
    name: 'bets-tracker', description: 'Log bets from slip screenshots, grade them, track units.',
    stack: ['React', 'TypeScript', 'Supabase', 'MCP'], commits: 27, lastMs: 26 * HOUR, recency: 0.9,
    local: { dirtyFiles: 0, ahead: 0, behind: 3, branch: 'main', lastCommitMessage: 'Parlay leg grading' },
    github: { openPRs: 1, openIssues: 2, stars: 1, private: true }, language: 'TypeScript',
  },
  {
    name: 'budget-android', description: 'Jetpack Compose client for the budget app.',
    stack: ['Kotlin', 'Jetpack Compose', 'Supabase'], commits: 19, lastMs: 2 * DAY, recency: 1.4,
    local: { dirtyFiles: 7, untrackedFiles: 1, ahead: 0, behind: 0, branch: 'glass-sheets', lastCommitMessage: 'Haze blur on bottom nav' },
    github: { openPRs: 1, openIssues: 0, stars: 0, private: true }, language: 'Kotlin',
  },
  {
    name: 'league-history', description: 'Fantasy league records, rivalries and season recaps.',
    stack: ['Next.js', 'TypeScript', 'Python'], commits: 9, lastMs: 11 * DAY, recency: 0.4, quietTail: 10,
    local: { dirtyFiles: 0, ahead: 1, behind: 0, branch: 'main', lastCommitMessage: 'Season 2025 import' },
    github: { openPRs: 1, openIssues: 4, stars: 3, private: false }, language: 'TypeScript',
  },
  {
    name: 'bracketeer', description: 'March bracket builder with live scoring.',
    stack: ['SvelteKit', 'TypeScript'], commits: 4, lastMs: 19 * DAY, recency: 0.3, quietTail: 18,
    local: false, github: { openPRs: 0, openIssues: 1, stars: 6, private: false }, language: 'Svelte',
  },
  {
    name: 'portfolio-site', description: 'Personal site and project write-ups.',
    stack: ['Astro', 'CSS'], commits: 0, lastMs: 64 * DAY,
    local: { dirtyFiles: 1, ahead: 0, behind: 0, branch: 'main', lastCommitMessage: 'Update resume link' },
    github: { openPRs: 0, openIssues: 0, stars: 1, private: false }, language: 'Astro',
  },
  {
    name: 'scratch-notes', description: null as unknown as string,
    stack: ['Node.js'], commits: 2, lastMs: 23 * DAY, recency: 0.2, quietTail: 22,
    local: { dirtyFiles: 3, untrackedFiles: 5, ahead: 0, behind: 0, branch: 'main', hasUpstream: false, remoteUrl: null, lastCommitMessage: 'wip' },
    github: false,
  },
  {
    name: 'fantasy-draft-kit', description: 'Draft-day rankings and tiers from projections.',
    stack: ['Python', 'pandas'], commits: 0, lastMs: 140 * DAY,
    local: false, github: { openPRs: 0, openIssues: 0, stars: 0, private: true }, language: 'Python',
  },
  {
    name: 'recipe-box', description: 'Recipes with scaling and a shopping list.',
    stack: ['React', 'Vite', 'IndexedDB'], commits: 6, lastMs: 9 * DAY, recency: 0.5, quietTail: 8,
    local: { dirtyFiles: 0, ahead: 0, behind: 0, branch: 'main', hasUpstream: false, remoteUrl: null, lastCommitMessage: 'Unit conversion' },
    github: false,
  },
];

function statusFor(lastMs: number): Project['status'] {
  return lastMs < 7 * DAY ? 'active' : lastMs < 30 * DAY ? 'idle' : 'stale';
}

const projects: Project[] = specs.map((s, i) => {
  const gh = s.github === false ? null : {
    fullName: `cev64/${s.name}`,
    url: `https://github.com/cev64/${s.name}`,
    description: s.description ?? null,
    private: true, fork: false, archived: false,
    defaultBranch: 'main',
    pushedAt: isoAt(s.lastMs + 20 * MIN),
    openPRs: 0, openIssues: 0, stars: 0,
    language: s.language ?? null,
    commitsLast30: s.commits,
    ...s.github,
  };
  const local = s.local === false ? null : {
    path: `${ROOT}/${s.name}`,
    branch: 'main', dirtyFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0,
    hasUpstream: true,
    lastCommitAt: isoAt(s.lastMs),
    lastCommitMessage: null,
    commitsLast30: s.commits,
    hasClaudeMd: s.name !== 'scratch-notes' && s.name !== 'recipe-box',
    remoteUrl: gh ? `git@github.com:${gh.fullName}.git` : null,
    ...s.local,
  };
  const byDay = spread(s.commits, 17 + i * 31, s.recency ?? 1, s.quietTail ?? 0);
  return {
    id: gh ? gh.fullName.toLowerCase() : `local:${s.name}`,
    name: s.name,
    description: s.description ?? null,
    local, github: gh,
    stack: s.stack,
    commitsByDay: byDay,
    commitsLast30: s.commits,
    activityScore: Math.round(s.commits * 10 + Math.max(0, 30 - s.lastMs / DAY) * 4 + (local?.dirtyFiles ?? 0)),
    lastActivityAt: isoAt(s.lastMs),
    status: statusFor(s.lastMs),
  } satisfies Project;
});

const pulls: PullRequest[] = [
  pr('budget-app', 42, 'Net worth chart with scrub tooltip', 'feat/net-worth-chart', 3 * HOUR, 'open', 'failure', 'REVIEW_REQUIRED', 412, 87),
  pr('budget-app', 41, 'Close month flow and year summary projection', 'close-month', 2 * DAY, 'open', 'success', 'APPROVED', 268, 140),
  pr('claudehub', 3, 'Job runner: stream claude -p output over SSE', 'job-stream', 40 * MIN, 'open', 'pending', null, 530, 22, true),
  pr('bets-tracker', 18, 'Grade parlays with void legs on winning legs only', 'parlay-voids', 5 * DAY, 'open', 'success', 'CHANGES_REQUESTED', 96, 31),
  pr('budget-android', 7, 'Glass sheets with drag to dismiss', 'glass-sheets', 2 * DAY, 'open', 'success', 'APPROVED', 344, 118),
  pr('league-history', 12, 'Rivalry pages', 'rivalries', 16 * DAY, 'open', 'success', null, 205, 12, false, 'dependabot[bot]'),
  pr('budget-app', 39, 'Ledger IOUs in net worth', 'ledger-ious', 9 * DAY, 'merged', 'success', 'APPROVED', 188, 44),
  pr('bets-tracker', 17, 'Kalshi and Polymarket odds from contract price', 'prediction-markets', 12 * DAY, 'merged', 'success', 'APPROVED', 121, 9),
  pr('claudehub', 2, 'Repo scanner with scan depth', 'scanner', 6 * DAY, 'merged', 'success', null, 302, 0),
  pr('budget-android', 6, 'Swipe to delete with undo', 'swipe-delete', 21 * DAY, 'closed', 'failure', null, 77, 50),
];

function pr(
  repo: string, number: number, title: string, headRef: string, ago: number, state: PullRequest['state'],
  checks: PullRequest['checks'], reviewDecision: PullRequest['reviewDecision'], additions: number, deletions: number,
  draft = false, author = 'cev64',
): PullRequest {
  const full = `cev64/${repo}`;
  return {
    id: `${full}#${number}`, number, title, url: `https://github.com/${full}/pull/${number}`,
    repoFullName: full, projectId: full.toLowerCase(), state, draft, author, isMine: author === 'cev64',
    createdAt: isoAt(ago + 2 * DAY), updatedAt: isoAt(ago), mergedAt: state === 'merged' ? isoAt(ago) : null,
    reviewDecision, checks, additions, deletions, headRef,
  };
}

// ---------- Jobs ----------

interface MockJob extends Job { events: JobEvent[]; script: Omit<JobEvent, 'ts'>[] }
const jobs: MockJob[] = [];
const listeners = new Map<string, Set<(m: JobStreamMessage) => void>>();

function scriptFor(req: NewJobRequest, cwd: string): Omit<JobEvent, 'ts'>[] {
  const where = cwd.replace(/^\/Users\/[^/]+/, '~');
  const project = req.projectId ? projects.find(p => p.id === req.projectId) : null;
  const s: Omit<JobEvent, 'ts'>[] = [
    ...(project && !project.local && project.github ? [{ type: 'system' as const, text: `Cloning ${project.github.fullName} into ${where}` }] : []),
    { type: 'system', text: `Session started in ${where}` },
    { type: 'text', text: "I'll look at how the project is laid out first." },
    { type: 'tool', tool: 'Glob', text: 'src/**/*.{ts,tsx}' },
    { type: 'tool', tool: 'Read', text: 'src/App.tsx' },
    { type: 'tool', tool: 'Grep', text: 'useSettings' },
    { type: 'text', text: 'Settings live in `src/state/settings.ts` and are read through `useSettings()`. The screen itself is `src/screens/Settings.tsx`.' },
  ];
  if (req.permission === 'plan') {
    s.push({ type: 'text', text: 'Here is the plan:\n\n1. Add a `theme` field to settings with `system` as the default.\n2. Render a segmented control in Settings.\n3. Apply `data-theme` on the root element.' });
    s.push({ type: 'result', text: 'Plan ready. Nothing was changed.' });
  } else {
    s.push({ type: 'tool', tool: 'Edit', text: 'src/state/settings.ts' });
    s.push({ type: 'tool', tool: 'Edit', text: 'src/screens/Settings.tsx' });
    s.push({ type: 'tool', tool: 'Bash', text: 'npm run build' });
    s.push({ type: 'text', text: 'Build passes. Changes:\n\n- `theme` setting with **System**, **Light** and **Dark**\n- Segmented control in Settings\n- Root `data-theme` attribute, read once on load\n\n```ts\nexport type Theme = \'system\' | \'light\' | \'dark\';\n```' });
    s.push({ type: 'result', text: 'Done. 2 files changed, build passes.' });
  }
  return s;
}

function makeJob(req: NewJobRequest, ago: number, status: Job['status'], doneSteps?: number): MockJob {
  const project = req.projectId ? projects.find(p => p.id === req.projectId) : null;
  const cwd = project?.local?.path ?? (project ? `${ROOT}/${project.name}` : ROOT);
  const id = `job_${Math.random().toString(36).slice(2, 10)}`;
  const script = scriptFor(req, cwd);
  const created = Date.now() - ago;
  const steps = status === 'running' || status === 'queued' ? (doneSteps ?? 0) : script.length;
  const events = script.slice(0, steps).map((e, i) => ({ ...e, ts: new Date(created + (i + 1) * 2500).toISOString() }));
  const finished = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  const result = [...script].reverse().find(e => e.type === 'result');
  return {
    id,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    cwd,
    prompt: req.prompt,
    permission: req.permission,
    model: req.model ?? null,
    status,
    createdAt: new Date(created).toISOString(),
    startedAt: status === 'queued' ? null : new Date(created + 400).toISOString(),
    finishedAt: finished ? new Date(created + script.length * 2500).toISOString() : null,
    sessionId: status !== 'queued' ? `9f2c${id.slice(4)}-4d1e-8a77` : null,
    resultText: status === 'succeeded' ? result?.text ?? null : null,
    error: status === 'failed' ? 'claude exited with code 1' : null,
    events,
    script,
  };
}

jobs.push(
  makeJob({ projectId: 'cev64/budget-app', prompt: 'Add a theme setting (System / Light / Dark) to Settings and apply it on load.', permission: 'acceptEdits', model: null }, 40_000, 'running', 3),
  makeJob({ projectId: 'cev64/claudehub', prompt: 'Review the uncommitted changes and suggest a commit message.', permission: 'plan', model: 'sonnet' }, 2 * HOUR, 'succeeded'),
  makeJob({ projectId: 'cev64/bets-tracker', prompt: 'Fix the flaky odds parser test in CI.', permission: 'acceptEdits', model: 'opus' }, 26 * HOUR, 'succeeded'),
  makeJob({ projectId: 'cev64/league-history', prompt: 'Import the 2025 season CSV and regenerate recaps.', permission: 'auto', model: null }, 3 * DAY, 'failed'),
);
jobs[3].events.push({ ts: jobs[3].finishedAt!, type: 'error', text: 'claude exited with code 1' });

let ticker: ReturnType<typeof setInterval> | null = null;
function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const running = jobs.filter(j => j.status === 'running' || j.status === 'queued');
    if (!running.length) { clearInterval(ticker!); ticker = null; return; }
    for (const j of running) {
      if (j.status === 'queued') {
        j.status = 'running';
        j.startedAt = new Date().toISOString();
        j.sessionId = `9f2c${j.id.slice(4)}-4d1e-8a77`;
        emit(j.id, { kind: 'status', job: publicJob(j) });
        continue;
      }
      const next = j.script[j.events.length];
      if (next) {
        const ev = { ...next, ts: new Date().toISOString() };
        j.events.push(ev);
        emit(j.id, { kind: 'event', event: ev });
      }
      if (j.events.length >= j.script.length) {
        j.status = 'succeeded';
        j.finishedAt = new Date().toISOString();
        j.resultText = j.script[j.script.length - 1].text;
        emit(j.id, { kind: 'status', job: publicJob(j) });
      }
    }
  }, 1400);
}

function emit(id: string, msg: JobStreamMessage) {
  listeners.get(id)?.forEach(fn => fn(msg));
}

function publicJob(j: MockJob, withEvents = false): Job {
  const { script: _s, events, ...rest } = j;
  return withEvents ? { ...rest, events: [...events] } : { ...rest };
}

export function mockStream(id: string, onMessage: (m: JobStreamMessage) => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, set = new Set());
  set.add(onMessage);
  ensureTicker();
  return () => { set!.delete(onMessage); };
}

// ---------- Overview / suggestions ----------

function activity(): DayCount[] {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(NOW - (29 - i) * DAY);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, commits: projects.reduce((a, p) => a + p.commitsByDay[i], 0) };
  });
}

const ruleSuggestions: Suggestion[] = [
  {
    id: 's1', kind: 'ci-failing', projectId: 'cev64/budget-app', projectName: 'budget-app', priority: 1, source: 'rules',
    title: 'Checks failing on #42', detail: 'budget-app · Net worth chart with scrub tooltip',
    action: { type: 'prompt', prompt: 'Checks are failing on PR #42 (feat/net-worth-chart). Find the cause and fix it.', permission: 'acceptEdits' },
  },
  {
    id: 's2', kind: 'uncommitted', projectId: 'cev64/claudehub', projectName: 'claudehub', priority: 1, source: 'rules',
    title: '6 uncommitted files', detail: 'claudehub · main',
    action: { type: 'prompt', prompt: 'Review the uncommitted changes and commit them with a clear message.', permission: 'acceptEdits' },
  },
  {
    id: 's3', kind: 'behind', projectId: 'cev64/bets-tracker', projectName: 'bets-tracker', priority: 2, source: 'rules',
    title: '3 commits behind', detail: 'bets-tracker · main',
    action: { type: 'project-action', action: 'pull' },
  },
  {
    id: 's4', kind: 'pr-ready', projectId: 'cev64/budget-android', projectName: 'budget-android', priority: 2, source: 'rules',
    title: '#7 is approved', detail: 'budget-android · Glass sheets with drag to dismiss',
    action: { type: 'link', url: 'https://github.com/cev64/budget-android/pull/7' },
  },
  {
    id: 's6', kind: 'no-claude-md', projectId: 'local:scratch-notes', projectName: 'scratch-notes', priority: 3, source: 'rules',
    title: 'No CLAUDE.md', detail: 'scratch-notes',
    action: { type: 'prompt', prompt: 'Create a concise CLAUDE.md for this repository.', permission: 'acceptEdits' },
  },
];
function mockNextEdits(): Suggestion[] {
  return [
    {
      id: 'ai1', kind: 'ai', projectId: 'cev64/claudehub', projectName: 'claudehub', priority: 1, source: 'claude',
      title: 'Show clone progress in the run view', detail: 'The last commits added clone-before-run, but the transcript only says "Cloning".',
      action: { type: 'prompt', prompt: 'In web/src/components/Transcript.tsx, show a calm progress line while a run is cloning its repo. Check it at ?mock=1.', permission: 'acceptEdits' },
    },
    {
      id: 'ai2', kind: 'ai', projectId: 'cev64/budget-app', projectName: 'budget-app', priority: 2, source: 'claude',
      title: 'Test the theme setting', detail: 'The theme switch landed yesterday without tests.',
      action: { type: 'prompt', prompt: 'Add tests for the System / Light / Dark theme setting in src/state/settings.ts, then run npm test.', permission: 'auto' },
    },
    {
      id: 'ai3', kind: 'ai', projectId: 'cev64/bracketeer', projectName: 'bracketeer', priority: 2, source: 'claude',
      title: 'Finish the seeding screen', detail: 'Recent commits stub out seeding but the screen is still empty.',
      action: { type: 'prompt', prompt: 'Look at the recent seeding commits and propose how to finish the seeding screen. Do not change files yet.', permission: 'plan' },
    },
  ];
}
let aiAt: string | null = new Date(Date.now() - 2 * 3_600_000).toISOString();
let aiSuggestions: Suggestion[] = mockNextEdits();

function stats(): Overview['stats'] {
  return {
    projects: projects.length,
    localRepos: projects.filter(p => p.local).length,
    githubRepos: projects.filter(p => p.github).length,
    localOnly: projects.filter(p => p.local && !p.github).length,
    notCloned: projects.filter(p => !p.local).length,
    openPRs: pulls.filter(p => p.state === 'open').length,
    prsAuthored: 87,
    prsMerged30: 9,
    commits30: projects.reduce((a, p) => a + p.commitsLast30, 0),
    dirtyRepos: projects.filter(p => p.local && p.local.dirtyFiles + p.local.untrackedFiles > 0).length,
    runningJobs: jobs.filter(j => j.status === 'running' || j.status === 'queued').length,
  };
}

function overview(): Overview {
  const ranked = [...projects].sort((a, b) => b.activityScore - a.activityScore);
  return {
    generatedAt: lastScanAt,
    stats: stats(),
    mostActive: ranked[0],
    topProjects: ranked.slice(0, 5),
    activity: activity(),
    suggestions: [...aiSuggestions, ...ruleSuggestions].sort((a, b) => a.priority - b.priority),
    aiSuggestionsAt: aiAt,
    aiSuggestionsRunning: false,
  };
}

// ---------- Detail ----------

const commitMessages = [
  'Add job stream endpoint', 'Tighten row spacing', 'Fix relative time rounding', 'Segmented thumb spring',
  'Move token to settings', 'Scan depth setting', 'Readme excerpt', 'Handle detached HEAD', 'Bump deps',
  'Sparkline on hero card',
];

const changedFileList = [
  { path: 'server/src/jobs.ts', status: 'M' }, { path: 'server/src/routes/jobs.ts', status: 'M' },
  { path: 'web/src/screens/Claude.tsx', status: 'M' }, { path: 'web/src/api.ts', status: 'M' },
  { path: 'web/src/components/Transcript.tsx', status: '??' }, { path: 'docs/notes.md', status: '??' },
  { path: 'app/src/main/java/ui/Sheet.kt', status: 'M' }, { path: 'app/src/main/java/ui/Nav.kt', status: 'M' },
];

function detail(p: Project): ProjectDetail {
  const r = rng(p.name.length * 97);
  const n = p.local ? p.local.dirtyFiles + p.local.untrackedFiles : 0;
  return {
    ...p,
    readmeExcerpt: p.description
      ? `${p.description}\n\nRun \`npm install\` then \`npm run dev\`. The app reads its settings from \`.env.local\`; see \`docs/\` for the data model and deployment notes.`
      : null,
    claudeMdExcerpt: p.local?.hasClaudeMd ? 'Use TypeScript strict mode. Keep components small. Run `npm run build` before finishing.' : null,
    recentCommits: p.commitsLast30 > 0 || p.local
      ? commitMessages.slice(0, 6).map((m, i) => ({
          sha: Math.floor(r() * 0xfffffff).toString(16).padStart(7, '0'),
          message: i === 0 && p.local?.lastCommitMessage ? p.local.lastCommitMessage : m,
          author: 'Charlie',
          date: new Date(Date.parse(p.lastActivityAt ?? isoAt(0)) - i * (7 + r() * 30) * HOUR).toISOString(),
        }))
      : [],
    pulls: pulls.filter(x => x.projectId === p.id),
    jobs: jobs.filter(j => j.projectId === p.id).map(j => publicJob(j)),
    changedFiles: changedFileList.slice(0, Math.min(n, changedFileList.length)),
  };
}

// ---------- Settings / health ----------

let settings: Settings = {
  projectsDir: ROOT,
  scanDepth: 2,
  editor: 'Visual Studio Code',
  refreshMinutes: 10,
  defaultModel: null,
  githubUser: 'cev64',
};
let lastScanAt = iso(2 * MIN);
let scanningUntil = 0;

function health(): Health {
  const scanning = Date.now() < scanningUntil;
  return {
    ok: true,
    version: '0.1.0',
    hostname: 'charlies-mac-mini',
    checks: {
      git: { ok: true, detail: 'git version 2.50.1' },
      projectsDir: { ok: true, detail: `${settings.projectsDir} · 8 repos` },
      github: { ok: true, detail: 'Signed in as cev64' },
      claude: { ok: false, detail: 'claude not found on PATH. Install with npm i -g @anthropic-ai/claude-code' },
    },
    lastScanAt,
    scanning,
  };
}

// ---------- Usage ----------
// ?mock=1&usage=empty: nothing captured yet and the status line script not installed.
// ?mock=1&usage=high: both plan limits near or at the limit.

const USAGE_VARIANT = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('usage') : null;
const USAGE_EMPTY = USAGE_VARIANT === 'empty';
const USAGE_HIGH = USAGE_VARIANT === 'high';
let statusline: Usage['statusline'] = USAGE_EMPTY
  ? { installed: false, chained: null }
  : { installed: true, chained: 'npx -y ccstatusline@latest' };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function totals(total: number, seed: number, sessions: number): TokenTotals {
  const r = rng(seed);
  const output = Math.round(total * (0.05 + r() * 0.04));
  const input = Math.round(total * (0.004 + r() * 0.004));
  const cacheCreation = total - output - input;
  return {
    input, output, cacheCreation, total,
    cacheRead: Math.round(total * (9 + r() * 5)),
    sessions,
    messages: Math.round(total / (9_000 + r() * 4_000)),
  };
}

function addTotals(list: TokenTotals[]): TokenTotals {
  const z: TokenTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0, sessions: 0, messages: 0 };
  for (const t of list) for (const k of Object.keys(z) as (keyof TokenTotals)[]) z[k] += t[k];
  return z;
}

const usageDays: UsageDay[] = (() => {
  const r = rng(1414);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(NOW - (13 - i) * DAY);
    const weekend = d.getDay() % 6 === 0;
    const base = weekend ? 0.9e6 : 2.6e6;
    const total = i === 13 ? 1_840_000 : r() < 0.08 ? 0 : Math.round(base * (0.45 + r() * 1.1) + i * 60_000);
    const sessions = total ? Math.max(1, Math.round(total / 520_000)) : 0;
    return { date: ymd(d), ...totals(total, 300 + i, sessions) };
  });
})();

interface SessionSpec {
  project: string; title: string | null; model: string; ago: number; ran: number; total: number; messages: number;
  ctx: number; window: number;
}

const sessionSpecs: SessionSpec[] = [
  { project: 'claudehub', title: 'Add a Usage screen with plan limits, sessions and tokens', model: 'claude-opus-5-5', ago: 1 * MIN, ran: 95 * MIN, total: 1_120_000, messages: 142, ctx: 870_000, window: 1_000_000 },
  { project: 'budget-app', title: 'Fix the failing net worth chart test on #42', model: 'claude-sonnet-5', ago: 4 * MIN, ran: 22 * MIN, total: 318_000, messages: 42, ctx: 205_000, window: 1_000_000 },
  { project: 'bets-tracker', title: 'Grade parlays with void legs', model: 'claude-opus-5-5', ago: 48 * MIN, ran: 40 * MIN, total: 540_000, messages: 77, ctx: 312_000, window: 1_000_000 },
  { project: 'budget-android', title: null, model: 'claude-sonnet-5', ago: 5 * HOUR, ran: 18 * MIN, total: 210_000, messages: 31, ctx: 96_000, window: 200_000 },
  { project: 'claudehub', title: 'Review the job runner queue for races', model: 'claude-opus-5-5', ago: 26 * HOUR, ran: 55 * MIN, total: 760_000, messages: 98, ctx: 455_000, window: 1_000_000 },
  { project: 'league-history', title: 'Import the 2019 season standings', model: 'claude-sonnet-5', ago: 3 * DAY, ran: 12 * MIN, total: 96_000, messages: 18, ctx: 61_000, window: 200_000 },
];

const usageSessions: UsageSession[] = sessionSpecs.map((x, i) => {
  const p = projects.find(q => q.name === x.project);
  return {
    sessionId: `9f1c${i}a2e-4b7d-4c1e-9a3f-${String(i).padStart(12, '0')}`,
    projectId: p?.id ?? null,
    projectName: x.project,
    cwd: `${ROOT}/${x.project}`,
    model: x.model,
    startedAt: isoAt(x.ago + x.ran),
    lastActivityAt: isoAt(x.ago),
    active: x.ago < 10 * MIN,
    title: x.title,
    totals: { ...totals(x.total, 900 + i, 1), messages: x.messages },
    contextTokens: x.ctx,
    contextWindow: x.window,
    contextPercent: Math.round((x.ctx / x.window) * 1000) / 10,
  };
});

function usage(): Usage {
  const week = addTotals(usageDays.slice(-7));
  const projectShares: [string, number][] = [
    ['claudehub', 0.41], ['budget-app', 0.22], ['bets-tracker', 0.14], ['budget-android', 0.09],
    ['league-history', 0.06], ['Projects', 0.04], ['scratch-notes', 0.03], ['bracketeer', 0.01],
  ];
  const fiveReset = new Date(NOW + 2 * HOUR + 14 * MIN + 20_000);
  const weekReset = new Date(NOW + 3 * DAY);
  weekReset.setHours(9, 0, 0, 0);
  const captured = !USAGE_EMPTY;
  return {
    generatedAt: new Date().toISOString(),
    limits: captured
      ? {
          fiveHour: { usedPercentage: USAGE_HIGH ? 93 : 31, resetsAt: fiveReset.toISOString() },
          sevenDay: { usedPercentage: USAGE_HIGH ? 78 : 64, resetsAt: weekReset.toISOString() },
          capturedAt: isoAt(4 * MIN),
        }
      : { fiveHour: null, sevenDay: null, capturedAt: null },
    statusline,
    lastRateLimit: captured
      ? { status: 'allowed_warning', utilization: 78, resetsAt: weekReset.toISOString(), at: isoAt(2 * MIN) }
      : null,
    today: usageDays[13],
    week,
    days: usageDays,
    byModel: [
      { model: 'claude-opus-5-5', total: Math.round(week.total * 0.74) },
      { model: 'claude-sonnet-5', total: Math.round(week.total * 0.23) },
      { model: 'claude-haiku-4-5', total: Math.round(week.total * 0.03) },
    ],
    byProject: projectShares.map(([name, share]) => ({
      projectId: projects.find(q => q.name === name)?.id ?? null,
      name,
      total: Math.round(week.total * share),
    })),
    sessions: usageSessions,
  };
}

// ---------- Router ----------

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function mockRequest(method: string, path: string, body: unknown): Promise<unknown> {
  await wait(120 + Math.random() * 160);
  if (new URLSearchParams(location.search).get('offline') === '1') throw new ApiError('offline', 0, 'Agent offline');

  const url = new URL(path, 'http://x');
  const parts = url.pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
  const route = `${method} ${parts[0]}`;

  switch (route) {
    case 'GET health': return health();
    case 'GET overview': return overview();
    case 'GET projects': {
      if (parts[1]) {
        const p = projects.find(x => x.id === parts[1]);
        if (!p) throw new ApiError('http', 404, 'Project not found');
        return detail(p);
      }
      return projects;
    }
    case 'POST projects': {
      if (!parts[1]) return createProject(body as NewProjectRequest);
      const p = projects.find(x => x.id === parts[1]);
      if (!p) throw new ApiError('http', 404, 'Project not found');
      return projectAction(p, (body as { action: ProjectAction }).action);
    }
    case 'GET pulls': {
      const state = url.searchParams.get('state') ?? 'open';
      const list = state === 'all' ? pulls : pulls.filter(x => x.state === 'open');
      return [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    case 'POST refresh': {
      scanningUntil = Date.now() + 2600;
      setTimeout(() => { lastScanAt = new Date().toISOString(); }, 2600);
      return { ok: true };
    }
    case 'GET jobs': {
      if (parts[1]) {
        const j = jobs.find(x => x.id === parts[1]);
        if (!j) throw new ApiError('http', 404, 'Run not found');
        return publicJob(j, true);
      }
      return [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(j => publicJob(j));
    }
    case 'POST jobs': {
      if (parts[2] === 'cancel') {
        const j = jobs.find(x => x.id === parts[1]);
        if (!j) throw new ApiError('http', 404, 'Run not found');
        if (j.status === 'running' || j.status === 'queued') {
          j.status = 'cancelled';
          j.finishedAt = new Date().toISOString();
          emit(j.id, { kind: 'status', job: publicJob(j) });
        }
        return publicJob(j);
      }
      const req = body as NewJobRequest;
      if (!req.prompt?.trim()) throw new ApiError('http', 400, 'Prompt is empty');
      const j = makeJob(req, 0, 'queued');
      jobs.unshift(j);
      ensureTicker();
      return publicJob(j);
    }
    case 'POST suggestions': {
      await wait(2600);
      aiAt = new Date().toISOString();
      aiSuggestions = mockNextEdits();
      return aiSuggestions;
    }
    case 'GET usage': return usage();
    case 'POST usage': {
      const enabled = !!(body as { enabled?: boolean })?.enabled;
      statusline = enabled
        ? { installed: true, chained: statusline.chained }
        : { installed: false, chained: statusline.chained };
      return { ok: true, message: enabled ? 'Usage capture on' : 'Usage capture off' } satisfies ActionResult;
    }
    case 'GET settings': return settings;
    case 'PUT settings': {
      settings = { ...settings, ...(body as Partial<Settings>) };
      return settings;
    }
  }
  throw new ApiError('http', 404, `No mock for ${method} ${path}`);
}

function projectAction(p: Project, action: ProjectAction): ActionResult {
  switch (action) {
    case 'open-editor': return { ok: true, message: `Opened ${p.name} in ${settings.editor}` };
    case 'open-finder': return { ok: true, message: `Opened ${p.name} in Finder` };
    case 'open-terminal': return { ok: true, message: `Opened Terminal in ${p.name}` };
    case 'fetch': return { ok: true, message: 'Fetched. Nothing new.' };
    case 'pull': {
      if (p.local?.dirtyFiles) return { ok: false, message: 'Pull stopped: uncommitted changes' };
      if (p.local) p.local.behind = 0;
      return { ok: true, message: `Pulled ${p.name}` };
    }
    case 'clone': {
      p.local = {
        path: `${ROOT}/${p.name}`, branch: 'main', dirtyFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0,
        hasUpstream: true, lastCommitAt: p.lastActivityAt, lastCommitMessage: null, commitsLast30: p.commitsLast30,
        hasClaudeMd: false, remoteUrl: `git@github.com:${p.github?.fullName}.git`,
      };
      return { ok: true, message: `Cloned into ~/Desktop/Projects/${p.name}` };
    }
  }
}

function createProject(req: NewProjectRequest): NewProjectResult {
  const name = (req.name ?? '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ApiError('http', 400, 'Use letters, digits, . _ or -');
  if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: `${name} already exists`, project: null, job: null };
  }
  const now = new Date().toISOString();
  const project: Project = {
    id: `local:${name}`,
    name, description: null,
    local: {
      path: `${settings.projectsDir}/${name}`, branch: 'main', dirtyFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0,
      hasUpstream: false, lastCommitAt: now, lastCommitMessage: 'Initial commit', commitsLast30: 1, hasClaudeMd: false,
      remoteUrl: null,
    },
    github: null,
    stack: [],
    commitsByDay: [...Array(29).fill(0), 1],
    commitsLast30: 1,
    activityScore: 130,
    lastActivityAt: now,
    status: 'active',
  };
  projects.unshift(project);
  let job: Job | null = null;
  if (req.prompt?.trim()) {
    const j = makeJob({ projectId: project.id, prompt: req.prompt.trim(), permission: req.permission ?? 'auto', model: req.model ?? null }, 0, 'queued');
    jobs.unshift(j);
    ensureTicker();
    job = publicJob(j);
  }
  return { ok: true, message: `Created ${name}`, project, job };
}
