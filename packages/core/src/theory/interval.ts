/**
 * Intervals.
 *
 * An interval is a *number* (unison, second, third...) plus a *quality*
 * (perfect, major, minor, augmented, diminished). Both halves matter: a
 * diminished fourth and a major third span the same three semitones but are
 * different intervals, written differently, and functioning differently.
 *
 * The app teaches interval reading as the primary reading strategy, so this
 * module is on the hot path for the Reading and Ear domains.
 */

import {
  type MidiNote,
  type SpelledPitch,
  diatonicPosition,
  mod7,
  stepFromIndex,
  stepIndex,
  toMidi,
} from './pitch.js';

export type IntervalQuality =
  | 'perfect'
  | 'major'
  | 'minor'
  | 'augmented'
  | 'diminished'
  | 'doubly-augmented'
  | 'doubly-diminished';

export interface Interval {
  /** 1 = unison, 2 = second, 8 = octave, 9 = ninth. Always >= 1. */
  readonly number: number;
  readonly quality: IntervalQuality;
  /** Direction: +1 ascending, -1 descending. Unisons are +1. */
  readonly direction: 1 | -1;
}

/**
 * Numbers whose "pure" form is perfect rather than major.
 * Reduced to within an octave first: 1, 4, 5, 8 -> perfect family.
 */
function isPerfectFamily(number: number): boolean {
  const simple = mod7(number - 1) + 1;
  return simple === 1 || simple === 4 || simple === 5;
}

/** Semitones spanned by the major/perfect form of each simple interval number. */
const PURE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // index = number - 1, within an octave

function pureSemitones(number: number): number {
  const octaves = Math.floor((number - 1) / 7);
  const simpleIndex = mod7(number - 1);
  const base = PURE_SEMITONES[simpleIndex];
  if (base === undefined) throw new Error(`unreachable: bad interval number ${number}`);
  return base + octaves * 12;
}

/**
 * Semitone deviation from the pure form, mapped to a quality.
 * Perfect-family: 0 = perfect. Major-family: 0 = major, -1 = minor.
 */
function qualityFromDeviation(number: number, deviation: number): IntervalQuality {
  if (isPerfectFamily(number)) {
    switch (deviation) {
      case 0:
        return 'perfect';
      case 1:
        return 'augmented';
      case -1:
        return 'diminished';
      case 2:
        return 'doubly-augmented';
      case -2:
        return 'doubly-diminished';
      default:
        throw new Error(`interval ${number} deviation ${deviation} has no name`);
    }
  }
  switch (deviation) {
    case 0:
      return 'major';
    case -1:
      return 'minor';
    case 1:
      return 'augmented';
    case -2:
      return 'diminished';
    case 2:
      return 'doubly-augmented';
    case -3:
      return 'doubly-diminished';
    default:
      throw new Error(`interval ${number} deviation ${deviation} has no name`);
  }
}

function deviationFromQuality(number: number, quality: IntervalQuality): number {
  const perfect = isPerfectFamily(number);
  switch (quality) {
    case 'perfect':
      if (!perfect) throw new Error(`a ${number}th cannot be perfect`);
      return 0;
    case 'major':
      if (perfect) throw new Error(`a ${number}th cannot be major`);
      return 0;
    case 'minor':
      if (perfect) throw new Error(`a ${number}th cannot be minor`);
      return -1;
    case 'augmented':
      return 1;
    case 'diminished':
      return perfect ? -1 : -2;
    case 'doubly-augmented':
      return 2;
    case 'doubly-diminished':
      return perfect ? -2 : -3;
  }
}

/** Total semitones spanned, unsigned. */
export function intervalSemitones(iv: Interval): number {
  return pureSemitones(iv.number) + deviationFromQuality(iv.number, iv.quality);
}

/** Signed semitones, honoring direction. */
export function intervalSignedSemitones(iv: Interval): number {
  return intervalSemitones(iv) * iv.direction;
}

/** The interval from `a` to `b`, fully spelled. Order matters: this is directional. */
export function intervalBetween(a: SpelledPitch, b: SpelledPitch): Interval {
  const diatonicDelta = diatonicPosition(b) - diatonicPosition(a);
  const semitoneDelta = toMidi(b) - toMidi(a);

  const direction: 1 | -1 = diatonicDelta < 0 || (diatonicDelta === 0 && semitoneDelta < 0) ? -1 : 1;

  const number = Math.abs(diatonicDelta) + 1;
  const absSemitones = Math.abs(semitoneDelta);
  const deviation = absSemitones - pureSemitones(number);

  return { number, quality: qualityFromDeviation(number, deviation), direction };
}

/** Apply an interval to a pitch, producing a correctly spelled result. */
export function transpose(p: SpelledPitch, iv: Interval): SpelledPitch {
  const diatonicSteps = (iv.number - 1) * iv.direction;
  const targetDiatonic = diatonicPosition(p) + diatonicSteps;

  const step = stepFromIndex(mod7(targetDiatonic));
  const octave = Math.floor(targetDiatonic / 7);

  const targetMidi = toMidi(p) + intervalSignedSemitones(iv);
  // `alter` is whatever it takes to make the chosen letter reach the target pitch.
  const natural = toMidi({ step, alter: 0, octave });
  return { step, alter: targetMidi - natural, octave };
}

