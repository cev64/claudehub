import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayLock, usePhone, useReducedMotion } from '../hooks';

/**
 * Modal sheet. The container never fades: the scrim (::before) and the sheet animate themselves,
 * so the sheet's backdrop blur is never inside a translucent ancestor.
 * On phones it is a bottom sheet you can drag down to dismiss.
 */
export function Sheet({
  open, onClose, title, children, wide, label,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'enter' | 'open' | 'closing'>('enter');
  const sheetRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const reduced = useReducedMotion();
  const drag = useRef<{ y: number; t: number; dy: number; v: number; id: number } | null>(null);

  useOverlayLock(mounted);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setPhase('enter');
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
      return () => cancelAnimationFrame(id);
    }
    if (!mounted) return;
    setPhase('closing');
    const t = setTimeout(() => setMounted(false), reduced ? 0 : 230);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    const body = document.body.style;
    const overflow = body.overflow;
    body.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      body.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  if (!mounted) return null;

  const setDrag = (dy: number) => {
    const sheet = sheetRef.current, modal = modalRef.current;
    if (!sheet || !modal) return;
    const shown = dy >= 0 ? dy : -Math.sqrt(-dy) * 4; // rubber-band upward
    sheet.style.transform = `translateY(${shown}px)`;
    modal.style.setProperty('--scrim-o', String(Math.max(0, 1 - Math.max(0, dy) / Math.max(1, sheet.offsetHeight))));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!phone || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, v: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetRef.current?.classList.add('dragging');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    const dy = e.clientY - d.y;
    d.v = (dy - d.dy) / Math.max(1, now - d.t);
    d.t = now;
    d.dy = dy;
    setDrag(dy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const sheet = sheetRef.current, modal = modalRef.current;
    if (!sheet || !modal) return;
    sheet.classList.remove('dragging');
    if (d.dy > 120 || d.v > 0.6) {
      sheet.style.transform = '';
      modal.style.removeProperty('--scrim-o');
      onClose();
    } else {
      sheet.style.transition = 'transform .3s cubic-bezier(.3,1.25,.5,1)';
      sheet.style.transform = '';
      modal.style.removeProperty('--scrim-o');
      setTimeout(() => { if (sheetRef.current) sheetRef.current.style.transition = ''; }, 320);
    }
  };

  const dragProps = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

  return createPortal(
    <div
      ref={modalRef}
      className={`modal${phase === 'open' ? ' open' : ''}${phase === 'closing' ? ' closing' : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={sheetRef}
        className={`sheet glass-strong${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="sheet-grab" {...dragProps} aria-hidden={!phone}><span /></div>
        <div className="sheet-head" {...dragProps}>
          <div style={{ minWidth: 0 }}>{title ?? <h2 className="card-title">{label}</h2>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
