import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SegOption<T extends string> { value: T; label: ReactNode }

/** Pill track with a raised thumb that slides between options. */
export function Segmented<T extends string>({
  options, value, onChange, label, size, full,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm';
  full?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [instant, setInstant] = useState(true);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const btn = el.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!btn) { setThumb(null); return; }
      setThumb({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(() => { setInstant(true); measure(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);

  useLayoutEffect(() => {
    if (!instant) return;
    const id = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(id);
  }, [instant, thumb]);

  const onKey = (e: React.KeyboardEvent) => {
    const i = options.findIndex(o => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
  };

  return (
    <div ref={track} className={`seg${size ? ' ' + size : ''}${full ? ' full' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {thumb && (
        <span
          className={`seg-thumb${instant ? ' instant' : ''}`}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
          aria-hidden
        />
      )}
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg-opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <div className="switch-row">
      <label htmlFor={id} className="ink-2" style={{ fontSize: 15, fontWeight: 500 }}>{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function Select<T extends string>({
  value, onChange, options, label, id, className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  id?: string;
  className?: string;
}) {
  return (
    <span className={`select-wrap${className ? ' ' + className : ''}`}>
      <select id={id} className="select" aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={18} strokeWidth={1.75} />
    </span>
  );
}

export const MODEL_OPTIONS = [
  { value: '', label: 'Default model' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export const PERMISSION_OPTIONS = [
  { value: 'plan' as const, label: 'Plan' },
  { value: 'acceptEdits' as const, label: 'Edit files' },
  { value: 'auto' as const, label: 'Auto' },
];
