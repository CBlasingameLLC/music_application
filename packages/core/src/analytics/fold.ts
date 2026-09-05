/**
 * Folding the event log into state.
 *
 * This lives in core, not in the client, because two different things need it
 * and they must never disagree: the live projection that drives the home screen,
 * and the historical replay behind the analytics. A second implementation of
 * "what this event does to state" would drift, and the drift would show up as
 * the dashboard and the home page reporting different numbers for the same
 * thing — which is worse than having no dashboard.
 *
 * Nothing here is authoritative. Delete every projection and it rebuilds from
 * the log identically, which is the property the tests check.
 */

import type { EtudeEvent } from '../events/types';
import type { ModeId } from '../generators/questions';
import { LADDERS } from '../generators/modes';
import { initialLadderState, type LadderState } from '../progression/ladder';
import {
  applyEvidence, initialMastery, type MasteryState,
} from '../progression/mastery';
import {
  newDeclarativeCard, newMotorState, reviewDeclarative, reviewMotor,
  type DeclarativeCard, type MotorState,
} from '../progression/scheduler';
import {
  DAILY_MINIMUM_MINUTES, initialStreak, localDay, recordQualifyingDay, type StreakState,
} from '../progression/streak';

import { skill, type SkillKind } from '../skills/taxonomy';

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

export interface SkillAccumulator {
  mastery: MasteryState;
  declarative?: DeclarativeCard;
  motor?: MotorState;
}

export function skillKind(skillId: string): SkillKind {
  try {
    return skill(skillId).kind;
  } catch {
    // An event referencing a skill this build no longer defines must not break
    // the fold; treat it as declarative and move on.
    return 'declarative';
  }
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
  // Copied once, then mutated in place, then returned. The obvious version
  // spreads `next` per event — and `secondsByDay` grows a key per day, so a
  // year of practice made that 73k events x 365 keys of copying. Measured at
  // 2.4 seconds on a desktop, which is several times worse on the tablet, and
  // it is paid in full every time the projection version bumps and the log
  // replays from genesis. The external contract is unchanged: a new object in,
  // a new object out, the argument never touched.
  const next = {
    ...state,
    ladders: { ...state.ladders },
    secondsByDay: { ...state.secondsByDay },
  };

  for (const event of events) {
    const at = new Date(event.at);
    const day = localDay(at);

    switch (event.type) {
      case 'Session.Ended': {
        next.sessionsCompleted += 1;
        next.secondsByDay[day] =
          (next.secondsByDay[day] ?? 0) + event.payload.elapsedSeconds;
        break;
      }

      case 'Activity.Attempted': {
        // Drills played outside a planned session still count toward the day.
        // The overhead approximates reading and thinking time, which response
        // latency alone would miss.
        if (!event.payload.sessionId) {
          const seconds = event.payload.responseMs / 1000 + 4;
          next.secondsByDay[day] = (next.secondsByDay[day] ?? 0) + seconds;
        }
        next.attemptsTotal += 1;
        next.lastPracticedAt = event.at;
        break;
      }

      case 'Activity.Graded': {
        const p = event.payload;
        next.totalXp += p.xpAwarded;
        if (p.correctness >= 0.99) next.correctTotal += 1;

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
        next.ladders[modeId] = {
          ...current,
          rungIndex: toIndex,
          recent: [],
          promotions: current.promotions + (event.payload.direction === 'promote' ? 1 : 0),
          demotions: current.demotions + (event.payload.direction === 'demote' ? 1 : 0),
          highWater: Math.max(current.highWater, toIndex),
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
