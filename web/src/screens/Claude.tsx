import { useEffect, useMemo, useRef } from 'react';
import { FolderPlus } from 'lucide-react';
import type { Job, PermissionLevel, Settings } from '../../../shared/types';
import { api } from '../api';
import { bumpData, navigate, useFlip, useNow, useReducedMotion, useResource, useWide, type Route } from '../hooks';
import { firstLine, relTime } from '../format';
import { Composer, type ComposerPreset } from '../components/Composer';
import { Transcript } from '../components/Transcript';
import { Sheet } from '../components/Sheet';
import { openNewProject } from '../components/NewProjectSheet';
import { ErrorState, ICON, jobStatus, PageHead, SkeletonRows, StatusWord } from '../components/bits';

export function ClaudeScreen({ route, settings }: { route: Route; settings: Settings | undefined }) {
  const projects = useResource('projects', api.projects, 30_000);
  const jobs = useResource('jobs', api.jobs);
  const wide = useWide();
  const now = useNow(15_000);
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const selected = route.param;
  const anyRunning = jobs.data?.some(j => j.status === 'running' || j.status === 'queued');

  // Poll faster while something runs.
  useResource(anyRunning ? 'jobs-poll' : null, async () => { const d = await api.jobs(); jobs.setData(d); return d; }, 5_000);

  useFlip(listRef, [jobs.data?.map(j => j.id).join(',')], reduced);

  const qs = route.query.toString();
  const preset = useMemo<ComposerPreset | undefined>(() => {
    const q = new URLSearchParams(qs);
    if (!q.has('project') && !q.has('prompt')) return undefined;
    return {
      projectId: q.get('project'),
      prompt: q.get('prompt') ?? undefined,
      permission: (q.get('permission') as PermissionLevel) ?? undefined,
    };
  }, [qs]);

  // On wide screens, open the newest run when nothing is picked.
  useEffect(() => {
    if (wide && !selected && jobs.data?.length) navigate('claude', jobs.data[0].id, preset ? Object.fromEntries(new URLSearchParams(qs)) : undefined, true);
  }, [wide, selected, jobs.data, preset, qs]);

  const onSent = (job: Job) => {
    jobs.setData([job, ...(jobs.data ?? []).filter(j => j.id !== job.id)]);
    bumpData();
    navigate('claude', job.id);
  };

  const onJobChange = (job: Job) => {
    if (!jobs.data) return;
    const prev = jobs.data.find(j => j.id === job.id);
    if (prev && prev.status === job.status && prev.finishedAt === job.finishedAt) return;
    jobs.setData(jobs.data.map(j => (j.id === job.id ? { ...j, ...job, events: undefined } : j)));
  };

  const transcript = selected
    ? <Transcript key={selected} jobId={selected} onJobChange={onJobChange} onContinue={onSent} />
    : null;

  const runs = (
    <section className="glass card" aria-labelledby="runs-h">
      <div className="card-head"><h2 id="runs-h" className="card-title">Runs</h2></div>
      {jobs.error && !jobs.data ? <ErrorState error={jobs.error} onRetry={jobs.reload} />
        : !jobs.data ? <SkeletonRows n={4} />
          : jobs.data.length === 0 ? <p className="meta" style={{ margin: '8px 0' }}>No runs yet.</p>
            : (
              <div className="list" ref={listRef}>
                {jobs.data.map(j => {
                  const s = jobStatus[j.status];
                  const live = j.status === 'running' || j.status === 'queued';
                  return (
                    <button key={j.id} type="button" data-flip={j.id}
                      className={`row${wide && j.id === selected ? ' selected' : ''}`}
                      aria-current={wide && j.id === selected ? true : undefined}
                      onClick={() => navigate('claude', j.id, undefined, wide)}>
                      <div className="row-main">
                        <div className="row-title"><span className="t">{firstLine(j.prompt, 90)}</span></div>
                        <div className="row-meta">
                          <StatusWord tone={s.tone} word={s.word} pulse={live} />
                          <span className="m">· {j.projectName ?? 'Projects folder'}</span>
                        </div>
                      </div>
                      <div className="row-end"><span className="w num" style={{ fontSize: 13 }}>{relTime(j.createdAt, now)}</span></div>
                    </button>
                  );
                })}
              </div>
            )}
    </section>
  );

  const composer = (
    <section className="glass card" aria-label="New prompt">
      <Composer
        projects={projects.data ?? []}
        defaultModel={settings?.defaultModel}
        onSent={onSent}
        preset={preset}
      />
    </section>
  );

  return (
    <>
      <PageHead label="Claude Code" title="Claude">
        <button type="button" className="btn" onClick={openNewProject}>
          <FolderPlus {...ICON} size={18} />New project
        </button>
      </PageHead>
      {wide ? (
        <div className="split claude">
          <div className="stack">{composer}{runs}</div>
          <div className="glass split-detail">
            <div className="detail">
              {transcript ?? <p className="meta" style={{ margin: 0 }}>Pick a run to see its transcript.</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="stack">
          {composer}
          {runs}
          <Sheet open={!!selected} onClose={() => navigate('claude')} label="Run" title={<span className="micro">Run</span>} wide>
            {transcript}
          </Sheet>
        </div>
      )}
    </>
  );
}
