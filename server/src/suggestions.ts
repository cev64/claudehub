import type { Overview, Project, Suggestion } from '../../shared/types.ts';
import type { Snapshot } from './merge.ts';
import { readJson, writeJson } from './store.ts';
import { extractJsonObject, runClaudeJson } from './claude.ts';
import { daysSince, truncate } from './util.ts';

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
    if (p.github && !p.local && !p.github.archived) {
      const pushed = daysSince(p.github.pushedAt, now);
      if (pushed !== null && pushed <= 30) {
        add(p, {
          kind: 'not-cloned',
          title: 'Repo not cloned',
          detail: `${p.github.fullName} had activity ${pushed < 1 ? 'today' : `${Math.floor(pushed)} days ago`} but is not on this Mac.`,
          priority: 3,
          action: { type: 'project-action', action: 'clone' },
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
// AI suggestions

interface AiCache { generatedAt: string; suggestions: Suggestion[] }

let aiCache: AiCache | null = readJson<AiCache>('ai-suggestions.json');

export function aiSuggestions(): Suggestion[] { return aiCache?.suggestions ?? []; }
export function aiSuggestionsAt(): string | null { return aiCache?.generatedAt ?? null; }

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          projectId: { type: ['string', 'null'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 3 },
          prompt: { type: 'string' },
        },
        required: ['projectId', 'title', 'detail', 'priority', 'prompt'],
      },
    },
  },
  required: ['suggestions'],
};

let aiInFlight: Promise<Suggestion[]> | null = null;

export function generateAiSuggestions(snap: Snapshot, overview: Overview, cwd: string): Promise<Suggestion[]> {
  if (aiInFlight) return aiInFlight;
  aiInFlight = doGenerate(snap, overview, cwd).finally(() => { aiInFlight = null; });
  return aiInFlight;
}

async function doGenerate(snap: Snapshot, overview: Overview, cwd: string): Promise<Suggestion[]> {
  const summary = {
    today: new Date().toISOString().slice(0, 10),
    projects: snap.projects.slice(0, 40).map((p) => ({
      id: p.id,
      status: p.status,
      stack: p.stack,
      commits30: p.commitsLast30,
      lastActivity: p.lastActivityAt?.slice(0, 10) ?? null,
      description: p.description ? truncate(p.description, 100) : null,
      cloned: Boolean(p.local),
      dirtyFiles: p.local ? p.local.dirtyFiles + p.local.untrackedFiles : 0,
      ahead: p.local?.ahead ?? 0,
      behind: p.local?.behind ?? 0,
      hasClaudeMd: p.local?.hasClaudeMd ?? null,
      openPRs: p.github?.openPRs ?? 0,
      openIssues: p.github?.openIssues ?? 0,
    })),
    openPullRequests: snap.pulls
      .filter((p) => p.state === 'open')
      .slice(0, 25)
      .map((p) => ({ project: p.projectId, number: p.number, title: truncate(p.title, 80), mine: p.isMine, checks: p.checks, review: p.reviewDecision, updated: p.updatedAt.slice(0, 10) })),
    existingSuggestions: overview.suggestions.filter((s) => s.source === 'rules').map((s) => `${s.projectId ?? '-'}: ${s.title}`),
  };
  const prompt =
    `You are helping a developer decide what to work on next. Below is a JSON summary of their projects, open pull requests and suggestions that were already generated by simple rules.\n` +
    `Propose up to 6 concrete, high-value next steps that go beyond the existing suggestions. Each needs: projectId (one of the project ids above, or null), a short noun-first title, ` +
    `one calm sentence of detail (no exclamation marks), a priority 1 (most important) to 3, and a self-contained prompt that Claude Code could run inside that project to start on it. ` +
    `Respond only with JSON matching the schema.\n\n${JSON.stringify(summary)}`;
  const res = await runClaudeJson(prompt, { cwd, model: 'sonnet', schema: SCHEMA, timeoutMs: 5 * 60_000 });
  let parsed: any = res.structured;
  if (!parsed && res.text) parsed = extractJsonObject(res.text);
  const list: any[] | null = Array.isArray(parsed?.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : null;
  if (!list) throw new Error('Claude did not return suggestions in the expected format.');
  const ids = new Map(snap.projects.map((p) => [p.id, p]));
  const suggestions: Suggestion[] = [];
  for (const [i, s] of list.slice(0, 6).entries()) {
    if (!s || typeof s.title !== 'string' || typeof s.prompt !== 'string') continue;
    const project = typeof s.projectId === 'string' ? ids.get(s.projectId.toLowerCase()) ?? ids.get(s.projectId) ?? null : null;
    const pr = Number(s.priority);
    suggestions.push({
      id: `ai:${i}:${project?.id ?? 'none'}`,
      kind: 'ai',
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      title: truncate(s.title, 80),
      detail: truncate(String(s.detail ?? ''), 200),
      priority: pr === 1 || pr === 2 || pr === 3 ? pr : 2,
      action: { type: 'prompt', prompt: s.prompt, permission: 'plan' },
      source: 'claude',
    });
  }
  aiCache = { generatedAt: new Date().toISOString(), suggestions };
  writeJson('ai-suggestions.json', aiCache);
  return suggestions;
}
