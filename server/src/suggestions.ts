import fs from 'node:fs';
import path from 'node:path';
import type { Project, Suggestion } from '../../shared/types.ts';
import type { Snapshot } from './merge.ts';
import { readJson, writeJson } from './store.ts';
import { extractJsonObject, runClaudeJson } from './claude.ts';
import { fetchRecentWork, resolveToken, type RecentWork } from './github.ts';
import { git } from './git.ts';
import { daysSince, errMsg, log, truncate, warn } from './util.ts';

const DAY = 86_400_000;
const CAP = 12;

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ruleSuggestions(snap: Snapshot, now = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  const byId = new Map(snap.projects.map((p) => [p.id, p]));
  const add = (p: Project | null, s: Omit<Suggestion, 'projectId' | 'projectName' | 'source' | 'id'> & { idSuffix?: string }) => {
    const { idSuffix, ...rest } = s;
    out.push({
      ...rest,
      id: `${s.kind}:${p?.id ?? 'none'}${idSuffix ? ':' + idSuffix : ''}`,
      projectId: p?.id ?? null,
      projectName: p?.name ?? null,
      source: 'rules',
    });
  };

  for (const p of snap.projects) {
    const l = p.local;
    const extra = snap.extras[p.id];
    if (l) {
      const changed = l.dirtyFiles + l.untrackedFiles;
      const age = extra?.dirtySince ? (now - Date.parse(extra.dirtySince)) / DAY : null;
      if (changed > 0 && age !== null && age >= 1) {
        add(p, {
          kind: 'uncommitted',
          title: `${plural(changed, 'uncommitted file')}`,
          detail: `Changes have been sitting for ${Math.floor(age)} ${Math.floor(age) === 1 ? 'day' : 'days'}.`,
          priority: age >= 3 ? 2 : 3,
          action: {
            type: 'prompt',
            prompt: 'Review the uncommitted changes in this repo (git diff and git status) and commit them with a good, descriptive commit message. Group unrelated changes into separate commits.',
            permission: 'acceptEdits',
          },
        });
      }
      if (l.ahead > 0) {
        add(p, {
          kind: 'unpushed',
          title: `${plural(l.ahead, 'unpushed commit')}`,
          detail: `${l.branch ?? 'This branch'} is ahead of its upstream.`,
          priority: 3,
          action: p.github ? { type: 'link', url: p.github.url } : null,
        });
      }
      if (l.behind > 0) {
        add(p, {
          kind: 'behind',
          title: `Behind upstream by ${l.behind}`,
          detail: `${l.branch ?? 'This branch'} has ${plural(l.behind, 'commit')} to pull.`,
          priority: 2,
          action: { type: 'project-action', action: 'pull' },
        });
      }
      if (!l.hasClaudeMd && p.status === 'active') {
        add(p, {
          kind: 'no-claude-md',
          title: 'No CLAUDE.md',
          detail: 'Active repo without project notes for Claude.',
          priority: 3,
          action: {
            type: 'prompt',
            prompt: "Create a CLAUDE.md describing this repo's structure, commands and conventions.",
            permission: 'acceptEdits',
          },
        });
      }
    }
  }

  for (const pr of snap.pulls) {
    if (!pr.isMine || pr.state !== 'open') continue;
    const p = byId.get(pr.projectId) ?? null;
    const age = (now - Date.parse(pr.updatedAt)) / DAY;
    if (pr.checks === 'failure') {
      add(p, {
        kind: 'ci-failing',
        title: `Failing CI on #${pr.number}`,
        detail: truncate(pr.title, 90),
        priority: 1,
        idSuffix: String(pr.number),
        action: { type: 'prompt', prompt: `Fix the failing CI on PR #${pr.number}`, permission: 'acceptEdits' },
      });
    } else if (pr.reviewDecision === 'APPROVED' && pr.checks === 'success' && !pr.draft) {
      add(p, {
        kind: 'pr-ready',
        title: `PR #${pr.number} ready to merge`,
        detail: `Approved with passing checks: ${truncate(pr.title, 70)}`,
        priority: 1,
        idSuffix: String(pr.number),
        action: { type: 'link', url: pr.url },
      });
    } else if (age > 7) {
      add(p, {
        kind: 'stale-pr',
        title: `PR #${pr.number} waiting ${Math.floor(age)} days`,
        detail: truncate(pr.title, 90),
        priority: 3,
        idSuffix: String(pr.number),
        action: { type: 'link', url: pr.url },
      });
    }
  }

  let staleCount = 0;
  for (const p of snap.projects) {
    if (p.status !== 'stale' || !p.local) continue;
    const age = daysSince(p.lastActivityAt, now);
    if (age === null || age < 60 || staleCount >= 2) continue;
    staleCount++;
    add(p, {
      kind: 'stale-project',
      title: `Quiet for ${Math.floor(age)} days`,
      detail: 'Worth reviving or archiving?',
      priority: 3,
      action: {
        type: 'prompt',
        prompt: 'Look over this repo and tell me where it was left off, and whether it is worth reviving or archiving. Do not change any files.',
        permission: 'plan',
      },
    });
  }

  const score = new Map(snap.projects.map((p) => [p.id, p.activityScore]));
  out.sort((a, b) => a.priority - b.priority || (score.get(b.projectId ?? '') ?? 0) - (score.get(a.projectId ?? '') ?? 0));
  return out.slice(0, CAP);
}

