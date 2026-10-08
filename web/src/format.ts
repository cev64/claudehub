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

/** Token counts: 950, 1.2k, 12.4k, 205k, 1.2M, 12.4M, 1.1B */
export function tokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0';
  const a = Math.abs(n);
  if (a < 1000) return num(n);
  const units: [number, string][] = [[1e3, 'k'], [1e6, 'M'], [1e9, 'B']];
  let i = a >= 1e9 ? 2 : a >= 1e6 ? 1 : 0;
  // 999,960 would round to "1000k": carry to the next unit.
  if (i < 2 && Math.round(a / units[i][0]) >= 1000) i++;
  const v = a / units[i][0];
  const s = v < 100 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString();
  return (n < 0 ? MINUS : '') + s + units[i][1];
}

/** "Thu 9:00 AM" (or "9:00 AM" when it's today). */
export function dayTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

/** "Resets in 2h 14m" within a day, "Resets Thu 9:00 AM" beyond, "Reset 3:40 PM" once passed. */
export function resetsIn(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = t - now;
  if (diff <= 0) return `Reset ${dayTime(iso, now)}`;
  if (diff > 24 * 3600_000) return `Resets ${dayTime(iso, now)}`;
  const m = Math.max(1, Math.floor(diff / 60_000));
  const h = Math.floor(m / 60);
  return `Resets in ${h ? `${h}h ${m % 60}m` : `${m}m`}`;
}

/** "claude-opus-5-5" -> "Opus 5.5", "claude-sonnet-4-5-20250929" -> "Sonnet 4.5", "claude-3-5-haiku-20241022" -> "Haiku 3.5" */
export function modelName(id: string | null | undefined): string {
  if (!id) return 'Unknown model';
  const clean = id.replace(/\[.*?\]$/, '').replace(/^(us\.|eu\.)?anthropic\./, '').replace(/^claude-/, '').replace(/-\d{8}(-v\d+(:\d+)?)?$/, '');
  const fam = clean.match(/(opus|sonnet|haiku|fable)/i);
  if (!fam) return id;
  const family = fam[1][0].toUpperCase() + fam[1].slice(1).toLowerCase();
  const version = clean.replace(fam[1], '').split('-').filter(p => /^\d{1,2}$/.test(p)).join('.');
  return version ? `${family} ${version}` : family;
}
