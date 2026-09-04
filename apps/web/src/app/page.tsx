'use client';

import Link from 'next/link';
import {
  DAILY_MINIMUM_MINUTES, DOMAINS, MODES, SKILLS, levelForXp,
  masteryBand, MASTERY_BAND_LABEL, streakIsAlive,
} from '@etude/core';
import { useEtudeState, useMastery } from '@/db/store';
import { DomainBar } from '@/components/DomainBar';

export default function TodayPage() {
  const { app, streak, secondsToday, ready } = useEtudeState();
  const mastery = useMastery();

  const level = levelForXp(app.totalXp);
  const minutesToday = Math.floor(secondsToday / 60);
  const metToday = minutesToday >= DAILY_MINIMUM_MINUTES;
  const alive = streakIsAlive(streak);

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8">
      <header className="mb-8">
        <h1 className="text-[2.6rem] font-bold leading-none tracking-tight">Étude</h1>
        <p className="mt-2 text-ink-faint">
          {ready ? greeting(app.attemptsTotal) : 'Loading your history…'}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3" aria-label="Progress summary">
        <Stat
          label="Streak"
          value={String(streak.current)}
          unit={streak.current === 1 ? 'day' : 'days'}
          tone={alive ? 'good' : 'dim'}
          footnote={
            streak.freezesBanked > 0
              ? `${streak.freezesBanked} freeze${streak.freezesBanked > 1 ? 's' : ''} banked`
              : streak.current === 0
                ? `${DAILY_MINIMUM_MINUTES} min starts one`
                : 'Earn a freeze every 7 days'
          }
        />
        <Stat
          label="Level"
          value={String(level.level)}
          unit={`${level.into}/${level.span} XP`}
          tone="accent"
          progress={level.into / level.span}
        />
        <Stat
          label="Today"
          value={String(minutesToday)}
          unit="min"
          tone={metToday ? 'good' : 'dim'}
          footnote={metToday ? 'Daily minimum met' : `${DAILY_MINIMUM_MINUTES - minutesToday} min to go`}
          progress={Math.min(1, minutesToday / DAILY_MINIMUM_MINUTES)}
        />
      </section>

      <section className="mt-6">
        <div className="flex gap-3">
          <Link
            href="/practice"
            className="tap flex-1 rounded-2xl bg-accent px-6 py-6 text-[1.3rem] font-bold text-accent-ink"
          >
            Start practising
          </Link>
          <Link
            href="/play/free"
            className="tap rounded-2xl bg-raised px-7 py-6 text-[1.05rem] font-semibold text-ink-dim"
          >
            Free play
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Where you stand
        </h2>
        <div className="panel divide-y divide-hairline">
          {DOMAINS.map((d) => {
            const skills = SKILLS.filter((s) => s.domain === d.id);
            const values = skills.map((s) => mastery.get(s.id) ?? 0);
            const mean = values.length
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0;
            const started = values.filter((v) => v > 0.01).length;
            return (
              <DomainBar
                key={d.id}
                domain={d}
                value={mean}
                caption={
                  started === 0
                    ? 'Not started'
                    : `${started} of ${skills.length} skills · ${MASTERY_BAND_LABEL[masteryBand(mean)]}`
                }
              />
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Jump in
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.slice(0, 4).map((m) => (
            <Link
              key={m.id}
              href={`/play/${m.id}`}
              className="panel block p-4 transition-colors active:bg-raised"
            >
              <div className="font-semibold text-ink">{m.name}</div>
              <div className="mt-1 text-sm text-ink-faint">{m.tagline}</div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mt-12 pb-6 text-center">
        <Link href="/diagnostics" className="text-sm text-ink-faint underline">
          Device diagnostics
        </Link>
      </footer>
    </div>
  );
}

function greeting(attempts: number): string {
  if (attempts === 0) return 'Nothing logged yet. Pick anything below to begin.';
  if (attempts < 50) return 'Early days. Consistency beats intensity right now.';
  return `${attempts.toLocaleString()} attempts logged.`;
}

function Stat({
  label, value, unit, tone, footnote, progress,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: 'good' | 'accent' | 'dim';
  footnote?: string;
  progress?: number;
}) {
  const toneClass = {
    good: 'text-good',
    accent: 'text-accent',
    dim: 'text-ink-dim',
  }[tone];

  return (
    <div className="panel p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`tabular text-[2.1rem] font-bold leading-none ${toneClass}`}>
          {value}
        </span>
        {unit && <span className="text-sm text-ink-faint">{unit}</span>}
      </div>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
          <div
            className={`h-full rounded-full ${tone === 'good' ? 'bg-good' : 'bg-accent'}`}
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
      {footnote && <p className="mt-2 text-xs leading-snug text-ink-faint">{footnote}</p>}
    </div>
  );
}
