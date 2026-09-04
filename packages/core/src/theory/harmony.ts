/**
 * Functional harmony: diatonic chords, Roman numerals, cadences, progressions.
 *
 * This is the module that turns "notes" into "meaning". The app's ear training
 * is deliberately *functional* — it asks which scale degree or which Roman
 * numeral, not which absolute interval — because that is the skill that lets a
 * player work out a song by ear, and it is the one consumer apps skip.
 */

import {
  type SpelledPitch, mod12, mod7, stepIndex, toMidi,
} from './pitch';
import {
  type Chord, type ChordQuality, chordSymbol, chordTones, inversionFigure,
} from './chord';
import { type Key, keyScale, scaleNotes } from './scale';

/** Triad qualities on each degree of a major key. */
const MAJOR_TRIADS: ChordQuality[] = [
  'major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished',
];
/** Seventh-chord qualities on each degree of a major key. */
const MAJOR_SEVENTHS: ChordQuality[] = [
  'major7', 'minor7', 'minor7', 'major7', 'dominant7', 'minor7', 'minor7b5',
];
/** Natural minor. The harmonic-minor V and vii° are handled separately. */
const MINOR_TRIADS: ChordQuality[] = [
  'minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major',
];
const MINOR_SEVENTHS: ChordQuality[] = [
  'minorMajor7', 'minor7b5', 'major7', 'minor7', 'minor7', 'major7', 'dominant7',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export interface HarmonicOptions {
  /** Use the harmonic-minor V and vii° rather than the natural-minor v and VII. */
  readonly raisedLeadingTone?: boolean;
}

/** Raise a root by a chromatic semitone, keeping its letter name. */
function raiseRoot(root: SpelledPitch | undefined): SpelledPitch {
  if (!root) throw new Error('unreachable: missing scale degree');
  return { ...root, alter: root.alter + 1 };
}

/** The seven diatonic triads of a key, in degree order. */
export function diatonicTriads(key: Key, opts: HarmonicOptions = {}): Chord[] {
  const roots = [...keyScale(key)];
  const qualities =
    key.mode === 'major' ? [...MAJOR_TRIADS] : [...MINOR_TRIADS];

  if (key.mode === 'minor' && opts.raisedLeadingTone) {
    qualities[4] = 'major'; // V instead of v
    qualities[6] = 'diminished'; // vii° instead of VII
    // The leading tone is raised in the chord *root* as well: in A harmonic
    // minor the seventh-degree chord is G♯dim, not Gdim. Changing only the
    // quality would leave the root a whole step below the tonic and lose the
    // leading-tone pull that is the entire point of harmonic minor.
    roots[6] = raiseRoot(roots[6]);
  }

  return roots.map((root, i) => {
    const q = qualities[i];
    if (!q) throw new Error('unreachable: missing diatonic quality');
    return { root, quality: q, inversion: 0 };
  });
}

/** The seven diatonic seventh chords of a key. */
export function diatonicSevenths(key: Key, opts: HarmonicOptions = {}): Chord[] {
  const roots = [...keyScale(key)];
  const qualities =
    key.mode === 'major' ? [...MAJOR_SEVENTHS] : [...MINOR_SEVENTHS];

  if (key.mode === 'minor' && opts.raisedLeadingTone) {
    qualities[4] = 'dominant7'; // V7
    qualities[6] = 'diminished7'; // vii°7
    roots[6] = raiseRoot(roots[6]);
  }

  return roots.map((root, i) => {
    const q = qualities[i];
    if (!q) throw new Error('unreachable: missing diatonic quality');
    return { root, quality: q, inversion: 0 };
  });
}

/** The chord built on a given scale degree (1-7). */
export function chordOnDegree(
  key: Key,
  degree: number,
  seventh = false,
  opts: HarmonicOptions = {},
): Chord {
  const chords = seventh ? diatonicSevenths(key, opts) : diatonicTriads(key, opts);
  const c = chords[(degree - 1) % 7];
  if (!c) throw new Error(`no chord on degree ${degree}`);
  return c;
}

/**
 * Which scale degree a chord root sits on, plus how far it is bent from the
 * diatonic version of that degree.
 *
 * Degree comes from the *letter*, chromatic alteration from the semitones. That
 * split is what lets an E♭ chord in C major be read as ♭III rather than as some
 * unrelated sharp-side degree.
 */
function degreeAndAlteration(root: SpelledPitch, key: Key): { degree: number; alter: number } {
  const tonicLetter = stepIndex(key.tonic.step);
  const rootLetter = stepIndex(root.step);
  const degree = mod7(rootLetter - tonicLetter) + 1;

  const diatonic = keyScale(key)[degree - 1];
  if (!diatonic) throw new Error('unreachable: degree out of range');

  // Compare pitch classes so octave placement never matters.
  const diatonicPc = mod12(toMidi(diatonic));
  const rootPc = mod12(toMidi(root));
  let alter = rootPc - diatonicPc;
  if (alter > 6) alter -= 12;
  if (alter < -6) alter += 12;

  return { degree, alter };
}

function alterationPrefix(alter: number): string {
  if (alter === 0) return '';
  return alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
}

/**
 * Minor and diminished chords take a lowercase numeral; everything else is
 * uppercase. This is the convention that lets `vi` and `VI` carry real meaning
 * rather than being decoration.
 */
const LOWERCASE_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  'minor', 'minor7', 'minor6', 'minor9', 'minorMajor7', 'minor7b5',
  'diminished', 'diminished7',
]);

