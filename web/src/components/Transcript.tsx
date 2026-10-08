import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, BookOpen, FilePen, FilePlus, FileText, Globe, ListChecks, Search, SquareTerminal, Users, Wrench, X,
} from 'lucide-react';
import type { Job, JobEvent } from '../../../shared/types';
import { api, ApiError, streamJob } from '../api';
import { clockTime, duration, relTime } from '../format';
import { useNow } from '../hooks';
import { Markdown } from './Markdown';
import { ErrorState, ICON, jobStatus, SkeletonRows, StatusWord } from './bits';
import { toast } from './Toasts';

const TOOL_ICONS: Record<string, typeof Wrench> = {
  Read: FileText, Edit: FilePen, MultiEdit: FilePen, Write: FilePlus, NotebookEdit: FilePen,
  Bash: SquareTerminal, Grep: Search, Glob: Search, LS: Search,
  WebFetch: Globe, WebSearch: Globe, Task: Users, Agent: Users, TodoWrite: ListChecks, Skill: BookOpen,
};

const evKey = (e: JobEvent) => `${e.ts}|${e.type}|${e.tool ?? ''}|${e.text}`;
const isLive = (j: Job | null) => !!j && (j.status === 'running' || j.status === 'queued');

export function Transcript({ jobId, onJobChange, onContinue }: {
  jobId: string;
  onJobChange?: (job: Job) => void;
  onContinue?: (job: Job) => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const seen = useRef(new Set<string>());
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const now = useNow(1000);
  const onJobChangeRef = useRef(onJobChange);
  onJobChangeRef.current = onJobChange;

  const addEvents = (list: JobEvent[]) => {
    const fresh = list.filter(e => !seen.current.has(evKey(e)));
    if (!fresh.length) return;
    fresh.forEach(e => seen.current.add(evKey(e)));
    setEvents(prev => [...prev, ...fresh]);
  };

  const updateJob = (j: Job) => {
    setJob({ ...j, events: undefined });
    onJobChangeRef.current?.(j);
  };

  // Load the run, then follow it live while it runs.
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    seen.current = new Set();
    setEvents([]);
    setJob(null);
    setError(null);
    stick.current = true;

    const refetch = async () => {
      try {
        const j = await api.job(jobId);
        if (!alive) return;
        addEvents(j.events ?? []);
        updateJob(j);
        if (!isLive(j) && poll) { clearInterval(poll); poll = null; }
      } catch { /* keep the last state */ }
    };

    (async () => {
      try {
        const j = await api.job(jobId);
        if (!alive) return;
        addEvents(j.events ?? []);
        updateJob(j);
        if (!isLive(j)) return;
        stop = streamJob(jobId, msg => {
          if (!alive) return;
          if (msg.kind === 'event') addEvents([msg.event]);
          else {
            updateJob(msg.job);
            if (msg.job.events) addEvents(msg.job.events);
            if (!isLive(msg.job)) { stop?.(); stop = null; refetch(); }
          }
        }, () => {
          // Stream dropped: fall back to polling the run.
          stop?.();
          stop = null;
          if (!poll && alive) poll = setInterval(refetch, 3000);
        });
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e : new ApiError('http', 0, String(e)));
      }
    })();

    return () => { alive = false; stop?.(); if (poll) clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Keep the newest output in view while the reader is at the bottom.
  useEffect(() => {
    const scroller = scrollParent(endRef.current);
    if (!scroller) return;
    const on = () => {
      const el = scroller === document.scrollingElement ? document.documentElement : scroller as HTMLElement;
      const bottom = scroller === document.scrollingElement ? window.innerHeight + window.scrollY : el.clientHeight + el.scrollTop;
      stick.current = el.scrollHeight - bottom < 120;
    };
    const target: EventTarget = scroller === document.scrollingElement ? window : scroller;
    target.addEventListener('scroll', on, { passive: true });
    return () => target.removeEventListener('scroll', on);
  }, [job?.id]);

  useLayoutEffect(() => {
    if (!isLive(job) || !stick.current || events.length < 2) return;
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length, job]);

  if (error) return <ErrorState error={error} />;
  if (!job) return <SkeletonRows n={4} />;

  const st = jobStatus[job.status];
  const live = isLive(job);

  const cancel = async () => {
    setCancelling(true);
    try {
      const j = await api.cancelJob(job.id);
      updateJob(j);
      toast('Run cancelled');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not cancel', { tone: 'bad' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="transcript">
      <div className="section" style={{ gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="meta" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <StatusWord tone={st.tone} word={st.word} pulse={live} />
            <span className="ellipsis">· {job.projectName ?? 'Projects folder'} · {job.mode === 'cloud' ? 'Cloud' : 'On Mac'}</span>
          </span>
          {live && (
            <button type="button" className="btn sm" onClick={cancel} disabled={cancelling}>
              <X {...ICON} size={16} />Cancel
            </button>
          )}
          {!live && job.cloudUrl && (
            <a className="btn sm" href={job.cloudUrl} target="_blank" rel="noreferrer noopener">
              Open in Claude<ArrowUpRight {...ICON} size={16} />
            </a>
          )}
        </div>
        <div className="prompt-bubble">{job.prompt}</div>
        <div className="meta num">
          {relTime(job.createdAt, now)}
          {job.startedAt && ` · ${duration(job.startedAt, job.finishedAt, now)}`}
          {job.model && ` · ${cap(job.model)}`}
          {` · ${job.permission === 'acceptEdits' ? 'Edit files' : cap(job.permission)}`}
        </div>
        {live && job.cloudUrl && (
          <a className="meta" href={job.cloudUrl} target="_blank" rel="noreferrer noopener" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Open in Claude <ArrowUpRight size={14} strokeWidth={1.75} />
          </a>
        )}
      </div>

      <div className="transcript" style={{ marginTop: 8 }}>
        {events.length === 0 && live && <p className="meta" style={{ margin: 0 }}>Waiting for output</p>}
        {events.map((e, i) => <EventView key={i} e={e} />)}
        {job.status === 'failed' && job.error && !events.some(e => e.type === 'error') && (
          <div className="tx-error">{job.error}</div>
        )}
        {!live && job.resultText && !events.some(e => e.type === 'result') && (
          <div className="tx-result"><span className="micro">Result</span><Markdown text={job.resultText} /></div>
        )}
      </div>
      <div ref={endRef} />

      {!live && job.mode === 'local' && job.sessionId && onContinue && (
        <ContinueComposer job={job} onSent={onContinue} />
      )}
    </div>
  );
}

function EventView({ e }: { e: JobEvent }) {
  switch (e.type) {
    case 'text':
      return <Markdown text={e.text} />;
    case 'tool': {
      const Icon = (e.tool && TOOL_ICONS[e.tool]) || Wrench;
      return (
        <div className="tx-tool">
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          <span className="name">{e.tool ?? 'Tool'}</span>
          <span className="arg mono">{e.text}</span>
        </div>
      );
    }
    case 'result':
      return <div className="tx-result"><span className="micro">Result</span><Markdown text={e.text} /></div>;
    case 'error':
      return <div className="tx-error">{e.text}</div>;
    default:
      return <div className="tx-system"><span className="num">{clockTime(e.ts)}</span> · {e.text}</div>;
  }
}

function ContinueComposer({ job, onSent }: { job: Job; onSent: (j: Job) => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const j = await api.createJob({
        projectId: job.projectId, prompt: text.trim(), mode: 'local', permission: job.permission,
        model: job.model, resumeSessionId: job.sessionId,
      });
      setText('');
      onSent(j);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not continue', { tone: 'bad' });
    } finally {
      setSending(false);
    }
  };
  return (
    <form className="composer" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="micro" htmlFor={`cont-${job.id}`}>Continue</label>
      <textarea
        id={`cont-${job.id}`}
        className="textarea"
        rows={2}
        style={{ minHeight: 72 }}
        placeholder="Reply to Claude"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn" disabled={!text.trim() || sending}>{sending ? 'Sending' : 'Continue'}</button>
      </div>
    </form>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function scrollParent(el: HTMLElement | null): Element | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return document.scrollingElement;
}
