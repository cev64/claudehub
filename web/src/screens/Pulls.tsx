import { useEffect, useRef, useState } from 'react';
import type { PullRequest } from '../../../shared/types';
import { api } from '../api';
import { navigate, useFlip, useNow, useReducedMotion, useResource, type Route } from '../hooks';
import { MINUS, num, relTime } from '../format';
import { Segmented } from '../components/controls';
import { ErrorState, PageHead, prStateWord, reviewWord, Rolling, SkeletonRows, StatusWord } from '../components/bits';

export function PullsScreen({ route }: { route: Route }) {
  const initial = route.query.get('state') === 'all' ? 'all' : 'open';
  const [state, setState] = useState<'open' | 'all'>(initial);
  useEffect(() => { setState(route.query.get('state') === 'all' ? 'all' : 'open'); }, [route.query]);
  const res = useResource(`pulls:${state}`, () => api.pulls(state), 60_000);
  const ov = useResource('overview', api.overview, 30_000);
  const now = useNow();
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, [state, res.data?.map(p => p.id).join(',')], reduced);

  const stats = ov.data?.stats;
  const change = (v: 'open' | 'all') => { setState(v); navigate('pulls', null, v === 'all' ? { state: 'all' } : undefined, true); };

  return (
    <>
      <PageHead label="GitHub" title="Pull requests" />
      {stats && (
        <section className="glass strip" aria-label="Pull request stats">
          <div><span className="micro">Open</span><Rolling value={stats.openPRs} className="v" /></div>
          <div><span className="micro">Authored</span><Rolling value={stats.prsAuthored} className="v" /></div>
          <div><span className="micro">Merged 30d</span><Rolling value={stats.prsMerged30} className="v" /></div>
        </section>
      )}
      <div style={{ marginBottom: 12 }}>
        <Segmented label="Show" value={state} onChange={change} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      </div>
      <section className="glass card" aria-label="Pull requests">
        {res.error && !res.data ? <ErrorState error={res.error} onRetry={res.reload} />
          : !res.data ? <SkeletonRows n={6} />
            : res.data.length === 0 ? <p className="meta" style={{ margin: '8px 0' }}>{state === 'open' ? 'No open pull requests.' : 'No pull requests yet.'}</p>
              : (
                <div className="list" ref={listRef}>
                  {res.data.map(p => <PrRow key={p.id} p={p} now={now} />)}
                </div>
              )}
      </section>
    </>
  );
}

function PrRow({ p, now }: { p: PullRequest; now: number }) {
  const s = prStateWord(p);
  const review = p.state === 'open' ? reviewWord(p.reviewDecision) : null;
  const repo = p.repoFullName.split('/').pop();
  return (
    <a className="row pr-row" href={p.url} target="_blank" rel="noreferrer noopener" data-flip={p.id}>
      <div className="row-main">
        <div className="row-title"><span className="t clamp-2">{p.title}</span></div>
        <div className="row-meta">
          <span className="m">{repo} #{p.number} · {relTime(p.updatedAt, now)} · {p.author}</span>
        </div>
      </div>
      <div className="row-end">
        <span className="diff num">
          <span className="good">+{num(p.additions)}</span>{' '}
          <span className="bad">{MINUS}{num(p.deletions)}</span>
        </span>
        <span className="w pr-status">
          <StatusWord tone={s.tone} word={s.word} />{review ? <span className="pr-review"><span className="pr-sep">· </span>{review}</span> : null}
        </span>
      </div>
    </a>
  );
}