function isUppercase(quality: ChordQuality): boolean {
  return !LOWERCASE_QUALITIES.has(quality);
}

/** Symbol appended to the numeral for non-triadic or altered qualities. */
function qualityMark(quality: ChordQuality): string {
  switch (quality) {
    case 'diminished': return '°';
    case 'diminished7': return '°7';
    case 'minor7b5': return 'ø7';
    case 'augmented': return '+';
    case 'augmented7': return '+7';
    case 'major7': return 'maj7';
    case 'dominant7': return '7';
    case 'minor7': return '7';
    case 'minorMajor7': return 'maj7';
    case 'major6': return '6';
    case 'minor6': return '6';
    case 'sus2': return 'sus2';
    case 'sus4': return 'sus4';
    case 'dominant9': return '9';
    case 'major9': return 'maj9';
    case 'minor9': return '9';
    default: return '';
  }
}

/**
 * Roman-numeral analysis of a chord within a key.
 *
 * Handles diatonic chords, chromatic alterations (♭III, ♯iv°), and inversions
 * via figured bass. Secondary dominants are detected separately by
 * `secondaryDominantOf`, since they need a target, not just a root.
 */
export function romanNumeral(chord: Chord, key: Key): string {
  const { degree, alter } = degreeAndAlteration(chord.root, key);
  const base = ROMAN[degree - 1];
  if (!base) throw new Error('unreachable: bad degree');

  const numeral = isUppercase(chord.quality) ? base : base.toLowerCase();
  const figure = chord.inversion > 0 ? inversionFigure(chord.quality, chord.inversion) : '';
  const mark = qualityMark(chord.quality);

  // A seventh chord in root position already says "7" via its mark; in
  // inversion the figured bass carries it instead.
  const tail = chord.inversion > 0 ? figure : mark;
  return `${alterationPrefix(alter)}${numeral}${tail}`;
}

/**
 * If this chord acts as a secondary dominant in the key, name its target.
 * Returns e.g. "V/V" or "V7/vi", or null when it is not functioning that way.
 */
export function secondaryDominantOf(chord: Chord, key: Key): string | null {
  if (chord.quality !== 'dominant7' && chord.quality !== 'major') return null;

  const diatonic = diatonicTriads(key);
  const rootPc = mod12(toMidi(chord.root));

  // A plain diatonic major triad is not acting as a secondary dominant, even
  // though C major is technically V/IV in C. Only chords foreign to the key
  // (or the seventh chords built on them) get that reading.
  if (chord.quality === 'major') {
    const isDiatonic = diatonic.some(
      (d) => d.quality === 'major' && mod12(toMidi(d.root)) === rootPc,
    );
    if (isDiatonic) return null;
  }

  for (let i = 0; i < diatonic.length; i++) {
    const target = diatonic[i];
    if (!target) continue;
    // Skip the tonic: the dominant of I is simply V, not V/I.
    if (i === 0) continue;

    const targetPc = mod12(toMidi(target.root));
    // A dominant sits a perfect fifth above its target.
    if (mod12(targetPc + 7) !== rootPc) continue;

    const targetNumeral = romanNumeral(target, key);
    const label = chord.quality === 'dominant7' ? 'V7' : 'V';
    return `${label}/${targetNumeral}`;
  }
  return null;
}

