/**
 * Two schedulers behind one queue.
 *
 * FSRS models declarative memory: near-binary recall against a retrievability
 * curve. That fits note names, intervals, chord qualities and key signatures
 * exactly, so those go through `ts-fsrs` unmodified.
 *
 * It fits motor skills badly, and forcing them through it would be the kind of
 * mistake that looks principled and produces nonsense. Motor memory decays far
 * more slowly, consolidates with sleep rather than with review, and has a
 * continuous outcome — accuracy at a tempo — rather than a recall event.
 * Motor learning also wants *massed* practice during acquisition, which is the
 * opposite of "review just before you forget".
 *
 * So motor skills get a tempo-ladder scheduler with a flat decay timer, and a
 * failure drops one tempo rung instead of resetting stability.
 */

import {
  type Card, type Grade, Rating, createEmptyCard, fsrs, generatorParameters,
} from 'ts-fsrs';
import type { SkillKind } from '../skills/taxonomy.js';
import { type MasteryState, currentMastery } from './mastery.js';

const engine = fsrs(
  generatorParameters({
    // Aim to review at ~90% recall. Slightly higher than the default, because
    // theory facts are cheap to review and expensive to have wrong mid-piece.
    request_retention: 0.9,
    enable_fuzz: true,
  }),
);

export interface DueItem {
  readonly skillId: string;
  readonly kind: SkillKind;
  readonly dueAt: Date;
  /** Higher sorts first. */
  readonly priority: number;
  readonly reason: 'overdue' | 'new' | 'below-target-tempo' | 'lapsed';
}

// ---------------------------------------------------------------------------
// Declarative track — FSRS
// ---------------------------------------------------------------------------

export interface DeclarativeCard {
  readonly skillId: string;
  readonly card: Card;
}

export function newDeclarativeCard(skillId: string): DeclarativeCard {
  return { skillId, card: createEmptyCard() };
}

/**
 * Map a continuous correctness score onto an FSRS grade.
 *
 * FSRS wants a four-point self-report; the app has an objective accuracy plus a
 * response time. Deriving the grade rather than asking for it removes a
 * self-assessment step that learners are famously bad at.
 */
export function gradeFromPerformance(correctness: number, responseMs: number): Grade {
  if (correctness < 0.6) return Rating.Again;
  if (correctness < 0.85) return Rating.Hard;
  // A correct-but-slow answer is not yet fluent, and fluency is the goal.
  if (responseMs > 6000) return Rating.Hard;
  if (correctness >= 0.99 && responseMs < 2500) return Rating.Easy;
  return Rating.Good;
}

export function reviewDeclarative(
  entry: DeclarativeCard,
  correctness: number,
  responseMs: number,
  now: Date = new Date(),
): DeclarativeCard {
  const grade = gradeFromPerformance(correctness, responseMs);
  const { card } = engine.next(entry.card, now, grade);
  return { skillId: entry.skillId, card };
}

/** Current probability of recall, 0-1. Used to sort the queue and to explain it. */
export function retrievability(entry: DeclarativeCard, now: Date = new Date()): number {
  return engine.get_retrievability(entry.card, now, false);
}

// ---------------------------------------------------------------------------
// Motor track — tempo ladder with a flat decay timer
// ---------------------------------------------------------------------------

/** Review gaps in days. Far flatter than a forgetting curve, by design. */
export const MOTOR_INTERVALS = [1, 3, 7, 21, 60] as const;

export interface MotorState {
  readonly skillId: string;
  /** Index into MOTOR_INTERVALS. */
  readonly intervalIndex: number;
  /** Highest tempo (BPM) held at criterion accuracy. 0 for untested. */
  readonly achievedTempo: number;
  readonly targetTempo: number;
  readonly lastPracticedAt: string | null;
}

/** BPM steps in the tempo ladder. Failure drops one rung; success climbs one. */
export const TEMPO_STEP = 8;

