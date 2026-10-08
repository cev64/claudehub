import type { ProjectAction, Suggestion } from '../../shared/types';
import { api, ApiError } from './api';
import { bumpData, navigate } from './hooks';
import { toast } from './components/Toasts';

export const ACTION_LABEL: Record<ProjectAction, string> = {
  'open-editor': 'Open in editor',
  'open-finder': 'Finder',
  'open-terminal': 'Terminal',
  fetch: 'Fetch',
  pull: 'Pull',
  clone: 'Clone',
};

export async function runProjectAction(projectId: string, action: ProjectAction): Promise<boolean> {
  try {
    const r = await api.projectAction(projectId, action);
    toast(r.message, { tone: r.ok ? 'good' : 'bad' });
    if (r.ok && (action === 'fetch' || action === 'pull' || action === 'clone')) bumpData();
    return r.ok;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Action failed', { tone: 'bad' });
    return false;
  }
}

export const WEB_URL = 'https://claude.ai/code';

/** Copy text: the Mac app's bridge if present, else the Clipboard API, else a hidden textarea. */
export function copyText(text: string): Promise<boolean> {
  const bridge = (window as { webkit?: { messageHandlers?: { copy?: { postMessage: (t: string) => void } } } }).webkit?.messageHandlers?.copy;
  if (bridge) {
    try { bridge.postMessage(text); return Promise.resolve(true); } catch { /* fall through */ }
  }
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, legacy);
  return Promise.resolve(legacy());
}

/** Claude Code on the web: copy the prompt, open claude.ai/code. Call straight from a click. */
export function openOnWeb(prompt: string, repo: string | null): void {
  const copied = copyText(prompt);
  window.open(WEB_URL, '_blank', 'noopener');
  void copied.then(ok => toast(
    ok ? `Prompt copied${repo ? `. Pick ${repo} and paste it` : '. Paste it'} on claude.ai/code` : `Opened claude.ai/code${repo ? `. Pick ${repo}` : ''}`,
    { tone: 'good' },
  ));
}

/** GitHub repo name for a project id ("cev64/x"), or null for local-only projects. */
export function repoOf(projectId: string | null): string | null {
  return projectId && !projectId.startsWith('local:') ? projectId : null;
}

export function suggestionLabel(s: Suggestion): string | null {
  const a = s.action;
  if (!a) return null;
  if (a.type === 'prompt') return 'Run';
  if (a.type === 'link') return 'Open';
  switch (a.action) {
    case 'clone': return 'Clone';
    case 'pull': return 'Pull';
    case 'fetch': return 'Fetch';
    default: return 'Open';
  }
}

export async function runSuggestion(s: Suggestion): Promise<void> {
  const a = s.action;
  if (!a) return;
  if (a.type === 'link') {
    window.open(a.url, '_blank', 'noopener');
    return;
  }
  if (a.type === 'project-action') {
    if (s.projectId) await runProjectAction(s.projectId, a.action);
    return;
  }
  try {
    const job = await api.createJob({ projectId: s.projectId, prompt: a.prompt, permission: a.permission });
    toast('Claude is on it', { tone: 'good', action: { label: 'View', run: () => navigate('claude', job.id) } });
    bumpData();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not start the run', { tone: 'bad' });
  }
}
