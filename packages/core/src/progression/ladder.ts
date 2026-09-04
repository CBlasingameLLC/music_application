/**
 * The difficulty ladder.
 *
 * One engine, shared by every game mode, so a new mode costs a rung table and
 * nothing else. Rungs promote on sustained accuracy and demote on sustained
 * failure — both judged over a rolling window, never on a single attempt,
 * because one bad rep is noise and one lucky rep is not mastery.
 */

export interface Rung {
  readonly id: string;
  readonly name: string;
  /** Mode-specific generator parameters for this rung. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Skills this rung provides evidence for. */
  readonly skillIds: readonly string[];
}

export interface Ladder {
  readonly modeId: string;
  readonly rungs: readonly Rung[];
}

export interface LadderState {
  readonly modeId: string;
  readonly rungIndex: number;
  /** Rolling window of recent correctness values, oldest first. */
  readonly recent: readonly number[];
  readonly promotions: number;
  readonly demotions: number;
  /** Highest rung ever reached, so the map can show real progress. */
  readonly highWater: number;
}

/** Attempts considered when deciding to move. */
export const WINDOW = 8;
/** Mean accuracy over a full window that earns promotion. */
export const PROMOTE_AT = 0.9;
/** Mean accuracy over a full window that forces demotion. */
export const DEMOTE_AT = 0.55;

export function initialLadderState(modeId: string): LadderState {
  return { modeId, rungIndex: 0, recent: [], promotions: 0, demotions: 0, highWater: 0 };
}

export type LadderMove = 'promote' | 'demote' | 'hold';

export interface LadderResult {
  readonly state: LadderState;
  readonly move: LadderMove;
  readonly windowMean: number;
  readonly windowFull: boolean;
}

/**
 * Fold one attempt into the ladder.
 *
 * The window is cleared after any move: judging a new rung using results from
 * the old one would promote on stale evidence and oscillate.
 */
export function recordAttempt(
  state: LadderState,
  ladder: Ladder,
  correctness: number,
): LadderResult {
  const recent = [...state.recent, Math.max(0, Math.min(1, correctness))].slice(-WINDOW);
  const windowFull = recent.length >= WINDOW;
  const windowMean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);

  const atTop = state.rungIndex >= ladder.rungs.length - 1;
  const atBottom = state.rungIndex <= 0;

  let move: LadderMove = 'hold';
  if (windowFull && windowMean >= PROMOTE_AT && !atTop) move = 'promote';
  else if (windowFull && windowMean <= DEMOTE_AT && !atBottom) move = 'demote';

  if (move === 'hold') {
    return { state: { ...state, recent }, move, windowMean, windowFull };
  }

  const rungIndex = state.rungIndex + (move === 'promote' ? 1 : -1);
  return {
    state: {
      ...state,
      rungIndex,
      recent: [],
      promotions: state.promotions + (move === 'promote' ? 1 : 0),
      demotions: state.demotions + (move === 'demote' ? 1 : 0),
      highWater: Math.max(state.highWater, rungIndex),
    },
    move,
    windowMean,
    windowFull,
  };
}

export function currentRung(state: LadderState, ladder: Ladder): Rung {
  const idx = Math.max(0, Math.min(ladder.rungs.length - 1, state.rungIndex));
  const rung = ladder.rungs[idx];
  if (!rung) throw new Error(`ladder ${ladder.modeId} has no rungs`);
  return rung;
}

/** Progress toward the next promotion, 0-1. Drives the rung progress bar. */
export function progressToNextRung(state: LadderState): number {
  if (state.recent.length === 0) return 0;
  const mean = state.recent.reduce((a, b) => a + b, 0) / state.recent.length;
  const windowFill = state.recent.length / WINDOW;
  const accuracyFill = Math.max(0, Math.min(1, mean / PROMOTE_AT));
  return windowFill * accuracyFill;
}
