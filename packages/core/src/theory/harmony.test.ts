import { describe, expect, it } from 'vitest';
import { parsePitch, type SpelledPitch } from './pitch';
import { chordId, chordSymbol, type Chord } from './chord';
import { allKeys, keyId, type Key } from './scale';
import {
  CADENCES, PROGRESSIONS, chordFromRomanNumeral, chordOnDegree, diatonicSevenths,
  diatonicTriads, realizeProgression, romanNumeral, secondaryDominantOf,
} from './harmony';

const P = (s: string): SpelledPitch => {
  const p = parsePitch(s);
  if (!p) throw new Error(`bad test pitch ${s}`);
  return p;
};
const K = (id: string): Key => {
  const found = [...allKeys('major'), ...allKeys('minor')].find((k) => keyId(k) === id);
  if (!found) throw new Error(`no key ${id}`);
  return found;
};
const syms = (cs: Chord[]) => cs.map(chordId);

describe('diatonic harmony', () => {
  it('builds the major-key triads in the textbook order', () => {
    expect(syms(diatonicTriads(K('C-major'))))
      .toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  });

  it('builds the major-key sevenths', () => {
    expect(syms(diatonicSevenths(K('C-major'))))
      .toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7b5']);
  });

  it('uses natural minor by default', () => {
    expect(syms(diatonicTriads(K('A-minor'))))
      .toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  });

  it('raises the leading tone on request, giving a real dominant', () => {
    const raised = diatonicTriads(K('A-minor'), { raisedLeadingTone: true });
    expect(chordId(raised[4]!)).toBe('E');   // V, not v
    expect(chordId(raised[6]!)).toBe('G#dim'); // vii°, not VII
  });

  it('transposes the pattern to any key', () => {
    expect(syms(diatonicTriads(K('Eb-major'))))
      .toEqual(['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim']);
  });

  it('indexes chords by scale degree', () => {
    expect(chordSymbol(chordOnDegree(K('C-major'), 5))).toBe('G');
    expect(chordSymbol(chordOnDegree(K('C-major'), 5, true))).toBe('G7');
    expect(chordSymbol(chordOnDegree(K('C-major'), 2))).toBe('Dm');
  });
});

describe('roman numerals', () => {
  it('cases numerals by chord quality', () => {
    const key = K('C-major');
    const triads = diatonicTriads(key);
    expect(triads.map((c) => romanNumeral(c, key)))
      .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  });

  it('marks seventh chords', () => {
    const key = K('C-major');
    expect(romanNumeral({ root: P('G4'), quality: 'dominant7', inversion: 0 }, key)).toBe('V7');
    expect(romanNumeral({ root: P('B3'), quality: 'minor7b5', inversion: 0 }, key)).toBe('viiø7');
    expect(romanNumeral({ root: P('C4'), quality: 'major7', inversion: 0 }, key)).toBe('Imaj7');
  });

  it('uses figured bass for inversions', () => {
    const key = K('C-major');
    expect(romanNumeral({ root: P('C4'), quality: 'major', inversion: 1 }, key)).toBe('I6');
    expect(romanNumeral({ root: P('C4'), quality: 'major', inversion: 2 }, key)).toBe('I6/4');
    expect(romanNumeral({ root: P('G4'), quality: 'dominant7', inversion: 1 }, key)).toBe('V6/5');
    expect(romanNumeral({ root: P('G4'), quality: 'dominant7', inversion: 3 }, key)).toBe('V4/2');
  });

  it('reads chromatic chords as altered degrees', () => {
    const key = K('C-major');
    // Eb major in C major is bIII, not some sharp-side degree.
    expect(romanNumeral({ root: P('Eb4'), quality: 'major', inversion: 0 }, key)).toBe('♭III');
    expect(romanNumeral({ root: P('Bb4'), quality: 'major', inversion: 0 }, key)).toBe('♭VII');
    // Borrowed minor iv.
    expect(romanNumeral({ root: P('F4'), quality: 'minor', inversion: 0 }, key)).toBe('iv');
  });

  it('recognizes secondary dominants by their target', () => {
    const key = K('C-major');
    // D7 resolves to G, which is V. So D7 is V7/V.
    expect(secondaryDominantOf({ root: P('D4'), quality: 'dominant7', inversion: 0 }, key))
      .toBe('V7/V');
    // E7 resolves to Am, which is vi.
    expect(secondaryDominantOf({ root: P('E4'), quality: 'dominant7', inversion: 0 }, key))
      .toBe('V7/vi');
    // G7 is just the plain dominant, not a secondary.
    expect(secondaryDominantOf({ root: P('G4'), quality: 'dominant7', inversion: 0 }, key))
      .toBeNull();
  });

  it('round-trips numerals back into chords', () => {
    const key = K('C-major');
    for (const [numeral, expected] of [
      ['I', 'C'], ['ii', 'Dm'], ['V7', 'G7'], ['vi', 'Am'],
      ['IV', 'F'], ['bVII', 'Bb'], ['bIII', 'Eb'],
    ] as const) {
      const c = chordFromRomanNumeral(numeral, key);
      expect(c, numeral).not.toBeNull();
      expect(chordId(c!), numeral).toBe(expected);
    }
  });

  it('round-trips in a flat key too', () => {
    const key = K('Eb-major');
    expect(chordId(chordFromRomanNumeral('V7', key)!)).toBe('Bb7');
    expect(chordId(chordFromRomanNumeral('vi', key)!)).toBe('Cm');
  });
});

describe('progressions', () => {
  it('realizes the pop axis in C major', () => {
    expect(syms(realizeProgression(['I', 'V', 'vi', 'IV'], K('C-major'))))
      .toEqual(['C', 'G', 'Am', 'F']);
  });

  it('realizes a two-five-one in a flat key', () => {
    expect(syms(realizeProgression(['ii', 'V', 'I'], K('Bb-major'))))
      .toEqual(['Cm', 'F', 'Bb']);
  });

  it('realizes every catalogued progression without dropping a chord', () => {
    for (const t of PROGRESSIONS) {
      const key = t.mode === 'minor' ? K('A-minor') : K('C-major');
      const chords = realizeProgression(t.numerals, key);
      expect(chords, t.id).toHaveLength(t.numerals.length);
    }
  });

  it('realizes cadences used to establish a key by ear', () => {
    expect(syms(realizeProgression(CADENCES.authentic, K('C-major'))))
      .toEqual(['C', 'F', 'G', 'C']);
    expect(syms(realizeProgression(CADENCES.deceptive, K('C-major'))))
      .toEqual(['C', 'F', 'G', 'Am']);
  });
});
