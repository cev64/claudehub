import { useEffect, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Health, HealthCheck, Settings } from '../../../shared/types';
import { api, ApiError, getToken, setToken } from '../api';
import { bumpData, useNow, useTheme, type ThemePref } from '../hooks';
import { relTime } from '../format';
import { MODEL_OPTIONS, Segmented, Select, Switch } from '../components/controls';
import { ErrorState, PageHead, SkeletonRows, StatusWord } from '../components/bits';
import { toast } from '../components/Toasts';
import type { Resource } from '../hooks';
import { toggleCapture, useUsage } from './Usage';

const EDITORS = ['Visual Studio Code', 'Cursor', 'Zed', 'Xcode'];

export function SettingsScreen({ settings, health }: { settings: Resource<Settings>; health: Resource<Health> }) {
  const uid = useId();
  const [theme, setTheme] = useTheme();
  const [form, setForm] = useState<Settings | null>(settings.data ?? null);
  const [token, setTokenInput] = useState(getToken());
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const now = useNow();
  const usage = useUsage();

  useEffect(() => { if (settings.data && !form) setForm(settings.data); }, [settings.data, form]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm(f => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    setSaving(true);
    const tokenChanged = token.trim() !== getToken();
    if (tokenChanged) setToken(token.trim());
    try {
      if (form) {
        const { githubUser: _g, ...patch } = form;
        const saved = await api.saveSettings({ ...patch, refreshMinutes: Math.max(1, Math.round(Number(patch.refreshMinutes) || 1)) });
        settings.setData(saved);
        setForm(saved);
      }
      toast('Saved', { tone: 'good' });
      if (tokenChanged || !form) bumpData();
    } catch (e) {
      if (tokenChanged && !form) { toast('Token saved', { tone: 'good' }); bumpData(); }
      else toast(e instanceof ApiError ? e.message : 'Could not save', { tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHead label="ClaudeHub" title="Settings" />
      <form className="settings" onSubmit={e => { e.preventDefault(); save(); }}>
        <section className="glass card stack" aria-labelledby={`${uid}-a`}>
          <h2 id={`${uid}-a`} className="card-title">Agent</h2>
          {!form ? (
            settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : <SkeletonRows n={3} />
          ) : (
            <>
              <div className="field">
                <label className="label" htmlFor={`${uid}-dir`}>Projects folder</label>
                <input id={`${uid}-dir`} className="input mono" style={{ fontSize: 15 }} value={form.projectsDir}
                  onChange={e => set('projectsDir', e.target.value)} spellCheck={false} autoCapitalize="off" />
              </div>
              <div className="field">
                <span className="label" id={`${uid}-depth`}>Scan depth</span>
                <div>
                  <Segmented label="Scan depth" value={String(form.scanDepth) as '1' | '2' | '3'}
                    onChange={v => set('scanDepth', Number(v))}
                    options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor={`${uid}-ed`}>Editor</label>
                <input id={`${uid}-ed`} className="input" list={`${uid}-eds`} value={form.editor}
                  onChange={e => set('editor', e.target.value)} autoCapitalize="off" />
                <datalist id={`${uid}-eds`}>{EDITORS.map(e => <option key={e} value={e} />)}</datalist>
              </div>
              <div className="settings-pair">
                <div className="field">
                  <label className="label" htmlFor={`${uid}-rm`}>Refresh every (min)</label>
                  <input id={`${uid}-rm`} className="input num" type="number" min={1} max={240} inputMode="numeric"
                    value={form.refreshMinutes} onChange={e => set('refreshMinutes', Number(e.target.value))} />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`${uid}-m`}>Default model</label>
                  <Select id={`${uid}-m`} label="Default model" value={form.defaultModel ?? ''}
                    onChange={v => set('defaultModel', v || null)}
                    options={MODEL_OPTIONS.map(o => (o.value === '' ? { ...o, label: 'Default' } : o))} />
                </div>
              </div>
              {form.githubUser && <p className="meta" style={{ margin: 0 }}>GitHub · {form.githubUser}</p>}
            </>
          )}
        </section>

        <section className="glass card stack" aria-labelledby={`${uid}-d`}>
          <h2 id={`${uid}-d`} className="card-title">This device</h2>
          <div className="field">
            <span className="label">Theme</span>
            <div>
              <Segmented<ThemePref> label="Theme" value={theme} onChange={setTheme}
                options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${uid}-tk`}>Access token</label>
            <div style={{ position: 'relative' }}>
              <input id={`${uid}-tk`} className="input mono" style={{ paddingRight: 52, fontSize: 15 }}
                type={showToken ? 'text' : 'password'} autoComplete="off" spellCheck={false} autoCapitalize="off"
                value={token} onChange={e => setTokenInput(e.target.value)} placeholder="Not set" />
              <button type="button" className="icon-btn" style={{ position: 'absolute', right: 0, top: 0 }}
                onClick={() => setShowToken(s => !s)} aria-label={showToken ? 'Hide token' : 'Show token'}>
                {showToken ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
              </button>
            </div>
          </div>
        </section>

        <div className="settings-save">
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving' : 'Save'}</button>
        </div>

        <section className="glass card stack" aria-labelledby={`${uid}-u`} style={{ gap: 4 }}>
          <h2 id={`${uid}-u`} className="card-title" style={{ marginBottom: 8 }}>Claude Code</h2>
          {!usage.data ? (
            usage.error ? <ErrorState error={usage.error} onRetry={usage.reload} /> : <SkeletonRows n={1} />
          ) : (
            <>
              <Switch id={`${uid}-cap`} label="Usage capture" checked={usage.data.statusline.installed}
                onChange={v => toggleCapture(usage, v)} />
              {usage.data.statusline.chained && (
                <p className="meta" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                  Also runs: <span className="mono" style={{ fontSize: 13 }}>{usage.data.statusline.chained}</span>
                </p>
              )}
            </>
          )}
        </section>

        <section className="glass card" aria-labelledby={`${uid}-h`}>
          <div className="card-head">
            <h2 id={`${uid}-h`} className="card-title">Health</h2>
            {health.data && <span className="meta num">v{health.data.version}</span>}
          </div>
          {!health.data ? (
            health.error ? <ErrorState error={health.error} onRetry={health.reload} /> : <SkeletonRows n={4} />
          ) : (
            <>
              <div className="list">
                <HealthRow name="git" check={health.data.checks.git} />
                <HealthRow name="Projects folder" check={health.data.checks.projectsDir} />
                <HealthRow name="GitHub" check={health.data.checks.github} />
                <HealthRow name="Claude CLI" check={health.data.checks.claude} />
              </div>
              <p className="meta" style={{ margin: '12px 0 0' }}>
                {health.data.hostname} · {health.data.scanning ? 'Scanning' : `Scanned ${relTime(health.data.lastScanAt, now)}`}
              </p>
            </>
          )}
        </section>
      </form>
    </>
  );
}

function HealthRow({ name, check }: { name: string; check: HealthCheck }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="row-main">
        <div className="row-title"><span className="t">{name}</span></div>
        <div className="row-meta" style={{ alignItems: 'flex-start' }}><span style={{ overflowWrap: 'anywhere' }}>{check.detail}</span></div>
      </div>
      <div className="row-end" style={{ paddingTop: 1 }}>
        <span className="w" style={{ fontSize: 14, lineHeight: '22px', color: 'var(--ink-2)' }}>
          <StatusWord tone={check.ok ? 'good' : 'warn'} word={check.ok ? 'Ready' : 'Needs setup'} />
        </span>
      </div>
    </div>
  );
}
