/**
 * Generated sight-reading material.
 *
 * There is no CC0 MusicXML corpus of the beginner piano progression — OpenScore
 * is Lieder and string quartets, Mutopia has no MusicXML at all. So the bulk of
 * what gets read here is generated from the theory engine: infinite supply,
 * zero licensing, and difficulty controlled precisely by the ladder rung.
 *
 * Generating *musical* material matters more than generating a lot of it. A
 * random walk through a scale is reading practice in the same way that random
 * letters are reading practice — technically it exercises decoding, and it
 * teaches nothing about what music does. So the melody follows the rules a
 * teacher would recognise:
 *
 *  - Steps dominate; leaps are the exception and resolve by step in the
 *    opposite direction, which is how melodies actually behave.
 *  - Strong beats prefer chord tones, so the harmony is audible.
 *  - Phrases begin and end on a stable degree, so they sound finished.
 *
 * Material is never repeated: each phrase comes from a fresh seed and is scored
 * on first attempt only. Repeating it converts reading into memorisation and
 * destroys the measurement.
 */

import { type MidiNote, type SpelledPitch, toMidi } from '../../theory/pitch';
import { type Key, keyScale } from '../../theory/scale';
import { makeRng, type Rng } from '../../generators/rng';
import {
  type Measure, type Part, type Score, type ScoreNote, type TimeSignature,
  GENERATED_PROVENANCE, beatsPerMeasure, makeMeasure, makeNote,
} from '../model';

export interface SightReadingParams {
  readonly key: Key;
  readonly bars: number;
  readonly timeSignature: TimeSignature;
  /** Playable range for the right hand, as MIDI numbers. */
  readonly range: readonly [MidiNote, MidiNote];
  /** 1 = melody only; 2 = adds a left-hand part. */
  readonly hands: 1 | 2;
  /** Allowed note lengths in quarter-note beats. */
  readonly rhythmUnits: readonly number[];
  /** Largest melodic leap, in scale steps. 1 means stepwise only. */
  readonly maxLeap: number;
  /** Probability that a move is a step rather than a leap, 0-1. */
  readonly stepBias: number;
  readonly allowRests: boolean;
  readonly tempo: number;
}

/** Degrees that feel like resting points: tonic, mediant, dominant. */
const STABLE_DEGREES = [0, 2, 4];

interface ScaleFrame {
  /** Every scale pitch in range, ascending, with its spelling. */
  readonly pitches: readonly { midi: MidiNote; spelled: SpelledPitch; degree: number }[];
}

/** Lay the key's scale out across the playable range, keeping spellings. */
function buildScaleFrame(key: Key, range: readonly [MidiNote, MidiNote]): ScaleFrame {
  const scale = keyScale(key);
  const pitches: { midi: MidiNote; spelled: SpelledPitch; degree: number }[] = [];

  for (let octave = -1; octave <= 9; octave++) {
    scale.forEach((note, degree) => {
      const spelled: SpelledPitch = { ...note, octave: note.octave + octave };
      const midi = toMidi(spelled);
      if (midi >= range[0] && midi <= range[1]) pitches.push({ midi, spelled, degree });
    });
  }

  pitches.sort((a, b) => a.midi - b.midi);
  return { pitches };
}

/** Rhythm for one bar, filling it exactly from the allowed units. */
function generateBar(
  rng: Rng,
  beats: number,
  units: readonly number[],
  allowRests: boolean,
): Array<{ duration: number; isRest: boolean }> {
  const out: Array<{ duration: number; isRest: boolean }> = [];
  let remaining = beats;

  while (remaining > 1e-6) {
    const usable = units.filter((u) => u <= remaining + 1e-6);
    const duration = usable.length > 0 ? rng.pick(usable) : remaining;
    // Rests stay sparse and never open a phrase: a bar that begins with silence
    // gives the reader nothing to orient on.
    const isRest = allowRests && out.length > 0 && rng.bool(0.12);
    out.push({ duration, isRest });
    remaining -= duration;
  }
  return out;
}

/**
 * Pick the next melodic pitch.
 *
 * Leaps are followed by a step back the other way, which is the single rule
 * that most separates a melody from a random walk.
 */
