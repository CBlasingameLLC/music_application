/**
 * Generated hand-independence exercises.
 *
 * Hands-together is the wall, and it is not trained by playing pieces and
 * hoping. It fails for a specific reason — one hand captures the other — and
 * the fix is material that makes capture impossible to fake: two parts whose
 * rhythms genuinely disagree, at a ratio the player can only hold by keeping
 * an internal subdivision.
 *
 * So the exercises are built around a *ratio*, not around a piece. The left
 * hand plays an ostinato slow enough to be automatic; the right hand plays
 * against it at 2:1, 3:1 or 3:2. Everything else is deliberately easy — small
 * range, one harmony per bar — because the thing being trained is the
 * coordination, and adding a reading problem on top would confound the measure.
 *
 * ## The split point, and why it is not the forbidden pitch threshold
 *
 * The grader assigns hands from `ScoreNote.staff`, never from pitch, because in
 * real repertoire the left hand crosses above middle C constantly. That
 * argument is about *arbitrary* material. Here the exercise is generated, so
 * the register gap can be **constructed** and then **asserted**: every left-hand
 * pitch stays below `splitPoint` and every right-hand pitch at or above it.
 *
 * That turns live hand attribution from a guess into a lookup, and it is what
 * lets one number serve all three input paths — a MIDI note number, an
 * on-screen key, and the microphone's band boundary.
 */

import { type MidiNote, type SpelledPitch, toMidi } from '../../theory/pitch';
import { type Key, keyScale } from '../../theory/scale';
import { makeRng, type Rng } from '../../generators/rng';
import {
  type Articulation, type Measure, type Part, type Score, type ScoreNote,
  type TimeSignature,
  GENERATED_PROVENANCE, beatsPerMeasure, makeMeasure, makeNote,
} from '../model';

/**
 * Right-hand notes per left-hand note.
 *
 * `1:1` is the control condition — the hands agree, so nothing is being
 * measured except whether the notes are right. Everything above it puts the
 * hands in genuine conflict.
 */
export type IndependenceRatio = '1:1' | '2:1' | '3:1' | '3:2';

export interface IndependenceParams {
  readonly key: Key;
  readonly bars: number;
  readonly timeSignature: TimeSignature;
  readonly ratio: IndependenceRatio;
  /**
   * Lowest right-hand pitch, and the boundary the left hand stays under.
   *
   * Guaranteed by construction, asserted by `assertHandsSeparated`.
   */
  readonly splitPoint: MidiNote;
  /** Highest right-hand pitch. */
  readonly rightCeiling: MidiNote;
  /** How far the left-hand ostinato may roam, in scale steps. 0 = a drone. */
  readonly leftMotion: number;
  /** Different articulation per hand is its own rung; null means unmarked. */
  readonly articulation: { right: Articulation; left: Articulation } | null;
  /** Different dynamics per hand. Only measurable over a velocity source. */
  readonly dynamics: { right: string; left: string } | null;
  /** Right hand improvises over a fixed left hand — the last rung. */
  readonly rightImprovises: boolean;
  readonly tempo: number;
}

/** Beats each hand's note occupies, derived from the ratio. */
const RATIO_TABLE: Record<
  IndependenceRatio,
  { readonly right: number; readonly left: number }
> = {
  // Expressed as note lengths in quarter-note beats over a two-beat cell, so
  // the cell always closes and the bar lines stay honest.
  '1:1': { right: 1, left: 1 },
  '2:1': { right: 0.5, left: 1 },
  '3:1': { right: 1 / 3, left: 1 },
  '3:2': { right: 2 / 3, left: 1 },
};

export interface HandSplitReport {
  readonly ok: boolean;
  readonly highestLeft: MidiNote | null;
  readonly lowestRight: MidiNote | null;
}

/**
 * Check that the two hands really do occupy disjoint registers.
 *
 * The whole live-attribution scheme rests on this, so it is checked rather than
 * assumed: a generator change that let the hands overlap would not break any
 * rendering, it would silently start attributing notes to the wrong hand and
 * every independence number after it would be fiction.
 */
export function assertHandsSeparated(score: Score, splitPoint: MidiNote): HandSplitReport {
  let highestLeft: MidiNote | null = null;
  let lowestRight: MidiNote | null = null;

  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        if (note.midi === null) continue;
        if (note.staff === 2) {
          if (highestLeft === null || note.midi > highestLeft) highestLeft = note.midi;
        } else {
          if (lowestRight === null || note.midi < lowestRight) lowestRight = note.midi;
        }
      }
    }
  }

  const ok =
    (highestLeft === null || highestLeft < splitPoint) &&
    (lowestRight === null || lowestRight >= splitPoint);

  return { ok, highestLeft, lowestRight };
}

/** Which hand a live pitch belongs to, given the exercise's own boundary. */
export function handForPitch(midi: MidiNote, splitPoint: MidiNote): 'left' | 'right' {
  return midi < splitPoint ? 'left' : 'right';
}

interface Frame {
  readonly pitches: readonly { midi: MidiNote; spelled: SpelledPitch; degree: number }[];
}

