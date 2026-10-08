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
    const job = await api.createJob({ projectId: s.projectId, prompt: a.prompt, mode: a.mode, permission: a.permission });
    toast('Claude is on it', { tone: 'good', action: { label: 'View', run: () => navigate('claude', job.id) } });
    bumpData();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not start the run', { tone: 'bad' });
  }
}
