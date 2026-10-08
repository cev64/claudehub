import { useEffect, useId, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { Job, JobMode, PermissionLevel, Project } from '../../../shared/types';
import { api, ApiError } from '../api';
import { MODEL_OPTIONS, PERMISSION_OPTIONS, Segmented, Select } from './controls';
import { toast } from './Toasts';
import { ICON } from './bits';

export const ROOT_PROJECT = '__root__';

export interface ComposerPreset {
  projectId?: string | null;
  prompt?: string;
  mode?: JobMode;
  permission?: PermissionLevel;
  nonce?: number;
}

/** Prompt composer. With `projects` it shows a project picker; otherwise it targets `projectId`. */
export function Composer({
  projectId, projects, defaultModel, onSent, preset, accent = true, compact,
}: {
  projectId?: string | null;
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
  const [mode, setMode] = useState<JobMode>('local');
  const [permission, setPermission] = useState<PermissionLevel>('acceptEdits');
  const [model, setModel] = useState<string>(defaultModel ?? '');
  const [sending, setSending] = useState(false);

  useEffect(() => { setModel(defaultModel ?? ''); }, [defaultModel]);
  useEffect(() => { if (projectId !== undefined) setTarget(projectId ?? ROOT_PROJECT); }, [projectId]);
  useEffect(() => {
    if (!preset) return;
    if (preset.projectId !== undefined) setTarget(preset.projectId ?? ROOT_PROJECT);
    if (preset.prompt != null) setPrompt(preset.prompt);
    if (preset.mode) setMode(preset.mode);
    if (preset.permission) setPermission(preset.permission);
  }, [preset]);

  const localProjects = (projects ?? []).filter(p => p.local).sort((a, b) => a.name.localeCompare(b.name));

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const job = await api.createJob({
        projectId: target === ROOT_PROJECT ? null : target,
        prompt: text,
        mode,
        permission,
        model: model || null,
      });
      setPrompt('');
      toast(mode === 'cloud' ? 'Cloud session started' : 'Claude is on it', { tone: 'good' });
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
            options={[{ value: ROOT_PROJECT, label: 'Projects folder' }, ...localProjects.map(p => ({ value: p.id, label: p.name }))]}
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
        <Segmented
          label="Where"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: 'local', label: 'On Mac' }, { value: 'cloud', label: 'Cloud' }]}
        />
        {mode === 'local' && (
          <Segmented label="Permission" size="sm" value={permission} onChange={setPermission} options={PERMISSION_OPTIONS} />
        )}
      </div>
      <div className="composer-foot">
        <Select label="Model" value={model} onChange={setModel} options={MODEL_OPTIONS} />
        <button type="submit" className={`btn${accent ? ' primary' : ''}`} disabled={!prompt.trim() || sending}>
          {sending ? 'Sending' : 'Send'}
          <ArrowUp {...ICON} size={18} />
        </button>
      </div>
    </form>
  );
}