/** Parse a Roman numeral into a concrete chord in a key. Supports ♭/♯ prefixes. */
export function chordFromRomanNumeral(numeral: string, key: Key): Chord | null {
  const m = /^([b♭#♯]*)([ivxIVX]+)(.*)$/.exec(numeral.trim());
  if (!m) return null;
  const [, prefix, roman, tail] = m;
  if (!roman) return null;

  const upper = roman.toUpperCase();
  const degreeIdx = ROMAN.indexOf(upper as (typeof ROMAN)[number]);
  if (degreeIdx === -1) return null;

  const alter = !prefix ? 0
    : prefix[0] === 'b' || prefix[0] === '♭' ? -prefix.length : prefix.length;

  const isMinorNumeral = roman === roman.toLowerCase();
  const scale = keyScale(key);
  const diatonicRoot = scale[degreeIdx];
  if (!diatonicRoot) return null;

  const root: SpelledPitch = { ...diatonicRoot, alter: diatonicRoot.alter + alter };

  let quality: ChordQuality;
  const t = tail ?? '';
  if (t.includes('ø')) quality = 'minor7b5';
  else if (t.includes('°7')) quality = 'diminished7';
  else if (t.includes('°')) quality = 'diminished';
  else if (t.includes('+')) quality = 'augmented';
  else if (t.includes('maj7')) quality = isMinorNumeral ? 'minorMajor7' : 'major7';
  else if (t.includes('7')) quality = isMinorNumeral ? 'minor7' : 'dominant7';
  else if (t.includes('sus4')) quality = 'sus4';
  else if (t.includes('sus2')) quality = 'sus2';
  else if (t.includes('6')) quality = isMinorNumeral ? 'minor6' : 'major6';
  else quality = isMinorNumeral ? 'minor' : 'major';

  return { root, quality, inversion: 0 };
}

// ---------------------------------------------------------------------------
// Cadences and progressions
// ---------------------------------------------------------------------------

export type CadenceType = 'authentic' | 'plagal' | 'half' | 'deceptive';

/** Roman numerals of each cadence type. Used to establish a key by ear. */
export const CADENCES: Record<CadenceType, string[]> = {
  authentic: ['I', 'IV', 'V', 'I'],
  plagal: ['I', 'IV', 'I'],
  half: ['I', 'ii', 'V'],
  deceptive: ['I', 'IV', 'V', 'vi'],
};

export interface ProgressionTemplate {
  readonly id: string;
  readonly name: string;
  readonly numerals: readonly string[];
  readonly mode: 'major' | 'minor' | 'either';
  /** Rough ordering for the Progression Detective difficulty ladder. */
  readonly difficulty: number;
}

/**
 * Progressions worth recognizing by ear, roughly ordered by how often a
 * self-taught player will actually run into them.
 */
export const PROGRESSIONS: ProgressionTemplate[] = [
  { id: 'I-V-vi-IV', name: 'Pop axis', numerals: ['I', 'V', 'vi', 'IV'], mode: 'major', difficulty: 1 },
  { id: 'I-IV-V-I', name: 'Primary triads', numerals: ['I', 'IV', 'V', 'I'], mode: 'major', difficulty: 1 },
  { id: 'vi-IV-I-V', name: 'Axis rotation', numerals: ['vi', 'IV', 'I', 'V'], mode: 'major', difficulty: 2 },
  { id: 'I-vi-IV-V', name: 'Fifties doo-wop', numerals: ['I', 'vi', 'IV', 'V'], mode: 'major', difficulty: 2 },
  { id: 'ii-V-I', name: 'Two-five-one', numerals: ['ii', 'V', 'I'], mode: 'major', difficulty: 2 },
  { id: 'i-VI-III-VII', name: 'Minor axis', numerals: ['i', 'VI', 'III', 'VII'], mode: 'minor', difficulty: 3 },
  { id: 'I-iii-IV-V', name: 'Rising third', numerals: ['I', 'iii', 'IV', 'V'], mode: 'major', difficulty: 3 },
  { id: 'i-iv-V-i', name: 'Harmonic minor cadence', numerals: ['i', 'iv', 'V', 'i'], mode: 'minor', difficulty: 3 },
  { id: 'I-V-vi-iii-IV-I-IV-V', name: 'Pachelbel', numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], mode: 'major', difficulty: 4 },
  { id: 'ii-V-I-vi', name: 'Turnaround', numerals: ['ii', 'V', 'I', 'vi'], mode: 'major', difficulty: 4 },
  { id: 'I-VofV-V-I', name: 'Secondary dominant', numerals: ['I', 'II7', 'V', 'I'], mode: 'major', difficulty: 5 },
  { id: 'I-bVII-IV-I', name: 'Mixolydian rock', numerals: ['I', 'bVII', 'IV', 'I'], mode: 'major', difficulty: 5 },
  { id: 'i-bVI-bVII-i', name: 'Aeolian rock', numerals: ['i', 'bVI', 'bVII', 'i'], mode: 'minor', difficulty: 5 },
  { id: 'I-iv-I', name: 'Borrowed minor iv', numerals: ['I', 'iv', 'I'], mode: 'major', difficulty: 6 },
];

/** Realize a progression's numerals as concrete chords in a key. */
export function realizeProgression(
  numerals: readonly string[],
  key: Key,
): Chord[] {
  const out: Chord[] = [];
  for (const n of numerals) {
    const c = chordFromRomanNumeral(n, key);
    if (c) out.push(c);
  }
  return out;
}

/** Human-readable summary of a chord in a key: "G7 — V7 in C major". */
export function describeChordInKey(chord: Chord, key: Key): string {
  const secondary = secondaryDominantOf(chord, key);
  const rn = secondary ?? romanNumeral(chord, key);
  return `${chordSymbol(chord)} — ${rn}`;
}
