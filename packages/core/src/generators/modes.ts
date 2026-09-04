/**
 * Game modes: ladder definitions, drill generation, and grading.
 *
 * Each mode is a rung table plus a generator plus a grader. Adding a mode means
 * adding those three things — no new plumbing — which is why the ladder engine
 * and the grading contract are shared.
 *
 * Difficulty is a real progression, not a difficulty *slider*. The rungs are
 * ordered the way a teacher would order them, and the ladder engine promotes
 * and demotes automatically, so the drill always sits near the edge of ability.
 */

import {
  type MidiNote, type SpelledPitch, mod12, parsePitch, toMidi,
} from '../theory/pitch';
import {
  type Chord, type ChordQuality, chordSymbol, chordVoicing, matchesChord,
} from '../theory/chord';
import {
  type Interval, intervalAbbrev, intervalFromSemitones, intervalName,
} from '../theory/interval';
import {
  type Key, allKeys, keyFifths, keyId, keyName, keyScale, relativeKey,
  scaleDegreeOf, spellInKey,
} from '../theory/scale';
import {
  CADENCES, PROGRESSIONS, diatonicTriads,
  realizeProgression, romanNumeral,
} from '../theory/harmony';
import type { Ladder } from '../progression/ladder';
import { generateSightReading } from '../score/generate/sightReading';
import {
  generateIndependence, type IndependenceRatio,
} from '../score/generate/independence';
import { judgeIndependence, type IndependenceAspect } from '../grading/independence';
import type { Articulation } from '../score/model';
import { serializeMusicXml } from '../score/musicxml/serialize';
import { flattenScore, onsetClusters } from '../score/timeline';
import { type Rng, makeRng } from './rng';
import type { Drill, Grade, ModeId, Question, Response, RhythmPattern } from './questions';

export interface ModeMeta {
  readonly id: ModeId;
  readonly name: string;
  readonly tagline: string;
  /** Shown on the mode card so the pedagogical point is never a mystery. */
  readonly why: string;
  readonly needsMidi: boolean;
  readonly icon: string;
}

export const MODES: readonly ModeMeta[] = [
  {
    id: 'chord-sprint', name: 'Chord Sprint',
    tagline: 'See a symbol, play the chord, beat the clock.',
    why: 'Chord shapes have to become automatic before they are useful. Timed recall under pressure is what makes them so.',
    needsMidi: false, icon: 'sprint',
  },
  {
    id: 'degrees', name: 'Degrees',
    tagline: 'Hear a note in a key. Name its scale degree.',
    why: 'Functional ear training, not interval trivia. Hearing "that is the flat seventh" is what lets you work out a song by ear.',
    needsMidi: false, icon: 'ear',
  },
  {
    id: 'interval-ladder', name: 'Interval Ladder',
    tagline: 'Identify the distance between two notes.',
    why: 'Reading fluently means reading distances, not letter names. This trains the same recognition your eyes will need.',
    needsMidi: false, icon: 'ladder',
  },
  {
    id: 'progression-detective', name: 'Progression Detective',
    tagline: 'Hear four chords. Write the Roman numerals.',
    why: 'Most songs are four chords you already know. Recognising the pattern is the difference between copying and understanding.',
    needsMidi: false, icon: 'search',
  },
  {
    id: 'key-signature-blitz', name: 'Key Signature Blitz',
    tagline: 'Signatures, relatives, and spellings. Fast.',
    why: 'Key signatures should be instant recall. Every second spent counting sharps is a second not spent reading.',
    needsMidi: false, icon: 'bolt',
  },
  {
    id: 'sight-read', name: 'Sight-Read Sprint',
    tagline: 'A phrase you have never seen. One attempt.',
    why: 'Reading is a separate skill from playing, and it only improves on material you have not memorised. Every phrase is new and scored on the first attempt — repeating one turns reading into recall.',
    needsMidi: false, icon: 'staff',
  },
  {
    id: 'independence', name: 'Independence Lab',
    tagline: 'Two hands that refuse to agree.',
    why: 'Hands-together is the wall, and playing pieces and hoping does not get you over it. It fails because one hand captures the other, so the fix is material where the rhythms genuinely disagree and a measure that can see the capture happening.',
    needsMidi: false, icon: 'hands',
  },
  {
    id: 'rhythm-gauntlet', name: 'Rhythm Gauntlet',
    tagline: 'Tap the rhythm against the click.',
    why: 'Rhythm is drilled without pitch so the measurement is clean. Hands-together fails more often from rhythm than from notes.',
    needsMidi: false, icon: 'pulse',
  },
];

