import { useMemo, useState } from 'react';
import type { PlanLimit, RateLimitNotice, TokenTotals, Usage, UsageSession } from '../../../shared/types';
import { api, ApiError } from '../api';
import { href, useNow, useResource, useWide, type Resource } from '../hooks';
import { dayTime, modelName, num, plural, relTime, resetsIn, tokens } from '../format';
import { BarChart } from '../components/Charts';
import { Segmented } from '../components/controls';
import { ErrorState, Meter, meterTone, PageHead, Rolling, Skeleton, SkeletonRows, StatusWord } from '../components/bits';
import { toast } from '../components/Toasts';

const SESSIONS_SHOWN = 8;
const pct = (n: number) => `${num(Math.round(n))}%`;

/** Shared by Usage, Overview and Settings so they read one cache and one poll. */
export function useUsage(): Resource<Usage> {
  return useResource('usage', api.getUsage, 60_000);
}

/** Turn the status line capture on or off, toast the result and refetch. */
export async function toggleCapture(usage: Resource<Usage>, enabled: boolean): Promise<void> {
  if (usage.data) usage.setData({ ...usage.data, statusline: { ...usage.data.statusline, installed: enabled } });
  try {
    const r = await api.setStatusline(enabled);
    toast(r.message, { tone: r.ok ? 'good' : 'bad' });
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not change usage capture', { tone: 'bad' });
  }
  await usage.reload();
}

export function UsageScreen() {
  const usage = useUsage();
  const now = useNow(30_000);
  const wide = useWide();
  const head = <PageHead label="Claude subscription" title="Usage" />;

  if (!usage.data) {
    return (
      <>
        {head}
        {usage.error ? <div className="glass card"><ErrorState error={usage.error} onRetry={usage.reload} /></div> : <UsageSkeleton />}
      </>
    );
  }
  const u = usage.data;
  const byProject = (
    <Breakdown title="By project" rows={u.byProject.slice(0, 8).map(p => ({
      key: p.projectId ?? `name:${p.name}`, name: p.name, total: p.total, to: p.projectId ? href('projects', p.projectId) : undefined,
    }))} />
  );
  const byModel = <Breakdown title="By model" rows={u.byModel.slice(0, 8).map(m => ({ key: m.model, name: modelName(m.model), total: m.total }))} />;

  return (
    <>
      {head}
      <Limits u={u} now={now} usage={usage} />
      <div className="usage-grid">
        <div className="stack">
          <Sessions list={u.sessions} now={now} />
          {wide && byModel}
        </div>
        <div className="stack">
          <Tokens u={u} />
          {byProject}
          {!wide && byModel}
        </div>
      </div>
      <p className="meta usage-foot">
        Counts Claude Code on this Mac. Claude.ai chats and cloud sessions count toward plan limits but aren't listed.
      </p>
    </>
  );
}

// ---------- Plan limits ----------

function Limits({ u, now, usage }: { u: Usage; now: number; usage: Resource<Usage> }) {
  const [busy, setBusy] = useState(false);
  const { limits, statusline } = u;
  const notice = noticeToShow(u.lastRateLimit, limits.capturedAt);

  if (!limits.capturedAt) {
    const turnOn = async () => {
      setBusy(true);
      await toggleCapture(usage, true);
      setBusy(false);
    };
    return (
      <section className="glass card limits-empty" aria-labelledby="lim-h">
        <div className="limits-empty-text">
          <h2 id="lim-h" className="card-title">Plan limits</h2>
          <p className="meta" style={{ margin: 0 }}>
            {statusline.installed ? 'Waiting for a Claude Code session on this Mac.' : 'Read from Claude Code on this Mac.'}
          </p>
        </div>
        {!statusline.installed && (
          <button type="button" className="btn primary" onClick={turnOn} disabled={busy}>{busy ? 'Turning on' : 'Turn on'}</button>
        )}
        {notice && <NoticeRow n={notice} now={now} />}
      </section>
    );
  }

  return (
    <section aria-label="Plan limits" className="limits">
      <div className="limits-tiles">
        <LimitTile label="Session · 5 hours" limit={limits.fiveHour} now={now} />
        <LimitTile label="Week · all models" limit={limits.sevenDay} now={now} />
      </div>
      <div className="limits-foot">
        <span className="meta">As of {relTime(limits.capturedAt, now)}</span>
        {notice && <NoticeRow n={notice} now={now} />}
      </div>
    </section>
  );
}

function LimitTile({ label, limit, now }: { label: string; limit: PlanLimit | null; now: number }) {
  if (!limit) {
    return (
      <div className="glass limit-tile">
        <span className="micro">{label}</span>
        <span className="hero-num quiet num">—</span>
        <span className="meta">Not reported</span>
      </div>
    );
  }
  const t = meterTone(limit.usedPercentage);
  return (
    <div className="glass limit-tile">
      <span className="micro">{label}</span>
      <Rolling value={Math.round(limit.usedPercentage)} format={pct} className="hero-num" />
      <div className="meter-row">
        <Meter value={limit.usedPercentage} label={`${label} used`} />
        {t && <span className="meta"><StatusWord tone={t.tone} word={t.word} /></span>}
      </div>
      <span className="meta">{resetsIn(limit.resetsAt, now) || 'Reset time unknown'}</span>
    </div>
  );
}

function noticeToShow(n: RateLimitNotice | null, capturedAt: string | null): RateLimitNotice | null {
  if (!n || n.status === 'allowed') return null;
  if (capturedAt && Date.parse(n.at) <= Date.parse(capturedAt)) return null;
  return n;
}

