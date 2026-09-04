/**
 * Pitch representation.
 *
 * Two representations coexist deliberately:
 *   - `MidiNote`: a number 0-127. What hardware speaks. Enharmonically ambiguous.
 *   - `SpelledPitch`: letter + accidental + octave. What notation speaks. C#4 and Db4
 *     are the same MidiNote but different SpelledPitches, and the difference is
 *     musically real — it determines how the note is written, which key it implies,
 *     and how intervals from it are named.
 *
 * Almost every bug in a naive theory engine comes from collapsing the second into
 * the first too early. We keep them separate all the way through.
 */

/** MIDI note number. Middle C (C4) is 60. */
export type MidiNote = number;

/** Pitch class, 0-11, where 0 is C. Octave-invariant. */
export type PitchClass = number;

/** The seven letter names, in diatonic order from C. */
export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Step = (typeof STEPS)[number];

/**
 * A pitch as it would be written on a staff.
 * `alter` is in semitones: -1 flat, +1 sharp, -2 double flat, etc.
 * `octave` follows scientific pitch notation (C4 = middle C = MIDI 60).
 */
export interface SpelledPitch {
  readonly step: Step;
  readonly alter: number;
  readonly octave: number;
}

/** Semitones above C for each natural letter. */
const STEP_SEMITONES: Record<Step, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Diatonic index (0-6) for each letter. Used for interval-number arithmetic. */
const STEP_INDEX: Record<Step, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

export function stepSemitones(step: Step): number {
  return STEP_SEMITONES[step];
}

export function stepIndex(step: Step): number {
  return STEP_INDEX[step];
}

export function stepFromIndex(index: number): Step {
  const s = STEPS[((index % 7) + 7) % 7];
  if (!s) throw new Error(`unreachable: bad step index ${index}`);
  return s;
}

