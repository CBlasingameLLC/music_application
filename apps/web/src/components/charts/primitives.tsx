'use client';

/**
 * Chart primitives, as inline SVG.
 *
 * No charting library. Recharts pulls d3 for perhaps four shapes, and this is
 * the project that took OpenSheetMusicDisplay at 2 MB over Verovio at 27 MB
 * because the target is a 3 GB tablet. These are a few hundred lines and they
 * inherit the app's own tokens rather than fighting a library's theme.
 *
 * ## Why nothing here is a multi-series line chart
 *
 * The seven domain colours in `globals.css` were run through a contrast
 * validator rather than eyeballed, and they **fail** colour-vision-deficiency
 * separation: ear and rhythm sit at ΔE 3.8 under deuteranopia, below even the
 * floor of 6. Seven overlaid lines would therefore be unreadable for a
 * red-green colourblind reader — and spaghetti for everyone else.
 *
 * So domains are drawn as *small multiples*: one sparkline each, directly
 * labelled, with colour echoing a label that already carries the identity.
 * Colour is never the only thing distinguishing two marks.
 */

import { useId, useMemo, useState } from 'react';

export interface Point {
  readonly day: string;
  readonly value: number;
}

/** Nothing to draw, said plainly rather than drawn as an empty axis. */
export function NotEnoughData({ need }: { need: string }) {
  return (
    <p className="py-6 text-center text-sm text-ink-faint" data-testid="not-enough-data">
      {need}
    </p>
  );
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * A small line, drawn without axes.
 *
 * Deliberately unlabelled inside: a sparkline's job is the *shape*, and the
 * caller shows the current value beside it as a number. Putting a number on
 * every point is the single most common way to make a chart unreadable.
 */
export function Sparkline({
  points, color, height = 40, label,
}: {
  points: readonly Point[];
  color: string;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 240;
  const pad = 3;

  const path = useMemo(() => {
    if (points.length < 2) return '';
    const max = Math.max(1e-9, ...points.map((p) => p.value));
    const stepX = (width - pad * 2) / (points.length - 1);
    return points
      .map((p, i) => {
        const x = pad + i * stepX;
        const y = height - pad - (p.value / max) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, height]);

  if (points.length < 2) return null;
  const active = hover !== null ? points[hover] : null;
  const stepX = (width - pad * 2) / (points.length - 1);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-10 w-full"
        role="img"
        aria-label={label}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const index = Math.round(ratio * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, index)));
        }}
      >
        <path d={path} fill="none" stroke={color} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active && hover !== null && (
          <circle
            cx={pad + hover * stepX}
            cy={height - pad - (active.value / Math.max(1e-9, ...points.map((p) => p.value))) * (height - pad * 2)}
            r={3} fill={color} stroke="var(--color-ground)" strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {active && (
        <span className="tabular pointer-events-none absolute -top-1 right-0 rounded bg-raised px-2 py-0.5 text-xs text-ink">
          {active.day.slice(5)} · {Math.round(active.value * 100)}%
        </span>
      )}
    </div>
  );
}

/**
 * One bar per day.
 *
 * Days with nothing practised are drawn as an empty slot rather than skipped.
 * That is the whole point of the chart: a gap is a day off, and joining across
 * it would draw a continuous habit that did not happen.
 */
export function DayBars({
  points, max, unit = '',
}: {
  points: readonly Point[];
  max?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = niceMax(max ?? Math.max(1, ...points.map((p) => p.value)));
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="flex h-28 items-end gap-[2px]" onPointerLeave={() => setHover(null)}>
        {points.map((point, i) => {
          const ratio = point.value / ceiling;
          return (
            <button
              key={point.day}
              type="button"
              // The hit target is the full column height, not the bar: a
              // one-minute day is 3px tall and would be unhittable otherwise.
              className="group relative flex h-full flex-1 items-end"
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${point.day}: ${Math.round(point.value)}${unit}`}
            >
              <span
                className="w-full rounded-t-[4px] transition-colors"
                style={{
                  height: `${Math.max(point.value > 0 ? 3 : 1, ratio * 100)}%`,
                  background: point.value > 0
                    ? (hover === i ? 'var(--color-accent)' : 'var(--color-accent-dim)')
                    : 'var(--color-hairline)',
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex h-4 items-baseline justify-between text-xs text-ink-faint">
        <span>{points[0]?.day.slice(5)}</span>
        {active && (
          <span className="tabular text-ink">
            {active.day.slice(5)} · {Math.round(active.value)}{unit}
          </span>
        )}
        <span>{points[points.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

/**
 * How values are spread, rather than what they average.
 *
 * An average hides the difference between every note slightly loose and most
 * notes tight with a few disasters — different problems, different remedies.
 */
export function Histogram({
  buckets, median, unit = '',
}: {
  buckets: readonly { from: number; to: number; count: number }[];
  median: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = Math.max(1, ...buckets.map((b) => b.count));
  const active = hover !== null ? buckets[hover] : null;
  const id = useId();

  return (
    <div>
      <div className="flex h-24 items-end gap-[2px]" onPointerLeave={() => setHover(null)}>
        {buckets.map((bucket, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            className="flex h-full flex-1 items-end"
            onPointerEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${Math.round(bucket.from)}–${Math.round(bucket.to)}${unit}: ${bucket.count}`}
          >
            <span
              className="w-full rounded-t-[4px]"
              style={{
                height: `${Math.max(bucket.count > 0 ? 3 : 1, (bucket.count / ceiling) * 100)}%`,
                background: hover === i ? 'var(--color-accent)' : 'var(--color-accent-dim)',
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs text-ink-faint">
        <span>{Math.round(buckets[0]?.from ?? 0)}{unit}</span>
        <span className="tabular text-ink">
          {active
            ? `${Math.round(active.from)}–${Math.round(active.to)}${unit} · ${active.count}`
            : `median ${Math.round(median)}${unit}`}
        </span>
        <span>{Math.round(buckets[buckets.length - 1]?.to ?? 0)}{unit}</span>
      </div>
    </div>
  );
}

/**
 * The numbers behind a chart, on demand.
 *
 * Present because a chart that can only be read by seeing it is not readable by
 * everyone — and because the exact figures are sometimes what you actually
 * want.
 */
export function TableToggle({
  rows, columns,
}: {
  rows: readonly (readonly string[])[];
  columns: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-ink-faint underline"
        data-testid="table-toggle"
      >
        {open ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {open && (
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-faint">
              <tr>{columns.map((c) => <th key={c} className="py-1 pr-4 font-medium">{c}</th>)}</tr>
            </thead>
            <tbody className="tabular text-ink-dim">
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <td key={j} className="py-1 pr-4">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
