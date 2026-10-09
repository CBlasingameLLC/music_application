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
import { initialLadderState, WINDOW, type LadderState } from '../progression/ladder';
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

  // Rebuilding the ladder's rolling window needs all three activity events:
  // `Presented` carries the mode, `Attempted` carries the id the grade is keyed
  // on, and `Graded` carries the correctness. They are written in one
  // transaction and the projection cursor advances in that same transaction, so
  // a batch never splits across two fold calls and these never need to outlive
  // one. If that ever stops holding, an unattributable grade is dropped from
  // the window — which delays a promotion, where guessing a mode would corrupt
  // one.
  const modeOfActivity = new Map<string, string>();
  const activityOfAttempt = new Map<string, string>();

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

      case 'Activity.Presented': {
        modeOfActivity.set(event.payload.activityId, event.payload.modeId);
        break;
      }

      case 'Activity.Attempted': {
        activityOfAttempt.set(event.payload.attemptId, event.payload.activityId);
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

        // The ladder's promotion window, derived rather than stored. Nothing
        // writes `recent` to the log, because the evidence *is* the run of
        // grades — and deriving it means an existing log rebuilds a correct
        // window rather than starting empty.
        const gradedMode = activityOfAttempt.has(p.attemptId)
          ? modeOfActivity.get(activityOfAttempt.get(p.attemptId)!) as ModeId | undefined
          : undefined;
        if (gradedMode && LADDERS[gradedMode]) {
          const ladderState = next.ladders[gradedMode] ?? initialLadderState(gradedMode);
          next.ladders[gradedMode] = {
            ...ladderState,
            recent: [...ladderState.recent, Math.max(0, Math.min(1, p.correctness))]
              .slice(-WINDOW),
          };
        }

        for (const evidence of p.skillEvidence) {
          const acc = skills.get(evidence.skillId)
            ?? { mastery: initialMastery(evidence.skillId, skillKind(evidence.skillId)) };

          acc.mastery = applyEvidence(acc.mastery, evidence.correctness, evidence.weight, at);

          if (acc.mastery.kind === 'declarative') {
            const card = acc.declarative ?? newDeclarativeCard(evidence.skillId);
            acc.declarative = reviewDeclarative(card, evidence.correctness, p.latencyMs, at);
          } else {
            const motor = acc.motor ?? newMotorState(evidence.skillId, 120);
            // The tempo actually played, which only a mode that measures one
            // reports. Passing `motor.achievedTempo` here — as this did — makes
            // `reviewMotor`'s success branch `Math.max(a, a)`, so the ladder
            // could only ever fall and every motor skill sat at the 60 BPM
            // default forever. "Clean at 96 BPM" is the unit of motor progress;
            // it has to come from the take.
            const measured = p.diagnostics.tempoBpm;
            const tempoKnown = typeof measured === 'number'
              && Number.isFinite(measured) && measured > 0;
            const reviewed = reviewMotor(
              motor,
              evidence.correctness,
              tempoKnown ? measured : motor.achievedTempo,
              at,
            );
            // Without a measured tempo the attempt is no evidence about tempo
            // at all, so the review still moves the interval and the practice
            // date while `achievedTempo` stays exactly where it was. An honest
            // gap beats climbing or dropping a number nobody measured.
            acc.motor = tempoKnown
              ? reviewed
              : { ...reviewed, achievedTempo: motor.achievedTempo };
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
