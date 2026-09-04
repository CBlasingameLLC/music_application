/**
 * Scales, modes, and key signatures.
 *
 * Scales are defined by *degree tables* — a diatonic offset paired with a
 * semitone offset for each degree — rather than by a bare semitone pattern.
 * That extra half of the definition is what lets the engine spell A♭ major as
 * A♭ B♭ C D♭ E♭ F G instead of A♭ A♯ C C♯ D♯ F G. Spelling is not cosmetic:
 * the user reads these on a staff, and a wrong spelling is a wrong note name.
 */

import {
  type MidiNote,
  type SpelledPitch,
  type Step,
  mod12,
  mod7,
  stepFromIndex,
  stepIndex,
  stepSemitones,
  toMidi,
} from './pitch.js';

export type ScaleType =
  | 'major'
  | 'natural-minor'
  | 'harmonic-minor'
  | 'melodic-minor'
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian'
  | 'major-pentatonic'
  | 'minor-pentatonic'
  | 'blues'
  | 'chromatic'
  | 'whole-tone';

/**
 * Each entry is [diatonicOffset, semitoneOffset] from the tonic.
 * The diatonic offset is what forces one letter name per degree.
 */
type DegreeTable = ReadonlyArray<readonly [number, number]>;

const SCALE_TABLES: Record<ScaleType, DegreeTable> = {
  major: [[0, 0], [1, 2], [2, 4], [3, 5], [4, 7], [5, 9], [6, 11]],
  ionian: [[0, 0], [1, 2], [2, 4], [3, 5], [4, 7], [5, 9], [6, 11]],
  'natural-minor': [[0, 0], [1, 2], [2, 3], [3, 5], [4, 7], [5, 8], [6, 10]],
  aeolian: [[0, 0], [1, 2], [2, 3], [3, 5], [4, 7], [5, 8], [6, 10]],
  'harmonic-minor': [[0, 0], [1, 2], [2, 3], [3, 5], [4, 7], [5, 8], [6, 11]],
  'melodic-minor': [[0, 0], [1, 2], [2, 3], [3, 5], [4, 7], [5, 9], [6, 11]],
  dorian: [[0, 0], [1, 2], [2, 3], [3, 5], [4, 7], [5, 9], [6, 10]],
  phrygian: [[0, 0], [1, 1], [2, 3], [3, 5], [4, 7], [5, 8], [6, 10]],
  lydian: [[0, 0], [1, 2], [2, 4], [3, 6], [4, 7], [5, 9], [6, 11]],
  mixolydian: [[0, 0], [1, 2], [2, 4], [3, 5], [4, 7], [5, 9], [6, 10]],
  locrian: [[0, 0], [1, 1], [2, 3], [3, 5], [4, 6], [5, 8], [6, 10]],
  'major-pentatonic': [[0, 0], [1, 2], [2, 4], [4, 7], [5, 9]],
  'minor-pentatonic': [[0, 0], [2, 3], [3, 5], [4, 7], [6, 10]],
  blues: [[0, 0], [2, 3], [3, 5], [3, 6], [4, 7], [6, 10]],
  chromatic: [
    [0, 0], [0, 1], [1, 2], [2, 3], [2, 4], [3, 5],
    [3, 6], [4, 7], [4, 8], [5, 9], [5, 10], [6, 11],
  ],
  'whole-tone': [[0, 0], [1, 2], [2, 4], [3, 6], [4, 8], [5, 10]],
};

export const SCALE_LABELS: Record<ScaleType, string> = {
  major: 'major',
  'natural-minor': 'natural minor',
  'harmonic-minor': 'harmonic minor',
  'melodic-minor': 'melodic minor',
  ionian: 'Ionian',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Aeolian',
  locrian: 'Locrian',
  'major-pentatonic': 'major pentatonic',
  'minor-pentatonic': 'minor pentatonic',
  blues: 'blues',
  chromatic: 'chromatic',
  'whole-tone': 'whole tone',
};

