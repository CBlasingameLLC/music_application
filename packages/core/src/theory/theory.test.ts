import { describe, expect, it } from 'vitest';
import {
  isBlackKey, parsePitch, pitchId, spellMidi, toMidi, type SpelledPitch,
} from './pitch.js';
import {
  intervalAbbrev, intervalBetween, intervalFromSemitones, intervalName,
  interval, invert, parseInterval, transpose,
} from './interval.js';
import {
  allKeys, keyFifths, keyId, keySignatureAccidentals, keyName, parallelKey,
  relativeKey, scaleDegreeOf, scaleNotes, spellInKey, type Key,
} from './scale.js';
import {
  bassNoteOf, chordId, chordSymbol, chordTones, chordVoicing, detectChord,
  inversionFigure, matchesChord, parseChordSymbol,
} from './chord.js';

const P = (s: string): SpelledPitch => {
  const p = parsePitch(s);
  if (!p) throw new Error(`bad test pitch ${s}`);
  return p;
};
const spell = (ps: SpelledPitch[]) => ps.map(pitchId);

describe('pitch', () => {
  it('anchors middle C at MIDI 60', () => {
    expect(toMidi(P('C4'))).toBe(60);
    expect(toMidi(P('A4'))).toBe(69); // A440
  });

  it('spans the 88-key piano from A0 to C8', () => {
    expect(toMidi(P('A0'))).toBe(21);
    expect(toMidi(P('C8'))).toBe(108);
  });

  it('round-trips scientific pitch notation', () => {
    for (const s of ['C4', 'F#3', 'Bb5', 'G#-1', 'Dbb2', 'Ex4']) {
      const p = parsePitch(s);
      expect(p, s).not.toBeNull();
    }
    expect(pitchId(P('F#3'))).toBe('F#3');
    expect(pitchId(P('Bb5'))).toBe('Bb5');
  });

  it('treats enharmonics as equal in pitch but distinct in spelling', () => {
    expect(toMidi(P('C#4'))).toBe(toMidi(P('Db4')));
    expect(pitchId(P('C#4'))).not.toBe(pitchId(P('Db4')));
  });

  it('handles the B#/Cb octave boundary', () => {
    expect(toMidi(P('B#3'))).toBe(60); // sounds as C4
    expect(toMidi(P('Cb4'))).toBe(59); // sounds as B3
  });

  it('identifies black keys', () => {
    expect(isBlackKey(61)).toBe(true); // C#
    expect(isBlackKey(60)).toBe(false); // C
    expect(isBlackKey(70)).toBe(true); // Bb
  });

  it('spells by preferred accidental direction', () => {
    expect(pitchId(spellMidi(61, 'sharp'))).toBe('C#4');
    expect(pitchId(spellMidi(61, 'flat'))).toBe('Db4');
  });
});

describe('interval', () => {
  it('names the common intervals from C', () => {
    const cases: Array<[string, string]> = [
      ['C4', 'P1'], ['D4', 'M2'], ['E4', 'M3'], ['F4', 'P4'],
      ['G4', 'P5'], ['A4', 'M6'], ['B4', 'M7'], ['C5', 'P8'],
      ['Eb4', 'm3'], ['Ab4', 'm6'], ['Bb4', 'm7'], ['Db4', 'm2'],
    ];
    for (const [to, expected] of cases) {
      expect(intervalAbbrev(intervalBetween(P('C4'), P(to))), `C4 -> ${to}`).toBe(expected);
    }
  });

  it('distinguishes a tritone spelled as A4 from one spelled as d5', () => {
    expect(intervalAbbrev(intervalBetween(P('C4'), P('F#4')))).toBe('A4');
    expect(intervalAbbrev(intervalBetween(P('C4'), P('Gb4')))).toBe('d5');
  });

  it('tracks direction', () => {
    expect(intervalBetween(P('C4'), P('G4')).direction).toBe(1);
    expect(intervalBetween(P('G4'), P('C4')).direction).toBe(-1);
    expect(intervalAbbrev(intervalBetween(P('C4'), P('B3')))).toBe('m2');
  });

  it('transposes with correct spelling', () => {
    expect(pitchId(transpose(P('C4'), interval(5, 'perfect')))).toBe('G4');
    expect(pitchId(transpose(P('F#4'), interval(3, 'minor')))).toBe('A4');
    expect(pitchId(transpose(P('Bb3'), interval(6, 'major')))).toBe('G4');
    expect(pitchId(transpose(P('E4'), interval(3, 'major')))).toBe('G#4');
    expect(pitchId(transpose(P('C4'), interval(5, 'perfect', -1)))).toBe('F3');
  });

  it('inverts intervals so the numbers sum to nine', () => {
    expect(intervalAbbrev(invert(interval(3, 'major')))).toBe('m6');
    expect(intervalAbbrev(invert(interval(5, 'perfect')))).toBe('P4');
    expect(intervalAbbrev(invert(interval(2, 'minor')))).toBe('M7');
  });

  it('rejects impossible quality/number pairs', () => {
    expect(parseInterval('P3')).toBeNull();
    expect(parseInterval('M5')).toBeNull();
    expect(parseInterval('P5')).not.toBeNull();
  });

  it('names intervals for ear training from bare semitone counts', () => {
    expect(intervalName(intervalFromSemitones(7))).toBe('perfect fifth');
    expect(intervalName(intervalFromSemitones(3))).toBe('minor third');
    expect(intervalName(intervalFromSemitones(12))).toBe('perfect octave');
  });
});

