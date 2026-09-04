/**
 * XP.
 *
 * XP is a function of *quality*, never of time spent. Sitting at the keyboard
 * for an hour playing the same easy thing badly should not out-score ten
 * focused minutes at the edge of your ability, because that is not how
 * practice works and rewarding it would train the wrong behaviour.
 *
 * Scaffolds are priced rather than banned. The keyboard-diagram hint stays
 * available, but leaning on it visibly costs XP, so the choice is yours and
 * the cost is legible.
 */

export type ScaffoldId =
  | 'keyboard-highlight'
  | 'letter-names'
  | 'fingering'
  | 'slow-tempo'
  | 'audio-preview'
  | 'extended-time';

/**
 * Multiplier applied per scaffold in use. Fingering numbers barely count as a
 * crutch — real editions print them and teachers insist on them — while
 * letter-names-in-noteheads directly substitutes for the reading skill being
 * trained, so it costs the most.
 */
export const SCAFFOLD_MULTIPLIERS: Record<ScaffoldId, number> = {
  'keyboard-highlight': 0.55,
  'letter-names': 0.45,
  fingering: 0.95,
  'slow-tempo': 0.8,
  'audio-preview': 0.7,
  'extended-time': 0.85,
};

export const SCAFFOLD_LABELS: Record<ScaffoldId, string> = {
  'keyboard-highlight': 'Keyboard hint',
  'letter-names': 'Letter names',
  fingering: 'Fingering',
  'slow-tempo': 'Reduced tempo',
  'audio-preview': 'Hear it first',
  'extended-time': 'Extra time',
};

export interface XpInput {
  /** Base value for the activity, before any modifiers. */
  readonly base: number;
  /** 0-1. */
  readonly accuracy: number;
  /** Achieved tempo over target tempo, capped at 1. Non-tempo drills pass 1. */
  readonly tempoRatio?: number;
  readonly scaffolds?: readonly ScaffoldId[];
  /** Ladder rung index; higher rungs are worth more. */
  readonly rungIndex?: number;
  /** First clean attempt in a session earns a bonus. */
  readonly firstTry?: boolean;
}

export interface XpBreakdown {
  readonly total: number;
  readonly base: number;
  readonly accuracyFactor: number;
  readonly tempoFactor: number;
  readonly scaffoldFactor: number;
  readonly difficultyFactor: number;
  readonly firstTryBonus: number;
  readonly scaffoldsUsed: readonly ScaffoldId[];
}

/** Below this accuracy an attempt earns nothing; guessing should not pay. */
const XP_ACCURACY_FLOOR = 0.5;

export function computeXp(input: XpInput): XpBreakdown {
  const scaffolds = input.scaffolds ?? [];
  const accuracy = Math.max(0, Math.min(1, input.accuracy));

  // Below the floor, scale to zero rather than clifing, so a near-miss still
  // reads as "almost" instead of as total failure.
  const accuracyFactor =
    accuracy < XP_ACCURACY_FLOOR ? (accuracy / XP_ACCURACY_FLOOR) * 0.25 : accuracy;

  const tempoFactor = Math.max(0, Math.min(1, input.tempoRatio ?? 1));
  const scaffoldFactor = scaffolds.reduce(
    (acc, id) => acc * (SCAFFOLD_MULTIPLIERS[id] ?? 1),
    1,
  );
  const difficultyFactor = 1 + (input.rungIndex ?? 0) * 0.15;
  const firstTryBonus = input.firstTry && accuracy >= 0.95 ? 0.2 : 0;

  const total = Math.round(
    input.base *
      accuracyFactor *
      tempoFactor *
      scaffoldFactor *
      difficultyFactor *
      (1 + firstTryBonus),
  );

  return {
    total: Math.max(0, total),
    base: input.base,
    accuracyFactor,
    tempoFactor,
    scaffoldFactor,
    difficultyFactor,
    firstTryBonus,
    scaffoldsUsed: scaffolds,
  };
}

/**
 * Level curve. Growth is superlinear so early levels arrive quickly and later
 * ones mean something, without ever becoming a grind wall.
 */
export function levelForXp(totalXp: number): { level: number; into: number; span: number } {
  let level = 1;
  let remaining = totalXp;
  let span = 100;
  while (remaining >= span) {
    remaining -= span;
    level += 1;
    span = Math.round(span * 1.18);
  }
  return { level, into: remaining, span };
}

export function xpForLevel(level: number): number {
  let total = 0;
  let span = 100;
  for (let i = 1; i < level; i++) {
    total += span;
    span = Math.round(span * 1.18);
  }
  return total;
}
