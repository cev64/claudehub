// Shared API contract between the Mac agent (server/) and the dashboard (web/).
// Every JSON response from /api/* uses these shapes. Dates are ISO 8601 strings.

export type ProjectStatus = 'active' | 'idle' | 'stale';

export interface LocalRepo {
  path: string;                 // absolute path on the Mac
  branch: string | null;        // null when detached
  dirtyFiles: number;           // modified + staged tracked files
  untrackedFiles: number;
  ahead: number;                // commits not pushed to upstream
  behind: number;               // commits on upstream not pulled
  hasUpstream: boolean;
  lastCommitAt: string | null;
  lastCommitMessage: string | null;
  commitsLast30: number;
  hasClaudeMd: boolean;
  remoteUrl: string | null;
}

export interface GithubRepo {
  fullName: string;             // "cev64/claudehub"
  url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string | null;
  pushedAt: string | null;
  openPRs: number;
  openIssues: number;
  stars: number;
  language: string | null;
  commitsLast30: number;        // on the default branch
}

export interface Project {
  id: string;                   // github full name lowercased ("cev64/claudehub"), or "local:<folder>"
  name: string;
  description: string | null;
  local: LocalRepo | null;      // null = only on GitHub (not cloned on the Mac)
  github: GithubRepo | null;    // null = local only (no GitHub remote)
  stack: string[];              // e.g. ["React", "Vite", "TypeScript", "Supabase"]
  commitsByDay: number[];       // last 30 days, oldest first, local+GitHub de-duplicated by sha
  commitsLast30: number;
  activityScore: number;        // higher = more active; used to rank "most active"
  lastActivityAt: string | null;
  status: ProjectStatus;        // active: activity < 7d, idle: < 30d, stale: older
}

export interface CommitSummary {
  sha: string;
  message: string;              // first line
  author: string;
  date: string;
}

export interface ProjectDetail extends Project {
  readmeExcerpt: string | null; // first ~600 chars of README, markdown stripped of images
  claudeMdExcerpt: string | null;
  recentCommits: CommitSummary[];
  pulls: PullRequest[];         // open + recently closed PRs for this repo
  jobs: Job[];                  // Claude runs for this project, newest first
  changedFiles: { path: string; status: string }[]; // from git status, max 50
}

export type PrState = 'open' | 'closed' | 'merged';
export type ChecksState = 'success' | 'failure' | 'pending' | null;

export interface PullRequest {
  id: string;                   // "<fullName>#<number>"
  number: number;
  title: string;
  url: string;
  repoFullName: string;
  projectId: string;
  state: PrState;
  draft: boolean;
  author: string;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  checks: ChecksState;
  additions: number;
  deletions: number;
  headRef: string;
}

export type SuggestionKind =
  | 'uncommitted' | 'unpushed' | 'behind' | 'stale-pr' | 'pr-ready' | 'ci-failing'
  | 'not-cloned' | 'no-claude-md' | 'stale-project' | 'ai';

export type SuggestionAction =
  | { type: 'prompt'; prompt: string; permission: PermissionLevel }
  | { type: 'project-action'; action: ProjectAction }
  | { type: 'link'; url: string };

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  projectId: string | null;
  projectName: string | null;
  title: string;                // short, noun-first ("3 uncommitted files")
  detail: string;               // one quiet line
  priority: 1 | 2 | 3;          // 1 = highest
  action: SuggestionAction | null;
  source: 'rules' | 'claude';
}

export interface DayCount { date: string; commits: number } // date = YYYY-MM-DD (local time)

export interface OverviewStats {
  projects: number;
  localRepos: number;
  githubRepos: number;
  localOnly: number;
  notCloned: number;
  openPRs: number;              // open PRs across my repos
  prsAuthored: number;          // all-time PRs I opened (GitHub search total)
  prsMerged30: number;          // my PRs merged in the last 30 days
  commits30: number;
  dirtyRepos: number;
  runningJobs: number;
}

export interface Overview {
  generatedAt: string;
  stats: OverviewStats;
  mostActive: Project | null;
  topProjects: Project[];       // up to 5 by activityScore
  activity: DayCount[];         // last 30 days, all projects
  suggestions: Suggestion[];    // rules + cached Claude suggestions, sorted by priority
  aiSuggestionsAt: string | null;
}

// Jobs run `claude -p` in the repo on the Mac.
export type PermissionLevel = 'plan' | 'acceptEdits' | 'auto';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobEvent {
  ts: string;
  type: 'system' | 'text' | 'tool' | 'result' | 'error';
  text: string;
  tool?: string;
}

export interface Job {
  id: string;
  projectId: string | null;
  projectName: string | null;
  cwd: string;
  prompt: string;
  permission: PermissionLevel;
  model: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  sessionId: string | null;     // Claude session id, usable to continue the conversation
  resultText: string | null;
  error: string | null;
  events?: JobEvent[];          // only on GET /api/jobs/:id
}

export interface NewJobRequest {
  projectId: string | null;     // null = run in the projects folder root
  prompt: string;
  permission: PermissionLevel;
  model?: string | null;        // 'opus' | 'sonnet' | 'haiku' | full id; null = CLI default
  resumeSessionId?: string | null;
}

export type ProjectAction =
  | 'open-editor' | 'open-finder' | 'open-terminal' | 'fetch' | 'pull' | 'clone';

export interface ActionResult { ok: boolean; message: string }