describe('scale', () => {
  it('spells major scales with one letter per degree', () => {
    expect(spell(scaleNotes(P('C4'), 'major')))
      .toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    expect(spell(scaleNotes(P('Ab4'), 'major')))
      .toEqual(['Ab4', 'Bb4', 'C5', 'Db5', 'Eb5', 'F5', 'G5']);
    expect(spell(scaleNotes(P('F#4'), 'major')))
      .toEqual(['F#4', 'G#4', 'A#4', 'B4', 'C#5', 'D#5', 'E#5']);
  });

  it('raises the seventh in harmonic minor', () => {
    expect(spell(scaleNotes(P('A3'), 'harmonic-minor')))
      .toEqual(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G#4']);
  });

  it('spells modes off their own tonic', () => {
    expect(spell(scaleNotes(P('D4'), 'dorian')))
      .toEqual(['D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
    expect(spell(scaleNotes(P('E4'), 'phrygian')))
      .toEqual(['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);
  });
});

describe('key', () => {
  const K = (id: string): Key => {
    const found = [...allKeys('major'), ...allKeys('minor')].find((k) => keyId(k) === id);
    if (!found) throw new Error(`no key ${id}`);
    return found;
  };

  it('places keys correctly on the circle of fifths', () => {
    expect(keyFifths(K('C-major'))).toBe(0);
    expect(keyFifths(K('G-major'))).toBe(1);
    expect(keyFifths(K('F-major'))).toBe(-1);
    expect(keyFifths(K('Eb-major'))).toBe(-3);
    expect(keyFifths(K('F#-major'))).toBe(6);
    expect(keyFifths(K('A-minor'))).toBe(0);
    expect(keyFifths(K('C-minor'))).toBe(-3);
  });

  it('orders key-signature accidentals the way they are written', () => {
    expect(keySignatureAccidentals(K('D-major'))).toEqual({ steps: ['F', 'C'], alter: 1 });
    expect(keySignatureAccidentals(K('Eb-major')))
      .toEqual({ steps: ['B', 'E', 'A'], alter: -1 });
    expect(keySignatureAccidentals(K('C-major'))).toEqual({ steps: [], alter: 1 });
  });

  it('pairs relative and parallel keys', () => {
    expect(keyId(relativeKey(K('C-major')))).toBe('A-minor');
    expect(keyId(relativeKey(K('Eb-major')))).toBe('C-minor');
    expect(keyId(relativeKey(K('A-minor')))).toBe('C-major');
    expect(keyId(parallelKey(K('C-major')))).toBe('C-minor');
  });

  it('enumerates all fifteen spellings of each mode', () => {
    expect(allKeys('major')).toHaveLength(15);
    expect(allKeys('minor')).toHaveLength(15);
  });

  it('spells notes the way the key would write them', () => {
    expect(pitchId(spellInKey(66, K('D-major')))).toBe('F#4');
    expect(pitchId(spellInKey(70, K('Eb-major')))).toBe('Bb4');
    expect(pitchId(spellInKey(61, K('Db-major')))).toBe('Db4');
  });

  it('reports scale degrees, which is what ear training asks for', () => {
    expect(scaleDegreeOf(60, K('C-major'))).toBe(1);
    expect(scaleDegreeOf(67, K('C-major'))).toBe(5);
    expect(scaleDegreeOf(61, K('C-major'))).toBeNull(); // chromatic
  });

  it('renders readable key names', () => {
    expect(keyName(K('Eb-major'))).toBe('E♭ major');
    expect(keyName(K('F#-minor'))).toBe('F♯ minor');
  });
});

describe('chord', () => {
  it('spells triads and sevenths correctly', () => {
    expect(spell(chordTones(P('C4'), 'major'))).toEqual(['C4', 'E4', 'G4']);
    expect(spell(chordTones(P('A3'), 'minor'))).toEqual(['A3', 'C4', 'E4']);
    expect(spell(chordTones(P('C4'), 'dominant7'))).toEqual(['C4', 'E4', 'G4', 'Bb4']);
    expect(spell(chordTones(P('C4'), 'major7'))).toEqual(['C4', 'E4', 'G4', 'B4']);
    expect(spell(chordTones(P('B3'), 'minor7b5'))).toEqual(['B3', 'D4', 'F4', 'A4']);
  });

  it('spells chords that require double sharps without collapsing them', () => {
    // G#7 is G# B# D# F#, not G# C D# F#.
    expect(spell(chordTones(P('G#4'), 'dominant7')))
      .toEqual(['G#4', 'B#4', 'D#5', 'F#5']);
  });

  it('voices inversions by lifting the lowest tones an octave', () => {
    expect(chordVoicing({ root: P('C4'), quality: 'major', inversion: 0 }))
      .toEqual([60, 64, 67]);
    expect(chordVoicing({ root: P('C4'), quality: 'major', inversion: 1 }))
      .toEqual([64, 67, 72]);
    expect(chordVoicing({ root: P('C4'), quality: 'major', inversion: 2 }))
      .toEqual([67, 72, 76]);
  });

  it('names the bass note of each inversion', () => {
    expect(pitchId(bassNoteOf({ root: P('C4'), quality: 'major', inversion: 1 })))
      .toBe('E4');
    expect(chordSymbol({ root: P('C4'), quality: 'major', inversion: 1 })).toBe('C/E');
  });

  it('uses figured-bass shorthand for inversions', () => {
    expect(inversionFigure('major', 1)).toBe('6');
    expect(inversionFigure('major', 2)).toBe('6/4');
    expect(inversionFigure('dominant7', 1)).toBe('6/5');
    expect(inversionFigure('dominant7', 3)).toBe('4/2');
  });

  it('round-trips chord symbols', () => {
    for (const sym of ['C', 'Am', 'F#m7', 'Bbmaj7', 'G7', 'Dsus4', 'Bm7b5', 'Ddim7']) {
      const parsed = parseChordSymbol(sym);
      expect(parsed, sym).not.toBeNull();
      expect(chordId(parsed!), sym).toBe(sym.replace('b5', 'b5'));
    }
  });

  it('reads a slash bass that is a chord tone as an inversion', () => {
    const c = parseChordSymbol('C/E');
    expect(c?.inversion).toBe(1);
    expect(c?.bass).toBeUndefined();
  });

  it('keeps a non-chord-tone slash bass as a real slash chord', () => {
    const c = parseChordSymbol('C/D');
    expect(c?.inversion).toBe(0);
    expect(c?.bass).toBeDefined();
  });

  it('accepts common alternate notations', () => {
    expect(parseChordSymbol('CM7')?.quality).toBe('major7');
    expect(parseChordSymbol('C-')?.quality).toBe('minor');
    expect(parseChordSymbol('Cmin')?.quality).toBe('minor');
  });

  it('detects chords from sounding notes', () => {
    expect(detectChord([60, 64, 67])[0]?.symbol).toBe('C');
    expect(detectChord([57, 60, 64])[0]?.symbol).toBe('Am');
    expect(detectChord([60, 64, 67, 70])[0]?.symbol).toBe('C7');
    expect(detectChord([60, 64, 67, 71])[0]?.symbol).toBe('Cmaj7');
  });

  it('detects inversions from the bass note', () => {
    const m = detectChord([64, 67, 72])[0];
    expect(m?.symbol).toBe('C/E');
    expect(m?.chord.inversion).toBe(1);
  });

  it('accepts a chord played in any octave but respects inversion when asked', () => {
    const target = { root: P('C4'), quality: 'major' as const, inversion: 0 };
    expect(matchesChord([72, 76, 79], target)).toBe(true); // octave up, still correct
    expect(matchesChord([64, 67, 72], target)).toBe(true); // inversion ignored by default
    expect(matchesChord([64, 67, 72], target, { requireInversion: true })).toBe(false);
    expect(matchesChord([60, 64, 67], target, { requireInversion: true })).toBe(true);
  });

  it('rejects a chord with a wrong or missing note', () => {
    const target = { root: P('C4'), quality: 'major' as const, inversion: 0 };
    expect(matchesChord([60, 64], target)).toBe(false); // missing fifth
    expect(matchesChord([60, 63, 67], target)).toBe(false); // minor third
    expect(matchesChord([60, 64, 67, 69], target)).toBe(false); // extra note
  });
});
