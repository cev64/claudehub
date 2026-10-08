import { useEffect, useId, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { Job, PermissionLevel, Project } from '../../../shared/types';
import { api, ApiError } from '../api';
import { openOnWeb } from '../actions';
import { MODEL_OPTIONS, PERMISSION_OPTIONS, Segmented, Select } from './controls';
import { toast } from './Toasts';
import { ICON } from './bits';

export const ROOT_PROJECT = '__root__';

export interface ComposerPreset {
  projectId?: string | null;
  prompt?: string;
  permission?: PermissionLevel;
  nonce?: number;
}

/** Prompt composer. With `projects` it shows a project picker; otherwise it targets `projectId`. */
type Where = 'mac' | 'web';
const WHERE_OPTIONS = [{ value: 'mac' as const, label: 'On Mac' }, { value: 'web' as const, label: 'On the web' }];

export function Composer({
  projectId, repo, projects, defaultModel, onSent, preset, accent = true, compact,
}: {
  projectId?: string | null;
  repo?: string | null;          // GitHub repo for "On the web" when there's no project picker
  projects?: Project[];
  defaultModel: string | null | undefined;
  onSent: (job: Job) => void;
  preset?: ComposerPreset;
  accent?: boolean;
  compact?: boolean;
}) {
  const uid = useId();
  const [target, setTarget] = useState<string>(projectId ?? ROOT_PROJECT);
  const [prompt, setPrompt] = useState('');
  const [where, setWhere] = useState<Where>('mac');
  const [permission, setPermission] = useState<PermissionLevel>('acceptEdits');
  const [model, setModel] = useState<string>(defaultModel ?? '');
  const [sending, setSending] = useState(false);

  useEffect(() => { setModel(defaultModel ?? ''); }, [defaultModel]);
  useEffect(() => { if (projectId !== undefined) setTarget(projectId ?? ROOT_PROJECT); }, [projectId]);
  useEffect(() => {
    if (!preset) return;
    if (preset.projectId !== undefined) setTarget(preset.projectId ?? ROOT_PROJECT);
    if (preset.prompt != null) setPrompt(preset.prompt);
    if (preset.permission) setPermission(preset.permission);
  }, [preset]);

  // Every project: ones that aren't on the Mac yet are cloned into the projects folder when the run starts.
  const pickable = (projects ?? []).filter(p => p.local || (p.github && !p.github.archived)).sort((a, b) => a.name.localeCompare(b.name));
  const picked = pickable.find(p => p.id === target);
  const targetRepo = projects ? picked?.github?.fullName ?? null : repo ?? null;

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (where === 'web') {
      openOnWeb(text, targetRepo);
      setPrompt('');
      return;
    }
    setSending(true);
    try {
      const job = await api.createJob({
        projectId: target === ROOT_PROJECT ? null : target,
        prompt: text,
        permission,
        model: model || null,
      });
      setPrompt('');
      toast('Claude is on it', { tone: 'good' });
      onSent(job);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not start the run', { tone: 'bad' });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
      {projects && (
        <div className="field">
          <label className="label" htmlFor={`${uid}-p`}>Project</label>
          <Select
            id={`${uid}-p`}
            label="Project"
            value={target}
            onChange={setTarget}
            options={[
              { value: ROOT_PROJECT, label: 'Projects folder' },
              ...pickable.map(p => ({ value: p.id, label: p.local ? p.name : `${p.name} · clones first` })),
            ]}
          />
        </div>
      )}
      <label className="sr-only" htmlFor={`${uid}-t`}>Prompt</label>
      <textarea
        id={`${uid}-t`}
        className="textarea"
        rows={compact ? 3 : 4}
        placeholder="Ask Claude"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
      />
      <div className="composer-opts">
        <Segmented label="Where" size="sm" value={where} onChange={setWhere} options={WHERE_OPTIONS} />
        {where === 'mac' && (
          <Segmented label="Permission" size="sm" value={permission} onChange={setPermission} options={PERMISSION_OPTIONS} />
        )}
      </div>
      <div className="composer-foot">
        {where === 'mac' ? <Select label="Model" value={model} onChange={setModel} options={MODEL_OPTIONS} /> : <span className="meta">Copies the prompt and opens claude.ai/code</span>}
        <button type="submit" className={`btn${accent ? ' primary' : ''}`} disabled={!prompt.trim() || sending}>
          {sending ? 'Sending' : where === 'web' ? 'Open' : 'Send'}
          <ArrowUp {...ICON} size={18} />
        </button>
      </div>
    </form>
  );
}
