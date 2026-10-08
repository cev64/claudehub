// Typed client for the ClaudeHub agent (/api/*). With ?mock=1 every call is served by mock.ts.
import type {
  ActionResult, Health, Job, JobStreamMessage, NewJobRequest, NewProjectRequest, NewProjectResult, Overview, Project, ProjectAction,
  ProjectDetail, PullRequest, Settings, Suggestion,
} from '../../shared/types';

export const MOCK = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mock') === '1';

const TOKEN_KEY = 'claudehub.token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export type ApiErrorKind = 'offline' | 'unauthorized' | 'http';

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, public status: number, message: string) {
    super(message);
  }
}

/** Fired on any 401 so the shell can route to Settings. */
export const UNAUTHORIZED_EVENT = 'claudehub:unauthorized';

let mockModule: Promise<typeof import('./mock')> | null = null;
function mock() {
  mockModule ??= import('./mock');
  return mockModule;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const m = await mock();
    return m.mockRequest(method, path, body) as Promise<T>;
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('offline', 0, 'Agent offline');
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError('unauthorized', 401, 'Access token needed');
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try { data = JSON.parse(text); } catch { data = undefined; }
  }

  if (!res.ok) {
    // The dev proxy answers 5xx with an empty / non-JSON body when the agent isn't running.
    if (res.status >= 500 && data === undefined) throw new ApiError('offline', res.status, 'Agent offline');
    const msg = (data && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string')
      ? (data as { message: string }).message
      : (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string')
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError('http', res.status, msg);
  }
  if (data === undefined && text) throw new ApiError('offline', res.status, 'Agent offline');
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<Health>('GET', '/api/health'),
  overview: () => request<Overview>('GET', '/api/overview'),
  projects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (req: NewProjectRequest) => request<NewProjectResult>('POST', '/api/projects', req),
  project: (id: string) => request<ProjectDetail>('GET', `/api/projects/${enc(id)}`),
  projectAction: (id: string, action: ProjectAction) =>
    request<ActionResult>('POST', `/api/projects/${enc(id)}/actions`, { action }),
  pulls: (state: 'open' | 'all') => request<PullRequest[]>('GET', `/api/pulls?state=${state}`),
  refresh: () => request<{ ok: true }>('POST', '/api/refresh'),
  jobs: () => request<Job[]>('GET', '/api/jobs'),
  job: (id: string) => request<Job>('GET', `/api/jobs/${enc(id)}`),
  createJob: (req: NewJobRequest) => request<Job>('POST', '/api/jobs', req),
  cancelJob: (id: string) => request<Job>('POST', `/api/jobs/${enc(id)}/cancel`),
  aiSuggestions: () => request<Suggestion[]>('POST', '/api/suggestions/ai'),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('PUT', '/api/settings', s),
};

/** Subscribe to a job's live stream. Returns an unsubscribe function. */
export function streamJob(
  id: string,
  onMessage: (msg: JobStreamMessage) => void,
  onError?: () => void,
): () => void {
  if (MOCK) {
    let stop: (() => void) | null = null;
    let cancelled = false;
    mock().then(m => { if (!cancelled) stop = m.mockStream(id, onMessage); });
    return () => { cancelled = true; stop?.(); };
  }
  const token = getToken();
  const url = `/api/jobs/${enc(id)}/stream${token ? `?token=${enc(token)}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = e => {
    try { onMessage(JSON.parse(e.data) as JobStreamMessage); } catch { /* ignore malformed line */ }
  };
  es.onerror = () => {
    // EventSource retries on its own; report once so the UI can fall back to polling.
    onError?.();
  };
  return () => es.close();
}