// Create a new project folder on the Mac (git init + README + first commit),
// optionally a GitHub repo for it, and optionally start Claude in it right away.
export interface NewProjectRequest {
  name: string;                 // folder name: letters, digits, '.', '_', '-'
  createGithubRepo: boolean;    // uses `gh repo create` (needs gh login)
  privateRepo: boolean;
  prompt?: string | null;       // if set, starts a local job in the new folder
  permission?: PermissionLevel; // for that job, default 'auto'
  model?: string | null;
}

export interface NewProjectResult {
  ok: boolean;
  message: string;
  project: Project | null;
  job: Job | null;
}

export interface Settings {
  projectsDir: string;          // e.g. /Users/charlie/Desktop/Projects
  scanDepth: number;            // 1-3, how deep to look for git repos
  editor: string;               // macOS app name for `open -a`, e.g. "Visual Studio Code", "Cursor"
  refreshMinutes: number;       // background rescan interval
  defaultModel: string | null;
  githubUser: string | null;    // detected from the token
}

export interface HealthCheck { ok: boolean; detail: string }

export interface Health {
  ok: boolean;
  version: string;
  hostname: string;
  checks: {
    git: HealthCheck;
    projectsDir: HealthCheck;
    github: HealthCheck;        // token found + user login
    claude: HealthCheck;        // CLI found + version
  };
  lastScanAt: string | null;
  scanning: boolean;
}

// ---- Claude usage -----------------------------------------------------------
// Plan limits come from Claude Code's status line JSON (`rate_limits`), captured by
// scripts/statusline.mjs whenever an interactive Claude Code session runs on the Mac.
// Token counts come from Claude Code transcripts in ~/.claude/projects/*/*.jsonl.

export interface PlanLimit {
  usedPercentage: number;       // 0-100
  resetsAt: string | null;
}

export interface TokenTotals {
  input: number;                // uncached input tokens
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;                // input + output + cacheCreation (cache reads shown separately)
  sessions: number;
  messages: number;             // assistant messages
}

export interface UsageDay extends TokenTotals { date: string } // YYYY-MM-DD local

export interface UsageSession {
  sessionId: string;
  projectId: string | null;     // matched to a Project by cwd when possible
  projectName: string;          // project name or cwd folder name
  cwd: string | null;
  model: string | null;         // last model used, e.g. "claude-opus-5-5"
  startedAt: string | null;
  lastActivityAt: string;
  active: boolean;              // activity in the last 10 minutes
  title: string | null;         // first user prompt, first line, max 120 chars
  totals: TokenTotals;          // sessions = 1
  contextTokens: number;        // last assistant message: input + cacheCreation + cacheRead
  contextWindow: number;        // from status line if captured, else 1_000_000 or 200_000 by model
  contextPercent: number;       // 0-100
}

export interface RateLimitNotice {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  utilization: number | null;   // as reported, 0-100 or 0-1 normalised to 0-100
  resetsAt: string | null;
  at: string;
}

export interface Usage {
  generatedAt: string;
  limits: {
    fiveHour: PlanLimit | null;
    sevenDay: PlanLimit | null;
    capturedAt: string | null;  // when the status line last reported them
  };
  statusline: {
    installed: boolean;         // our capture script is the statusLine command in ~/.claude/settings.json
    chained: string | null;     // the user's previous statusLine command, still run and shown
  };
  lastRateLimit: RateLimitNotice | null; // latest rate_limit_event seen in a ClaudeHub run
  today: TokenTotals;
  week: TokenTotals;            // last 7 days including today
  days: UsageDay[];             // last 14 days, oldest first
  byModel: { model: string; total: number }[];                       // last 7 days, desc
  byProject: { projectId: string | null; name: string; total: number }[]; // last 7 days, top 8
  sessions: UsageSession[];     // up to 30, most recent activity first
}

// SSE on GET /api/jobs/:id/stream sends `data: <JSON>` lines of:
export type JobStreamMessage =
  | { kind: 'event'; event: JobEvent }
  | { kind: 'status'; job: Job };

/*
REST endpoints (all JSON; when CLAUDEHUB_TOKEN is set, non-loopback requests need
`Authorization: Bearer <token>` or `?token=` for SSE):

GET  /api/health                      -> Health
GET  /api/overview                    -> Overview
GET  /api/projects                    -> Project[]
POST /api/projects                   body NewProjectRequest -> NewProjectResult
GET  /api/projects/:id                -> ProjectDetail      (id is URL-encoded)
POST /api/projects/:id/actions        body { action: ProjectAction } -> ActionResult
GET  /api/pulls?state=open|all        -> PullRequest[]
POST /api/refresh                     -> { ok: true }       (starts a rescan; poll /api/health.scanning)
GET  /api/jobs                        -> Job[]              (newest first, no events)
POST /api/jobs                        body NewJobRequest -> Job
GET  /api/jobs/:id                    -> Job (with events)
GET  /api/jobs/:id/stream             -> text/event-stream of JobStreamMessage
POST /api/jobs/:id/cancel             -> Job
POST /api/suggestions/ai              -> Suggestion[]       (asks Claude over the current overview; may take ~1 min)
GET  /api/usage                       -> Usage
POST /api/usage/statusline            body { enabled: boolean } -> ActionResult   (installs/removes the capture script)
GET  /api/settings                    -> Settings
PUT  /api/settings                    body Partial<Settings> -> Settings
*/
