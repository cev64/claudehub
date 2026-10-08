import { useState } from 'react';
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, CircleX, Clock, Download, FileDiff, FileQuestion, Gauge, GitMerge, Sparkles,
} from 'lucide-react';
import type { Health, Project, Suggestion, SuggestionKind, Usage } from '../../../shared/types';
import { api, ApiError } from '../api';
import { href, navigate, useNow, useResource } from '../hooks';
import { num, plural, relTime } from '../format';
import { ActivityChart, Sparkline } from '../components/Charts';
import { ErrorState, ICON, meterTone, PageHead, projectStatus, Rolling, Skeleton, SkeletonRows, StatusWord } from '../components/bits';
import { useUsage } from './Usage';
import { toast } from '../components/Toasts';
import { runProjectAction, runSuggestion, suggestionLabel } from '../actions';

const KIND_ICON: Record<SuggestionKind, typeof Sparkles> = {
  uncommitted: FileDiff, unpushed: ArrowUpFromLine, behind: ArrowDownToLine, 'stale-pr': Clock,
  'pr-ready': GitMerge, 'ci-failing': CircleX, 'not-cloned': Download, 'no-claude-md': FileQuestion,
  'stale-project': Archive, ai: Sparkles,
};

export function OverviewScreen({ health }: { health: Health | undefined }) {
  const ov = useResource('overview', api.overview, 30_000);
  const usage = useUsage();
  const now = useNow();
  const label = health?.hostname ?? 'Mac Mini';
  const plan = <PlanLink u={usage.data} />;

  if (!ov.data) {
    return (
      <>
        <PageHead label={label} title="Overview">{plan}</PageHead>
        {ov.error ? <div className="glass card"><ErrorState error={ov.error} onRetry={ov.reload} /></div> : <OverviewSkeleton />}
      </>
    );
  }
  const { stats, mostActive, topProjects, activity, suggestions } = ov.data;
  const total30 = activity.reduce((a, d) => a + d.commits, 0);

  return (
    <>
      <PageHead label={label} title="Overview">{plan}</PageHead>
      <section className="tiles" aria-label="Stats">
        <Tile label="Projects" value={stats.projects} meta={`${num(stats.localRepos)} on Mac`} to={href('projects')} />
        <Tile label="Open PRs" value={stats.openPRs} meta={plural(stats.githubRepos, 'repo')} to={href('pulls')} />
        <Tile label="PRs authored" value={stats.prsAuthored} meta={`${num(stats.prsMerged30)} merged 30d`} to={href('pulls', null, { state: 'all' })} />
        <Tile label="Commits 30d" value={stats.commits30} meta="all projects" />
        <Tile label="Uncommitted" value={stats.dirtyRepos} meta={stats.dirtyRepos === 1 ? 'repo' : 'repos'} to={href('projects', null, { filter: 'attention' })} />
        <Tile label="Claude runs" value={stats.runningJobs} meta="running" to={href('claude')} />
      </section>

      <div className="ov-grid">
        {mostActive ? <Hero p={mostActive} now={now} /> : <div className="glass card"><p className="meta">No projects yet</p></div>}

        <section className="glass card" aria-labelledby="act-h">
          <div className="card-head">
            <h2 id="act-h" className="card-title">Activity</h2>
            <span className="meta num">{plural(total30, 'commit')} · 30 days</span>
          </div>
          <ActivityChart data={activity} />
        </section>

        <section className="glass card" aria-labelledby="top-h">
          <div className="card-head">
            <h2 id="top-h" className="card-title">Top projects</h2>
            <a className="btn sm" href={href('projects')}>All</a>
          </div>
          <div className="list">
            {topProjects.map(p => <ProjectRow key={p.id} p={p} now={now} />)}
          </div>
        </section>

        <Suggestions list={suggestions} onChanged={ov.reload} />
      </div>
    </>
  );
}

/** Compact plan limits ("5h 31% · wk 64%") linking to Usage. */
function PlanLink({ u }: { u: Usage | undefined }) {
  const l = u?.limits;
  if (!l?.capturedAt || (!l.fiveHour && !l.sevenDay)) return null;
  const parts = [
    l.fiveHour ? `5h ${Math.round(l.fiveHour.usedPercentage)}%` : null,
    l.sevenDay ? `wk ${Math.round(l.sevenDay.usedPercentage)}%` : null,
  ].filter(Boolean).join(' · ');
  const t = meterTone(Math.max(l.fiveHour?.usedPercentage ?? 0, l.sevenDay?.usedPercentage ?? 0));
  return (
    <a className="btn sm plan-link" href={href('usage')} aria-label={`Plan usage: ${parts}${t ? ', ' + t.word : ''}`}>
      <Gauge {...ICON} size={16} />
      <span className="num">{parts}</span>
      {t && <StatusWord tone={t.tone} word={t.word} />}
    </a>
  );
}

