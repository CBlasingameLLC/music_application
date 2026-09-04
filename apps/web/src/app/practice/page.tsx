'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { LADDERS, MODES, TIME_BUDGETS, currentRung } from '@etude/core';
import { db, hasIndexedDb } from '@/db/schema';
import { ladderStateFor, useEtudeState } from '@/db/store';
import { dueQueueFromRows, planFor, stepsFromPlan } from '@/lib/session';

export default function PracticePage() {
  const router = useRouter();
  const { app } = useEtudeState();
  const [budget, setBudget] = useState<number>(20);

  const rows = useLiveQuery(
    async () => (hasIndexedDb() ? db().skills.toArray() : []),
    [],
    [],
  );

  const due = dueQueueFromRows(rows);
  const plan = planFor(budget, due);
  const steps = stepsFromPlan(plan);
  const drillCount = steps.reduce((a, s) => a + s.count, 0);

  const begin = () => {
    sessionStorage.setItem('etude.session.steps', JSON.stringify(steps));
    sessionStorage.setItem('etude.session.budget', String(budget));
    router.push('/session');
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8">
      <h1 className="text-3xl font-bold">Practice</h1>

      <section className="panel mt-6 p-5">
        <h2 className="font-semibold">How long have you got?</h2>
        <p className="mt-1 text-sm text-ink-faint">
          The session is built from whatever is most overdue, balanced across
          warmup, your weakest area, reading, ear and theory.
        </p>

        <div className="mt-4 flex gap-3">
          {TIME_BUDGETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setBudget(m)}
              aria-pressed={budget === m}
              className={[
                'tap flex-1 rounded-xl text-lg font-bold transition-colors',
                budget === m
                  ? 'bg-accent text-accent-ink'
                  : 'bg-raised text-ink-dim',
              ].join(' ')}
            >
              {m} min
            </button>
          ))}
        </div>

        <ul className="mt-5 space-y-2">
          {plan.slots.map((s) => (
            <li key={s.slot.id} className="flex items-baseline gap-3 text-sm">
              <span className="tabular w-14 shrink-0 text-right text-ink-faint">
                {Math.round(s.seconds / 60)} min
              </span>
              <span className="font-medium text-ink">{s.slot.name}</span>
              <span className="min-w-0 flex-1 truncate text-ink-faint">{s.slot.note}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={begin}
          className="tap mt-5 w-full rounded-xl bg-accent py-5 text-lg font-bold text-accent-ink"
        >
          Begin — {drillCount} drills
        </button>
      </section>

      <section className="mt-6">
        <Link href="/play/free" className="panel block p-5 active:bg-raised">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold text-ink">Free Play</span>
            <span className="text-xs text-ink-faint">nothing scored</span>
          </div>
          <p className="mt-1 text-sm text-ink-dim">
            Just play. Chords and keys are named live as you go.
          </p>
          <p className="mt-2 border-t border-hairline pt-2 text-xs leading-snug text-ink-faint">
            Unstructured playing is where musical intuition forms, so this is
            deliberately ungraded — but it still counts toward your day and your
            streak.
          </p>
        </Link>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Or pick a drill
        </h2>
        <p className="mb-4 text-sm text-ink-faint">
          Free practice counts toward your day and your streak exactly the same.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const state = ladderStateFor(app, m.id);
            const ladder = LADDERS[m.id];
            const rung = currentRung(state, ladder);
            return (
              <Link key={m.id} href={`/play/${m.id}`} className="panel block p-4 active:bg-raised">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{m.name}</span>
                  <span className="tabular shrink-0 text-xs text-ink-faint">
                    rung {state.rungIndex + 1}/{ladder.rungs.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-ink-dim">{m.tagline}</div>
                <div className="mt-2 text-xs text-accent">{rung.name}</div>
                <p className="mt-2 border-t border-hairline pt-2 text-xs leading-snug text-ink-faint">
                  {m.why}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
      <div className="h-8" />
    </div>
  );
}