export function scaleDegreeCount(type: ScaleType): number {
  return SCALE_TABLES[type].length;
}

/**
 * Spell one ascending octave of a scale from a tonic.
 * The result always has one entry per scale degree, correctly spelled.
 */
export function scaleNotes(tonic: SpelledPitch, type: ScaleType): SpelledPitch[] {
  const table = SCALE_TABLES[type];
  const tonicDiatonic = stepIndex(tonic.step);
  const tonicMidi = toMidi(tonic);

  return table.map(([diatonicOffset, semitoneOffset]) => {
    const stepIdx = mod7(tonicDiatonic + diatonicOffset);
    const step = stepFromIndex(stepIdx);
    // Octave advances when the letter wraps past B.
    const octave = tonic.octave + Math.floor((tonicDiatonic + diatonicOffset) / 7);
    const natural = toMidi({ step, alter: 0, octave });
    return { step, alter: tonicMidi + semitoneOffset - natural, octave };
  });
}

/** MIDI pitch classes of a scale. Loses spelling; for detection and matching only. */
export function scalePitchClasses(tonicPc: number, type: ScaleType): number[] {
  return SCALE_TABLES[type].map(([, semis]) => mod12(tonicPc + semis));
}

/** True when every supplied pitch class belongs to the scale. */
export function fitsScale(pitchClasses: number[], tonicPc: number, type: ScaleType): boolean {
  const set = new Set(scalePitchClasses(tonicPc, type));
  return pitchClasses.every((pc) => set.has(mod12(pc)));
}

// ---------------------------------------------------------------------------
// Key signatures
// ---------------------------------------------------------------------------

export type Mode = 'major' | 'minor';

export interface Key {
  readonly tonic: SpelledPitch;
  readonly mode: Mode;
}

/** Order accidentals appear in a key signature. */
export const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Major keys by their position on the circle of fifths. Index = sharp count. */
const MAJOR_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C',
  1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};

const MINOR_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Ab', [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D',
  0: 'A',
  1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#',
};

function nameToStepAlter(name: string): { step: Step; alter: number } {
  const step = name[0] as Step;
  const rest = name.slice(1);
  let alter = 0;
  if (rest === '#') alter = 1;
  else if (rest === 'b') alter = -1;
  return { step, alter };
}

/**
 * Signed accidental count for a key: positive = sharps, negative = flats.
 * Returns null for a tonic spelling that is not a real key (e.g. D# major).
 */
export function keyFifths(key: Key): number | null {
  const table = key.mode === 'major' ? MAJOR_BY_FIFTHS : MINOR_BY_FIFTHS;
  for (const [fifths, name] of Object.entries(table)) {
    const { step, alter } = nameToStepAlter(name);
    if (step === key.tonic.step && alter === key.tonic.alter) return Number(fifths);
  }
  return null;
}

/** The letters that carry an accidental in this key signature, in written order. */
export function keySignatureAccidentals(key: Key): { steps: Step[]; alter: 1 | -1 } | null {
  const fifths = keyFifths(key);
  if (fifths === null) return null;
  if (fifths === 0) return { steps: [], alter: 1 };
  return fifths > 0
    ? { steps: SHARP_ORDER.slice(0, fifths), alter: 1 }
    : { steps: FLAT_ORDER.slice(0, -fifths), alter: -1 };
}

/** Build a Key from a fifths count. Used to enumerate keys for drills. */
export function keyFromFifths(fifths: number, mode: Mode): Key {
  const table = mode === 'major' ? MAJOR_BY_FIFTHS : MINOR_BY_FIFTHS;
  const name = table[fifths];
  if (!name) throw new Error(`no ${mode} key with ${fifths} fifths`);
  const { step, alter } = nameToStepAlter(name);
  return { tonic: { step, alter, octave: 4 }, mode };
}

/** All 15 major and 15 minor keys, ordered from flattest to sharpest. */
export function allKeys(mode: Mode): Key[] {
  const out: Key[] = [];
  for (let f = -7; f <= 7; f++) out.push(keyFromFifths(f, mode));
  return out;
}

