import { useId, useMemo, useRef, useState } from 'react';
import type { DayCount } from '../../../shared/types';
import { num, shortDate, weekday } from '../format';
import { useReducedMotion } from '../hooks';

/** 30-day commits as bars. */
export function ActivityChart({ data, height = 200 }: { data: DayCount[]; height?: number }) {
  const bars = useMemo(() => data.map(d => ({ date: d.date, value: d.commits })), [data]);
  const total = data.reduce((a, d) => a + d.commits, 0);
  return (
    <BarChart data={bars} height={height}
      tip={v => `${num(v)} ${v === 1 ? 'commit' : 'commits'}`}
      label={`Commits per day, last 30 days. ${num(total)} total.`} />
  );
}

export interface BarDatum { date: string; value: number }

/** Daily values as bars, with a scrub hairline + glass tooltip. Plain SVG. */
export function BarChart({
  data, height = 200, tip, label, axis = num,
}: {
  data: BarDatum[];
  height?: number;
  tip: (v: number) => string;     // tooltip value line
  label: string;                  // accessible summary
  axis?: (v: number) => string;   // y-axis tick labels
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const reduced = useReducedMotion();
  const [drawn] = useState(() => !reduced);

  const roRef = useRef<ResizeObserver | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    ref.current = el;
    roRef.current?.disconnect();
    if (el) {
      setWidth(el.clientWidth || 640);
      roRef.current = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
      roRef.current.observe(el);
    }
  };

  const padR = 4, padT = 8, padB = 24;
  const n = data.length || 1;
  const max = Math.max(4, ...data.map(d => d.value));
  const nice = niceMax(max);
  const padL = Math.max(28, 10 + 7 * axis(nice).length);
  const plotW = Math.max(10, width - padL - padR);
  const plotH = height - padT - padB;
  const step = plotW / n;
  const gap = 2;
  const barW = Math.max(2, step - gap);
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];

  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left - padL;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / step)));
    setActive(i);
  };

  const labelIdx = useMemo(() => {
    const idx = new Set<number>([0, n - 1]);
    const every = n <= 14 ? (width < 360 ? 7 : 4) : width < 480 ? 10 : 7;
    for (let i = n - 1; i >= 0; i -= every) idx.add(i);
    // drop labels too close to the first one
    for (const i of [...idx]) if (i !== 0 && i < every * 0.6) idx.delete(i);
    return idx;
  }, [n, width]);

  const a = active != null ? data[active] : null;
  const tipX = active != null ? padL + active * step + step / 2 : 0;
  const clampedTipX = Math.min(Math.max(tipX, 70), width - 70);

  return (
    <div
      ref={setRef}
      className={`chart${drawn ? ' draw' : ''}${active != null ? ' scrubbing' : ''}`}
      onPointerMove={e => pick(e.clientX)}
      onPointerDown={e => pick(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onPointerUp={e => { if (e.pointerType !== 'mouse') setActive(null); }}
      role="img"
      aria-label={label}
    >
      <svg height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {ticks.map(t => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={padL - 8} y={y(t) + 4} textAnchor="end">{axis(t)}</text>
          </g>
        ))}
        <g className="bars">
          {data.map((d, i) => {
            if (d.value <= 0) return null;
            const h = Math.max(2, plotH - (y(d.value) - padT));
            const x = padL + i * step + gap / 2;
            return <path key={d.date} className={`bar${i === active ? ' on' : ''}`} d={roundTop(x, padT + plotH - h, barW, h, Math.min(4, barW / 2))} />;
          })}
        </g>
        {active != null && (
          <line className="hair" x1={tipX} x2={tipX} y1={padT} y2={padT + plotH} />
        )}
        {data.map((d, i) => labelIdx.has(i) ? (
          <text key={d.date} className="axis-text" x={padL + i * step + step / 2} y={height - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {i === n - 1 ? 'Today' : shortDate(d.date)}
          </text>
        ) : null)}
      </svg>
      {a && (
        <div className="tooltip glass-strong" style={{ left: clampedTipX, top: -8 }}>
          <span className="quiet">{weekday(a.date)}</span>
          <b className="num">{tip(a.value)}</b>
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) {
    const c = m * pow;
    if (c >= v && Number.isInteger(c / 2)) return c;
  }
  return Math.ceil(v / 2) * 2;
}

/** Bar rounded at the data end (top), square at the baseline. */
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Small area sparkline (line draws in, then the area fades). */
export function Sparkline({ values, height = 56, label }: { values: number[]; height?: number; label: string }) {
  const w = 300;
  const reduced = useReducedMotion();
  const id = useId();
  const max = Math.max(1, ...values);
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => [(i / (n - 1)) * w, height - 3 - (v / max) * (height - 8)] as const);
  const line = smooth(pts);
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg className={`spark${reduced ? '' : ' draw'}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }} role="img" aria-label={label} key={id}>
      <path className="area" d={area} />
      <path className="line" d={line} pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function smooth(pts: readonly (readonly [number, number])[]) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}
