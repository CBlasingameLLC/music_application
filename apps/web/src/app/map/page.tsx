'use client';

import { useState } from 'react';
import {
  DOMAINS, MASTERY_BAND_LABEL, SKILLS, UNLOCK_THRESHOLD, type DomainId,
  masteryBand,
} from '@etude/core';
import { useMastery } from '@/db/store';

/**
 * The progress map.
 *
 * A prerequisite graph laid out by tier, not a linear course. Locked skills stay
 * visible so the path ahead is legible — hiding them would make the curriculum
 * feel arbitrary rather than ordered.
 */
export default function MapPage() {
  const mastery = useMastery();
  const [active, setActive] = useState<DomainId>('theory');

  const domain = DOMAINS.find((d) => d.id === active) ?? DOMAINS[0]!;
  const skills = SKILLS.filter((s) => s.domain === active);
  const tiers = [...new Set(skills.map((s) => s.tier))].sort((a, b) => a - b);

  const isUnlocked = (requires: readonly string[]) =>
    requires.every((r) => (mastery.get(r) ?? 0) >= UNLOCK_THRESHOLD);

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8">
      <h1 className="text-3xl font-bold">Progress</h1>
      <p className="mt-2 text-sm text-ink-faint">
        Seven tracks, measured separately. Mastery fades if you leave it alone —
        that is what puts a skill back in the queue.
      </p>

      <div className="mt-5 -mx-5 overflow-x-auto px-5">
        <div className="flex gap-2 pb-2">
          {DOMAINS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActive(d.id)}
              aria-pressed={active === d.id}
              className={[
                'tap shrink-0 rounded-xl px-5 text-sm font-semibold transition-colors',
                active === d.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-dim',
              ].join(' ')}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink-faint">
        {domain.blurb}
        {domain.agnostic && ' · carries over to guitar unchanged'}
      </p>

      <div className="mt-6 space-y-6 pb-10">
        {tiers.map((tier) => (
          <div key={tier}>
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Tier {tier + 1}
              </span>
              <span className="h-px flex-1 bg-hairline" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {skills
                .filter((s) => s.tier === tier)
                .map((s) => {
                  const value = mastery.get(s.id) ?? 0;
                  const unlocked = isUnlocked(s.requires);
                  const band = masteryBand(value);
                  return (
                    <div
                      key={s.id}
                      className={[
                        'panel p-3 transition-opacity',
                        unlocked ? '' : 'opacity-45',
                      ].join(' ')}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">{s.name}</span>
                        <span className="tabular shrink-0 text-xs text-ink-faint">
                          {Math.round(value * 100)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-500"
                          style={{ width: `${Math.max(2, value * 100)}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-faint">
                        <span>{MASTERY_BAND_LABEL[band]}</span>
                        {s.kind === 'motor' && <span>· motor</span>}
                        {!unlocked && <span>· locked</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
