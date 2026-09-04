/**
 * Chords: construction, spelling, inversion, symbol parsing, and detection.
 *
 * Chord Sprint — the flagship Phase 1 drill — lives on this module, and so does
 * the Free Play analyzer. Both need the same thing: a chord symbol and a set of
 * pitches must round-trip into each other reliably.
 *
 * Chord tones are defined as [diatonicOffset, semitoneOffset] pairs, the same
 * shape scales use, so a C7 spells its seventh as B♭ (a seventh above C) rather
 * than A♯. On a staff that distinction is the whole ballgame.
 */

import {
  type MidiNote,
  type SpelledPitch,
  mod12,
  mod7,
  stepFromIndex,
  stepIndex,
  toMidi,
} from './pitch';

export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'sus2' | 'sus4'
  | 'major7' | 'dominant7' | 'minor7' | 'minor7b5' | 'diminished7'
  | 'minorMajor7' | 'augmented7' | 'augmentedMajor7'
  | 'major6' | 'minor6'
  | 'dominant9' | 'major9' | 'minor9'
  | 'dominant11' | 'dominant13'
  | 'dominant7b9' | 'dominant7sharp9' | 'dominant7sharp5' | 'dominant7b5';

type ToneTable = ReadonlyArray<readonly [number, number]>;

/** [diatonicOffset from root, semitones from root] for every chord tone. */
const CHORD_TONES: Record<ChordQuality, ToneTable> = {
  major: [[0, 0], [2, 4], [4, 7]],
  minor: [[0, 0], [2, 3], [4, 7]],
  diminished: [[0, 0], [2, 3], [4, 6]],
  augmented: [[0, 0], [2, 4], [4, 8]],
  sus2: [[0, 0], [1, 2], [4, 7]],
  sus4: [[0, 0], [3, 5], [4, 7]],

  major7: [[0, 0], [2, 4], [4, 7], [6, 11]],
  dominant7: [[0, 0], [2, 4], [4, 7], [6, 10]],
  minor7: [[0, 0], [2, 3], [4, 7], [6, 10]],
  minor7b5: [[0, 0], [2, 3], [4, 6], [6, 10]],
  diminished7: [[0, 0], [2, 3], [4, 6], [6, 9]],
  minorMajor7: [[0, 0], [2, 3], [4, 7], [6, 11]],
  augmented7: [[0, 0], [2, 4], [4, 8], [6, 10]],
  augmentedMajor7: [[0, 0], [2, 4], [4, 8], [6, 11]],

  major6: [[0, 0], [2, 4], [4, 7], [5, 9]],
  minor6: [[0, 0], [2, 3], [4, 7], [5, 9]],

  dominant9: [[0, 0], [2, 4], [4, 7], [6, 10], [8, 14]],
  major9: [[0, 0], [2, 4], [4, 7], [6, 11], [8, 14]],
  minor9: [[0, 0], [2, 3], [4, 7], [6, 10], [8, 14]],
  dominant11: [[0, 0], [2, 4], [4, 7], [6, 10], [8, 14], [10, 17]],
  dominant13: [[0, 0], [2, 4], [4, 7], [6, 10], [8, 14], [12, 21]],

  dominant7b9: [[0, 0], [2, 4], [4, 7], [6, 10], [8, 13]],
  dominant7sharp9: [[0, 0], [2, 4], [4, 7], [6, 10], [8, 15]],
  dominant7sharp5: [[0, 0], [2, 4], [4, 8], [6, 10]],
  dominant7b5: [[0, 0], [2, 4], [4, 6], [6, 10]],
};

/** Suffix written after the root, e.g. the "m7" of "Dm7". */
const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: '', minor: 'm', diminished: 'dim', augmented: 'aug',
  sus2: 'sus2', sus4: 'sus4',
  major7: 'maj7', dominant7: '7', minor7: 'm7', minor7b5: 'm7♭5',
  diminished7: 'dim7', minorMajor7: 'mMaj7', augmented7: '7♯5', augmentedMajor7: 'maj7♯5',
  major6: '6', minor6: 'm6',
  dominant9: '9', major9: 'maj9', minor9: 'm9',
  dominant11: '11', dominant13: '13',
  dominant7b9: '7♭9', dominant7sharp9: '7♯9', dominant7sharp5: '7♯5', dominant7b5: '7♭5',
};

