import { useState } from 'react';
import { ArrowUpRight, ChevronRight, Lock } from 'lucide-react';
import type { ProjectAction, Settings } from '../../../shared/types';
import { api } from '../api';
import { navigate, useNow, useResource } from '../hooks';
import { firstLine, num, plural, relTime, tildePath } from '../format';
import { Composer } from '../components/Composer';
import { Markdown } from '../components/Markdown';
import {
  ErrorState, jobStatus, prStateWord, projectStatus, reviewWord, SkeletonRows, StatusWord,
} from '../components/bits';
import { ACTION_LABEL, runProjectAction } from '../actions';

export function ProjectDetailView({ id, settings }: { id: string; settings: Settings | undefined }) {
  const res = useResource(`project:${id}`, () => api.project(id), 30_000);
  const now = useNow();
  const [busy, setBusy] = useState<ProjectAction | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  if (!res.data) {
    return <div className="detail">{res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : <SkeletonRows n={6} />}</div>;
  }
  const p = res.data;
  const st = projectStatus[p.status];
  const local = p.local;
  const gh = p.github;

  const act = async (a: ProjectAction) => {
    setBusy(a);
    const ok = await runProjectAction(p.id, a);
    setBusy(null);
    if (ok && (a === 'fetch' || a === 'pull' || a === 'clone')) res.reload();
  };

  const actions: ProjectAction[] = local
    ? ['open-editor', 'open-finder', 'open-terminal', 'fetch', 'pull']
    : gh ? ['clone'] : [];
  const changed = local ? local.dirtyFiles + local.untrackedFiles : 0;

  return (
    <div className="detail">
      <header className="detail-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 className="title" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</h2>
          <span className="meta"><StatusWord tone={st.tone} word={st.word} /></span>
        </div>
        {p.description && <p className="ink-2" style={{ margin: 0, fontSize: 15, lineHeight: '22px' }}>{p.description}</p>}
        {p.stack.length > 0 && <div className="chips" style={{ marginTop: 4 }}>{p.stack.map(s => <span key={s} className="chip">{s}</span>)}</div>}
      </header>

      {actions.length > 0 && (
        <div className="btn-row">
          {actions.map(a => (
            <button key={a} type="button" className="btn sm" disabled={busy === a} onClick={() => act(a)}>{ACTION_LABEL[a]}</button>
          ))}
        </div>
      )}

      {local && (
        <section className="section" aria-label="Ask Claude">
          <span className="micro">Ask Claude</span>
          <Composer projectId={p.id} defaultModel={settings?.defaultModel} accent={false} compact
            onSent={job => navigate('claude', job.id)} />
        </section>
      )}

      <section className="section">
        <span className="micro">{local ? 'On this Mac' : 'Not on this Mac'}</span>
        {local ? (
          <dl className="kv">
            <dt>Path</dt><dd className="mono" style={{ fontSize: 13 }}>{tildePath(local.path)}</dd>
            <dt>Branch</dt><dd>{local.branch ?? 'Detached'}</dd>
            <dt>Sync</dt>
            <dd className="num">
              {!local.hasUpstream ? 'No upstream'
                : local.ahead || local.behind
                  ? [local.ahead && `${num(local.ahead)} ahead`, local.behind && `${num(local.behind)} behind`].filter(Boolean).join(' · ')
                  : 'Up to date'}
            </dd>
            <dt>Changes</dt>
            <dd className="num">{changed ? plural(changed, 'file') : 'Clean'}</dd>
            {local.lastCommitMessage && (<><dt>Last commit</dt><dd>{local.lastCommitMessage} <span className="quiet">· {relTime(local.lastCommitAt, now)}</span></dd></>)}
          </dl>
        ) : (
          <p className="meta" style={{ margin: 0 }}>Clone it to work on it here.</p>
        )}
        {p.changedFiles.length > 0 && (
          <div>
            <button type="button" className="disclosure" aria-expanded={filesOpen} onClick={() => setFilesOpen(o => !o)}>
              <ChevronRight size={16} strokeWidth={1.75} />Changed files
            </button>
            {filesOpen && (
              <ul className="files">
                {p.changedFiles.map(f => (
                  <li key={f.path}><span className="st mono">{f.status}</span><span className="p mono">{f.path}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {gh && (
        <section className="section">
          <span className="micro">GitHub</span>
          <dl className="kv">
            <dt>Repo</dt>
            <dd>
              <a href={gh.url} target="_blank" rel="noreferrer noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {gh.fullName}<ArrowUpRight size={14} strokeWidth={1.75} />
              </a>
              {gh.private && <span className="quiet" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}><Lock size={13} strokeWidth={1.75} />Private</span>}
            </dd>
            <dt>Open</dt>
            <dd className="num">{plural(gh.openPRs, 'PR')} · {plural(gh.openIssues, 'issue')}</dd>
            <dt>Stars</dt><dd className="num">{num(gh.stars)}</dd>
            {gh.pushedAt && (<><dt>Pushed</dt><dd>{relTime(gh.pushedAt, now)}</dd></>)}
          </dl>
        </section>
      )}

      {p.readmeExcerpt && (
        <section className="section">
          <span className="micro">README</span>
          <div className="excerpt-md"><Markdown text={p.readmeExcerpt} /></div>
        </section>
      )}

      {local && (
        <section className="section">
          <span className="micro">CLAUDE.md</span>
          {p.claudeMdExcerpt
            ? <div className="excerpt-md"><Markdown text={p.claudeMdExcerpt} /></div>
            : <p className="meta" style={{ margin: 0 }}>{local.hasClaudeMd ? 'Present' : 'Missing'}</p>}
        </section>
      )}

      {p.pulls.length > 0 && (
        <section className="section">
          <span className="micro">Pull requests</span>
          <div className="list">
            {p.pulls.map(pr => {
              const s = prStateWord(pr);
              const review = pr.state === 'open' ? reviewWord(pr.reviewDecision) : null;
              return (
                <a key={pr.id} className="row" href={pr.url} target="_blank" rel="noreferrer noopener">
                  <div className="row-main">
                    <div className="row-title"><span className="t">{pr.title}</span></div>
                    <div className="row-meta"><span className="m">#{pr.number} · {relTime(pr.updatedAt, now)}{review ? ` · ${review}` : ''}</span></div>
                  </div>
                  <div className="row-end"><span className="w" style={{ fontSize: 13 }}><StatusWord tone={s.tone} word={s.word} /></span></div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {p.recentCommits.length > 0 && (
        <section className="section">
          <span className="micro">Recent commits</span>
          <div className="list">
            {p.recentCommits.slice(0, 8).map(c => (
              <div key={c.sha} className="row" style={{ minHeight: 52 }}>
                <div className="row-main">
                  <div className="row-title"><span className="t" style={{ fontSize: 15 }}>{c.message}</span></div>
                  <div className="row-meta"><span className="m"><span className="mono">{c.sha.slice(0, 7)}</span> · {c.author} · {relTime(c.date, now)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {p.jobs.length > 0 && (
        <section className="section">
          <span className="micro">Claude runs</span>
          <div className="list">
            {p.jobs.slice(0, 6).map(j => {
              const s = jobStatus[j.status];
              return (
                <button key={j.id} type="button" className="row" onClick={() => navigate('claude', j.id)}>
                  <div className="row-main">
                    <div className="row-title"><span className="t" style={{ fontSize: 15 }}>{firstLine(j.prompt)}</span></div>
                    <div className="row-meta"><StatusWord tone={s.tone} word={s.word} /><span className="m">· {relTime(j.createdAt, now)}</span></div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
