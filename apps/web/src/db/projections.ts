/**
 * Projections over the event log.
 *
 * Mastery, streaks, XP, ladder positions and the due queue are all *derived*.
 * Nothing here is authoritative — delete every projection and it rebuilds from
 * the log identically, which is the property the tests check.
 *
 * Catching up reads only events after the stored cursor, so startup costs time
 * proportional to what changed rather than to the size of history. The cursor
 * is written in the same transaction as the state it describes, so it can never
 * run ahead of the data.
 */

import {
  type EtudeEvent, type MasteryState, type ModeId, type MotorState,
  type DeclarativeCard, type LadderState, type StreakState, type SkillKind,
  LADDERS, SKILLS, applyEvidence, currentMastery, dueAt as masteryDueAt,
  initialLadderState, initialMastery, initialStreak, localDay, newDeclarativeCard,
  newMotorState, recordQualifyingDay, reviewDeclarative, reviewMotor,
  DAILY_MINIMUM_MINUTES, skill,
} from '@etude/core';
import { db, type SkillRow } from './schema';
import { eventsAfter } from './log';

/**
 * Bump whenever fold logic changes. A mismatch discards the derived tables and
 * replays from genesis — safe precisely because they are derived.
 */
export const PROJECTION_VERSION = 1;

const CURSOR_KEY = 'projection:cursor';
const STATE_KEY = 'projection:state';

export interface AppState {
  readonly version: number;
  readonly totalXp: number;
  readonly ladders: Partial<Record<ModeId, LadderState>>;
  readonly sessionsCompleted: number;
  readonly lastPracticedAt: string | null;
  /** Practice seconds per local calendar day. Drives the streak. */
  readonly secondsByDay: Record<string, number>;
  readonly attemptsTotal: number;
  readonly correctTotal: number;
}

export const emptyAppState: AppState = {
  version: PROJECTION_VERSION,
  totalXp: 0,
  ladders: {},
  sessionsCompleted: 0,
  lastPracticedAt: null,
  secondsByDay: {},
  attemptsTotal: 0,
  correctTotal: 0,
};

interface SkillAccumulator {
  mastery: MasteryState;
  declarative?: DeclarativeCard;
  motor?: MotorState;
}

function skillKind(skillId: string): SkillKind {
  try {
    return skill(skillId).kind;
  } catch {
    // An event referencing a skill this build no longer defines must not break
    // the fold; treat it as declarative and move on.
    return 'declarative';
  }
}

function loadAccumulator(row: SkillRow | undefined, skillId: string): SkillAccumulator {
  const kind = skillKind(skillId);
  if (!row) return { mastery: initialMastery(skillId, kind) };
  return {
    mastery: (row.mastery as MasteryState) ?? initialMastery(skillId, kind),
    declarative: row.declarative as DeclarativeCard | undefined,
    motor: row.motor as MotorState | undefined,
  };
}

/**
 * Fold a batch of events into state.
 *
 * Pure apart from the accumulators it is handed, so the equivalence test can
 * run it over the whole log and compare against the incremental path.
 */
export function foldEvents(
  state: AppState,
  skills: Map<string, SkillAccumulator>,
  events: readonly EtudeEvent[],
): AppState {
  let next: AppState = { ...state, ladders: { ...state.ladders }, secondsByDay: { ...state.secondsByDay } };

  for (const event of events) {
    const at = new Date(event.at);
    const day = localDay(at);

    switch (event.type) {
      case 'Session.Ended': {
        next = {
          ...next,
          sessionsCompleted: next.sessionsCompleted + 1,
          secondsByDay: {
            ...next.secondsByDay,
            [day]: (next.secondsByDay[day] ?? 0) + event.payload.elapsedSeconds,
          },
        };
        break;
      }

      case 'Activity.Attempted': {
        // Drills played outside a planned session still count toward the day.
        // The overhead approximates reading and thinking time, which response
        // latency alone would miss.
        if (!event.payload.sessionId) {
          const seconds = event.payload.responseMs / 1000 + 4;
          next = {
            ...next,
            secondsByDay: {
              ...next.secondsByDay,
              [day]: (next.secondsByDay[day] ?? 0) + seconds,
            },
          };
        }
        next = { ...next, attemptsTotal: next.attemptsTotal + 1, lastPracticedAt: event.at };
        break;
      }

      case 'Activity.Graded': {
        const p = event.payload;
        next = {
          ...next,
          totalXp: next.totalXp + p.xpAwarded,
          correctTotal: next.correctTotal + (p.correctness >= 0.99 ? 1 : 0),
        };

        for (const evidence of p.skillEvidence) {
          const acc = skills.get(evidence.skillId)
            ?? { mastery: initialMastery(evidence.skillId, skillKind(evidence.skillId)) };

          acc.mastery = applyEvidence(acc.mastery, evidence.correctness, evidence.weight, at);

          if (acc.mastery.kind === 'declarative') {
            const card = acc.declarative ?? newDeclarativeCard(evidence.skillId);
            acc.declarative = reviewDeclarative(card, evidence.correctness, p.latencyMs, at);
          } else {
            const motor = acc.motor ?? newMotorState(evidence.skillId, 120);
            acc.motor = reviewMotor(motor, evidence.correctness, motor.achievedTempo, at);
          }
          skills.set(evidence.skillId, acc);
        }
        break;
      }

      case 'Ladder.Moved': {
        const modeId = event.payload.modeId as ModeId;
        const ladder = LADDERS[modeId];
        if (!ladder) break;
        const current = next.ladders[modeId] ?? initialLadderState(modeId);
        const toIndex = ladder.rungs.findIndex((r) => r.id === event.payload.toRungId);
        if (toIndex < 0) break;
        next = {
          ...next,
          ladders: {
            ...next.ladders,
            [modeId]: {
              ...current,
              rungIndex: toIndex,
              recent: [],
              promotions: current.promotions + (event.payload.direction === 'promote' ? 1 : 0),
              demotions: current.demotions + (event.payload.direction === 'demote' ? 1 : 0),
              highWater: Math.max(current.highWater, toIndex),
            },
          },
        };
        break;
      }

      default:
        break;
    }
  }

  return next;
}

