// Formatting helpers. Numbers use a real minus sign (U+2212) and tabular figures in CSS.

export const MINUS = '−';

const nf = new Intl.NumberFormat('en-US');

export function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0';
  const s = nf.format(Math.abs(n));
  return n < 0 ? MINUS + s : s;
}

export function signed(n: number): string {
  if (n === 0) return '0';
  return (n > 0 ? '+' : MINUS) + nf.format(Math.abs(n));
}

export function compact(n: number): string {
  if (Math.abs(n) < 1000) return num(n);
  const v = Math.abs(n) / 1000;
  const s = (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '')) + 'k';
  return n < 0 ? MINUS + s : s;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** "just now", "4m ago", "3h ago", "2d ago", "Mar 4" */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', year: 'numeric' });
}

export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function weekday(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function duration(startIso: string | null, endIso: string | null, now = Date.now()): string {
  if (!startIso) return '';
  const end = endIso ? Date.parse(endIso) : now;
  const s = Math.max(0, Math.round((end - Date.parse(startIso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function firstLine(text: string, max = 120): string {
  const line = text.split('\n').find(l => l.trim()) ?? '';
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

/** "/Users/charlie/Desktop/Projects/x" -> "~/Desktop/Projects/x" */
export function tildePath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}
