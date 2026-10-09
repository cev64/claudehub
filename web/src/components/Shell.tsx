import { useEffect, useState } from 'react';
import { FolderGit2, Gauge, GitPullRequest, LayoutGrid, RefreshCw, Settings as SettingsIcon, SquareTerminal } from 'lucide-react';
import type { Health } from '../../../shared/types';
import { href, type Screen } from '../hooks';
import { relTime } from '../format';
import { ICON } from './bits';

// `bar` is the bottom-pill label: six items share 328px at 360px wide, so the longest one is shortened.
export const NAV: { screen: Screen; label: string; short: string; bar?: string; Icon: typeof LayoutGrid }[] = [
  { screen: 'overview', label: 'Overview', short: 'Overview', bar: 'Home', Icon: LayoutGrid },
  { screen: 'projects', label: 'Projects', short: 'Projects', Icon: FolderGit2 },
  { screen: 'pulls', label: 'Pull requests', short: 'PRs', Icon: GitPullRequest },
  { screen: 'claude', label: 'Claude', short: 'Claude', Icon: SquareTerminal },
  { screen: 'usage', label: 'Usage', short: 'Usage', Icon: Gauge },
  { screen: 'settings', label: 'Settings', short: 'Settings', Icon: SettingsIcon },
];

export function Backdrop() {
  return <div className="backdrop" aria-hidden><i /><i /><i /></div>;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" aria-hidden>
      <rect width="36" height="36" rx="10" fill="var(--accent)" />
      <g stroke="var(--on-accent)" strokeWidth="1.9" strokeLinecap="round" fill="none">
        <path d="M18 18 L11 11 M18 18 L25 11 M18 18 L18 26.5" />
      </g>
      <g fill="var(--on-accent)">
        <circle cx="18" cy="18" r="3.4" />
        <circle cx="10.5" cy="10.5" r="2.4" />
        <circle cx="25.5" cy="10.5" r="2.4" />
        <circle cx="18" cy="27" r="2.4" />
      </g>
    </svg>
  );
}

export function Rail({ screen, health, offline }: { screen: Screen; health: Health | undefined; offline: boolean }) {
  const idx = NAV.findIndex(n => n.screen === screen);
  const [itemH, setItemH] = useState(52);
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)');
    const on = () => setItemH(m.matches ? 46 : 52);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const tone = offline ? 'bad' : health?.ok === false ? 'warn' : health ? 'good' : '';
  return (
    <nav className="rail glass" aria-label="Main">
      <a className="logo" href={href('overview')} aria-label="ClaudeHub">
        <LogoMark className="logo-mark" />
        <span className="logo-word">ClaudeHub</span>
      </a>
      <div className="rail-nav">
        <span className="rail-indicator" style={{ transform: `translateY(${idx * itemH}px)` }} aria-hidden />
        {NAV.map(({ screen: s, label, short, Icon }) => (
          <a key={s} className="rail-item" href={href(s)} aria-current={s === screen ? 'page' : undefined} aria-label={label}>
            <Icon {...ICON} />
            <span className="rail-label-narrow">{short}</span>
            <span className="rail-label-wide">{label}</span>
          </a>
        ))}
      </div>
      <div className="rail-spacer" />
      <div className="rail-foot" title={offline ? 'Agent offline' : health?.hostname}>
        <span className="meta">
          <span className={`dot ${tone}`} aria-hidden />
          <span className="ellipsis" style={{ maxWidth: 150 }}>{offline ? 'Offline' : health?.hostname ?? 'Connecting'}</span>
        </span>
        <span className={`dot ${tone} narrow-dot`} aria-label={offline ? 'Agent offline' : 'Agent online'} />
      </div>
    </nav>
  );
}

export function BottomNav({ screen }: { screen: Screen }) {
  const idx = NAV.findIndex(n => n.screen === screen);
  return (
    <nav className="bottom-nav glass-strong" aria-label="Main">
      <span className="bottom-indicator" style={{ width: `calc((100% - 8px) / ${NAV.length})`, transform: `translateX(${idx * 100}%)` }} aria-hidden />
      {NAV.map(({ screen: s, label, short, bar, Icon }) => (
        <a key={s} className="bottom-item" href={href(s)} aria-current={s === screen ? 'page' : undefined} aria-label={label}>
          <Icon {...ICON} />
          <span>{bar ?? short}</span>
        </a>
      ))}
    </nav>
  );
}

export function TopBar({
  title, condensed, updatedAt, note, scanning, onRefresh, now,
}: {
  title: string;
  condensed: boolean;
  updatedAt: string | null;
  /** Replaces "Updated …", e.g. "Sample data" in the hosted build. */
  note?: string | null;
  scanning: boolean;
  onRefresh: () => void;
  now: number;
}) {
  return (
    <div className={`topbar${condensed ? ' condensed' : ''}`}>
      <div className="topbar-inner">
        <div className="topbar-title" aria-hidden={!condensed}>{title}</div>
        <div className="topbar-actions">
          <span className="updated" aria-live="polite">
            {note ?? (scanning ? 'Updating' : updatedAt ? `Updated ${relTime(updatedAt, now)}` : '')}
          </span>
          <button type="button" className="icon-btn" onClick={onRefresh} disabled={scanning} aria-label="Refresh">
            <RefreshCw {...ICON} className={scanning ? 'spin' : undefined} />
          </button>
        </div>
      </div>
    </div>
  );
}