const QUALITY_LABEL: Record<ChordQuality, string> = {
  major: 'major', minor: 'minor', diminished: 'diminished', augmented: 'augmented',
  sus2: 'suspended 2nd', sus4: 'suspended 4th',
  major7: 'major 7th', dominant7: 'dominant 7th', minor7: 'minor 7th',
  minor7b5: 'half-diminished 7th', diminished7: 'fully diminished 7th',
  minorMajor7: 'minor-major 7th', augmented7: 'augmented 7th',
  augmentedMajor7: 'augmented major 7th',
  major6: 'major 6th', minor6: 'minor 6th',
  dominant9: 'dominant 9th', major9: 'major 9th', minor9: 'minor 9th',
  dominant11: 'dominant 11th', dominant13: 'dominant 13th',
  dominant7b9: 'dominant 7♭9', dominant7sharp9: 'dominant 7♯9',
  dominant7sharp5: 'dominant 7♯5', dominant7b5: 'dominant 7♭5',
};

export interface Chord {
  readonly root: SpelledPitch;
  readonly quality: ChordQuality;
  /** 0 = root position, 1 = first inversion, and so on. */
  readonly inversion: number;
  /** Explicit bass for slash chords, when it is not a chord tone. */
  readonly bass?: SpelledPitch;
}

export function chordToneCount(quality: ChordQuality): number {
  return CHORD_TONES[quality].length;
}

export function qualityLabel(quality: ChordQuality): string {
  return QUALITY_LABEL[quality];
}

/** Spell a chord's tones in root position, ascending from the root. */
export function chordTones(root: SpelledPitch, quality: ChordQuality): SpelledPitch[] {
  const rootDiatonic = stepIndex(root.step);
  const rootMidi = toMidi(root);

  return CHORD_TONES[quality].map(([diatonicOffset, semitoneOffset]) => {
    const stepIdx = mod7(rootDiatonic + diatonicOffset);
    const step = stepFromIndex(stepIdx);
    const octave = root.octave + Math.floor((rootDiatonic + diatonicOffset) / 7);
    const natural = toMidi({ step, alter: 0, octave });
    return { step, alter: rootMidi + semitoneOffset - natural, octave };
  });
}

/**
 * Voice a chord as actual MIDI notes, applying inversion.
 *
 * Inversion moves the lowest N tones up an octave, which is what a pianist
 * physically does. A slash bass, when present, is added below everything.
 */
export function chordVoicing(chord: Chord): MidiNote[] {
  const tones = chordTones(chord.root, chord.quality).map(toMidi);
  const n = tones.length;
  const inv = ((chord.inversion % n) + n) % n;

  const voiced = tones.map((m, i) => (i < inv ? m + 12 : m));
  voiced.sort((a, b) => a - b);

  if (chord.bass) {
    const bassMidi = toMidi(chord.bass);
    const lowest = voiced[0];
    if (lowest === undefined) return [bassMidi];
    // Seat the slash bass below the rest of the voicing.
    let b = bassMidi;
    while (b >= lowest) b -= 12;
    return [b, ...voiced];
  }
  return voiced;
}

/** Pitch classes of a chord, order- and octave-independent. Used for matching. */
export function chordPitchClasses(root: SpelledPitch, quality: ChordQuality): number[] {
  const rootPc = mod12(toMidi(root));
  return CHORD_TONES[quality].map(([, semis]) => mod12(rootPc + semis));
}

/** The chord tone that sits in the bass for a given inversion. */
export function bassNoteOf(chord: Chord): SpelledPitch {
  if (chord.bass) return chord.bass;
  const tones = chordTones(chord.root, chord.quality);
  const t = tones[chord.inversion % tones.length];
  if (!t) throw new Error('unreachable: chord has no tones');
  return t;
}

/** Figured-bass shorthand for an inversion, e.g. "6", "6/4", "4/2". */
export function inversionFigure(quality: ChordQuality, inversion: number): string {
  const isSeventh = chordToneCount(quality) >= 4;
  if (isSeventh) {
    return ['7', '6/5', '4/3', '4/2'][inversion] ?? '';
  }
  return ['', '6', '6/4'][inversion] ?? '';
}

function rootAscii(p: SpelledPitch): string {
  const acc = p.alter === 0 ? '' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return `${p.step}${acc}`;
}

function rootDisplay(p: SpelledPitch): string {
  const acc = p.alter === 0 ? '' : p.alter > 0 ? '♯'.repeat(p.alter) : '♭'.repeat(-p.alter);
  return `${p.step}${acc}`;
}

