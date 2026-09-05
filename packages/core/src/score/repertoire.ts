/**
 * The catalogue of pieces a Repertoire drill can draw from.
 *
 * Every other mode generates its own material from the theory engine, so it
 * needs nothing from outside. Repertoire cannot: a piece is content, and
 * content lives in `@etude/content`, which depends on core rather than the
 * other way round. So core defines the shape and something upstream fills it —
 * the app at startup with the bundled library plus whatever the user imported,
 * and the tests with fixtures of their own.
 *
 * An empty catalogue is a supported state, not an error. The mode says it has
 * no pieces rather than throwing, which is what a fresh install and a
 * server-side render both look like.
 */

import type { Score } from './model';
import { measureCount } from './section';

export interface RepertoireEntry {
  readonly id: string;
  readonly title: string;
  readonly composer: string | null;
  /**
   * Difficulty tier, 1 upward. Ordered by what the piece demands of the hands,
   * which is the thing the ladder is climbing — not by how it sounds.
   */
  readonly level: number;
  /** One line on what this piece is for, shown when choosing. */
  readonly teaches: string;
  /** The tempo it is written at. The ladder works up toward this, not past it. */
  readonly tempo: number;
  readonly score: Score;
}

let catalogue: readonly RepertoireEntry[] = [];

/** Replace the catalogue. Called once at startup, and by tests with fixtures. */
export function registerRepertoire(entries: readonly RepertoireEntry[]): void {
  catalogue = [...entries].sort(
    (a, b) => a.level - b.level || a.title.localeCompare(b.title),
  );
}

/** Everything available, easiest first. Empty until something registers. */
export function repertoire(): readonly RepertoireEntry[] {
  return catalogue;
}

/**
 * Pieces at or below a difficulty tier.
 *
 * At or *below*, deliberately. A ladder that offered only the current tier
 * would retire a piece the moment it was learned, and playing something you
 * already have is how a piece stays played — the motor scheduler's flat decay
 * timer exists for exactly that.
 */
export function repertoireAt(maxLevel: number): readonly RepertoireEntry[] {
  return catalogue.filter((entry) => entry.level <= maxLevel);
}

export function repertoireEntry(id: string): RepertoireEntry | null {
  return catalogue.find((entry) => entry.id === id) ?? null;
}

/**
 * How long a piece is, in bars.
 *
 * Used to size a practice loop and to decide whether a piece is short enough to
 * play whole at this stage.
 */
export function repertoireLength(entry: RepertoireEntry): number {
  return measureCount(entry.score);
}
