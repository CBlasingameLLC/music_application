'use client';

import type { Domain } from '@etude/core';

const HUE_VAR: Record<string, string> = {
  reading: 'var(--color-d-reading)',
  rhythm: 'var(--color-d-rhythm)',
  ear: 'var(--color-d-ear)',
  theory: 'var(--color-d-theory)',
  technique: 'var(--color-d-technique)',
  independence: 'var(--color-d-independence)',
  repertoire: 'var(--color-d-repertoire)',
};

/**
 * One domain's standing.
 *
 * Seven bars rather than one level is the point: it makes visible that you can
 * be a strong reader and weak at hand independence, which is exactly the
 * situation this app is built to fix and exactly what a single number hides.
 */
export function DomainBar({
  domain, value, caption,
}: {
  domain: Domain;
  value: number;
  caption: string;
}) {
  const color = HUE_VAR[domain.id] ?? 'var(--color-accent)';
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="w-32 shrink-0">
        <div className="font-semibold text-ink">{domain.name}</div>
        <div className="text-xs text-ink-faint">{domain.blurb}</div>
      </div>
      <div className="flex-1">
        <div className="h-2.5 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(2, value * 100)}%`, background: color }}
          />
        </div>
        <div className="mt-1.5 text-xs text-ink-faint">{caption}</div>
      </div>
      <div className="tabular w-12 shrink-0 text-right text-sm font-semibold" style={{ color }}>
        {Math.round(value * 100)}
      </div>
    </div>
  );
}
