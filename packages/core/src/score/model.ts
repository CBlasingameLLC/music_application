/**
 * The score model.
 *
 * This is what "should be played" — the single source of truth that rendering,
 * the cursor and (next pass) the grader all read from.
 *
 * Deliberately *not* OSMD's internal model. Grading against a rendering
 * library's internals would couple correctness to its next refactor, and would
 * mean generated drills and imported files took different paths through the
 * app. Here, MusicXML is a serialisation format on the way to the renderer,
 * never the thing we reason about.
 *
 * Fields the grader will need are present from the start — staff assignment,
 * fingering, articulation, arpeggiate — so that work is additive rather than a
 * migration.
 */

import type { MidiNote, SpelledPitch } from '../theory/pitch';
import type { Key } from '../theory/scale';

export interface TimeSignature {
  readonly beats: number;
  /** 4 = quarter, 8 = eighth. */
  readonly beatType: number;
}

export interface Tempo {
  readonly bpm: number;
  /** Which note value gets the beat. 1 = quarter note. */
  readonly beatUnit: number;
}

export type Articulation =
  | 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'legato';

export type TieState = 'start' | 'stop' | 'continue' | null;

export interface ScoreNote {
  /** Null for a rest. Rests matter: beginners under-hold them and nobody measures it. */
  readonly midi: MidiNote | null;
  readonly spelled: SpelledPitch | null;
  /**
   * 1 is the upper staff (right hand on piano), 2 the lower.
   *
   * Authoritative for hand assignment. A pitch threshold at middle C is wrong
   * constantly — the left hand crosses above and the right plays below all the
   * time — and using one would silently corrupt every per-hand metric.
   */
  readonly staff: number;
  readonly voice: number;
  /** Onset within its measure, in quarter-note beats. */
  readonly onsetBeats: number;
  readonly durationBeats: number;
  readonly tie: TieState;
  /** Slurs mark where legato is *notated*, so legato is graded only where asked. */
  readonly slurStart: boolean;
  readonly slurStop: boolean;
  readonly articulations: readonly Articulation[];
  /** 1-5, thumb to little finger, as printed in real editions. */
  readonly fingering: number | null;
  /** A notated roll. Spread onsets here are the instruction, not an error. */
  readonly arpeggiate: boolean;
  /** Grace notes and ornaments are excluded from strict timing. */
  readonly ornament: boolean;
  /** MusicXML dynamic marking in force, if any. */
  readonly dynamic: string | null;
}

export interface Measure {
  readonly number: number;
  readonly timeSignature: TimeSignature | null;
  readonly key: Key | null;
  readonly tempo: Tempo | null;
  readonly notes: readonly ScoreNote[];
  /** Bar-line repeat markers, needed to render and to loop sections later. */
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
}

export interface Part {
  readonly id: string;
  readonly name: string;
  readonly staffCount: number;
  readonly measures: readonly Measure[];
}

/**
 * Where a score came from and what may be done with it.
 *
 * `source: 'userImported'` never syncs and never enters git — the architecture
 * keeps private arrangements off the network, not a `.gitignore` rule.
 */
export interface Provenance {
  readonly source: 'bundled' | 'generated' | 'userImported';
  /** Licence of the *engraving*, which is separate from the composition. */
  readonly license: string;
  readonly attribution: string | null;
  readonly isPrivate: boolean;
}

export interface Score {
  readonly id: string;
  readonly title: string;
  readonly composer: string | null;
  readonly parts: readonly Part[];
  readonly provenance: Provenance;
}

export const GENERATED_PROVENANCE: Provenance = {
  source: 'generated',
  license: 'CC0-1.0',
  attribution: null,
  isPrivate: false,
};

/** Quarter-note beats in a measure of the given time signature. */
export function beatsPerMeasure(sig: TimeSignature): number {
  return sig.beats * (4 / sig.beatType);
}

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 };
export const DEFAULT_TEMPO: Tempo = { bpm: 80, beatUnit: 1 };

/** Every sounding note in a measure, rests excluded. */
export function soundingNotes(measure: Measure): ScoreNote[] {
  return measure.notes.filter((n) => n.midi !== null);
}

export function measureCount(score: Score): number {
  return Math.max(0, ...score.parts.map((p) => p.measures.length));
}

/** All distinct MIDI pitches in a score, ascending. Used to size a keyboard. */
export function pitchRange(score: Score): [MidiNote, MidiNote] | null {
  const pitches: MidiNote[] = [];
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const note of measure.notes) if (note.midi !== null) pitches.push(note.midi);
    }
  }
  if (pitches.length === 0) return null;
  return [Math.min(...pitches), Math.max(...pitches)];
}

/** A blank note, so constructing one does not mean listing every optional field. */
export function makeNote(partial: Partial<ScoreNote> & Pick<ScoreNote, 'onsetBeats' | 'durationBeats'>): ScoreNote {
  return {
    midi: null,
    spelled: null,
    staff: 1,
    voice: 1,
    tie: null,
    slurStart: false,
    slurStop: false,
    articulations: [],
    fingering: null,
    arpeggiate: false,
    ornament: false,
    dynamic: null,
    ...partial,
  };
}

export function makeMeasure(partial: Partial<Measure> & Pick<Measure, 'number' | 'notes'>): Measure {
  return {
    timeSignature: null,
    key: null,
    tempo: null,
    repeatStart: false,
    repeatEnd: false,
    ...partial,
  };
}
