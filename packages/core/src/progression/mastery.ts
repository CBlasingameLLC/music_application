/**
 * Mastery with decay.
 *
 * A skill's mastery is not a high-water mark — it fades. That is not a
 * gamification trick, it is how memory actually works, and modelling it is what
 * lets the review queue say "this is genuinely due" rather than nagging.
 *
 * Two decay regimes, because declarative and motor memory are different systems:
 * facts fade on a classic forgetting curve, while motor patterns decay far more
 * slowly and consolidate with sleep rather than with review.
 */

import type { SkillKind } from '../skills/taxonomy.js';

export interface MasteryState {
  readonly skillId: string;
  readonly kind: SkillKind;
  /** Mastery at the moment of `lastPracticedAt`, before any decay. */
  readonly mastery: number;
  /** Days over which mastery decays by 1/e. Grows with successful reps. */
  readonly stability: number;
  readonly reps: number;
  readonly lapses: number;
  /** ISO-8601, or null if never practiced. */
  readonly lastPracticedAt: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Starting stability in days. Motor patterns stick around far longer. */
const INITIAL_STABILITY: Record<SkillKind, number> = {
  declarative: 1.2,
  motor: 6,
};

/** Multiplier applied to stability on a successful rep. */
const STABILITY_GROWTH: Record<SkillKind, number> = {
  declarative: 1.9,
  motor: 1.5,
};

/** Stability floor after a lapse, in days. */
const MIN_STABILITY: Record<SkillKind, number> = {
  declarative: 0.5,
  motor: 3,
};

const MAX_STABILITY = 400;

/** How fast a single piece of evidence moves the estimate. */
const LEARNING_RATE = 0.55;

/** Correctness at or above this counts as a successful rep. */
export const SUCCESS_THRESHOLD = 0.8;

/** Mastery at or above this is "working knowledge" and unlocks dependents. */
export const UNLOCK_THRESHOLD = 0.5;

export function initialMastery(skillId: string, kind: SkillKind): MasteryState {
  return {
    skillId,
    kind,
    mastery: 0,
    stability: INITIAL_STABILITY[kind],
    reps: 0,
    lapses: 0,
    lastPracticedAt: null,
  };
}

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

/**
 * Mastery right now, after decay. This is the number the UI shows and the
 * scheduler reads — never the stored `mastery` field, which is frozen at the
 * time of the last rep.
 */
export function currentMastery(state: MasteryState, now: Date = new Date()): number {
  if (!state.lastPracticedAt || state.mastery === 0) return state.mastery;
  const elapsed = daysSince(state.lastPracticedAt, now);
  return state.mastery * Math.exp(-elapsed / state.stability);
}

/**
 * Fold one piece of evidence into a skill's mastery.
 *
 * Evidence is applied against the *decayed* value, so a skill you have not
 * touched in a month starts from where it actually is, not where it peaked.
 */
export function applyEvidence(
  state: MasteryState,
  correctness: number,
  weight: number,
  now: Date = new Date(),
): MasteryState {
  const retrieved = currentMastery(state, now);
  const clampedWeight = Math.max(0, Math.min(1, weight));
  const delta = clampedWeight * LEARNING_RATE * (correctness - retrieved);
  const mastery = Math.max(0, Math.min(1, retrieved + delta));

  const succeeded = correctness >= SUCCESS_THRESHOLD;
  const stability = succeeded
    ? Math.min(MAX_STABILITY, state.stability * STABILITY_GROWTH[state.kind])
    : Math.max(MIN_STABILITY[state.kind], state.stability * 0.5);

  return {
    ...state,
    mastery,
    stability,
    reps: state.reps + (succeeded ? 1 : 0),
    lapses: state.lapses + (succeeded ? 0 : 1),
    lastPracticedAt: now.toISOString(),
  };
}

/** When mastery will decay to `target`. The basis of the review queue. */
export function dueAt(
  state: MasteryState,
  target = UNLOCK_THRESHOLD,
): Date | null {
  if (!state.lastPracticedAt || state.mastery <= target) return null;
  const days = state.stability * Math.log(state.mastery / target);
  return new Date(new Date(state.lastPracticedAt).getTime() + days * MS_PER_DAY);
}

/** Coarse label for the UI. Precise numbers are for charts, not for the map. */
export type MasteryBand = 'untouched' | 'learning' | 'working' | 'solid' | 'mastered';

export function masteryBand(value: number): MasteryBand {
  if (value <= 0.01) return 'untouched';
  if (value < UNLOCK_THRESHOLD) return 'learning';
  if (value < 0.72) return 'working';
  if (value < 0.9) return 'solid';
  return 'mastered';
}

export const MASTERY_BAND_LABEL: Record<MasteryBand, string> = {
  untouched: 'Not started',
  learning: 'Learning',
  working: 'Working',
  solid: 'Solid',
  mastered: 'Mastered',
};

/** Aggregate a domain's mastery as the mean over its skills. */
export function domainMastery(
  states: readonly MasteryState[],
  now: Date = new Date(),
): number {
  if (states.length === 0) return 0;
  const total = states.reduce((acc, s) => acc + currentMastery(s, now), 0);
  return total / states.length;
}