function nextIndex(
  rng: Rng,
  frame: ScaleFrame,
  current: number,
  lastLeapDirection: number,
  params: SightReadingParams,
  preferStable: boolean,
): number {
  const max = frame.pitches.length - 1;

  if (lastLeapDirection !== 0) {
    const resolved = current - lastLeapDirection;
    if (resolved >= 0 && resolved <= max) return resolved;
  }

  const step = rng.bool(params.stepBias) ? 1 : rng.int(2, Math.max(2, params.maxLeap));
  const directions = [1, -1];
  const order = rng.bool() ? directions : directions.reverse();

  for (const direction of order) {
    const candidate = current + step * direction;
    if (candidate < 0 || candidate > max) continue;
    const pitch = frame.pitches[candidate];
    if (!pitch) continue;
    // On a strong beat, hold out for a chord tone when one is reachable.
    if (preferStable && !STABLE_DEGREES.includes(pitch.degree) && rng.bool(0.6)) continue;
    return candidate;
  }

  // Boxed in at the edge of the range: turn around rather than repeat.
  return current > max / 2 ? Math.max(0, current - 1) : Math.min(max, current + 1);
}

/** Index of a stable scale degree near the middle of the range. */
function startingIndex(rng: Rng, frame: ScaleFrame): number {
  const middle = Math.floor(frame.pitches.length / 2);
  const candidates = frame.pitches
    .map((p, i) => ({ i, p }))
    .filter(({ p }) => STABLE_DEGREES.includes(p.degree))
    .sort((a, b) => Math.abs(a.i - middle) - Math.abs(b.i - middle))
    .slice(0, 4);
  const chosen = candidates.length > 0 ? rng.pick(candidates) : null;
  return chosen ? chosen.i : middle;
}

export function generateSightReading(
  params: SightReadingParams,
  seed: number,
): Score {
  const rng = makeRng(seed);
  const frame = buildScaleFrame(params.key, params.range);

  if (frame.pitches.length < 3) {
    throw new Error('The range is too narrow to build a phrase in this key.');
  }

  const beats = beatsPerMeasure(params.timeSignature);
  const measures: Measure[] = [];

  let index = startingIndex(rng, frame);
  let lastLeap = 0;

  for (let bar = 0; bar < params.bars; bar++) {
    const rhythm = generateBar(rng, beats, params.rhythmUnits, params.allowRests);
    const notes: ScoreNote[] = [];
    let onset = 0;
    const isLastBar = bar === params.bars - 1;

    rhythm.forEach((slot, slotIndex) => {
      const onStrongBeat = Math.abs(onset % 1) < 1e-6;
      const isFinalNote = isLastBar && slotIndex === rhythm.length - 1;

      if (slot.isRest && !isFinalNote) {
        notes.push(makeNote({ onsetBeats: onset, durationBeats: slot.duration, staff: 1 }));
        onset += slot.duration;
        return;
      }

      if (isFinalNote) {
        // Land the phrase on the tonic so it sounds finished rather than cut off.
        const tonic = frame.pitches
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.degree === 0)
          .sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index))[0];
        if (tonic) index = tonic.i;
      } else if (notes.length > 0 || bar > 0) {
        const previous = index;
        index = nextIndex(rng, frame, index, lastLeap, params, onStrongBeat);
        const distance = index - previous;
        lastLeap = Math.abs(distance) >= 2 ? Math.sign(distance) : 0;
      }

      const pitch = frame.pitches[index];
      if (pitch) {
        notes.push(
          makeNote({
            midi: pitch.midi,
            spelled: pitch.spelled,
            onsetBeats: onset,
            durationBeats: slot.duration,
            staff: 1,
            voice: 1,
          }),
        );
      }
      onset += slot.duration;
    });

    if (params.hands === 2) {
      notes.push(...leftHandBar(params, frame, bar, beats));
    }

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

  const part: Part = {
    id: 'P1',
    name: 'Piano',
    staffCount: params.hands,
    measures,
  };

  return {
    id: `sightread-${seed}`,
    title: 'Sight-reading',
    composer: null,
    parts: [part],
    provenance: GENERATED_PROVENANCE,
  };
}

/**
 * A left hand that supports rather than competes.
 *
 * Held roots and fifths: enough to make the harmony audible and to require
 * genuine two-staff reading, without adding a second rhythmic problem on top
 * of the reading problem being trained.
 */
function leftHandBar(
  params: SightReadingParams,
  frame: ScaleFrame,
  bar: number,
  beats: number,
): ScoreNote[] {
  const scale = keyScale(params.key);
  // Alternate tonic and dominant, which is the harmonic floor of most early
  // repertoire and lets the right hand sound like it belongs somewhere.
  const degree = bar % 2 === 0 ? 0 : 4;
  const note = scale[degree];
  if (!note) return [];

  const spelled: SpelledPitch = { ...note, octave: note.octave - 2 };
  const midi = toMidi(spelled);
  if (midi < 21) return [];

  return [
    makeNote({
      midi,
      spelled,
      onsetBeats: 0,
      durationBeats: beats,
      staff: 2,
      voice: 2,
    }),
  ];
}

export { buildScaleFrame };