/** Convert a spelled pitch to its MIDI number. Total; may fall outside 0-127. */
export function toMidi(p: SpelledPitch): MidiNote {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

/** Pitch class of a spelled pitch, normalized to 0-11. */
export function pitchClassOf(p: SpelledPitch): PitchClass {
  return mod12(STEP_SEMITONES[p.step] + p.alter);
}

/**
 * "Diatonic position": octave*7 + step index. A single integer that orders pitches
 * by staff position regardless of accidental. Interval numbers are differences of
 * this value, which is why it is worth naming.
 */
export function diatonicPosition(p: SpelledPitch): number {
  return p.octave * 7 + STEP_INDEX[p.step];
}

export function mod12(n: number): PitchClass {
  return ((n % 12) + 12) % 12;
}

export function mod7(n: number): number {
  return ((n % 7) + 7) % 7;
}

/** Accidental glyph for an alter value. Uses real Unicode musical symbols. */
export function accidentalGlyph(alter: number): string {
  switch (alter) {
    case 0:
      return '';
    case 1:
      return '♯'; // sharp
    case -1:
      return '♭'; // flat
    case 2:
      // Prefer 'x' over U+1D12A; the SMuFL codepoint is missing from most
      // system fonts and renders as tofu on the tablet.
      return 'x';
    case -2:
      return '\u266d\u266d';
    default:
      return alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
  }
}

/** ASCII accidental, for ids, parsing round-trips, and chord symbols. */
export function accidentalAscii(alter: number): string {
  if (alter === 0) return '';
  return alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
}

/** Display name without octave, e.g. "F♯". */
export function pitchName(p: SpelledPitch): string {
  return `${p.step}${accidentalGlyph(p.alter)}`;
}

/** Display name with octave, e.g. "F♯4". */
export function pitchNameWithOctave(p: SpelledPitch): string {
  return `${pitchName(p)}${p.octave}`;
}

/** Stable ASCII id, e.g. "F#4". Safe for object keys and URLs. */
export function pitchId(p: SpelledPitch): string {
  return `${p.step}${accidentalAscii(p.alter)}${p.octave}`;
}

/**
 * Parse scientific pitch notation: "C4", "F#3", "Bb5", "Cx4" (double sharp),
 * "Dbb2". Returns null on malformed input rather than throwing, because this
 * parses user- and content-authored strings.
 */
export function parsePitch(text: string): SpelledPitch | null {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|x|♯{1,2}|♭{1,2}|)(-?\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const [, rawStep, rawAlter, rawOctave] = m;
  if (!rawStep || rawOctave === undefined) return null;

  const step = rawStep.toUpperCase() as Step;
  let alter = 0;
  if (rawAlter === 'x') alter = 2;
  else if (rawAlter) {
    const sign = rawAlter[0] === '#' || rawAlter[0] === '♯' ? 1 : -1;
    alter = sign * rawAlter.length;
  }
  return { step, alter, octave: Number(rawOctave) };
}

/**
 * Spell a MIDI note using a preferred accidental direction.
 *
 * This is the lossy direction (MIDI carries no spelling), so it is only correct
 * in the absence of a key context. Where a key is known, prefer `spellInKey`
 * from ./key.ts, which produces the spelling a musician would actually write.
 */
export function spellMidi(midi: MidiNote, prefer: 'sharp' | 'flat' = 'sharp'): SpelledPitch {
  const pc = mod12(midi);
  const octave = Math.floor(midi / 12) - 1;

  const naturalStep = (Object.keys(STEP_SEMITONES) as Step[]).find(
    (s) => STEP_SEMITONES[s] === pc,
  );
  if (naturalStep) return { step: naturalStep, alter: 0, octave };

  if (prefer === 'sharp') {
    const below = (Object.keys(STEP_SEMITONES) as Step[]).find(
      (s) => STEP_SEMITONES[s] === mod12(pc - 1),
    );
    if (!below) throw new Error(`unreachable: no step below pc ${pc}`);
    return { step: below, alter: 1, octave };
  }

  const above = (Object.keys(STEP_SEMITONES) as Step[]).find(
    (s) => STEP_SEMITONES[s] === mod12(pc + 1),
  );
  if (!above) throw new Error(`unreachable: no step above pc ${pc}`);
  // B#/Cb cross the octave boundary; the octave of the *spelling* is what matters.
  const oct = above === 'C' ? octave + 1 : octave;
  return { step: above, alter: -1, octave: oct };
}

/** Build a spelled pitch from a step/alter at the octave that lands nearest `nearMidi`. */
export function spellNear(step: Step, alter: number, nearMidi: MidiNote): SpelledPitch {
  const baseOctave = Math.floor(nearMidi / 12) - 1;
  let best: SpelledPitch | null = null;
  let bestDist = Infinity;
  for (const oct of [baseOctave - 1, baseOctave, baseOctave + 1]) {
    const cand: SpelledPitch = { step, alter, octave: oct };
    const d = Math.abs(toMidi(cand) - nearMidi);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  if (!best) throw new Error('unreachable: spellNear found no candidate');
  return best;
}

/** True when two spellings sound the same but are written differently (C# vs Db). */
export function isEnharmonic(a: SpelledPitch, b: SpelledPitch): boolean {
  return toMidi(a) === toMidi(b) && a.step !== b.step;
}

/** Note name for a MIDI number, ignoring spelling nuance. Debug/display only. */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiToSharpName(midi: MidiNote): string {
  const n = SHARP_NAMES[mod12(midi)];
  if (!n) throw new Error(`unreachable: bad pitch class for midi ${midi}`);
  return `${n}${Math.floor(midi / 12) - 1}`;
}

/** Standard 88-key piano range: A0 (21) to C8 (108). */
export const PIANO_LOWEST: MidiNote = 21;
export const PIANO_HIGHEST: MidiNote = 108;

export function isOnPiano(midi: MidiNote): boolean {
  return midi >= PIANO_LOWEST && midi <= PIANO_HIGHEST;
}

/** True for the black keys. Useful for keyboard rendering and drill filtering. */
export function isBlackKey(midi: MidiNote): boolean {
  return [1, 3, 6, 8, 10].includes(mod12(midi));
}
