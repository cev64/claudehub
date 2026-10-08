import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Project, Settings } from '../../../shared/types';
import { api } from '../api';
import { navigate, useFlip, usePhone, useReducedMotion, useResource, useNow, useWide, type Route } from '../hooks';
import { num, relTime } from '../format';
import { Segmented, Select } from '../components/controls';
import { ErrorState, ICON, PageHead, projectStatus, SkeletonRows, StatusWord } from '../components/bits';
import { Sheet } from '../components/Sheet';
import { openNewProject } from '../components/NewProjectSheet';
import { ProjectDetailView } from './ProjectDetail';

type Filter = 'all' | 'mac' | 'github' | 'attention';
type Sort = 'active' | 'recent' | 'name';

const needsAttention = (p: Project) =>
  !!p.local && (p.local.dirtyFiles + p.local.untrackedFiles > 0 || p.local.ahead > 0 || p.local.behind > 0);

export function ProjectsScreen({ route, settings }: { route: Route; settings: Settings | undefined }) {
  const res = useResource('projects', api.projects, 30_000);
  const wide = useWide();
  const phone = usePhone();
  const reduced = useReducedMotion();
  const now = useNow();
  const qFilter = route.query.get('filter') as Filter | null;
  const [filter, setFilter] = useState<Filter>(qFilter ?? 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('active');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (qFilter) setFilter(qFilter); }, [qFilter]);

  const all = res.data ?? [];
  const counts = useMemo(() => ({
    all: all.length,
    mac: all.filter(p => p.local).length,
    github: all.filter(p => !p.local).length,
    attention: all.filter(needsAttention).length,
  }), [all]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter(p => {
      if (filter === 'mac' && !p.local) return false;
      if (filter === 'github' && p.local) return false;
      if (filter === 'attention' && !needsAttention(p)) return false;
      if (needle && !(`${p.name} ${p.description ?? ''} ${p.stack.join(' ')}`.toLowerCase().includes(needle))) return false;
      return true;
    });
    const t = (s: string | null) => (s ? Date.parse(s) : 0);
    list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'recent' ? t(b.lastActivityAt) - t(a.lastActivityAt)
          : b.activityScore - a.activityScore);
    return list;
  }, [all, filter, q, sort]);

  useFlip(listRef, [shown.map(p => p.id).join(',')], reduced);

  const selected = route.param;
  // On wide screens, show the first project when nothing is picked.
  useEffect(() => {
    if (wide && !selected && shown.length) navigate('projects', shown[0].id, filter !== 'all' ? { filter } : undefined, true);
  }, [wide, selected, shown, filter]);

  const select = (id: string) => navigate('projects', id, filter !== 'all' ? { filter } : undefined, !wide ? false : true);

  const filterOptions = [
    { value: 'all' as const, label: 'All' },
    { value: 'mac' as const, label: 'On Mac' },
    { value: 'github' as const, label: phone ? 'GitHub' : 'GitHub only' },
    { value: 'attention' as const, label: phone ? 'Attention' : 'Needs attention' },
  ];

  const list = (
    <section className="glass card" aria-label="Projects">
      {res.error && !res.data ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonRows n={7} /> : (
        <>
          <div className="toolbar">
            <label className="search">
              <Search size={18} strokeWidth={1.75} />
              <span className="sr-only">Search projects</span>
              <input className="input" type="search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
            </label>
            <Select label="Sort" value={sort} onChange={setSort} options={[
              { value: 'active', label: 'Most active' }, { value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' },
            ]} />
          </div>
          <div className="list" ref={listRef}>
            {shown.map(p => (
              <ProjectListRow key={p.id} p={p} now={now} selected={wide && p.id === selected} onClick={() => select(p.id)} />
            ))}
            {shown.length === 0 && (
              <p className="meta" style={{ margin: '12px 0' }}>
                {filter === 'attention' && !q ? 'Everything is committed and in sync.' : 'No projects match.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );

  return (
    <>
      <PageHead label={res.data ? `${num(counts.all)} projects` : 'Projects'} title="Projects">
        <button type="button" className="btn primary" onClick={openNewProject}>
          <Plus {...ICON} size={18} />New project
        </button>
      </PageHead>
      <div style={{ marginBottom: 12, overflowX: 'auto', scrollbarWidth: 'none' }}>
        <Segmented label="Filter" value={filter} onChange={v => { setFilter(v); }} options={filterOptions} />
      </div>
      {wide ? (
        <div className="split">
          {list}
          <div className="glass split-detail">
            {selected ? <ProjectDetailView key={selected} id={selected} settings={settings} /> : <div className="detail"><SkeletonRows n={4} /></div>}
          </div>
        </div>
      ) : (
        <>
          {list}
          <Sheet
            open={!!selected}
            onClose={() => navigate('projects', null, filter !== 'all' ? { filter } : undefined)}
            label={all.find(p => p.id === selected)?.name ?? 'Project'}
            title={<span className="micro">Project</span>}
            wide
          >
            {selected && <ProjectDetailView key={selected} id={selected} settings={settings} />}
          </Sheet>
        </>
      )}
    </>
  );
}

function ProjectListRow({ p, now, selected, onClick }: { p: Project; now: number; selected: boolean; onClick: () => void }) {
  const st = projectStatus[p.status];
  const ind: string[] = [];
  if (p.local) {
    const changed = p.local.dirtyFiles + p.local.untrackedFiles;
    if (changed) ind.push(`${num(changed)} changed`);
    if (p.local.ahead) ind.push(`${num(p.local.ahead)} ahead`);
    if (p.local.behind) ind.push(`${num(p.local.behind)} behind`);
  }
  if (p.github?.openPRs) ind.push(`${num(p.github.openPRs)} ${p.github.openPRs === 1 ? 'PR' : 'PRs'}`);
  const where = p.local ? (p.local.branch ?? 'detached') : 'GitHub only';
  return (
    <button type="button" className={`row${selected ? ' selected' : ''}`} onClick={onClick} data-flip={p.id} aria-current={selected || undefined}>
      <div className="row-main">
        <div className="row-title">
          <span className="t">{p.name}</span>
          {ind.length > 0 && <span className="ind num">{ind.slice(0, 3).join(' · ')}</span>}
        </div>
        <div className="row-meta">
          <StatusWord tone={st.tone} word={st.word} />
          <span className="m">· {[where, p.stack[0], relTime(p.lastActivityAt, now)].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="row-end">
        <span className="k num">{num(p.commitsLast30)}</span>
        <span className="w">commits</span>
      </div>
    </button>
  );
}
