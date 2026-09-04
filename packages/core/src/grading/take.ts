/**
 * What was actually played.
 *
 * The counterpart to `OnsetCluster` on the score side: the grader aligns
 * clusters against clusters, because a chord is a set of notes struck together
 * and matching it note-by-note would score a rolled chord as several timing
 * errors rather than as one chord with spread.
 */

import type { MidiNote } from '../theory/pitch';

export interface PerformedNote {
  readonly midi: MidiNote;
  /** Milliseconds on the performance clock, device offset already applied. */
  readonly onsetMs: number;
  /** Note-off. Needed for articulation: legato is measured in the gaps. */
  readonly offsetMs: number;
  /** 0-1. Meaningless unless the source measured it — see `hasVelocity`. */
  readonly velocity: number;
  readonly channel?: number;
}

export interface PedalEvent {
  readonly timeMs: number;
  /** 0-1; >= 0.5 is conventionally "down". */
  readonly value: number;
}

export interface PerformedTake {
  readonly notes: readonly PerformedNote[];
  readonly pedal: readonly PedalEvent[];
  /** Target tempo for the take, when one was set by a metronome or ladder. */
  readonly tempoTarget: number | null;
  /**
   * False for a touchscreen, which reports a nominal velocity.
   *
   * Every dynamics metric checks this. Scoring dynamic control from a source
   * that cannot measure it would be reporting a number about nothing, which is
   * worse than reporting nothing.
   */
  readonly hasVelocity: boolean;
  readonly deviceProfileId?: string;
}

export interface PerformedCluster {
  /** Earliest onset in the cluster. The cluster's position in time. */
  readonly onsetMs: number;
  readonly notes: readonly PerformedNote[];
  readonly pitches: readonly MidiNote[];
  /** Last onset minus first. The raw material of the chord-spread metric. */
  readonly spreadMs: number;
}

/** Floor on the clustering window: below this, two notes are one gesture. */
export const MIN_CLUSTER_MS = 60;
/**
 * Fraction of the local inter-onset interval used as the window.
 *
 * Wide enough to hold a rolled chord together — a roll spans 30-100 ms — because
 * a spread chord has to be *recognised* as one chord before its spread can be
 * measured. Splitting it instead reports a missing note and an extra one, which
 * is both wrong and hides the very thing worth reporting: hands that are not
 * together. At 160 bpm the floor still keeps genuine sixteenths (94 ms apart)
 * separate, which is the other end this has to satisfy.
 */
export const CLUSTER_IOI_FRACTION = 0.35;

/**
 * Group note-ons into chords, with an **adaptive** window.
 *
 * A fixed threshold cannot work at both ends of the tempo range. Fifty
 * milliseconds merges genuine sixteenth notes at 160 bpm (94 ms apart) into
 * chords that were never played, and is simultaneously too tight for a
 * deliberately rolled chord, which it splits into separate events. Scaling the
 * window to the local inter-onset interval tracks whatever the player is
 * actually doing.
 */
export function clusterPerformance(
  notes: readonly PerformedNote[],
  options: { minMs?: number; ioiFraction?: number } = {},
): PerformedCluster[] {
  if (notes.length === 0) return [];

  const minMs = options.minMs ?? MIN_CLUSTER_MS;
  const fraction = options.ioiFraction ?? CLUSTER_IOI_FRACTION;

  const sorted = [...notes].sort((a, b) => a.onsetMs - b.onsetMs || a.midi - b.midi);
  const gaps = sorted.slice(1).map((n, i) => n.onsetMs - (sorted[i]?.onsetMs ?? 0));

  const clusters: PerformedCluster[] = [];
  let current: PerformedNote[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const onsets = current.map((n) => n.onsetMs);
    clusters.push({
      onsetMs: Math.min(...onsets),
      notes: current,
      pitches: current.map((n) => n.midi).sort((a, b) => a - b),
      spreadMs: Math.max(...onsets) - Math.min(...onsets),
    });
    current = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const note = sorted[i];
    if (!note) continue;

    if (current.length > 0) {
      const gap = gaps[i - 1] ?? 0;
      const window = Math.max(minMs, fraction * localIoi(gaps, i - 1));
      if (gap > window) flush();
    }
    current.push(note);
  }
  flush();

  return clusters;
}

/**
 * Local inter-onset interval around a gap.
 *
 * Median over a neighbourhood rather than the neighbouring gap itself: a single
 * rolled chord produces one tiny gap that would otherwise shrink the window
 * exactly where it needs to be wide. Gaps below the floor are excluded, since
 * those are chord spread rather than rhythm.
 */
function localIoi(gaps: readonly number[], index: number, radius = 4): number {
  const from = Math.max(0, index - radius);
  const to = Math.min(gaps.length, index + radius + 1);
  const window = gaps.slice(from, to).filter((g) => g > MIN_CLUSTER_MS);
  if (window.length === 0) return MIN_CLUSTER_MS * 4;
  const sorted = [...window].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? MIN_CLUSTER_MS * 4;
}

/** Whether the sustain pedal was down at a given moment. */
export function pedalDownAt(pedal: readonly PedalEvent[], timeMs: number): boolean {
  let down = false;
  for (const event of pedal) {
    if (event.timeMs > timeMs) break;
    down = event.value >= 0.5;
  }
  return down;
}

/** Total sounding length of a note in milliseconds. */
export function noteDurationMs(note: PerformedNote): number {
  return Math.max(0, note.offsetMs - note.onsetMs);
}

export function takeDurationMs(take: PerformedTake): number {
  if (take.notes.length === 0) return 0;
  const last = take.notes.reduce((max, n) => Math.max(max, n.offsetMs), 0);
  const first = take.notes.reduce((min, n) => Math.min(min, n.onsetMs), Infinity);
  return last - first;
}