/**
 * The streak, recomputed from the day ledger rather than stored incrementally.
 *
 * Freezes are order-dependent, so replaying the whole day list is both simpler
 * and impossible to drift. A few hundred entries a year costs nothing.
 */
export function streakFrom(secondsByDay: Readonly<Record<string, number>>): StreakState {
  const qualifying = Object.entries(secondsByDay)
    .filter(([, seconds]) => seconds >= DAILY_MINIMUM_MINUTES * 60)
    .map(([day]) => day)
    .sort();

  let state = initialStreak;
  for (const day of qualifying) state = recordQualifyingDay(state, day).state;
  return state;
}

async function readCursor(): Promise<{ id: string | null; version: number }> {
  const row = await db().meta.get(CURSOR_KEY);
  const value = row?.value as { id?: string | null; version?: number } | undefined;
  return { id: value?.id ?? null, version: value?.version ?? 0 };
}

async function readState(): Promise<AppState> {
  const row = await db().meta.get(STATE_KEY);
  return (row?.value as AppState | undefined) ?? emptyAppState;
}

/**
 * Bring projections up to date with the log.
 *
 * Events, derived state and cursor move together in one transaction. Without
 * that, a crash between writes would leave the cursor claiming work that never
 * landed, and the corruption would be silent.
 */
export async function catchUp(): Promise<AppState> {
  const database = db();
  const cursor = await readCursor();

  const stale = cursor.version !== PROJECTION_VERSION;
  const from = stale ? null : cursor.id;
  let base = stale ? emptyAppState : await readState();

  const events = await eventsAfter(from);
  if (events.length === 0 && !stale) return base;

  const skills = new Map<string, SkillAccumulator>();
  const touched = new Set<string>();
  for (const e of events) {
    if (e.type === 'Activity.Graded') {
      for (const ev of e.payload.skillEvidence) touched.add(ev.skillId);
    }
  }

  if (stale) {
    await database.skills.clear();
  } else {
    for (const id of touched) {
      skills.set(id, loadAccumulator(await database.skills.get(id), id));
    }
  }

  base = foldEvents(base, skills, events);

  const lastId = events.length > 0 ? events[events.length - 1]?.id ?? from : from;

  await database.transaction('rw', database.skills, database.meta, async () => {
    const rows: SkillRow[] = [];
    for (const [skillId, acc] of skills) {
      const due = acc.mastery.kind === 'declarative'
        ? acc.declarative?.card.due ?? null
        : acc.motor ? masteryDueAt(acc.mastery) : null;
      rows.push({
        skillId,
        mastery: acc.mastery,
        declarative: acc.declarative,
        motor: acc.motor,
        dueAt: due ? new Date(due).toISOString() : null,
      });
    }
    if (rows.length > 0) await database.skills.bulkPut(rows);
    await database.meta.put({ key: STATE_KEY, value: base });
    await database.meta.put({
      key: CURSOR_KEY,
      value: { id: lastId, version: PROJECTION_VERSION },
    });
  });

  return base;
}

export async function getAppState(): Promise<AppState> {
  return catchUp();
}

export async function getSkillRows(): Promise<SkillRow[]> {
  return db().skills.toArray();
}

/** Current decayed mastery for every skill that has any history. */
export async function getMasteryMap(now = new Date()): Promise<Map<string, number>> {
  const rows = await getSkillRows();
  const out = new Map<string, number>();
  for (const row of rows) {
    const m = row.mastery as MasteryState | undefined;
    if (m) out.set(row.skillId, currentMastery(m, now));
  }
  return out;
}

/** Drop every derived table. The log is untouched, so this is always safe. */
export async function resetProjections(): Promise<void> {
  const database = db();
  await database.transaction('rw', database.skills, database.meta, async () => {
    await database.skills.clear();
    await database.meta.delete(CURSOR_KEY);
    await database.meta.delete(STATE_KEY);
  });
}

export type { SkillAccumulator };