// ---------------------------------------------------------------------------------------------
// Claude suggestions: next edits based on the most recently worked-on projects

interface AiCache { generatedAt: string; fingerprint?: string; suggestions: Suggestion[] }

const RECENT_PROJECTS = 5;
const MIN_AUTO_GAP = 20 * 60_000; // at most one automatic generation every 20 minutes

let aiCache: AiCache | null = readJson<AiCache>('ai-suggestions.json');
let aiInFlight: Promise<Suggestion[]> | null = null;
let lastAutoAttempt = 0;

export function aiSuggestions(): Suggestion[] { return aiCache?.suggestions ?? []; }
export function aiSuggestionsAt(): string | null { return aiCache?.generatedAt ?? null; }
export function aiSuggestionsRunning(): boolean { return aiInFlight !== null; }

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 3 },
          permission: { type: 'string', enum: ['plan', 'acceptEdits', 'auto'] },
          prompt: { type: 'string' },
        },
        required: ['projectId', 'title', 'detail', 'priority', 'permission', 'prompt'],
      },
    },
  },
  required: ['suggestions'],
};

/** The projects worked on most recently (last 30 days), newest first. */
export function recentProjects(snap: Snapshot, now = Date.now()): Project[] {
  return snap.projects
    .filter((p) => !p.github?.archived && p.lastActivityAt && now - Date.parse(p.lastActivityAt) <= 30 * DAY)
    .sort((a, b) => Date.parse(b.lastActivityAt!) - Date.parse(a.lastActivityAt!))
    .slice(0, RECENT_PROJECTS);
}

function fingerprint(projects: Project[]): string {
  return projects
    .map((p) => `${p.id}@${p.lastActivityAt}:${p.github?.openPRs ?? 0}:${p.local ? p.local.dirtyFiles + p.local.untrackedFiles : '-'}`)
    .join('|');
}

/** Regenerate in the background when recent activity changed. Never throws. */
export function maybeAutoGenerate(snap: Snapshot, cwd: string): void {
  const recent = recentProjects(snap);
  if (!recent.length || aiInFlight) return;
  const fp = fingerprint(recent);
  if (aiCache?.fingerprint === fp) return;
  if (Date.now() - lastAutoAttempt < MIN_AUTO_GAP) return;
  lastAutoAttempt = Date.now();
  log(`suggestions: recent work changed, asking Claude for next edits`);
  generateAiSuggestions(snap, cwd).then(
    (s) => log(`suggestions: ${s.length} next edits from Claude`),
    (e) => warn('suggestions: Claude run failed:', errMsg(e)),
  );
}

export function generateAiSuggestions(snap: Snapshot, cwd: string): Promise<Suggestion[]> {
  if (aiInFlight) return aiInFlight;
  aiInFlight = doGenerate(snap, cwd).finally(() => { aiInFlight = null; });
  return aiInFlight;
}

async function localContext(p: Project) {
  const dir = p.local!.path;
  const [log, status, diff] = await Promise.all([
    git(dir, ['log', '-n', '12', '--format=%as %s']),
    git(dir, ['status', '--short']),
    git(dir, ['diff', '--stat', 'HEAD']),
  ]);
  const read = (f: string, n: number) => {
    try { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return t.length > n ? t.slice(0, n) + '…' : t; } catch { return null; }
  };
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== '.git')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .slice(0, 60);
  } catch { /* unreadable */ }
  return {
    branch: p.local!.branch,
    recentCommits: log.ok ? log.stdout.split('\n').filter(Boolean) : [],
    uncommitted: status.ok ? status.stdout.split('\n').filter(Boolean).slice(0, 30) : [],
    diffStat: diff.ok ? truncate(diff.stdout.trim(), 1500) : '',
    readme: read('README.md', 2500),
    claudeMd: read('CLAUDE.md', 2000),
    files,
  };
}