export function newMotorState(
  skillId: string,
  targetTempo: number,
  startTempo = 60,
): MotorState {
  return {
    skillId,
    intervalIndex: 0,
    achievedTempo: startTempo,
    targetTempo,
    lastPracticedAt: null,
  };
}

/** Accuracy at or above this counts as holding the tempo. */
export const TEMPO_CRITERION = 0.95;

export function reviewMotor(
  state: MotorState,
  correctness: number,
  tempoPlayed: number,
  now: Date = new Date(),
): MotorState {
  const held = correctness >= TEMPO_CRITERION;

  if (held) {
    return {
      ...state,
      achievedTempo: Math.max(state.achievedTempo, tempoPlayed),
      intervalIndex: Math.min(MOTOR_INTERVALS.length - 1, state.intervalIndex + 1),
      lastPracticedAt: now.toISOString(),
    };
  }

  // Drop one rung rather than resetting. A missed rep at a stretch tempo means
  // the tempo was too high, not that the skill evaporated.
  return {
    ...state,
    achievedTempo: Math.max(40, state.achievedTempo - TEMPO_STEP),
    intervalIndex: Math.max(0, state.intervalIndex - 1),
    lastPracticedAt: now.toISOString(),
  };
}

export function motorDueAt(state: MotorState): Date | null {
  if (!state.lastPracticedAt) return null;
  const days = MOTOR_INTERVALS[state.intervalIndex] ?? 1;
  return new Date(new Date(state.lastPracticedAt).getTime() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Unified queue
// ---------------------------------------------------------------------------

export interface QueueInput {
  readonly declarative: readonly DeclarativeCard[];
  readonly motor: readonly MotorState[];
  readonly mastery: ReadonlyMap<string, MasteryState>;
}

/**
 * Build the due queue.
 *
 * Never-practised skills lead, then overdue items by how overdue they are.
 * Callers are expected to *interleave* across skills rather than draining one
 * at a time — blocked practice feels more productive and produces less
 * durable learning, which is exactly the trap this app exists to avoid.
 */
export function buildDueQueue(input: QueueInput, now: Date = new Date()): DueItem[] {
  const items: DueItem[] = [];

  for (const entry of input.declarative) {
    const due = entry.card.due;
    const isNew = entry.card.reps === 0;
    const overdueDays = (now.getTime() - new Date(due).getTime()) / 86_400_000;
    if (!isNew && overdueDays < 0) continue;

    items.push({
      skillId: entry.skillId,
      kind: 'declarative',
      dueAt: new Date(due),
      priority: isNew ? 1000 : 100 + overdueDays * 10,
      reason: isNew ? 'new' : entry.card.lapses > 0 ? 'lapsed' : 'overdue',
    });
  }

  for (const m of input.motor) {
    const due = motorDueAt(m);
    if (!due) {
      items.push({
        skillId: m.skillId,
        kind: 'motor',
        dueAt: now,
        priority: 900,
        reason: 'new',
      });
      continue;
    }
    const overdueDays = (now.getTime() - due.getTime()) / 86_400_000;
    const belowTarget = m.achievedTempo < m.targetTempo;
    if (overdueDays < 0 && !belowTarget) continue;

    items.push({
      skillId: m.skillId,
      kind: 'motor',
      dueAt: due,
      priority: (belowTarget ? 200 : 100) + Math.max(0, overdueDays) * 8,
      reason: belowTarget ? 'below-target-tempo' : 'overdue',
    });
  }

  // Weakest skills first among equally-due items.
  return items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ma = input.mastery.get(a.skillId);
    const mb = input.mastery.get(b.skillId);
    return (ma ? currentMastery(ma, now) : 0) - (mb ? currentMastery(mb, now) : 0);
  });
}

export { Rating };
// Re-exported under a qualified name: `Grade` is already the drill-grading
// result type, and two different Grades in one namespace is a trap.
export type { Card, Grade as FsrsGrade };