function NoticeRow({ n, now }: { n: RateLimitNotice; now: number }) {
  const rejected = n.status === 'rejected';
  return (
    <span className="meta notice">
      <StatusWord tone={rejected ? 'bad' : 'warn'} word={rejected ? 'Rate limited' : 'Usage warning'} />
      {n.resetsAt && <span>· resets {dayTime(n.resetsAt, now)}</span>}
    </span>
  );
}

// ---------- Sessions / context ----------

function Sessions({ list, now }: { list: UsageSession[]; now: number }) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...list].sort((a, b) =>
    Number(b.active) - Number(a.active) || Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)), [list]);
  const shown = all ? sorted : sorted.slice(0, SESSIONS_SHOWN);
  const active = list.filter(s => s.active).length;

  return (
    <section className="glass card" aria-labelledby="ses-h">
      <div className="card-head">
        <h2 id="ses-h" className="card-title">Sessions</h2>
        {active > 0 && <span className="meta num">{num(active)} active</span>}
      </div>
      {sorted.length === 0 ? (
        <p className="meta" style={{ margin: '8px 0' }}>No Claude Code sessions yet.</p>
      ) : (
        <div className="list">
          {shown.map(s => <SessionRow key={s.sessionId} s={s} now={now} />)}
        </div>
      )}
      {sorted.length > SESSIONS_SHOWN && (
        <button type="button" className="btn sm show-all" onClick={() => setAll(a => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${num(sorted.length)}`}
        </button>
      )}
    </section>
  );
}

function SessionRow({ s, now }: { s: UsageSession; now: number }) {
  const t = meterTone(s.contextPercent);
  const meta = [s.title ? s.projectName : null, s.model ? modelName(s.model) : null, plural(s.totals.messages, 'message')]
    .filter(Boolean).join(' · ');
  return (
    <div className="row session-row">
      <div className="row-main">
        <div className="row-title"><span className="t">{s.title ?? s.projectName}</span></div>
        <div className="row-meta">
          {s.active ? <StatusWord tone="good" word="Active" /> : <StatusWord tone="neutral" word={relTime(s.lastActivityAt, now)} />}
          <span className="m">· {meta}</span>
        </div>
        <div className="ctx">
          <Meter value={s.contextPercent} label={`Context used, ${s.title ?? s.projectName}`} thin />
          <span className="ctx-label num">
            {tokens(s.contextTokens)} of {tokens(s.contextWindow)}
            {t && <> · <StatusWord tone={t.tone} word={t.word} /></>}
          </span>
        </div>
      </div>
      <div className="row-end">
        <span className="k num">{pct(s.contextPercent)}</span>
        <span className="w">context</span>
      </div>
    </div>
  );
}

// ---------- Tokens ----------

type Range = 'today' | 'week';

function Tokens({ u }: { u: Usage }) {
  const [range, setRange] = useState<Range>('today');
  const t: TokenTotals = range === 'today' ? u.today : u.week;
  const bars = useMemo(() => u.days.map(d => ({ date: d.date, value: d.total })), [u.days]);
  const total14 = u.days.reduce((a, d) => a + d.total, 0);

  return (
    <section className="glass card tokens-card" aria-labelledby="tok-h">
      <div className="card-head">
        <h2 id="tok-h" className="card-title">Tokens</h2>
        <Segmented<Range> size="sm" label="Range" value={range} onChange={setRange}
          options={[{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }]} />
      </div>
      <div className="token-strip">
        <Stat label="Total" value={t.total} format={tokens} />
        <Stat label="Output" value={t.output} format={tokens} />
        <Stat label="Cache read" value={t.cacheRead} format={tokens} />
        <Stat label="Sessions" value={t.sessions} format={num} />
      </div>
      <div className="token-chart-head">
        <span className="micro">14 days</span>
        <span className="meta num">{tokens(total14)} tokens</span>
      </div>
      <BarChart data={bars} height={168} axis={tokens}
        tip={v => `${tokens(v)} tokens`}
        label={`Tokens per day, last 14 days. ${tokens(total14)} total.`} />
    </section>
  );
}

function Stat({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  return (
    <div>
      <span className="micro">{label}</span>
      <Rolling value={value} format={format} className="v" />
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; name: string; total: number; to?: string }[] }) {
  return (
    <section className="glass card" aria-label={title}>
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <span className="meta">7 days</span>
      </div>
      {rows.length === 0 ? (
        <p className="meta" style={{ margin: '8px 0' }}>Nothing this week.</p>
      ) : (
        <div className="list">
          {rows.map(r => {
            const inner = (
              <>
                <div className="row-main"><div className="row-title"><span className="t">{r.name}</span></div></div>
                <div className="row-end"><span className="k num">{tokens(r.total)}</span></div>
              </>
            );
            return r.to
              ? <a key={r.key} className="row compact" href={r.to}>{inner}</a>
              : <div key={r.key} className="row compact">{inner}</div>;
          })}
        </div>
      )}
    </section>
  );
}

function UsageSkeleton() {
  return (
    <>
      <div className="limits-tiles">
        {[0, 1].map(i => (
          <div key={i} className="glass limit-tile">
            <Skeleton h={12} w="40%" /><Skeleton h={44} w="30%" style={{ margin: '6px 0' }} /><Skeleton h={8} /><Skeleton h={12} w="45%" />
          </div>
        ))}
      </div>
      <div className="usage-grid" style={{ marginTop: 12 }}>
        <div className="glass card"><SkeletonRows n={5} /></div>
        <div className="glass card"><Skeleton h={220} /></div>
      </div>
    </>
  );
}
