'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type Drill, type Grade, type ModeId, type Response, type ScaffoldId,
  LADDERS, currentRung, generateDrill, modeMeta, randomSeed,
  recordAttempt as ulid,
} from '@etude/core';
import { useEtudeState, useRecordAttempt, ladderStateFor, recordSession } from '@/db/store';
import { DrillPlayer } from './DrillPlayer';

export interface RunnerStep {
  readonly modeId: ModeId;
  readonly count: number;
}

/**
 * Runs a queue of drills.
 *
 * Both free practice (one mode, open-ended) and a guided session (a queue of
 * modes with counts) go through here, so the recording, ladder and XP paths are
 * identical either way. Practice done off-plan has to count exactly as much as
 * practice done on it, or the numbers stop meaning anything.
 */
export function DrillRunner({
  steps,
  sessionId,
  title,
  onFinished,
}: {
  steps: readonly RunnerStep[];
  sessionId: string | null;
  title: string;
  onFinished?: (summary: RunSummary) => void;
}) {
  const router = useRouter();
  const { app } = useEtudeState();
  const record = useRecordAttempt();

  const [stepIndex, setStepIndex] = useState(0);
  const [doneInStep, setDoneInStep] = useState(0);
  // Seeded on the client only. Choosing a random seed during SSR would render a
  // different drill on the server than on the client and fail hydration.
  const [seed, setSeed] = useState<number | null>(null);
  useEffect(() => setSeed(randomSeed()), []);
  const [previous, setPrevious] = useState<Drill | undefined>(undefined);
  const [summary, setSummary] = useState<RunSummary>({
    attempted: 0, correct: 0, xp: 0, promotions: 0, startedAt: 0,
  });
  useEffect(() => setSummary((s) => (s.startedAt ? s : { ...s, startedAt: Date.now() })), []);
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState<{ xp: number; move: string } | null>(null);

  const step = steps[stepIndex];
  const ladderState = step ? ladderStateFor(app, step.modeId) : null;

  const drill = useMemo(() => {
    if (!step || !ladderState || seed === null) return null;
    return generateDrill({
      modeId: step.modeId,
      rungIndex: ladderState.rungIndex,
      seed,
      previous,
    });
    // `previous` deliberately excluded: it only seeds voice-leading constraints
    // and including it would regenerate the drill mid-answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.modeId, ladderState?.rungIndex, seed]);

  const finish = useCallback(async () => {
    setFinished(true);
    const elapsed = Math.round((Date.now() - summary.startedAt) / 1000);
    if (sessionId) await recordSession(sessionId, elapsed, summary.attempted);
    onFinished?.(summary);
  }, [sessionId, summary, onFinished]);

  const advance = useCallback(() => {
    setPrevious(drill ?? undefined);
    const nextDone = doneInStep + 1;
    if (step && nextDone >= step.count) {
      if (stepIndex + 1 >= steps.length) {
        void finish();
        return;
      }
      setStepIndex((i) => i + 1);
      setDoneInStep(0);
    } else {
      setDoneInStep(nextDone);
    }
    setSeed(randomSeed());
    setFlash(null);
  }, [drill, doneInStep, step, stepIndex, steps.length, finish]);

  const handleAnswered = useCallback(
    async (
      _response: Response,
      grade: Grade,
      responseMs: number,
      scaffolds: readonly ScaffoldId[],
    ) => {
      if (!drill || !ladderState) return;
      const outcome = await record(drill, _response, grade, {
        responseMs,
        sessionId,
        scaffolds,
        ladder: ladderState,
        firstTry: true,
      });
      setSummary((s) => ({
        ...s,
        attempted: s.attempted + 1,
        correct: s.correct + (grade.correct ? 1 : 0),
        xp: s.xp + outcome.xp,
        promotions: s.promotions + (outcome.ladderMove === 'promote' ? 1 : 0),
      }));
      setFlash({ xp: outcome.xp, move: outcome.ladderMove });
    },
    [drill, ladderState, record, sessionId],
  );

  if (finished) {
    return <RunComplete summary={summary} title={title} onDone={() => router.push('/')} />;
  }
  if (!drill || !step || !ladderState) {
    return <div className="p-8 text-ink-faint">Preparing…</div>;
  }

  const ladder = LADDERS[step.modeId];
  const rung = currentRung(ladderState, ladder);
  const totalDrills = steps.reduce((a, s) => a + s.count, 0);
  const completed = steps.slice(0, stepIndex).reduce((a, s) => a + s.count, 0) + doneInStep;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <button
          type="button"
          onClick={() => router.push('/practice')}
          aria-label="Leave practice"
          className="tap rounded-lg bg-raised px-3 text-ink-dim"
        >
          ✕
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{modeMeta(step.modeId).name}</div>
          <div className="truncate text-xs text-ink-faint">
            {rung.name} · rung {ladderState.rungIndex + 1} of {ladder.rungs.length}
          </div>
        </div>
        <div className="tabular text-right text-sm text-ink-faint">
          {completed + 1} / {totalDrills}
        </div>
        {flash && flash.xp > 0 && (
          <div className="tabular rounded-lg bg-accent/15 px-3 py-1 text-sm font-bold text-accent">
            +{flash.xp}
          </div>
        )}
      </header>

      <div className="h-1 bg-raised">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${(completed / Math.max(1, totalDrills)) * 100}%` }}
        />
      </div>

      {flash?.move === 'promote' && (
        <div className="bg-good/15 px-4 py-2 text-center text-sm font-semibold text-good">
          Promoted — next rung unlocked
        </div>
      )}
      {flash?.move === 'demote' && (
        <div className="bg-warn/15 px-4 py-2 text-center text-sm text-warn">
          Dropped back a rung. Nothing lost — this is the level that will teach you most.
        </div>
      )}

      <DrillPlayer
        key={drill.id}
        drill={drill}
        onAnswered={(r, g, ms, sc) => void handleAnswered(r, g, ms, sc)}
        onNext={advance}
      />
    </div>
  );
}

export interface RunSummary {
  attempted: number;
  correct: number;
  xp: number;
  promotions: number;
  startedAt: number;
}

function RunComplete({
  summary, title, onDone,
}: { summary: RunSummary; title: string; onDone: () => void }) {
  const minutes = Math.max(1, Math.round((Date.now() - summary.startedAt) / 60000));
  const accuracy = summary.attempted > 0
    ? Math.round((summary.correct / summary.attempted) * 100)
    : 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6">
      <h1 className="text-3xl font-bold">{title} complete</h1>
      <p className="mt-2 text-ink-faint">
        {summary.promotions > 0
          ? `You moved up ${summary.promotions} rung${summary.promotions > 1 ? 's' : ''}.`
          : 'Steady work. The numbers below are what moved.'}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3">
        <Cell label="Drills" value={String(summary.attempted)} />
        <Cell label="Accuracy" value={`${accuracy}%`} />
        <Cell label="XP earned" value={String(summary.xp)} />
        <Cell label="Time" value={`${minutes} min`} />
      </dl>

      <button
        type="button"
        onClick={onDone}
        className="tap mt-8 w-full rounded-2xl bg-accent py-5 text-lg font-bold text-accent-ink"
      >
        Done
      </button>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <dt className="text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="tabular mt-1 text-3xl font-bold text-ink">{value}</dd>
    </div>
  );
}
