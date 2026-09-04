/**
 * Flattening a score into a playable, gradeable timeline.
 *
 * Two representations come out of here:
 *
 *  - `TimelineNote[]` — every note at an absolute score position, with ties
 *    already resolved, which is what the cursor and playback follow.
 *  - `OnsetCluster[]` — notes grouped by shared onset, which is what the
 *    grader aligns against.
 *
 * The clusters are built now, before the grader exists, because they are the
 * unit alignment operates on. Matching a chord as a *set* rather than a
 * sequence is what stops a rolled chord being scored as four timing errors,
 * and that decision belongs in the model rather than in the grader.
 */

import type { MidiNote } from '../theory/pitch';
import {
  type Measure, type Score, type ScoreNote, type TimeSignature,
  DEFAULT_TEMPO, DEFAULT_TIME_SIGNATURE, beatsPerMeasure,
} from './model';

export interface TimelineNote extends ScoreNote {
  /** Quarter-note beats from the start of the score. */
  readonly absoluteBeats: number;
  /**
   * Sounding length after ties are joined. A note tied across a bar line is
   * one note held, not two struck — grading it as two would invent an onset
   * the player never made.
   */
  readonly soundingBeats: number;
  readonly measureNumber: number;
  readonly partId: string;
}

export interface OnsetCluster {
  readonly absoluteBeats: number;
  readonly notes: readonly TimelineNote[];
  /** Pitches in the cluster, ascending. The set the grader matches against. */
  readonly pitches: readonly MidiNote[];
  readonly measureNumber: number;
  /** True when the score notates a roll, so spread onsets are intended. */
  readonly arpeggiated: boolean;
}

/** Milliseconds per quarter-note beat at a tempo. */
export function msPerBeat(bpm: number): number {
  return 60000 / bpm;
}

/**
 * Flatten every part into one absolute-time list, ordered by onset.
 *
 * Ties are resolved here: a tie-start absorbs the durations of the notes tied
 * to it, and those are dropped. Doing it once, centrally, means no downstream
 * consumer has to remember that a tie is not a new attack.
 */
export function flattenScore(score: Score): TimelineNote[] {
  const out: TimelineNote[] = [];

  for (const part of score.parts) {
    let measureStart = 0;
    let signature: TimeSignature = DEFAULT_TIME_SIGNATURE;

    for (const measure of part.measures) {
      if (measure.timeSignature) signature = measure.timeSignature;

      for (const note of measure.notes) {
        out.push({
          ...note,
          absoluteBeats: measureStart + note.onsetBeats,
          soundingBeats: note.durationBeats,
          measureNumber: measure.number,
          partId: part.id,
        });
      }
      measureStart += beatsPerMeasure(signature);
    }
  }

  out.sort((a, b) => a.absoluteBeats - b.absoluteBeats || (a.midi ?? 0) - (b.midi ?? 0));
  return resolveTies(out);
}

/**
 * Join tied notes into single sounding events.
 *
 * Matching is by pitch, staff and voice, and only forward in time to the next
 * tie-stop — a naive "next same pitch" would swallow an unrelated repetition
 * of the note later in the bar.
 */
function resolveTies(notes: TimelineNote[]): TimelineNote[] {
  const out: TimelineNote[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < notes.length; i++) {
    if (consumed.has(i)) continue;
    const note = notes[i];
    if (!note) continue;

    if (note.tie !== 'start' || note.midi === null) {
      out.push(note);
      continue;
    }

    let total = note.soundingBeats;
    for (let j = i + 1; j < notes.length; j++) {
      const next = notes[j];
      if (!next || consumed.has(j)) continue;
      if (
        next.midi !== note.midi ||
        next.staff !== note.staff ||
        next.voice !== note.voice ||
        (next.tie !== 'stop' && next.tie !== 'continue')
      ) {
        continue;
      }
      consumed.add(j);
      total += next.soundingBeats;
      if (next.tie === 'stop') break;
    }
    out.push({ ...note, soundingBeats: total });
  }

  return out;
}

/**
 * Group notes that share an onset.
 *
 * `toleranceBeats` exists because generated material lands exactly on the grid
 * while imported files carry rounding from whatever wrote them.
 */
export function onsetClusters(
  notes: readonly TimelineNote[],
  toleranceBeats = 1e-6,
): OnsetCluster[] {
  const sounding = notes.filter((n) => n.midi !== null);
  if (sounding.length === 0) return [];

  const sorted = [...sounding].sort((a, b) => a.absoluteBeats - b.absoluteBeats);
  const clusters: OnsetCluster[] = [];
  let current: TimelineNote[] = [];
  let anchor = sorted[0]?.absoluteBeats ?? 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const pitches = current
      .map((n) => n.midi)
      .filter((m): m is MidiNote => m !== null)
      .sort((a, b) => a - b);
    const first = current[0];
    clusters.push({
      absoluteBeats: anchor,
      notes: current,
      pitches,
      measureNumber: first?.measureNumber ?? 0,
      arpeggiated: current.some((n) => n.arpeggiate),
    });
    current = [];
  };

  for (const note of sorted) {
    if (current.length > 0 && note.absoluteBeats - anchor > toleranceBeats) {
      flush();
      anchor = note.absoluteBeats;
    }
    if (current.length === 0) anchor = note.absoluteBeats;
    current.push(note);
  }
  flush();

  return clusters;
}

/** Total length of a score in quarter-note beats. */
export function scoreDurationBeats(score: Score): number {
  const notes = flattenScore(score);
  return notes.reduce((max, n) => Math.max(max, n.absoluteBeats + n.soundingBeats), 0);
}

/** Tempo in force at the start, falling back to a sensible practice tempo. */
export function initialTempo(score: Score): number {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      if (measure.tempo) return measure.tempo.bpm;
    }
  }
  return DEFAULT_TEMPO.bpm;
}

/** Convert a score position to milliseconds at a given tempo. */
export function beatsToMs(beats: number, bpm: number): number {
  return beats * msPerBeat(bpm);
}

/** Notes belonging to one staff, for hands-separate practice. */
export function notesOnStaff(notes: readonly TimelineNote[], staff: number): TimelineNote[] {
  return notes.filter((n) => n.staff === staff);
}

/** Measures as index ranges over the cluster list, for section looping. */
export function clustersByMeasure(
  clusters: readonly OnsetCluster[],
): Map<number, OnsetCluster[]> {
  const map = new Map<number, OnsetCluster[]>();
  for (const cluster of clusters) {
    const list = map.get(cluster.measureNumber);
    if (list) list.push(cluster);
    else map.set(cluster.measureNumber, [cluster]);
  }
  return map;
}

export { beatsPerMeasure };
export type { Measure, Score, ScoreNote };