export function modeMeta(id: ModeId): ModeMeta {
  const m = MODES.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mode ${id}`);
  return m;
}

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

const COMMON_KEY_IDS = ['C-major', 'G-major', 'F-major', 'D-major', 'Bb-major', 'A-minor', 'E-minor', 'D-minor'];

export const LADDERS: Record<ModeId, Ladder> = {
  'chord-sprint': {
    modeId: 'chord-sprint',
    rungs: [
      { id: 'cs0', name: 'Major triads', params: { qualities: ['major'], roots: 'white' }, skillIds: ['theory.triads.major-minor'] },
      { id: 'cs1', name: 'Major and minor', params: { qualities: ['major', 'minor'], roots: 'white' }, skillIds: ['theory.triads.major-minor'] },
      { id: 'cs2', name: 'All roots', params: { qualities: ['major', 'minor'], roots: 'all' }, skillIds: ['theory.triads.major-minor'] },
      { id: 'cs3', name: 'Diminished and augmented', params: { qualities: ['major', 'minor', 'diminished', 'augmented'], roots: 'all' }, skillIds: ['theory.triads.dim-aug'] },
      { id: 'cs4', name: 'Inversions', params: { qualities: ['major', 'minor'], roots: 'all', inversions: true }, skillIds: ['theory.triads.inversions'] },
      { id: 'cs5', name: 'Dominant sevenths', params: { qualities: ['dominant7'], roots: 'all' }, skillIds: ['theory.sevenths.dominant'] },
      { id: 'cs6', name: 'All sevenths', params: { qualities: ['major7', 'dominant7', 'minor7', 'minor7b5', 'diminished7'], roots: 'all' }, skillIds: ['theory.sevenths.all'] },
      { id: 'cs7', name: 'Sevenths inverted', params: { qualities: ['major7', 'dominant7', 'minor7'], roots: 'all', inversions: true }, skillIds: ['theory.sevenths.all', 'theory.triads.inversions'] },
      { id: 'cs8', name: 'Voice leading', params: { qualities: ['major', 'minor', 'dominant7'], roots: 'all', inversions: true, voiceLeading: 4 }, skillIds: ['theory.voice-leading'] },
    ],
  },
  degrees: {
    modeId: 'degrees',
    rungs: [
      { id: 'dg0', name: 'Tonic triad', params: { degrees: [1, 3, 5], modes: ['major'] }, skillIds: ['ear.degrees.tonic-triad'] },
      { id: 'dg1', name: 'Pentatonic', params: { degrees: [1, 2, 3, 5, 6], modes: ['major'] }, skillIds: ['ear.degrees.pentatonic'] },
      { id: 'dg2', name: 'All seven', params: { degrees: [1, 2, 3, 4, 5, 6, 7], modes: ['major'] }, skillIds: ['ear.degrees.diatonic'] },
      { id: 'dg3', name: 'Minor keys too', params: { degrees: [1, 2, 3, 4, 5, 6, 7], modes: ['major', 'minor'] }, skillIds: ['ear.degrees.diatonic'] },
      { id: 'dg4', name: 'Distant keys', params: { degrees: [1, 2, 3, 4, 5, 6, 7], modes: ['major', 'minor'], anyKey: true }, skillIds: ['ear.degrees.diatonic'] },
    ],
  },
  'interval-ladder': {
    modeId: 'interval-ladder',
    rungs: [
      { id: 'iv0', name: 'Up to a fifth', params: { max: 7, direction: 'up' }, skillIds: ['ear.intervals.ascending', 'theory.intervals.simple'] },
      { id: 'iv1', name: 'Within an octave', params: { max: 12, direction: 'up' }, skillIds: ['ear.intervals.ascending', 'theory.intervals.all'] },
      { id: 'iv2', name: 'Descending', params: { max: 12, direction: 'down' }, skillIds: ['ear.intervals.descending'] },
      { id: 'iv3', name: 'Either direction', params: { max: 12, direction: 'both' }, skillIds: ['ear.intervals.descending'] },
      { id: 'iv4', name: 'Harmonic', params: { max: 12, direction: 'both', harmonic: true }, skillIds: ['ear.intervals.harmonic'] },
      { id: 'iv5', name: 'Compound', params: { max: 19, direction: 'both', harmonic: true }, skillIds: ['ear.intervals.harmonic'] },
    ],
  },
  'progression-detective': {
    modeId: 'progression-detective',
    rungs: [
      { id: 'pd0', name: 'Primary triads', params: { maxDifficulty: 1 }, skillIds: ['ear.progressions.primary'] },
      { id: 'pd1', name: 'Adding vi', params: { maxDifficulty: 2 }, skillIds: ['ear.progressions.primary'] },
      { id: 'pd2', name: 'All diatonic', params: { maxDifficulty: 3 }, skillIds: ['ear.progressions.diatonic', 'theory.roman-numerals'] },
      { id: 'pd3', name: 'Longer patterns', params: { maxDifficulty: 4 }, skillIds: ['ear.progressions.diatonic'] },
      { id: 'pd4', name: 'Borrowed and secondary', params: { maxDifficulty: 6 }, skillIds: ['ear.progressions.secondary', 'theory.secondary-dominants'] },
    ],
  },
  'key-signature-blitz': {
    modeId: 'key-signature-blitz',
    rungs: [
      { id: 'ks0', name: 'Up to two accidentals', params: { maxFifths: 2, asks: ['accidental-count'] }, skillIds: ['theory.key-signatures.sharps'] },
      { id: 'ks1', name: 'Up to four', params: { maxFifths: 4, asks: ['accidental-count', 'name-from-signature'] }, skillIds: ['theory.key-signatures.sharps', 'theory.key-signatures.flats'] },
      { id: 'ks2', name: 'All fifteen', params: { maxFifths: 7, asks: ['accidental-count', 'name-from-signature'] }, skillIds: ['theory.key-signatures.flats'] },
      { id: 'ks3', name: 'Relative minors', params: { maxFifths: 7, asks: ['relative'] }, skillIds: ['theory.scales.minor'] },
      { id: 'ks4', name: 'Scale spelling', params: { maxFifths: 7, asks: ['scale-spelling'] }, skillIds: ['theory.scales.major'] },
    ],
  },
  'independence': {
    modeId: 'independence',
    // The ladder the taxonomy already describes: get each hand automatic, put
    // them in parallel, then in conflict, and only then ask for different
    // articulation and dynamics on top. Dynamics comes last because it is the
    // one rung that needs a keyboard which measures how hard you struck.
    rungs: [
      { id: 'ind0', name: 'Hands together', params: { ratio: '1:1', bars: 4, leftMotion: 0, aspect: 'together', tempo: 66 }, skillIds: ['independence.hands-separate'] },
      { id: 'ind1', name: 'Parallel motion', params: { ratio: '1:1', bars: 4, leftMotion: 2, aspect: 'together', tempo: 72 }, skillIds: ['independence.parallel'] },
      { id: 'ind2', name: 'Contrary motion', params: { ratio: '1:1', bars: 4, leftMotion: 4, aspect: 'together', tempo: 76 }, skillIds: ['independence.contrary'] },
      { id: 'ind3', name: 'Two against one', params: { ratio: '2:1', bars: 4, leftMotion: 2, aspect: 'rhythm', tempo: 72 }, skillIds: ['independence.rhythm.2-1'] },
      { id: 'ind4', name: 'Three against one', params: { ratio: '3:1', bars: 4, leftMotion: 2, aspect: 'rhythm', tempo: 66 }, skillIds: ['independence.rhythm.3-1'] },
      { id: 'ind5', name: 'Different articulation', params: { ratio: '2:1', bars: 4, leftMotion: 2, aspect: 'articulation', articulation: ['legato', 'staccato'], tempo: 72 }, skillIds: ['independence.articulation'] },
      { id: 'ind6', name: 'Three against two', params: { ratio: '3:2', bars: 4, leftMotion: 2, aspect: 'rhythm', tempo: 63 }, skillIds: ['independence.rhythm.3-2'] },
      { id: 'ind7', name: 'Different dynamics', params: { ratio: '2:1', bars: 4, leftMotion: 2, aspect: 'dynamics', dynamics: ['f', 'p'], tempo: 72 }, skillIds: ['independence.dynamics'] },
      { id: 'ind8', name: 'Ostinato under a melody', params: { ratio: '3:2', bars: 8, leftMotion: 0, aspect: 'rhythm', improvise: true, tempo: 69 }, skillIds: ['independence.ostinato'] },
    ],
  },
  'sight-read': {
    modeId: 'sight-read',
    rungs: [
      // Graded the way a teacher grades reading: position first, then range,
      // then rhythm, then a second staff, then key signatures. Leaps come late
      // — stepwise reading has to be automatic before intervals mean anything.
      { id: 'sr0', name: 'Five-finger position', params: { keys: ['C-major'], low: 60, high: 67, units: [1], hands: 1, maxLeap: 1, bars: 2 }, skillIds: ['reading.treble.steps'] },
      { id: 'sr1', name: 'An octave', params: { keys: ['C-major'], low: 60, high: 72, units: [1, 2], hands: 1, maxLeap: 2, bars: 2 }, skillIds: ['reading.treble.steps', 'reading.intervals'] },
      { id: 'sr2', name: 'Adding eighths', params: { keys: ['C-major', 'G-major'], low: 60, high: 72, units: [1, 0.5, 2], hands: 1, maxLeap: 2, bars: 4 }, skillIds: ['reading.intervals'] },
      { id: 'sr3', name: 'Leaps', params: { keys: ['C-major', 'G-major', 'F-major'], low: 57, high: 76, units: [1, 0.5, 2], hands: 1, maxLeap: 4, bars: 4 }, skillIds: ['reading.intervals'] },
      { id: 'sr4', name: 'Both hands', params: { keys: ['C-major', 'G-major', 'F-major'], low: 60, high: 76, units: [1, 0.5, 2], hands: 2, maxLeap: 3, bars: 4 }, skillIds: ['reading.grand-staff'] },
      { id: 'sr5', name: 'Sharp keys', params: { keys: ['G-major', 'D-major', 'A-major'], low: 57, high: 79, units: [1, 0.5, 2], hands: 2, maxLeap: 4, bars: 4 }, skillIds: ['reading.accidentals'] },
      { id: 'sr6', name: 'Flat keys', params: { keys: ['F-major', 'Bb-major', 'Eb-major'], low: 55, high: 79, units: [1, 0.5, 2], hands: 2, maxLeap: 4, bars: 4 }, skillIds: ['reading.accidentals'] },
      { id: 'sr7', name: 'Rests and dots', params: { keys: ['C-major', 'G-major', 'F-major', 'D-major', 'Bb-major'], low: 55, high: 79, units: [1, 0.5, 1.5, 0.25], hands: 2, maxLeap: 4, bars: 4, rests: true }, skillIds: ['reading.sight-reading', 'rhythm.dotted'] },
      { id: 'sr8', name: 'Ledger lines', params: { keys: ['C-major', 'G-major', 'F-major', 'D-major', 'Eb-major'], low: 48, high: 84, units: [1, 0.5, 1.5, 0.25], hands: 2, maxLeap: 5, bars: 4, rests: true }, skillIds: ['reading.ledger-lines', 'reading.sight-reading'] },
    ],
  },
  'rhythm-gauntlet': {
    modeId: 'rhythm-gauntlet',
    rungs: [
      { id: 'rg0', name: 'Quarter notes', params: { units: [1], bars: 2, bpm: 72 }, skillIds: ['rhythm.quarter'] },
      { id: 'rg1', name: 'Adding eighths', params: { units: [1, 0.5], bars: 2, bpm: 76 }, skillIds: ['rhythm.eighth'] },
      { id: 'rg2', name: 'Rests', params: { units: [1, 0.5], bars: 2, bpm: 80, rests: true }, skillIds: ['rhythm.rests'] },
      { id: 'rg3', name: 'Sixteenths', params: { units: [1, 0.5, 0.25], bars: 2, bpm: 80, rests: true }, skillIds: ['rhythm.sixteenth'] },
      { id: 'rg4', name: 'Dotted rhythms', params: { units: [1, 0.5, 0.75, 0.25], bars: 2, bpm: 84, rests: true }, skillIds: ['rhythm.dotted'] },
      { id: 'rg5', name: 'Triplets', params: { units: [1, 0.5, 1 / 3], bars: 2, bpm: 84, rests: true }, skillIds: ['rhythm.triplet'] },
      { id: 'rg6', name: 'Syncopation', params: { units: [0.5, 0.25, 0.75], bars: 2, bpm: 88, rests: true, syncopate: true }, skillIds: ['rhythm.syncopation'] },
    ],
  },
};

/**
 * Build a choice list that always contains the right answer.
 *
 * Capping a shuffled list can silently drop the correct option, which makes a
 * question unanswerable. The answer is reserved first, then the distractors
 * fill the remaining slots.
 */
function withAnswer(choices: string[], answer: string, rng: Rng, max: number): string[] {
  const distractors = [...new Set(choices)].filter((c) => c !== answer);
  return rng.shuffle([answer, ...rng.shuffle(distractors).slice(0, max - 1)]);
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}
function str(params: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}
function bool(params: Readonly<Record<string, unknown>>, key: string): boolean {
  return params[key] === true;
}
function list<T>(params: Readonly<Record<string, unknown>>, key: string, fallback: T[]): T[] {
  const v = params[key];
  return Array.isArray(v) ? (v as T[]) : fallback;
}

function keyById(id: string): Key {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`unknown key ${id}`);
  return k;
}

const WHITE_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ALL_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function rootPitch(name: string, octave = 4): SpelledPitch {
  const p = parsePitch(`${name}${octave}`);
  if (!p) throw new Error(`bad root ${name}`);
  return p;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  readonly modeId: ModeId;
  readonly rungIndex: number;
  readonly seed: number;
  /** Previous drill, so voice-leading rungs can constrain the next chord. */
  readonly previous?: Drill;
}

export function generateDrill(opts: GenerateOptions): Drill {
  const ladder = LADDERS[opts.modeId];
  const idx = Math.max(0, Math.min(ladder.rungs.length - 1, opts.rungIndex));
  const rung = ladder.rungs[idx];
  if (!rung) throw new Error(`mode ${opts.modeId} has no rungs`);

  const rng = makeRng(opts.seed);
  const p = rung.params;

  let question: Question;
  let baseXp = 40;

  switch (opts.modeId) {
    case 'chord-sprint': {
      const roots = str(p, 'roots', 'white') === 'all' ? ALL_ROOTS : WHITE_ROOTS;
      const qualities = list<ChordQuality>(p, 'qualities', ['major']);
      const quality = rng.pick(qualities);
      const root = rootPitch(rng.pick(roots));
      const useInversions = bool(p, 'inversions');
      const toneCount = quality.includes('7') || quality.includes('sixth') ? 4 : 3;
      const inversion = useInversions ? rng.int(0, toneCount - 1) : 0;
      const chord: Chord = { root, quality, inversion };

      const vl = num(p, 'voiceLeading', 0);
      const prev = opts.previous?.question.kind === 'play-chord'
        ? opts.previous.question
        : undefined;

      question = {
        kind: 'play-chord',
        chord,
        symbol: chordSymbol(chord),
        requireInversion: useInversions,
        ...(vl > 0 && prev
          ? {
              previous: { chord: prev.chord, voicing: chordVoicing(prev.chord) },
              maxVoiceLeadingDistance: vl,
            }
          : {}),
      };
      baseXp = 45 + idx * 6;
      break;
    }

    case 'degrees': {
      const degrees = list<number>(p, 'degrees', [1, 3, 5]);
      const modes = list<string>(p, 'modes', ['major']);
      const mode = rng.pick(modes) as 'major' | 'minor';
      const key = bool(p, 'anyKey')
        ? rng.pick(allKeys(mode))
        : keyById(rng.pick(COMMON_KEY_IDS.filter((k) => k.endsWith(mode))));

      const degree = rng.pick(degrees);
      const scale = keyScale(key);
      const note = scale[degree - 1];
      if (!note) throw new Error('unreachable: degree out of scale');
      // Seat the target in a comfortable listening octave.
      const target = toMidi({ ...note, octave: 4 });

      question = {
        kind: 'identify-degree',
        key,
        cadence: realizeProgression(CADENCES.authentic, key),
        target,
        degree,
        choices: degrees,
      };
      baseXp = 40 + idx * 8;
      break;
    }

    case 'interval-ladder': {
      const max = num(p, 'max', 12);
      const dirParam = str(p, 'direction', 'up');
      const direction: 1 | -1 =
        dirParam === 'down' ? -1 : dirParam === 'both' ? (rng.bool() ? 1 : -1) : 1;
      const semitones = rng.int(1, max);
      const from = rng.int(55, 67);
      const to = from + semitones * direction;
      const iv = intervalFromSemitones(semitones, direction);

      // Offer every interval size in range as a choice, so guessing is expensive.
      const choices = Array.from({ length: max }, (_, i) =>
        intervalAbbrev(intervalFromSemitones(i + 1)),
      );

      question = {
        kind: 'identify-interval',
        from, to, interval: iv,
        harmonic: bool(p, 'harmonic'),
        choices: [...new Set(choices)],
      };
      baseXp = 35 + idx * 7;
      break;
    }

    case 'progression-detective': {
      const maxDifficulty = num(p, 'maxDifficulty', 1);
      const pool = PROGRESSIONS.filter((t) => t.difficulty <= maxDifficulty);
      const template = rng.pick(pool.length > 0 ? pool : PROGRESSIONS);
      const mode = template.mode === 'minor' ? 'minor' : 'major';
      const key = keyById(rng.pick(COMMON_KEY_IDS.filter((k) => k.endsWith(mode))));
      const chords = realizeProgression(template.numerals, key);

      const diatonic = diatonicTriads(key).map((c) => romanNumeral(c, key));
      const choices = [...new Set([...diatonic, ...template.numerals, 'bVII', 'bVI', 'bIII'])];

      question = {
        kind: 'identify-progression',
        key, chords,
        numerals: template.numerals,
        choices,
      };
      baseXp = 60 + idx * 10;
      break;
    }

    case 'key-signature-blitz': {
      const maxFifths = num(p, 'maxFifths', 2);
      const asks = list<string>(p, 'asks', ['accidental-count']);
      const ask = rng.pick(asks) as 'accidental-count' | 'name-from-signature' | 'relative' | 'scale-spelling';
      const mode = ask === 'relative' ? 'major' : rng.bool(0.7) ? 'major' : 'minor';
      const candidates = allKeys(mode).filter(
        (k) => Math.abs(keyFifths(k) ?? 0) <= maxFifths,
      );
      const key = rng.pick(candidates);
      const fifths = keyFifths(key) ?? 0;

      let answer: string;
      let choices: string[];
      switch (ask) {
        case 'accidental-count': {
          answer = fifths === 0 ? 'none' : `${Math.abs(fifths)} ${fifths > 0 ? 'sharp' : 'flat'}${Math.abs(fifths) > 1 ? 's' : ''}`;
          choices = ['none'];
          for (let i = 1; i <= Math.max(2, maxFifths); i++) {
            choices.push(`${i} sharp${i > 1 ? 's' : ''}`, `${i} flat${i > 1 ? 's' : ''}`);
          }
          break;
        }
        case 'name-from-signature': {
          answer = keyName(key);
          choices = candidates.map(keyName);
          break;
        }
        case 'relative': {
          answer = keyName(relativeKey(key));
          choices = allKeys('minor')
            .filter((k) => Math.abs(keyFifths(k) ?? 0) <= maxFifths)
            .map(keyName);
          break;
        }
        case 'scale-spelling': {
          answer = keyScale(key).map((n) => {
            const acc = n.alter === 1 ? '♯' : n.alter === -1 ? '♭' : '';
            return `${n.step}${acc}`;
          }).join(' ');
          choices = candidates.slice(0, 6).map((k) =>
            keyScale(k).map((n) => {
              const acc = n.alter === 1 ? '♯' : n.alter === -1 ? '♭' : '';
              return `${n.step}${acc}`;
            }).join(' '),
          );
          if (!choices.includes(answer)) choices.push(answer);
          break;
        }
      }

      question = {
        kind: 'key-signature',
        key, ask, answer,
        choices: withAnswer(choices, answer, rng, 8),
      };
      baseXp = 25 + idx * 5;
      break;
    }

    case 'rhythm-gauntlet': {
      question = { kind: 'tap-rhythm', pattern: generateRhythm(p, rng) };
      baseXp = 50 + idx * 8;
      break;
    }

    case 'independence': {
      const ratio = str(p, 'ratio', '1:1') as IndependenceRatio;
      const tempo = num(p, 'tempo', 72);
      const pair = list<string>(p, 'articulation', []);
      const dyn = list<string>(p, 'dynamics', []);

      const articulation = pair.length === 2
        ? { right: pair[0] as Articulation, left: pair[1] as Articulation }
        : null;
      const dynamics = dyn.length === 2
        ? { right: dyn[0]!, left: dyn[1]! }
        : null;

      // Middle C as the boundary is a *construction* here, not an assumption:
      // the generator keeps the left hand strictly below it and the right at
      // or above, and `assertHandsSeparated` checks that it did. That is what
      // makes attributing a live note to a hand a lookup rather than a guess.
      const splitPoint = 60;
      const score = generateIndependence(
        {
          key: keyById('C-major'),
          bars: num(p, 'bars', 4),
          timeSignature: { beats: 4, beatType: 4 },
          ratio,
          splitPoint,
          rightCeiling: 79,
          leftMotion: num(p, 'leftMotion', 2),
          articulation,
          dynamics,
          rightImprovises: bool(p, 'improvise'),
          tempo,
        },
        opts.seed,
      );

      question = {
        kind: 'play-independence',
        score,
        musicXml: serializeMusicXml(score),
        splitPoint,
        ratio,
        aspect: str(p, 'aspect', 'rhythm') as IndependenceAspect,
        articulation,
        dynamics,
        tempo,
      };
      baseXp = 80 + idx * 12;
      break;
    }

    case 'sight-read': {
      const keyIds = list<string>(p, 'keys', ['C-major']);
      const key = keyById(rng.pick(keyIds));
      const hands = (num(p, 'hands', 1) === 2 ? 2 : 1) as 1 | 2;

      const score = generateSightReading(
        {
          key,
          bars: num(p, 'bars', 4),
          timeSignature: { beats: 4, beatType: 4 },
          range: [num(p, 'low', 60), num(p, 'high', 72)],
          hands,
          rhythmUnits: list<number>(p, 'units', [1]),
          maxLeap: num(p, 'maxLeap', 2),
          stepBias: 0.75,
          allowRests: bool(p, 'rests'),
          tempo: 72,
        },
        opts.seed,
      );

      // Expected pitches in playing order. Rests carry no onset to play, and
      // ties are already resolved by the timeline, so this is exactly the
      // sequence of attacks the reader should produce.
      const expected = onsetClusters(flattenScore(score)).flatMap((c) => c.pitches);

      question = {
        kind: 'read-notation',
        score,
        musicXml: serializeMusicXml(score),
        expected,
        key,
        tempo: 72,
        hands,
      };
      baseXp = 70 + idx * 10;
      break;
    }
  }

  return {
    id: `${opts.modeId}-${opts.seed}`,
    modeId: opts.modeId,
    rungId: rung.id,
    rungIndex: idx,
    skillIds: rung.skillIds,
    seed: opts.seed,
    question,
    baseXp,
  };
}

function generateRhythm(p: Readonly<Record<string, unknown>>, rng: Rng): RhythmPattern {
  const units = list<number>(p, 'units', [1]);
  const bars = num(p, 'bars', 2);
  const bpm = num(p, 'bpm', 72);
  const beatsPerBar = 4;
  const allowRests = bool(p, 'rests');

  const events: Array<{ beat: number; duration: number; isRest: boolean }> = [];
  let beat = 0;
  const total = bars * beatsPerBar;

  while (beat < total - 1e-6) {
    const remaining = total - beat;
    const usable = units.filter((u) => u <= remaining + 1e-6);
    const duration = usable.length > 0 ? rng.pick(usable) : remaining;
    // Rests are sparse; a pattern that is mostly silence teaches nothing.
    const isRest = allowRests && beat > 0 && rng.bool(0.15);
    events.push({ beat, duration, isRest });
    beat += duration;
  }

  return { events, beatsPerBar, bars, bpm };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** Tap within this many ms of the beat counts as fully on time. */
export const RHYTHM_PERFECT_MS = 45;
/** Beyond this, a tap is a miss rather than a late hit. */
export const RHYTHM_MISS_MS = 220;

export function gradeDrill(drill: Drill, response: Response): Grade {
  const q = drill.question;

  if (response.kind === 'skipped') {
    return { correctness: 0, correct: false, detail: 'Skipped.', diagnostics: {} };
  }

  switch (q.kind) {
    case 'play-chord': {
      if (response.kind !== 'notes') return wrongShape();
      const ok = matchesChord([...response.midi], q.chord, {
        requireInversion: q.requireInversion,
      });
      if (ok) {
        return {
          correctness: 1, correct: true,
          detail: `${q.symbol} — correct.`,
          diagnostics: { noteCount: response.midi.length },
        };
      }
      return {
        correctness: 0, correct: false,
        detail: explainChordMiss([...response.midi], q.chord, q.requireInversion),
        diagnostics: { noteCount: response.midi.length },
      };
    }

    case 'identify-degree': {
      if (response.kind !== 'choice') return wrongShape();
      const correct = Number(response.value) === q.degree;
      return {
        correctness: correct ? 1 : 0,
        correct,
        detail: correct
          ? `Degree ${q.degree} in ${keyName(q.key)}.`
          : `That was degree ${q.degree} — ${describeDegree(q.target, q.key)}.`,
        diagnostics: {},
      };
    }

    case 'identify-interval': {
      if (response.kind !== 'choice') return wrongShape();
      const expected = intervalAbbrev(q.interval);
      const correct = response.value === expected;
      return {
        correctness: correct ? 1 : 0,
        correct,
        detail: correct
          ? `${intervalName(q.interval)}.`
          : `That was ${intervalName(q.interval)} (${expected}).`,
        diagnostics: { semitones: Math.abs(q.to - q.from) },
      };
    }

    case 'identify-progression': {
      if (response.kind !== 'sequence') return wrongShape();
      const expected = q.numerals;
      let hits = 0;
      for (let i = 0; i < expected.length; i++) {
        if (response.values[i] === expected[i]) hits++;
      }
      const correctness = expected.length === 0 ? 0 : hits / expected.length;
      return {
        correctness,
        correct: hits === expected.length,
        detail: hits === expected.length
          ? `${expected.join(' – ')} in ${keyName(q.key)}.`
          : `It was ${expected.join(' – ')}. You had ${hits} of ${expected.length}.`,
        diagnostics: { hits, total: expected.length },
      };
    }

    case 'key-signature': {
      if (response.kind !== 'choice') return wrongShape();
      const correct = response.value === q.answer;
      return {
        correctness: correct ? 1 : 0,
        correct,
        detail: correct ? 'Correct.' : `It was ${q.answer}.`,
        diagnostics: { fifths: keyFifths(q.key) ?? 0 },
      };
    }

    case 'tap-rhythm': {
      if (response.kind !== 'taps') return wrongShape();
      return gradeRhythm(q.pattern, response.offsetsMs);
    }

    case 'play-independence': {
      if (response.kind !== 'take') return wrongShape();
      const report = judgeIndependence(q.score, response.take, {
        aspect: q.aspect,
        splitPoint: q.splitPoint,
        articulation: q.articulation,
        dynamics: q.dynamics,
      });

      const primary = report.verdicts.find((v) => v.aspect === q.aspect)
        ?? report.verdicts[0];

      return {
        correctness: report.correctness,
        correct: report.correctness >= 0.9 && (primary?.held ?? false),
        detail: report.findings[0] ?? 'Nothing to report.',
        diagnostics: {
          noteAccuracy: report.performance.metrics.noteAccuracy,
          entrainment:
            1 - (report.verdicts.find((v) => v.aspect === 'rhythm')?.score ?? 1),
          tempoBpm: report.performance.metrics.tempo.medianBpm,
        },
      };
    }

    case 'read-notation': {
      if (response.kind !== 'notes') return wrongShape();
      return gradeReading(q.expected, response.midi);
    }
  }
}

/**
 * Grade a read phrase against what was played.
 *
 * Greedy forward matching that tolerates extra notes: on a mismatch it advances
 * only the played list, so one wrong note costs one note rather than desyncing
 * everything after it. That cascade is the specific failure the affine-gap
 * aligner will remove properly; this keeps the mode honest until then.
 */
export function gradeReading(
  expected: readonly MidiNote[],
  played: readonly MidiNote[],
): Grade {
  if (expected.length === 0) {
    return { correctness: 0, correct: false, detail: 'Nothing to read.', diagnostics: {} };
  }

  let matched = 0;
  let expectedIndex = 0;
  let extra = 0;

  for (const note of played) {
    if (expectedIndex >= expected.length) {
      extra += 1;
      continue;
    }
    if (note === expected[expectedIndex]) {
      matched += 1;
      expectedIndex += 1;
    } else {
      extra += 1;
    }
  }

  const missed = expected.length - matched;
  const accuracy = matched / expected.length;
  // Extra notes are penalised, but never enough to erase a mostly-correct read.
  const correctness = Math.max(0, Math.min(1, accuracy * Math.max(0.4, 1 - extra * 0.08)));

  return {
    correctness,
    correct: matched === expected.length && extra === 0,
    detail:
      matched === expected.length && extra === 0
        ? `All ${expected.length} notes, first time.`
        : missed > 0 && extra > 0
          ? `${matched} of ${expected.length} correct, with ${extra} extra note${extra > 1 ? 's' : ''}.`
          : missed > 0
            ? `${matched} of ${expected.length} — ${missed} missed.`
            : `All notes found, plus ${extra} extra.`,
    diagnostics: {
      matched,
      expected: expected.length,
      missed,
      extraNotes: extra,
      accuracy,
    },
  };
}

function wrongShape(): Grade {
  return {
    correctness: 0, correct: false,
    detail: 'That answer did not match the question.',
    diagnostics: {},
  };
}

function describeDegree(midi: MidiNote, key: Key): string {
  const spelled = spellInKey(midi, key);
  const acc = spelled.alter === 1 ? '♯' : spelled.alter === -1 ? '♭' : '';
  const deg = scaleDegreeOf(midi, key);
  return deg ? `${spelled.step}${acc}, degree ${deg}` : `${spelled.step}${acc}, chromatic`;
}

/**
 * Explain a wrong chord in terms a teacher would use.
 *
 * "Wrong" is useless feedback. Naming the specific error — a minor third where
 * a major was asked, a missing fifth, the right notes in the wrong inversion —
 * is what turns an attempt into a lesson.
 */
function explainChordMiss(played: MidiNote[], target: Chord, requireInversion: boolean): string {
  if (played.length === 0) return 'Nothing played.';

  const targetPcs = new Set(chordVoicing({ ...target, inversion: 0 }).map(mod12));
  const playedPcs = new Set(played.map(mod12));

  const missing = [...targetPcs].filter((pc) => !playedPcs.has(pc));
  const extra = [...playedPcs].filter((pc) => !targetPcs.has(pc));

  if (missing.length === 0 && extra.length === 0 && requireInversion) {
    return `Right notes, wrong inversion — ${chordSymbol(target)} needs ${
      chordSymbol(target).split('/')[1] ?? 'the root'
    } in the bass.`;
  }
  if (missing.length > 0 && extra.length === 0) {
    return `${chordSymbol(target)} is missing ${missing.length} note${missing.length > 1 ? 's' : ''}.`;
  }
  if (extra.length > 0 && missing.length === 0) {
    return `Correct chord plus ${extra.length} extra note${extra.length > 1 ? 's' : ''}.`;
  }
  return `Not quite — ${chordSymbol(target)} is ${
    chordVoicing({ ...target, inversion: 0 }).length
  } notes.`;
}

/**
 * Grade a tapped rhythm.
 *
 * Scored on mean absolute onset deviation against the expected grid, which is
 * the same statistic used for MIDI timing later — so the Rhythm domain's
 * numbers stay comparable once real playing arrives.
 */
export function gradeRhythm(pattern: RhythmPattern, offsetsMs: readonly number[]): Grade {
  const msPerBeat = 60000 / pattern.bpm;
  const expected = pattern.events
    .filter((e) => !e.isRest)
    .map((e) => e.beat * msPerBeat);

  if (expected.length === 0) {
    return { correctness: 0, correct: false, detail: 'Nothing to tap.', diagnostics: {} };
  }

  const taps = [...offsetsMs].sort((a, b) => a - b);
  const used = new Set<number>();
  const deviations: number[] = [];
  let hits = 0;

  for (const target of expected) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i)) continue;
      const t = taps[i];
      if (t === undefined) continue;
      const d = Math.abs(t - target);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestDist <= RHYTHM_MISS_MS) {
      used.add(bestIdx);
      deviations.push(bestDist);
      hits++;
    }
  }

  const extra = taps.length - used.size;
  const meanDeviation = deviations.length > 0
    ? deviations.reduce((a, b) => a + b, 0) / deviations.length
    : RHYTHM_MISS_MS;

  const hitRate = hits / expected.length;
  // Timing quality tapers from perfect to zero across the tolerance window.
  const timingQuality = Math.max(
    0,
    Math.min(1, 1 - (meanDeviation - RHYTHM_PERFECT_MS) / (RHYTHM_MISS_MS - RHYTHM_PERFECT_MS)),
  );
  const extraPenalty = Math.max(0, 1 - extra * 0.12);
  const correctness = Math.max(0, Math.min(1, hitRate * timingQuality * extraPenalty));

  const early = deviations.length > 0 && meanDeviation > RHYTHM_PERFECT_MS;
  return {
    correctness,
    correct: correctness >= 0.9,
    detail: hits < expected.length
      ? `${hits} of ${expected.length} notes landed. Missing taps hurt more than late ones.`
      : early
        ? `All ${hits} landed, averaging ${Math.round(meanDeviation)} ms off the beat.`
        : `Clean — ${Math.round(meanDeviation)} ms average deviation.`,
    diagnostics: {
      hits,
      expected: expected.length,
      extraTaps: extra,
      meanAbsDeviationMs: Math.round(meanDeviation),
      hitRate,
    },
  };
}