/** Rendered chord symbol, e.g. "F♯m7", "C/E", "Dm7♭5". */
export function chordSymbol(chord: Chord): string {
  const base = `${rootDisplay(chord.root)}${QUALITY_SUFFIX[chord.quality]}`;
  const bass = bassNoteOf(chord);
  const isRootPosition = chord.inversion === 0 && !chord.bass;
  return isRootPosition ? base : `${base}/${rootDisplay(bass)}`;
}

/** Stable ASCII id for storage and comparison, e.g. "F#m7/A". */
export function chordId(chord: Chord): string {
  const base = `${rootAscii(chord.root)}${QUALITY_SUFFIX[chord.quality]
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')}`;
  const bass = bassNoteOf(chord);
  const isRootPosition = chord.inversion === 0 && !chord.bass;
  return isRootPosition ? base : `${base}/${rootAscii(bass)}`;
}

/**
 * Parse a chord symbol: "C", "Am", "F#m7", "Bbmaj7", "G7/B", "Dsus4".
 *
 * Longest-suffix-first matching, otherwise "m" would shadow "maj7" and "m7b5".
 */
export function parseChordSymbol(text: string): Chord | null {
  const trimmed = text.trim().replace(/♭/g, 'b').replace(/♯/g, '#');
  const slash = trimmed.split('/');
  const main = slash[0];
  if (!main) return null;

  const rootMatch = /^([A-Ga-g])(#{1,2}|b{1,2})?/.exec(main);
  if (!rootMatch) return null;
  const [, rawStep, rawAcc] = rootMatch;
  if (!rawStep) return null;

  const root: SpelledPitch = {
    step: rawStep.toUpperCase() as SpelledPitch['step'],
    alter: !rawAcc ? 0 : rawAcc[0] === '#' ? rawAcc.length : -rawAcc.length,
    octave: 4,
  };

  const suffix = main.slice(rootMatch[0].length);
  const asciiSuffix = (q: ChordQuality) =>
    QUALITY_SUFFIX[q].replace(/♭/g, 'b').replace(/♯/g, '#');

  const qualities = (Object.keys(CHORD_TONES) as ChordQuality[]).sort(
    (a, b) => asciiSuffix(b).length - asciiSuffix(a).length,
  );
  // Accept a few common aliases beyond the canonical suffix.
  const aliases: Record<string, ChordQuality> = {
    '': 'major', M: 'major', maj: 'major', '-': 'minor', min: 'minor',
    'ø': 'minor7b5', 'm7b5': 'minor7b5', 'o': 'diminished', 'o7': 'diminished7',
    '°': 'diminished', '°7': 'diminished7', '+': 'augmented', 'M7': 'major7',
    'Δ': 'major7', 'Δ7': 'major7',
  };

  let quality: ChordQuality | null = null;
  if (suffix in aliases) {
    quality = aliases[suffix] ?? null;
  } else {
    quality = qualities.find((q) => asciiSuffix(q) === suffix) ?? null;
  }
  if (!quality) return null;

  if (slash.length > 1 && slash[1]) {
    const bassMatch = /^([A-Ga-g])(#{1,2}|b{1,2})?$/.exec(slash[1]);
    if (!bassMatch) return null;
    const [, bStep, bAcc] = bassMatch;
    if (!bStep) return null;
    const bass: SpelledPitch = {
      step: bStep.toUpperCase() as SpelledPitch['step'],
      alter: !bAcc ? 0 : bAcc[0] === '#' ? bAcc.length : -bAcc.length,
      octave: 3,
    };
    // If the slash bass is a chord tone, express it as an inversion instead —
    // "C/E" is a first-inversion C, not a C with a foreign bass.
    const tones = chordTones(root, quality);
    const idx = tones.findIndex((t) => mod12(toMidi(t)) === mod12(toMidi(bass)));
    if (idx > 0) return { root, quality, inversion: idx };
    return { root, quality, inversion: 0, bass };
  }

  return { root, quality, inversion: 0 };
}

// ---------------------------------------------------------------------------
// Detection — pitches in, chord names out
// ---------------------------------------------------------------------------

export interface ChordMatch {
  readonly chord: Chord;
  readonly symbol: string;
  /** 0-1. Exact set match in root position with the root in the bass scores 1. */
  readonly confidence: number;
  readonly missing: number[];
  readonly extra: number[];
}

/** Qualities ranked by how likely a learner is to actually mean them. */
const DETECTION_PRIORITY: ChordQuality[] = [
  'major', 'minor', 'dominant7', 'major7', 'minor7',
  'diminished', 'augmented', 'sus4', 'sus2',
  'minor7b5', 'diminished7', 'major6', 'minor6', 'minorMajor7',
  'dominant9', 'major9', 'minor9',
  'dominant7b9', 'dominant7sharp9', 'dominant7sharp5', 'dominant7b5',
  'augmented7', 'augmentedMajor7', 'dominant11', 'dominant13',
];

/**
 * Identify the chord a set of sounding MIDI notes most likely represents.
 *
 * Returns ranked candidates. The bass note is weighted heavily because it is
 * what actually determines how a voicing is heard and named — a C-E-G with E
 * in the bass is C/E, not something else.
 */
export function detectChord(midiNotes: MidiNote[], limit = 3): ChordMatch[] {
  if (midiNotes.length < 2) return [];

  const sorted = [...midiNotes].sort((a, b) => a - b);
  const bassMidi = sorted[0];
  if (bassMidi === undefined) return [];
  const bassPc = mod12(bassMidi);
  const playedPcs = new Set(sorted.map(mod12));

  const results: ChordMatch[] = [];

  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const quality of DETECTION_PRIORITY) {
      const tones = CHORD_TONES[quality].map(([, s]) => mod12(rootPc + s));
      const toneSet = new Set(tones);

      const missing = tones.filter((pc) => !playedPcs.has(pc));
      const extra = [...playedPcs].filter((pc) => !toneSet.has(pc));

      // A chord is only a candidate if most of it is actually present.
      if (missing.length > (tones.length >= 5 ? 1 : 0)) continue;
      if (extra.length > 0) continue;

      const inversionIdx = tones.indexOf(bassPc);
      if (inversionIdx === -1) continue;

      // Prefer simple, common chords; penalize larger templates that only fit
      // because they happen to contain the played notes.
      const priorityPenalty = DETECTION_PRIORITY.indexOf(quality) * 0.012;
      const missingPenalty = missing.length * 0.15;
      const inversionPenalty = inversionIdx === 0 ? 0 : 0.05;
      const confidence = Math.max(
        0,
        1 - priorityPenalty - missingPenalty - inversionPenalty,
      );

      const root = spellRootForDetection(rootPc, quality);
      results.push({
        chord: { root, quality, inversion: inversionIdx },
        symbol: chordSymbol({ root, quality, inversion: inversionIdx }),
        confidence,
        missing,
        extra,
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, limit);
}

/**
 * Choose a readable root spelling for a detected chord.
 * Flat roots read better for most flat-side qualities; sharps for the rest.
 * Without a key context this is a convention, not a deduction.
 */
function spellRootForDetection(rootPc: number, quality: ChordQuality): SpelledPitch {
  const flatPreferred = [1, 3, 6, 8, 10];
  const useFlat =
    flatPreferred.includes(rootPc) &&
    ['major', 'dominant7', 'major7', 'major6', 'dominant9', 'major9'].includes(quality);

  const sharpNames: Array<[SpelledPitch['step'], number]> = [
    ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
    ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
  ];
  const flatNames: Array<[SpelledPitch['step'], number]> = [
    ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
    ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
  ];
  const entry = (useFlat ? flatNames : sharpNames)[mod12(rootPc)];
  if (!entry) throw new Error(`unreachable: bad root pitch class ${rootPc}`);
  const [step, alter] = entry;
  return { step, alter, octave: 4 };
}

/**
 * Does a played set satisfy a target chord?
 *
 * `requireInversion` enforces the notated bass, which is what the higher rungs
 * of Chord Sprint demand. `requireOctaveExact` is deliberately never used —
 * playing a chord in a different octave is correct, and marking it wrong would
 * teach the wrong lesson.
 */
export function matchesChord(
  played: MidiNote[],
  target: Chord,
  opts: { requireInversion?: boolean } = {},
): boolean {
  if (played.length === 0) return false;
  const targetPcs = new Set(chordPitchClasses(target.root, target.quality));
  const playedPcs = new Set(played.map(mod12));

  if (targetPcs.size !== playedPcs.size) return false;
  for (const pc of targetPcs) if (!playedPcs.has(pc)) return false;

  if (opts.requireInversion) {
    const sorted = [...played].sort((a, b) => a - b);
    const lowest = sorted[0];
    if (lowest === undefined) return false;
    const expectedBass = mod12(toMidi(bassNoteOf(target)));
    if (mod12(lowest) !== expectedBass) return false;
  }
  return true;
}

export { CHORD_TONES, QUALITY_SUFFIX, DETECTION_PRIORITY };
