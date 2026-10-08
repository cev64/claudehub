import type { ReactNode } from 'react';
import { CloudOff, KeyRound, RotateCw, TriangleAlert } from 'lucide-react';
import type { ChecksState, JobStatus, ProjectStatus, PullRequest } from '../../../shared/types';
import type { ApiError } from '../api';
import { href, useReducedMotion, useRolling } from '../hooks';
import { num } from '../format';

export const ICON = { size: 20, strokeWidth: 1.75 } as const;

export function PageHead({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <span className="micro">{label}</span>
      <div className="page-head-row">
        <h1 className="display">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function Rolling({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const shown = useRolling(value, reduced);
  return <span className={`num${className ? ' ' + className : ''}`}>{num(shown)}</span>;
}

type Tone = 'good' | 'bad' | 'warn' | 'accent' | 'neutral';

export function StatusWord({ tone, word, pulse }: { tone: Tone; word: string; pulse?: boolean }) {
  return (
    <span className="status">
      <span className={`dot${tone !== 'neutral' ? ' ' + tone : ''}${pulse ? ' pulse' : ''}`} aria-hidden />
      {word}
    </span>
  );
}

export const projectStatus: Record<ProjectStatus, { tone: Tone; word: string }> = {
  active: { tone: 'good', word: 'Active' },
  idle: { tone: 'warn', word: 'Idle' },
  stale: { tone: 'neutral', word: 'Stale' },
};

export const jobStatus: Record<JobStatus, { tone: Tone; word: string }> = {
  queued: { tone: 'neutral', word: 'Queued' },
  running: { tone: 'accent', word: 'Running' },
  succeeded: { tone: 'good', word: 'Done' },
  failed: { tone: 'bad', word: 'Failed' },
  cancelled: { tone: 'neutral', word: 'Cancelled' },
};

export function checksWord(c: ChecksState): { tone: Tone; word: string } {
  switch (c) {
    case 'success': return { tone: 'good', word: 'Passing' };
    case 'failure': return { tone: 'bad', word: 'Failing' };
    case 'pending': return { tone: 'warn', word: 'Pending' };
    default: return { tone: 'neutral', word: 'No checks' };
  }
}

export function prStateWord(p: PullRequest): { tone: Tone; word: string } {
  if (p.state === 'merged') return { tone: 'accent', word: 'Merged' };
  if (p.state === 'closed') return { tone: 'neutral', word: 'Closed' };
  if (p.draft) return { tone: 'neutral', word: 'Draft' };
  return checksWord(p.checks);
}

export function reviewWord(r: PullRequest['reviewDecision']): string | null {
  switch (r) {
    case 'APPROVED': return 'Approved';
    case 'CHANGES_REQUESTED': return 'Changes requested';
    case 'REVIEW_REQUIRED': return 'Review needed';
    default: return null;
  }
}

/** Calm empty / error states. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.kind === 'offline') return <Offline onRetry={onRetry} />;
  if (error.kind === 'unauthorized') {
    return (
      <div className="empty">
        <div className="row-icon"><KeyRound {...ICON} /></div>
        <h2 className="card-title">Access token needed</h2>
        <p className="meta" style={{ margin: 0 }}>Add the token from the Mac in Settings.</p>
        <a className="btn" href={href('settings')}>Open Settings</a>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="row-icon"><TriangleAlert {...ICON} /></div>
      <h2 className="card-title">Couldn't load this</h2>
      <p className="meta" style={{ margin: 0 }}>{error.message}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}><RotateCw {...ICON} size={18} />Try again</button>}
    </div>
  );
}

export function Offline({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="row-icon"><CloudOff {...ICON} /></div>
      <h2 className="card-title">Agent offline</h2>
      <p className="meta" style={{ margin: 0, maxWidth: 360 }}>
        Start it on the Mac with <code>npm start</code> in the claudehub folder.
      </p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}><RotateCw {...ICON} size={18} />Try again</button>}
    </div>
  );
}

export function Skeleton({ h = 20, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
          <Skeleton h={16} w={`${55 - (i % 3) * 10}%`} />
          <Skeleton h={12} w={`${35 + (i % 2) * 10}%`} />
        </div>
      ))}
    </div>
  );
}
