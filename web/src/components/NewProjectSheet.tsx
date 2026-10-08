import { useEffect, useId, useState } from 'react';
import type { NewProjectResult, PermissionLevel } from '../../../shared/types';
import { api, ApiError } from '../api';
import { Sheet } from './Sheet';
import { MODEL_OPTIONS, PERMISSION_OPTIONS, Segmented, Select, Switch } from './controls';

const NAME_RE = /^[A-Za-z0-9._-]+$/;

export const NEW_PROJECT_EVENT = 'claudehub:new-project';
export function openNewProject() { window.dispatchEvent(new Event(NEW_PROJECT_EVENT)); }

export function NewProjectSheet({
  open, onClose, defaultModel, githubReady, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultModel: string | null | undefined;
  githubReady: boolean;
  onCreated: (r: NewProjectResult) => void;
}) {
  const uid = useId();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [github, setGithub] = useState(githubReady);
  const [priv, setPriv] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [permission, setPermission] = useState<PermissionLevel>('auto');
  const [model, setModel] = useState(defaultModel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(''); setTouched(false); setGithub(githubReady); setPriv(true); setPrompt('');
    setPermission('auto'); setModel(defaultModel ?? ''); setError('');
  }, [open, githubReady, defaultModel]);

  const trimmed = name.trim();
  const valid = NAME_RE.test(trimmed);
  const nameError = touched && trimmed && !valid ? 'Letters, digits, . _ and - only' : '';

  const create = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.createProject({
        name: trimmed,
        createGithubRepo: github,
        privateRepo: github ? priv : true,
        prompt: prompt.trim() || null,
        permission,
        model: model || null,
      });
      if (!r.ok) { setError(r.message); return; }
      onCreated(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label="New project">
      <form className="sheet-body" onSubmit={e => { e.preventDefault(); create(); }}>
        <div className="field">
          <label className="label" htmlFor={`${uid}-n`}>Name</label>
          <input
            id={`${uid}-n`}
            className="input"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="my-new-app"
            value={name}
            onChange={e => { setName(e.target.value); if (e.target.value.length > 1) setTouched(true); }}
            onBlur={() => setTouched(true)}
            aria-invalid={!!nameError}
            aria-describedby={`${uid}-ne`}
          />
          <span id={`${uid}-ne`} className="field-error">{nameError}</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <Switch id={`${uid}-gh`} label="Create GitHub repo" checked={github} onChange={setGithub} />
          {github && <Switch id={`${uid}-pv`} label="Private" checked={priv} onChange={setPriv} />}
        </div>
        <div className="field">
          <label className="label" htmlFor={`${uid}-p`}>What should Claude build?</label>
          <textarea
            id={`${uid}-p`}
            className="textarea"
            rows={3}
            placeholder="Optional"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
        </div>
        <div className="composer-opts">
          <Segmented label="Permission" size="sm" value={permission} onChange={setPermission} options={PERMISSION_OPTIONS} />
          <Select label="Model" value={model} onChange={setModel} options={MODEL_OPTIONS} className="model-select" />
        </div>
        {error && <p className="bad" style={{ margin: 0, fontSize: 14 }}>{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy || !valid}>
          {busy ? 'Creating' : 'Create'}
        </button>
      </form>
    </Sheet>
  );
}
