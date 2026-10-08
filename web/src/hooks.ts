import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from './api';

// ---------- Hash router ----------

export type Screen = 'overview' | 'projects' | 'pulls' | 'claude' | 'usage' | 'settings';
export interface Route { screen: Screen; param: string | null; query: URLSearchParams }

const SCREENS: Screen[] = ['overview', 'projects', 'pulls', 'claude', 'usage', 'settings'];

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const [first, ...rest] = pathPart.split('/');
  const screen = (SCREENS as string[]).includes(first) ? first as Screen : 'overview';
  const param = rest.length ? decodeURIComponent(rest.join('/')) : null;
  return { screen, param, query: new URLSearchParams(queryPart) };
}

export function href(screen: Screen, param?: string | null, query?: Record<string, string | null | undefined>): string {
  let h = `#/${screen}`;
  if (param) h += `/${encodeURIComponent(param)}`;
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
    const s = q.toString();
    if (s) h += `?${s}`;
  }
  return h;
}

export function navigate(screen: Screen, param?: string | null, query?: Record<string, string | null | undefined>, replace = false) {
  const h = href(screen, param, query);
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  return route;
}

// ---------- Global refresh bus ----------

let version = 0;
const versionSubs = new Set<() => void>();
export function bumpData() { version++; versionSubs.forEach(f => f()); }
function useDataVersion() {
  return useSyncExternalStore(cb => { versionSubs.add(cb); return () => versionSubs.delete(cb); }, () => version);
}

// ---------- Resource hook (cached, polled while visible) ----------

const cache = new Map<string, unknown>();

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

export function useResource<T>(key: string | null, fetcher: () => Promise<T>, pollMs?: number): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(() => (key ? cache.get(key) as T | undefined : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;
  const v = useDataVersion();

  const load = useCallback(async () => {
    const k = keyRef.current;
    if (!k) return;
    setLoading(true);
    try {
      const d = await fetcherRef.current();
      if (keyRef.current !== k) return;
      cache.set(k, d);
      setDataState(d);
      setError(null);
    } catch (e) {
      if (keyRef.current !== k) return;
      setError(e instanceof ApiError ? e : new ApiError('http', 0, String(e)));
    } finally {
      if (keyRef.current === k) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!key) { setDataState(undefined); return; }
    setDataState(cache.get(key) as T | undefined);
    setError(null);
    load();
  }, [key, v, load]);

  useEffect(() => {
    if (!key || !pollMs) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [key, pollMs, load]);

  const setData = useCallback((d: T) => {
    if (keyRef.current) cache.set(keyRef.current, d);
    setDataState(d);
  }, []);

  return { data, error, loading, reload: load, setData };
}

// ---------- Misc hooks ----------

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => { const m = matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => matchMedia(query).matches,
    () => false,
  );
}

export const useWide = () => useMedia('(min-width: 1024px)');
export const usePhone = () => useMedia('(max-width: 599px)');
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

// ---------- Overlay lock: pause the backdrop drift while any sheet is open ----------

let overlays = 0;
export function useOverlayLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    overlays++;
    document.documentElement.classList.add('modal-lock');
    return () => {
      overlays--;
      if (overlays <= 0) { overlays = 0; document.documentElement.classList.remove('modal-lock'); }
    };
  }, [active]);
}

// ---------- Theme ----------

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'claudehub.theme';
const themeSubs = new Set<() => void>();

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

export function applyTheme(pref = getTheme()) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const el = m as HTMLMetaElement;
    if (pref === 'system') {
      el.content = el.media.includes('dark') ? '#0A1122' : '#F4F6FB';
    } else {
      el.content = dark ? '#0A1122' : '#F4F6FB';
    }
  });
}

export function setTheme(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* storage unavailable */ }
  applyTheme(pref);
  themeSubs.forEach(f => f());
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const t = useSyncExternalStore(cb => { themeSubs.add(cb); return () => themeSubs.delete(cb); }, getTheme);
  return [t, setTheme];
}

// ---------- FLIP: rows glide from their old position ----------

export function useFlip(container: React.RefObject<HTMLElement | null>, deps: unknown[], disabled = false) {
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'));
    const next = new Map<string, DOMRect>();
    for (const item of items) {
      const key = item.dataset.flip!;
      const rect = item.getBoundingClientRect();
      next.set(key, rect);
      const old = prev.current.get(key);
      if (disabled || !old || prev.current.size === 0) continue;
      const dy = old.top - rect.top;
      if (Math.abs(dy) > 1) {
        item.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
    if (!disabled && prev.current.size) {
      for (const item of items) {
        if (!prev.current.has(item.dataset.flip!)) {
          item.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
        }
      }
    }
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ---------- Rolling number (not on first paint) ----------

export function useRolling(value: number, reduced: boolean): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; from.current = value; setShown(value); return; }
    if (reduced || from.current === value) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 380);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * e));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, reduced]);
  return shown;
}
