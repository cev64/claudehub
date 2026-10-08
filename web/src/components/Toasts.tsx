import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
  tone: 'good' | 'bad' | 'neutral';
  action?: { label: string; run: () => void };
  out?: boolean;
}

let items: ToastItem[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => { items = [...items]; subs.forEach(f => f()); };

export function toast(
  message: string,
  opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; ms?: number } = {},
) {
  const id = nextId++;
  items.push({ id, message, tone: opts.tone ?? 'neutral', action: opts.action });
  if (items.length > 3) items.shift();
  emit();
  setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 6000 : 3800));
}

function dismiss(id: number) {
  const t = items.find(x => x.id === id);
  if (!t || t.out) return;
  t.out = true;
  emit();
  setTimeout(() => { items = items.filter(x => x.id !== id); emit(); }, 200);
}

export function Toasts() {
  const list = useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => items);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  if (!el) return null;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast glass-strong${t.out ? ' out' : ''}`}>
          {t.tone === 'good' && <CircleCheck size={20} strokeWidth={1.75} className="good" aria-hidden />}
          {t.tone === 'bad' && <CircleAlert size={20} strokeWidth={1.75} className="bad" aria-hidden />}
          <span className="msg">{t.message}</span>
          {t.action ? (
            <button type="button" className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
          ) : <span style={{ width: 6 }} />}
        </div>
      ))}
    </div>,
    el,
  );
}