function Tile({ label, value, meta, to }: { label: string; value: number; meta: string; to?: string }) {
  const inner = (
    <>
      <span className="micro">{label}</span>
      <Rolling value={value} className="tile-num" />
      <span className="meta">{meta}</span>
    </>
  );
  return to
    ? <a className="glass tile lift" href={to} style={{ color: 'inherit' }}>{inner}</a>
    : <div className="glass tile">{inner}</div>;
}

function Hero({ p, now }: { p: Project; now: number }) {
  const st = projectStatus[p.status];
  return (
    <section className="glass hero" aria-labelledby="hero-h">
      <div className="hero-top">
        <div style={{ minWidth: 0 }}>
          <span className="micro">Most active</span>
          <h2 id="hero-h" className="title ellipsis" style={{ marginTop: 4 }}>
            <a href={href('projects', p.id)} style={{ color: 'inherit' }}>{p.name}</a>
          </h2>
        </div>
        <span className="meta" style={{ paddingTop: 2 }}><StatusWord tone={st.tone} word={st.word} /></span>
      </div>
      {p.stack.length > 0 && (
        <div className="chips">{p.stack.slice(0, 5).map(s => <span key={s} className="chip">{s}</span>)}</div>
      )}
      <div className="hero-stats">
        <div>
          <Rolling value={p.commitsLast30} className="hero-num" />
          <div className="meta">commits in 30 days · {relTime(p.lastActivityAt, now)}</div>
        </div>
        <div className="hero-spark">
          <Sparkline values={p.commitsByDay} label={`${p.name} commits per day, last 30 days`} />
        </div>
      </div>
      <div className="btn-row">
        {p.local && (
          <button type="button" className="btn" onClick={() => runProjectAction(p.id, 'open-editor')}>Open in editor</button>
        )}
        <button type="button" className="btn primary" onClick={() => navigate('claude', null, { project: p.local ? p.id : null })}>
          <Sparkles {...ICON} size={18} />Ask Claude
        </button>
      </div>
    </section>
  );
}

export function ProjectRow({ p, now }: { p: Project; now: number }) {
  const st = projectStatus[p.status];
  return (
    <a className="row" href={href('projects', p.id)}>
      <div className="row-main">
        <div className="row-title"><span className="t">{p.name}</span></div>
        <div className="row-meta">
          <StatusWord tone={st.tone} word={st.word} />
          <span className="m">· {[p.stack[0], relTime(p.lastActivityAt, now)].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="row-end">
        <span className="k num">{num(p.commitsLast30)}</span>
        <span className="w">commits</span>
      </div>
    </a>
  );
}

function Suggestions({ list, onChanged }: { list: Suggestion[]; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const ask = async () => {
    setAsking(true);
    try {
      const s = await api.aiSuggestions();
      toast(s.length ? `${plural(s.length, 'suggestion')} from Claude` : 'Claude has nothing to add', { tone: 'good' });
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Claude could not answer', { tone: 'bad' });
    } finally {
      setAsking(false);
    }
  };

  const act = async (s: Suggestion) => {
    setBusy(s.id);
    await runSuggestion(s);
    setBusy(null);
  };

  return (
    <section className="glass card" aria-labelledby="sug-h">
      <div className="card-head">
        <h2 id="sug-h" className="card-title">Suggestions</h2>
        <button type="button" className="btn sm" onClick={ask} disabled={asking}>
          <Sparkles {...ICON} size={16} className={asking ? 'pulse-icon' : undefined} />
          {asking ? 'Asking Claude' : 'Ask Claude for suggestions'}
        </button>
      </div>
      {list.length === 0 ? (
        <p className="meta" style={{ margin: '8px 0' }}>Nothing needs attention.</p>
      ) : (
        <div className="list">
          {list.map(s => {
            const Icon = KIND_ICON[s.kind] ?? Sparkles;
            const label = suggestionLabel(s);
            return (
              <div key={s.id} className="row">
                <div className="row-icon" aria-hidden><Icon size={18} strokeWidth={1.75} /></div>
                <div className="row-main">
                  <div className="row-title"><span className="t">{s.title}</span></div>
                  <div className="row-meta"><span className="m">{s.source === 'claude' ? `Claude · ${s.detail}` : s.detail}</span></div>
                </div>
                {label && (
                  <button type="button" className="btn sm" onClick={() => act(s)} disabled={busy === s.id}>{label}</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {asking && <p className="meta" style={{ margin: '8px 0 0' }}>This can take a minute.</p>}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="tiles">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="glass tile"><Skeleton h={12} w="50%" /><Skeleton h={32} w="40%" style={{ margin: '6px 0' }} /><Skeleton h={12} w="60%" /></div>
        ))}
      </div>
      <div className="ov-grid">
        <div className="glass card"><SkeletonRows n={3} /></div>
        <div className="glass card"><Skeleton h={200} /></div>
      </div>
    </>
  );
}