async function doGenerate(snap: Snapshot, cwd: string): Promise<Suggestion[]> {
  const recent = recentProjects(snap);
  const fp = fingerprint(recent);
  if (!recent.length) {
    aiCache = { generatedAt: new Date().toISOString(), fingerprint: fp, suggestions: [] };
    writeJson('ai-suggestions.json', aiCache);
    return [];
  }

  const token = await resolveToken();
  const onGithub = recent.filter((p) => p.github).map((p) => p.github!.fullName);
  let remote: RecentWork[] = [];
  if (token && onGithub.length) {
    try { remote = await fetchRecentWork(token, onGithub); } catch (e) { warn('suggestions: GitHub recent work failed:', errMsg(e)); }
  }
  const byName = new Map(remote.map((r) => [r.fullName.toLowerCase(), r]));

  const projects = await Promise.all(recent.map(async (p) => {
    const gh = p.github ? byName.get(p.github.fullName.toLowerCase()) : undefined;
    const local = p.local ? await localContext(p) : null;
    return {
      projectId: p.id,
      name: p.name,
      description: p.description,
      stack: p.stack,
      lastActivity: p.lastActivityAt?.slice(0, 10) ?? null,
      onThisMac: Boolean(p.local),
      github: gh ? {
        repo: gh.fullName,
        defaultBranch: gh.defaultBranch,
        recentCommits: gh.commits.map((c) => `${c.date} ${c.message}`),
        recentPullRequests: gh.pulls.map((r) => ({ number: r.number, title: r.title, state: r.state, updated: r.updatedAt, body: r.body })),
        files: gh.files,
        readme: gh.readme,
        claudeMd: gh.claudeMd,
      } : null,
      local: local ? { ...local, readme: gh?.readme ? null : local.readme, claudeMd: gh?.claudeMd ? null : local.claudeMd } : null,
    };
  }));

  const prompt =
    `You are helping a solo developer pick their next edits. Below are the ${projects.length} projects they worked on most recently, ` +
    `newest first, with recent commits, pull requests, uncommitted changes, file lists, README and CLAUDE.md.\n\n` +
    `Propose up to 8 next edits, 1 or 2 per project, favouring the most recent projects. Each should build directly on what they were just doing: ` +
    `finish an open thread, fix a rough edge the commits hint at, add a missing test, polish UI they just touched, or commit/clean up uncommitted work. ` +
    `Be specific to this code (name files, screens or features you can see); never suggest generic chores like "add CI" or "write docs" unless the evidence points there.\n\n` +
    `For each: projectId (exactly as given), a short noun-first title (max 60 characters), one calm sentence of detail saying why now (no exclamation marks), ` +
    `priority 1 (do first) to 3, permission ("plan" if it needs investigation or a decision first, "acceptEdits" for edits, "auto" if it must run commands such as tests or builds), ` +
    `and a self-contained prompt for Claude Code running inside that project's folder: state the goal, the relevant files, and how to check the result. ` +
    `Respond only with JSON matching the schema. Do not use any tools; everything you need is below.\n\n${JSON.stringify(projects)}`;
  const res = await runClaudeJson(prompt, { cwd, model: 'sonnet', schema: SCHEMA, timeoutMs: 5 * 60_000 });
  let parsed: any = res.structured;
  if (!parsed && res.text) parsed = extractJsonObject(res.text);
  const list: any[] | null = Array.isArray(parsed?.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : null;
  if (!list) throw new Error('Claude did not return suggestions in the expected format.');
  const ids = new Map(snap.projects.map((p) => [p.id, p]));
  const suggestions: Suggestion[] = [];
  for (const [i, s] of list.slice(0, 8).entries()) {
    if (!s || typeof s.title !== 'string' || typeof s.prompt !== 'string') continue;
    const project = typeof s.projectId === 'string' ? ids.get(s.projectId) ?? ids.get(s.projectId.toLowerCase()) ?? null : null;
    const pr = Number(s.priority);
    const permission = s.permission === 'plan' || s.permission === 'auto' ? s.permission : 'acceptEdits';
    suggestions.push({
      id: `ai:${i}:${project?.id ?? 'none'}`,
      kind: 'ai',
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      title: truncate(s.title, 80),
      detail: truncate(String(s.detail ?? ''), 200),
      priority: pr === 1 || pr === 2 || pr === 3 ? pr : 2,
      action: { type: 'prompt', prompt: s.prompt, permission },
      source: 'claude',
    });
  }
  aiCache = { generatedAt: new Date().toISOString(), fingerprint: fp, suggestions };
  writeJson('ai-suggestions.json', aiCache);
  return suggestions;
}