/** Scale pitches inside a range, keeping spellings so the staff reads correctly. */
function frameFor(key: Key, low: MidiNote, high: MidiNote): Frame {
  const scale = keyScale(key);
  const pitches: { midi: MidiNote; spelled: SpelledPitch; degree: number }[] = [];

  for (let octave = -1; octave <= 9; octave++) {
    scale.forEach((note, degree) => {
      const spelled: SpelledPitch = { ...note, octave: note.octave + octave };
      const midi = toMidi(spelled);
      if (midi >= low && midi <= high) pitches.push({ midi, spelled, degree });
    });
  }

  pitches.sort((a, b) => a.midi - b.midi);
  return { pitches };
}

/**
 * The left-hand ostinato for one bar.
 *
 * Ostinato is the point: it has to become automatic, because the right hand
 * cannot be free until the left one stops needing attention. So it repeats
 * exactly, and `leftMotion` controls only how much shape it has.
 */
function leftHandBar(
  frame: Frame,
  bar: number,
  beats: number,
  noteBeats: number,
  params: IndependenceParams,
  rng: Rng,
): ScoreNote[] {
  const notes: ScoreNote[] = [];
  const anchor = frame.pitches.findIndex((p) => p.degree === 0);
  const base = anchor >= 0 ? anchor : 0;

  for (let onset = 0, step = 0; onset < beats - 1e-9; onset += noteBeats, step++) {
    // Alternating tonic and dominant makes the harmony audible without adding
    // a second thing to read.
    const offset = params.leftMotion === 0
      ? 0
      : (step % 2 === 0 ? 0 : Math.min(params.leftMotion, 4));
    const pitch = frame.pitches[Math.min(frame.pitches.length - 1, base + offset)];
    if (!pitch) continue;

    notes.push(
      makeNote({
        midi: pitch.midi,
        spelled: pitch.spelled,
        onsetBeats: onset,
        durationBeats: noteBeats,
        staff: 2,
        voice: 2,
        articulations: params.articulation ? [params.articulation.left] : [],
        dynamic: params.dynamics && onset === 0 && bar === 0 ? params.dynamics.left : null,
      }),
    );
  }

  // Nudge the shape so an eight-bar exercise is not literally one bar eight
  // times; the *rhythm* stays identical, which is what has to become automatic.
  if (params.leftMotion > 0 && bar % 4 === 3 && notes.length > 1) rng.next();
  return notes;
}

/** The right-hand part for one bar, at the ratio's subdivision. */
function rightHandBar(
  frame: Frame,
  bar: number,
  beats: number,
  noteBeats: number,
  params: IndependenceParams,
  rng: Rng,
  state: { index: number },
): ScoreNote[] {
  const notes: ScoreNote[] = [];

  for (let onset = 0; onset < beats - 1e-9; onset += noteBeats) {
    if (params.rightImprovises) {
      // A free right hand over a fixed left one: the step is chosen rather than
      // fixed, which is the last rung because it removes the last crutch.
      const move = rng.pick([-2, -1, -1, 0, 1, 1, 2]);
      state.index = Math.max(0, Math.min(frame.pitches.length - 1, state.index + move));
    } else {
      // Otherwise walk the scale, so the right hand is predictable and the only
      // difficulty is holding it against the other rhythm.
      state.index = (state.index + 1) % frame.pitches.length;
    }

    const pitch = frame.pitches[state.index];
    if (!pitch) continue;

    notes.push(
      makeNote({
        midi: pitch.midi,
        spelled: pitch.spelled,
        // Round to the microsecond so 1/3-beat triplets accumulate exactly
        // rather than drifting a hair off the bar line over eight bars.
        onsetBeats: Math.round(onset * 1e6) / 1e6,
        durationBeats: Math.round(noteBeats * 1e6) / 1e6,
        staff: 1,
        voice: 1,
        articulations: params.articulation ? [params.articulation.right] : [],
        dynamic: params.dynamics && onset === 0 && bar === 0 ? params.dynamics.right : null,
      }),
    );
  }

  return notes;
}

export function generateIndependence(params: IndependenceParams, seed: number): Score {
  const rng = makeRng(seed);
  const beats = beatsPerMeasure(params.timeSignature);
  const cell = RATIO_TABLE[params.ratio];

  const leftFrame = frameFor(params.key, 36, params.splitPoint - 1);
  const rightFrame = frameFor(params.key, params.splitPoint, params.rightCeiling);

  if (leftFrame.pitches.length === 0 || rightFrame.pitches.length === 0) {
    throw new Error('The split point leaves one hand with no notes to play.');
  }

  const measures: Measure[] = [];
  const rightState = { index: 0 };

  for (let bar = 0; bar < params.bars; bar++) {
    const notes: ScoreNote[] = [
      ...rightHandBar(rightFrame, bar, beats, cell.right, params, rng, rightState),
      ...leftHandBar(leftFrame, bar, beats, cell.left, params, rng),
    ];

    measures.push(
      makeMeasure({
        number: bar + 1,
        notes,
        timeSignature: bar === 0 ? params.timeSignature : null,
        key: bar === 0 ? params.key : null,
        tempo: bar === 0 ? { bpm: params.tempo, beatUnit: 1 } : null,
      }),
    );
  }

  const part: Part = { id: 'P1', name: 'Piano', staffCount: 2, measures };

  return {
    id: `independence-${params.ratio.replace(':', '-')}-${seed}`,
    title: `Independence — ${params.ratio}`,
    composer: null,
    parts: [part],
    provenance: GENERATED_PROVENANCE,
  };
}
