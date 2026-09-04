'use client';

/**
 * Practice over time.
 *
 * Every other screen shows an instantaneous value. Mastery decays, so "Reading
 * 62%" does not say whether it is climbing or rotting — and for a system built
 * on decay that is the question worth answering.
 *
 * Nothing here invents data. Each view states how much history it needs and
 * says so plainly below that, rather than drawing a slope through two points. A
 * line fitted to almost nothing is noise a reader will mistake for progress,
 * and this app opens nearly empty.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import {
  DOMAINS, MIN_TREND_DAYS,
  attemptGap, diagnosticDistribution, domainTrends, practiceByDay, tempoProgress,
  skill,
} from '@etude/core';
import { useLogHistory } from '@/db/history';
import { useEtudeState } from '@/db/store';
import {
  DayBars, Histogram, NotEnoughData, Sparkline, TableToggle,
} from '@/components/charts/primitives';

const DOMAIN_COLOR: Record<string, string> = {
  reading: 'var(--color-d-reading)',
  rhythm: 'var(--color-d-rhythm)',
  ear: 'var(--color-d-ear)',
  theory: 'var(--color-d-theory)',
  technique: 'var(--color-d-technique)',
  independence: 'var(--color-d-independence)',
  repertoire: 'var(--color-d-repertoire)',
};

export default function ProgressPage() {
  const { events, ready } = useLogHistory();
  const { app, streak } = useEtudeState();

  const practice = useMemo(() => practiceByDay(app.secondsByDay), [app.secondsByDay]);
  const trends = useMemo(() => domainTrends(events), [events]);
  const tempos = useMemo(() => tempoProgress(events), [events]);
  const timing = useMemo(
    () => diagnosticDistribution(events, 'meanAbsDeviationMs'),
    [events],
  );
  const gap = useMemo(() => attemptGap(events), [events]);

  const daysPractised = practice.filter((p) => p.value > 0).length;

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-24">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">Over time</h1>
        <Link href="/map" className="text-sm text-ink-faint underline">Skill map</Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-faint">
        Everything else in the app is a number for right now. Mastery decays, so
        this is where you can see whether it is going anywhere.
      </p>

      {!ready ? (
        <p className="mt-8 text-sm text-ink-faint">Reading your practice history…</p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Days practised" value={String(daysPractised)} />
            <Stat label="Current streak" value={`${streak.current}`} />
            <Stat label="Longest streak" value={`${streak.longest}`} />
          </section>

          <Panel
            title="Practice, by day"
            note="A gap is a day off. Days you did not practise are drawn empty rather than skipped, because a continuous line across them would show a habit that did not happen."
            testId="practice-chart"
          >
            {practice.length === 0 ? (
              <NotEnoughData need="No practice recorded yet. Play anything and this fills in." />
            ) : (
              <>
                <DayBars points={practice} unit=" min" />
                <TableToggle
                  columns={['Day', 'Minutes']}
                  rows={practice.map((p) => [p.day, String(Math.round(p.value))])}
                />
              </>
            )}
          </Panel>

          <Panel
            title="Each domain, over time"
            note="Drawn one per domain rather than seven lines on one chart. The domain colours fail a colour-vision check against each other — ear and rhythm are nearly identical to a red-green colourblind reader — so identity comes from the label, and colour only echoes it."
            testId="domain-trends"
          >
            {trends === null ? (
              <NotEnoughData
                need={`Not enough history yet — this needs ${MIN_TREND_DAYS} days of practice before a trend means anything.`}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {DOMAINS.map((domain) => {
                  const trend = trends.find((t) => t.domain === domain.id);
                  if (!trend) return null;
                  const latest = trend.points[trend.points.length - 1]?.value ?? 0;
                  // A domain nothing has touched would otherwise draw a flat
                  // line along zero, which reads as a measurement that did not
                  // move rather than as an absence of data. Saying "not
                  // started" is the same distinction the rest of the app makes
                  // when it declines to report a number it does not have.
                  const started = trend.points.some((p) => p.value > 0.001);
                  return (
                    <div key={domain.id} data-testid={`trend-${domain.id}`}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-medium text-ink">{domain.name}</span>
                        <span className="tabular text-sm text-ink-dim">
                          {started ? (
                            <>
                              {Math.round(latest * 100)}%
                              <Change value={trend.change} />
                            </>
                          ) : (
                            <span className="text-ink-faint">not started</span>
                          )}
                        </span>
                      </div>
                      {started ? (
                        <Sparkline
                          points={trend.points}
                          color={DOMAIN_COLOR[domain.id] ?? 'var(--color-accent)'}
                          label={`${domain.name} mastery over time`}
                        />
                      ) : (
                        <div className="h-10" aria-hidden />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="Tempo held, per skill"
            note="“Clean at 96 BPM” is the unit of progress for anything motor. An accuracy percentage on its own says little, because accuracy is trivially bought by slowing down."
            testId="tempo-progress"
          >
            {tempos.length === 0 ? (
              <NotEnoughData need="Nothing motor practised yet. Technique, independence and repertoire drills land here." />
            ) : (
              <TempoTable points={tempos} />
            )}
          </Panel>

          <Panel
            title="Timing, spread out"
            note="A distribution rather than an average, because “45 ms off on average” hides whether that is every note slightly loose or most notes tight with a few disasters — and those want different practice."
            testId="timing-distribution"
          >
            {timing === null ? (
              <NotEnoughData need="Not enough timed attempts yet. Rhythm Gauntlet records the deviation this reads." />
            ) : (
              <Histogram buckets={timing.buckets} median={timing.median} unit=" ms" />
            )}
          </Panel>

          <Panel
            title="First go against later ones"
            note="Whether material is learned or merely warmed up. A large gap means yesterday's practice did not survive the night, which calls for consolidation rather than more repetitions."
            testId="attempt-gap"
          >
            {gap === null ? (
              <NotEnoughData need="Not enough repeated drills yet to compare a first attempt with a second." />
            ) : (
              <div className="flex items-baseline gap-6">
                <Stat label="First attempt" value={`${Math.round(gap.firstAttempt * 100)}%`} />
                <Stat label="Later attempts" value={`${Math.round(gap.laterAttempts * 100)}%`} />
                <Stat
                  label="Gap"
                  value={`${Math.round((gap.laterAttempts - gap.firstAttempt) * 100)} pts`}
                />
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Change({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="ml-2 text-ink-faint">flat</span>;
  const up = value > 0;
  return (
    <span className={`ml-2 ${up ? 'text-accent' : 'text-warn'}`}>
      {up ? '+' : ''}{Math.round(value * 100)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <div className="tabular mt-1 text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}

function Panel({
  title, note, testId, children,
}: {
  title: string;
  note: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel mt-6 p-5" data-testid={testId}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 mb-4 max-w-2xl text-xs leading-relaxed text-ink-faint">{note}</p>
      {children}
    </section>
  );
}

/**
 * The best tempo each motor skill has held, most recent first.
 *
 * A table rather than a chart: these are a handful of discrete skills with one
 * number each, and a chart would be decoration around data a list says better.
 */
function TempoTable({ points }: { points: readonly { day: string; skillId: string; bpm: number }[] }) {
  const latest = new Map<string, { bpm: number; day: string }>();
  for (const point of points) latest.set(point.skillId, { bpm: point.bpm, day: point.day });

  const rows = [...latest.entries()]
    .map(([skillId, { bpm, day }]) => {
      let name = skillId;
      try { name = skill(skillId).name; } catch { /* a skill this build dropped */ }
      return { skillId, name, bpm, day };
    })
    .sort((a, b) => b.bpm - a.bpm);

  return (
    <ul className="divide-y divide-hairline">
      {rows.map((row) => (
        <li key={row.skillId} className="flex items-baseline justify-between py-2">
          <span className="text-sm text-ink">{row.name}</span>
          <span className="tabular text-sm text-ink-dim">{Math.round(row.bpm)} BPM</span>
        </li>
      ))}
    </ul>
  );
}
