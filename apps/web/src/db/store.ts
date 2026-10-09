'use client';

/**
 * React bindings over the log and its projections.
 *
 * Components never read the event log directly. They read projections, which
 * are recomputed whenever the log grows — so a single `recordAttempt` call
 * updates the streak, the XP total, the ladder and the map without any of them
 * knowing about each other.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import {
  type Drill, type Grade, type LadderState, type ModeId, type PerformedTake,
  type Response, type ScaffoldId, type StreakState, type MasteryState,
  GRADER_VERSION, LADDERS, computeXp, currentMastery, evidenceFor,
  initialLadderState, initialStreak, localDay, recordAttempt as ladderRecord, ulid,
} from '@etude/core';
import { saveTake } from '@/lib/takes/store';
import { db, hasIndexedDb } from './schema';
import { append, appendMany, deviceId } from './log';
import {
  type AppState, catchUp, emptyAppState, streakFrom,
} from './projections';

export interface EtudeState {
  readonly app: AppState;
  readonly streak: StreakState;
  readonly secondsToday: number;
  readonly ready: boolean;
}

/**
 * The whole derived view of the user's history.
 *
 * Keyed off the event count so any append anywhere re-derives everything. The
 * fold is incremental, so this is cheap even with a long history.
 */
export function useEtudeState(): EtudeState {
  const eventCount = useLiveQuery(
    async () => (hasIndexedDb() ? db().events.count() : 0),
    [],
    -1,
  );
  const [app, setApp] = useState<AppState>(emptyAppState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (eventCount < 0 || !hasIndexedDb()) return;
    let cancelled = false;
    void catchUp().then((next) => {
      if (!cancelled) {
        setApp(next);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [eventCount]);

  return {
    app,
    streak: ready ? streakFrom(app.secondsByDay) : initialStreak,
    secondsToday: app.secondsByDay[localDay()] ?? 0,
    ready,
  };
}

/** Live decayed mastery for every skill with history. */
export function useMastery(): Map<string, number> {
  const rows = useLiveQuery(
    async () => (hasIndexedDb() ? db().skills.toArray() : []),
    [],
    [],
  );
  const now = new Date();
  const out = new Map<string, number>();
  for (const row of rows) {
    const m = row.mastery as MasteryState | undefined;
    if (m) out.set(row.skillId, currentMastery(m, now));
  }
  return out;
}

export function ladderStateFor(app: AppState, modeId: ModeId): LadderState {
  return app.ladders[modeId] ?? initialLadderState(modeId);
}

export interface AttemptOutcome {
  readonly grade: Grade;
  readonly xp: number;
  readonly ladderMove: 'promote' | 'demote' | 'hold';
  readonly newRungIndex: number;
}

/**
 * Record one attempt.
 *
 * Writes three facts — presented, attempted, graded — plus a ladder move when
 * one is earned. Grading is its own event so that re-grading with a better
 * algorithm later appends rather than rewrites, which is the property that
 * makes stored takes worth keeping.
 */
export function useRecordAttempt(): (
  drill: Drill,
  response: Response,
  grade: Grade,
  opts: {
    responseMs: number;
    sessionId: string | null;
    scaffolds: readonly ScaffoldId[];
    ladder: LadderState;
    firstTry?: boolean;
    /** The raw performance, for modes that record one. Kept so it can be re-graded. */
    take?: PerformedTake | null;
    /** The tempo the take was aimed at, which the take itself does not carry. */
    tempoTarget?: number | null;
    /** Output latency at capture. Without it every timing metric is biased late. */
    audioOffsetMs?: number;
  },
) => Promise<AttemptOutcome> {
  return useCallback(async (drill, response, grade, opts) => {
    const attemptId = ulid();
    const xp = computeXp({
      base: drill.baseXp,
      accuracy: grade.correctness,
      scaffolds: opts.scaffolds,
      rungIndex: drill.rungIndex,
      firstTry: opts.firstTry ?? false,
    });

    const ladder = LADDERS[drill.modeId];
    const result = ladderRecord(opts.ladder, ladder, grade.correctness);

    await appendMany([
      {
        type: 'Activity.Presented',
        payload: {
          sessionId: opts.sessionId,
          activityId: drill.id,
          modeId: drill.modeId,
          rungId: drill.rungId,
          skillIds: [...drill.skillIds],
          seed: drill.seed,
        },
      },
      {
        type: 'Activity.Attempted',
        payload: {
          attemptId,
          activityId: drill.id,
          sessionId: opts.sessionId,
          responseMs: opts.responseMs,
          response,
          scaffolds: [...opts.scaffolds],
        },
      },
      {
        type: 'Activity.Graded',
        payload: {
          attemptId,
          correctness: grade.correctness,
          latencyMs: opts.responseMs,
          diagnostics: grade.diagnostics,
          skillEvidence: evidenceFor(drill, grade),
          xpAwarded: xp.total,
          graderVersion: GRADER_VERSION,
        },
      },
    ]);

    // The raw take, stored so a better grader can re-analyse it later. Written
    // after the attempt rather than before: a blob that will not save must not
    // cost the user the practice that produced it.
    if (opts.take) {
      const takeId = ulid();
      const ref = await saveTake(takeId, opts.take);
      if (ref) {
        await append('Take.Recorded', {
          takeId,
          activityId: drill.id,
          midiBlobRef: ref,
          tempoTarget: opts.tempoTarget ?? null,
          deviceProfileId: deviceId(),
          audioOffsetMs: opts.audioOffsetMs ?? 0,
        });
      }
    }

    if (result.move !== 'hold') {
      const from = ladder.rungs[opts.ladder.rungIndex];
      const to = ladder.rungs[result.state.rungIndex];
      if (from && to) {
        await append('Ladder.Moved', {
          modeId: drill.modeId,
          fromRungId: from.id,
          toRungId: to.id,
          direction: result.move,
        });
      }
    }

    return {
      grade,
      xp: xp.total,
      ladderMove: result.move,
      newRungIndex: result.state.rungIndex,
    };
  }, []);
}

/** Log a completed session so it counts toward the day and the streak. */
export async function recordSession(
  sessionId: string,
  elapsedSeconds: number,
  completedActivities: number,
): Promise<void> {
  await append('Session.Ended', { sessionId, elapsedSeconds, completedActivities });
}