/** The relative minor of a major key, or relative major of a minor key. */
export function relativeKey(key: Key): Key {
  const fifths = keyFifths(key);
  if (fifths === null) throw new Error('cannot take the relative of a non-standard key');
  return keyFromFifths(fifths, key.mode === 'major' ? 'minor' : 'major');
}

/** The parallel key: same tonic, opposite mode. */
export function parallelKey(key: Key): Key {
  return { tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' };
}

/** Display name, e.g. "E♭ major", "F♯ minor". */
export function keyName(key: Key): string {
  const acc = key.tonic.alter === 1 ? '♯' : key.tonic.alter === -1 ? '♭' : '';
  return `${key.tonic.step}${acc} ${key.mode}`;
}

/** Stable ASCII id, e.g. "Eb-major". */
export function keyId(key: Key): string {
  const acc = key.tonic.alter === 1 ? '#' : key.tonic.alter === -1 ? 'b' : '';
  return `${key.tonic.step}${acc}-${key.mode}`;
}

/** The scale that defines a key. Minor keys use the natural form as their base. */
export function keyScale(key: Key): SpelledPitch[] {
  return scaleNotes(key.tonic, key.mode === 'major' ? 'major' : 'natural-minor');
}

/**
 * Spell a MIDI note the way it would be written *in this key*.
 *
 * This is the spelling function to reach for whenever a key is known. It picks
 * the diatonic spelling when the pitch is in the key, and otherwise follows the
 * key's accidental direction — sharps in sharp keys, flats in flat keys — which
 * is what a musician would write.
 */
export function spellInKey(midi: MidiNote, key: Key): SpelledPitch {
  const octave = Math.floor(midi / 12) - 1;
  const pc = mod12(midi);

  for (const note of keyScale(key)) {
    if (mod12(toMidi(note)) === pc) {
      // Re-seat the scale note into the octave the MIDI number asks for.
      for (const oct of [octave - 1, octave, octave + 1]) {
        const cand: SpelledPitch = { step: note.step, alter: note.alter, octave: oct };
        if (toMidi(cand) === midi) return cand;
      }
    }
  }

  const fifths = keyFifths(key) ?? 0;
  const preferSharp = fifths >= 0;
  const naturalStep = (['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[]).find(
    (s) => stepSemitones(s) === pc,
  );
  if (naturalStep) return { step: naturalStep, alter: 0, octave };

  if (preferSharp) {
    const below = (['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[]).find(
      (s) => stepSemitones(s) === mod12(pc - 1),
    );
    if (!below) throw new Error(`unreachable: no step below pc ${pc}`);
    return { step: below, alter: 1, octave };
  }
  const above = (['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[]).find(
    (s) => stepSemitones(s) === mod12(pc + 1),
  );
  if (!above) throw new Error(`unreachable: no step above pc ${pc}`);
  return { step: above, alter: -1, octave: above === 'C' ? octave + 1 : octave };
}

/**
 * Which scale degree (1-7) a pitch occupies in a key, or null if chromatic.
 * Functional ear training is built on this: the app asks "which degree?",
 * not "which interval?", because degree is what carries musical meaning.
 */
export function scaleDegreeOf(midi: MidiNote, key: Key): number | null {
  const pcs = keyScale(key).map((n) => mod12(toMidi(n)));
  const idx = pcs.indexOf(mod12(midi));
  return idx === -1 ? null : idx + 1;
}

/** Movable-do solfège for a scale degree in major. */
export const SOLFEGE_MAJOR = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'] as const;
/** La-based minor solfège, matching how the relative minor is taught. */
export const SOLFEGE_MINOR = ['la', 'ti', 'do', 're', 'mi', 'fa', 'sol'] as const;

export function solfege(degree: number, mode: Mode): string {
  const table = mode === 'major' ? SOLFEGE_MAJOR : SOLFEGE_MINOR;
  return table[(degree - 1) % 7] ?? '?';
}