/** Transpose by a plain semitone count, choosing spelling by preference. */
export function transposeSemitones(midi: MidiNote, semitones: number): MidiNote {
  return midi + semitones;
}

const QUALITY_ABBREV: Record<IntervalQuality, string> = {
  perfect: 'P',
  major: 'M',
  minor: 'm',
  augmented: 'A',
  diminished: 'd',
  'doubly-augmented': 'AA',
  'doubly-diminished': 'dd',
};

const QUALITY_WORD: Record<IntervalQuality, string> = {
  perfect: 'perfect',
  major: 'major',
  minor: 'minor',
  augmented: 'augmented',
  diminished: 'diminished',
  'doubly-augmented': 'doubly augmented',
  'doubly-diminished': 'doubly diminished',
};

const ORDINALS = [
  '',
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
];

/** Compact form: "P5", "m3", "A4". */
export function intervalAbbrev(iv: Interval): string {
  return `${QUALITY_ABBREV[iv.quality]}${iv.number}`;
}

/** Spoken form: "perfect fifth", "minor third". */
export function intervalName(iv: Interval): string {
  const ord = ORDINALS[iv.number] ?? `${iv.number}th`;
  return `${QUALITY_WORD[iv.quality]} ${ord}`;
}

/** Parse "P5", "m3", "A4", "d7". Returns null on malformed input. */
export function parseInterval(text: string, direction: 1 | -1 = 1): Interval | null {
  const m = /^(P|M|m|A{1,2}|d{1,2})(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const [, q, n] = m;
  if (!q || !n) return null;

  const number = Number(n);
  const quality = (Object.keys(QUALITY_ABBREV) as IntervalQuality[]).find(
    (k) => QUALITY_ABBREV[k] === q,
  );
  if (!quality) return null;

  // Reject combinations that do not exist, e.g. "P3" or "M5".
  try {
    deviationFromQuality(number, quality);
  } catch {
    return null;
  }
  return { number, quality, direction };
}

/** Convenience constructor. Throws on impossible combinations like a perfect third. */
export function interval(
  number: number,
  quality: IntervalQuality,
  direction: 1 | -1 = 1,
): Interval {
  deviationFromQuality(number, quality); // validates
  return { number, quality, direction };
}

/**
 * Simple (within-octave) form of a compound interval.
 * A major tenth becomes a major third; the octave displacement is discarded.
 */
export function simplify(iv: Interval): Interval {
  if (iv.number <= 8) return iv;
  const simple = mod7(iv.number - 1) + 1;
  return { number: simple, quality: iv.quality, direction: iv.direction };
}

/**
 * The interval that, stacked on top of this one, completes an octave.
 * Majors invert to minors, augmenteds to diminisheds, perfects stay perfect,
 * and the numbers sum to 9. Used for teaching inversion and for chord analysis.
 */
export function invert(iv: Interval): Interval {
  const simple = simplify(iv);
  const number = 9 - simple.number;
  const inverted: Record<IntervalQuality, IntervalQuality> = {
    perfect: 'perfect',
    major: 'minor',
    minor: 'major',
    augmented: 'diminished',
    diminished: 'augmented',
    'doubly-augmented': 'doubly-diminished',
    'doubly-diminished': 'doubly-augmented',
  };
  return { number, quality: inverted[simple.quality], direction: simple.direction };
}

/** Is this interval consonant in common-practice terms? Used for ear-training ladders. */
export function isConsonant(iv: Interval): boolean {
  const s = simplify(iv);
  const key = intervalAbbrev(s);
  return ['P1', 'm3', 'M3', 'P5', 'm6', 'M6', 'P8'].includes(key);
}

/**
 * Interval identified purely by semitone distance, with no spelling context.
 * This is what ear training uses: the listener hears semitones, not spelling.
 */
export function intervalFromSemitones(semitones: number, direction: 1 | -1 = 1): Interval {
  const abs = Math.abs(semitones);
  const octaves = Math.floor(abs / 12);
  const simple = abs % 12;
  // Canonical spelling for each semitone count, preferring the common name.
  const table: Array<[number, IntervalQuality]> = [
    [1, 'perfect'], // 0  unison
    [2, 'minor'], // 1  m2
    [2, 'major'], // 2  M2
    [3, 'minor'], // 3  m3
    [3, 'major'], // 4  M3
    [4, 'perfect'], // 5  P4
    [4, 'augmented'], // 6  tritone -> A4 by convention
    [5, 'perfect'], // 7  P5
    [6, 'minor'], // 8  m6
    [6, 'major'], // 9  M6
    [7, 'minor'], // 10 m7
    [7, 'major'], // 11 M7
  ];
  const entry = table[simple];
  if (!entry) throw new Error(`unreachable: bad semitone count ${semitones}`);
  const [baseNumber, quality] = entry;
  return { number: baseNumber + octaves * 7, quality, direction };
}

export { stepIndex };
