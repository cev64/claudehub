import type { GithubRepo, PullRequest, ChecksState } from '../../shared/types.ts';
import { run, findBinary, log } from './util.ts';

export interface GithubCommit { sha: string; ts: number }

export interface GithubRepoData {
  repo: GithubRepo;
  commits: GithubCommit[];
}

export interface GithubData {
  login: string;
  syncedAt: string;
  repos: GithubRepoData[];
  pulls: PullRequest[];
  prsAuthored: number;
  prsMerged30: number;
}

export const NO_TOKEN_HELP = 'No GitHub token found. Run: gh auth login (or set GITHUB_TOKEN). Showing local repos only.';

let tokenCache: { token: string | null; at: number } | null = null;

export function invalidateToken(): void {
  tokenCache = null;
}

export async function resolveToken(): Promise<string | null> {
  const env = process.env.GITHUB_TOKEN?.trim();
  if (env) return env;
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60_000) return tokenCache.token;
  const gh = findBinary('gh', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
  let token: string | null = null;
  if (gh) {
    const r = await run(gh, ['auth', 'token'], { timeoutMs: 10_000 });
    const t = r.stdout.trim();
    if (r.ok && t && !/\s/.test(t)) token = t;
  }
  tokenCache = { token, at: Date.now() - (token ? 0 : 9 * 60_000) }; // retry a missing token after ~1 minute
  return token;
}

async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'claudehub-agent',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401) {
    invalidateToken();
    throw new Error('GitHub rejected the token (401). Run: gh auth login');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (!json.data) throw new Error(`GitHub API: ${json.errors?.map((e) => e.message).join('; ') ?? 'no data'}`);
  if (json.errors?.length) log('github: partial errors:', json.errors.map((e) => e.message).slice(0, 2).join('; '));
  return json.data;
}

const REPOS_QUERY = `
query($after: String, $since: GitTimestamp!) {
  viewer {
    login
    repositories(first: 100, after: $after, ownerAffiliations: [OWNER, COLLABORATOR], orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner url description isPrivate isFork isArchived pushedAt stargazerCount
        primaryLanguage { name }
        defaultBranchRef {
          name
          target { ... on Commit { history(first: 100, since: $since) { totalCount nodes { oid committedDate } } } }
        }
        pullRequests(states: OPEN) { totalCount }
        issues(states: OPEN) { totalCount }
      }
    }
  }
}`;

const PR_FIELDS = `
  ... on PullRequest {
    number title url state isDraft createdAt updatedAt mergedAt reviewDecision additions deletions headRefName
    author { login }
    repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

const PRS_QUERY = `
query($mine: String!, $merged: String!, $others: String!) {
  mine: search(type: ISSUE, query: $mine, first: 50) { issueCount nodes { ${PR_FIELDS} } }
  merged: search(type: ISSUE, query: $merged, first: 1) { issueCount }
  others: search(type: ISSUE, query: $others, first: 50) { issueCount nodes { ${PR_FIELDS} } }
}`;

interface RepoNode {
  nameWithOwner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  pushedAt: string | null;
  stargazerCount: number;
  primaryLanguage: { name: string } | null;
  defaultBranchRef: {
    name: string;
    target: { history?: { totalCount: number; nodes: { oid: string; committedDate: string }[] } } | null;
  } | null;
  pullRequests: { totalCount: number };
  issues: { totalCount: number };
}

interface PrNode {
  number?: number;
  title?: string;
  url?: string;
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft?: boolean;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string | null;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  additions?: number;
  deletions?: number;
  headRefName?: string;
  author?: { login: string } | null;
  repository?: { nameWithOwner: string };
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

export function mapChecks(state: string | undefined | null): ChecksState {
  switch (state) {
    case 'SUCCESS': return 'success';
    case 'FAILURE':
    case 'ERROR': return 'failure';
    case 'PENDING':
    case 'EXPECTED': return 'pending';
    default: return null;
  }
}

function mapPr(n: PrNode, login: string): PullRequest | null {
  if (!n.number || !n.repository || !n.url) return null;
  const full = n.repository.nameWithOwner;
  const author = n.author?.login ?? 'ghost';
  return {
    id: `${full}#${n.number}`,
    number: n.number,
    title: n.title ?? '',
    url: n.url,
    repoFullName: full,
    projectId: full.toLowerCase(),
    state: n.state === 'MERGED' ? 'merged' : n.state === 'CLOSED' ? 'closed' : 'open',
    draft: Boolean(n.isDraft),
    author,
    isMine: author.toLowerCase() === login.toLowerCase(),
    createdAt: n.createdAt ?? new Date(0).toISOString(),
    updatedAt: n.updatedAt ?? n.createdAt ?? new Date(0).toISOString(),
    mergedAt: n.mergedAt ?? null,
    reviewDecision: n.reviewDecision ?? null,
    checks: mapChecks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
    additions: n.additions ?? 0,
    deletions: n.deletions ?? 0,
    headRef: n.headRefName ?? '',
  };
}

export async function syncGithub(token: string): Promise<GithubData> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const sinceIso = since.toISOString();
  const repos: GithubRepoData[] = [];
  let login = '';
  let after: string | null = null;
  for (let page = 0; page < 3; page++) {
    const data: { viewer: { login: string; repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RepoNode | null)[] } } } =
      await gql(token, REPOS_QUERY, { after, since: sinceIso });
    login = data.viewer.login;
    for (const n of data.viewer.repositories.nodes) {
      if (!n) continue;
      const hist = n.defaultBranchRef?.target?.history;
      repos.push({
        repo: {
          fullName: n.nameWithOwner,
          url: n.url,
          description: n.description,
          private: n.isPrivate,
          fork: n.isFork,
          archived: n.isArchived,
          defaultBranch: n.defaultBranchRef?.name ?? null,
          pushedAt: n.pushedAt,
          openPRs: n.pullRequests.totalCount,
          openIssues: n.issues.totalCount,
          stars: n.stargazerCount,
          language: n.primaryLanguage?.name ?? null,
          commitsLast30: hist?.totalCount ?? 0,
        },
        commits: (hist?.nodes ?? []).map((c) => ({ sha: c.oid, ts: Date.parse(c.committedDate) })),
      });
    }
    const pi = data.viewer.repositories.pageInfo;
    if (!pi.hasNextPage || !pi.endCursor) break;
    after = pi.endCursor;
  }

  const day = since.toISOString().slice(0, 10);
  const pr = await gql<{
    mine: { issueCount: number; nodes: (PrNode | null)[] };
    merged: { issueCount: number };
    others: { nodes: (PrNode | null)[] };
  }>(token, PRS_QUERY, {
    mine: `is:pr author:${login} sort:updated-desc`,
    merged: `is:pr author:${login} is:merged merged:>=${day}`,
    others: `is:pr is:open user:${login} sort:updated-desc`,
  });

  const pulls = new Map<string, PullRequest>();
  for (const n of [...pr.mine.nodes, ...pr.others.nodes]) {
    if (!n) continue;
    const p = mapPr(n, login);
    if (p && !pulls.has(p.id)) pulls.set(p.id, p);
  }
  return {
    login,
    syncedAt: new Date().toISOString(),
    repos,
    pulls: [...pulls.values()],
    prsAuthored: pr.mine.issueCount,
    prsMerged30: pr.merged.issueCount,
  };
}

