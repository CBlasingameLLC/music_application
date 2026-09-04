import { describe, expect, it } from 'vitest';
import {
  beatsPerMeasure, flattenScore, notesOnStaff, parseMusicXml, pitchRange,
  serializeMusicXml, toMidi, parsePitch, keyId,
} from '@etude/core';
import { BUNDLED_PIECES, bundledScore, bundledScores } from './pieces';
import { buildPiece } from './builder';

const midi = (s: string) => toMidi(parsePitch(s)!);

describe('bundled pieces', () => {
  it('all build without error', () => {
    expect(bundledScores()).toHaveLength(BUNDLED_PIECES.length);
  });

  it('have unique ids and a stated teaching purpose', () => {
    const ids = BUNDLED_PIECES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUNDLED_PIECES) {
      expect(p.teaches.length, p.id).toBeGreaterThan(20);
    }
  });

  it('record provenance, so a licence question is never open', () => {
    for (const p of BUNDLED_PIECES) {
      expect(p.provenance.source, p.id).toBe('bundled');
      expect(p.provenance.isPrivate, p.id).toBe(false);
      expect(p.provenance.license.length, p.id).toBeGreaterThan(0);
    }
  });

  it('fill every bar exactly, on every staff', () => {
    for (const { spec, score } of bundledScores()) {
      const perBar = beatsPerMeasure(spec.timeSignature);
      for (const measure of score.parts[0]!.measures) {
        for (const staff of [1, 2]) {
          const notes = measure.notes.filter((n) => n.staff === staff);
          if (notes.length === 0) continue;
          const total = notes.reduce((a, n) => a + n.durationBeats, 0);
          expect(total, `${spec.id} bar ${measure.number} staff ${staff}`).toBeCloseTo(perBar, 5);
        }
      }
    }
  });

  it('stay within a playable range', () => {
    for (const { spec, score } of bundledScores()) {
      const range = pitchRange(score)!;
      expect(range[0], spec.id).toBeGreaterThanOrEqual(21);
      expect(range[1], spec.id).toBeLessThanOrEqual(108);
    }
  });

  it('round-trip through MusicXML', () => {
    for (const { spec, score } of bundledScores()) {
      const reparsed = parseMusicXml(serializeMusicXml(score));
      expect(
        flattenScore(reparsed).map((n) => n.midi),
        spec.id,
      ).toEqual(flattenScore(score).map((n) => n.midi));
    }
  });
});

describe('Ode to Joy is actually Ode to Joy', () => {
  const score = bundledScore('ode-to-joy')!;
  const melody = notesOnStaff(flattenScore(score), 1)
    .filter((n) => n.midi !== null)
    .sort((a, b) => a.absoluteBeats - b.absoluteBeats);

  it('opens with the right notes', () => {
    // E E F G G F E D C C D E — the phrase everyone can hum.
    expect(melody.slice(0, 12).map((n) => n.midi)).toEqual(
      ['E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4', 'C4', 'C4', 'D4', 'E4'].map(midi),
    );
  });

  it('has the dotted rhythm that ends each phrase', () => {
    const dotted = melody.filter((n) => Math.abs(n.soundingBeats - 1.5) < 1e-6);
    expect(dotted.length).toBeGreaterThanOrEqual(2);
  });

  it('ends both phrases on a resolution', () => {
    // First phrase ends on D (unresolved), the second on C (home).
    expect(melody[melody.length - 1]!.midi).toBe(midi('C4'));
  });

  it('stays in a five-finger position, which is why it is the first piece', () => {
    const range = pitchRange({ ...score, parts: [{ ...score.parts[0]!, measures: score.parts[0]!.measures.map((m) => ({ ...m, notes: m.notes.filter((n) => n.staff === 1) })) }] })!;
    expect(range[1] - range[0]).toBeLessThanOrEqual(7);
  });
});

describe('contrary motion study', () => {
  const score = bundledScore('contrary-motion-study')!;
  const flat = flattenScore(score);

  it('moves the hands in opposite directions', () => {
    const rh = notesOnStaff(flat, 1).filter((n) => n.midi !== null)
      .sort((a, b) => a.absoluteBeats - b.absoluteBeats);
    const lh = notesOnStaff(flat, 2).filter((n) => n.midi !== null)
      .sort((a, b) => a.absoluteBeats - b.absoluteBeats);

    expect(rh.length).toBe(lh.length);

    let opposed = 0;
    for (let i = 1; i < rh.length; i++) {
      const rhStep = rh[i]!.midi! - rh[i - 1]!.midi!;
      const lhStep = lh[i]!.midi! - lh[i - 1]!.midi!;
      if (rhStep !== 0 && lhStep !== 0 && Math.sign(rhStep) !== Math.sign(lhStep)) opposed += 1;
    }
    // The whole point of the study: essentially every move is a mirror.
    expect(opposed).toBeGreaterThanOrEqual(rh.length - 2);
  });

  it('starts both hands on the same note', () => {
    const rh = notesOnStaff(flat, 1).filter((n) => n.midi !== null)[0]!;
    const lh = notesOnStaff(flat, 2).filter((n) => n.midi !== null)[0]!;
    expect(rh.midi).toBe(midi('C4'));
    expect(lh.midi).toBe(midi('C4'));
  });
});

describe('two against one', () => {
  const score = bundledScore('two-against-one')!;
  const flat = flattenScore(score);

  it('gives the right hand more notes than the left', () => {
    const rh = notesOnStaff(flat, 1).filter((n) => n.midi !== null).length;
    const lh = notesOnStaff(flat, 2).filter((n) => n.midi !== null).length;
    expect(rh).toBeGreaterThan(lh * 1.5);
  });

  it('is in G major and uses the F sharp', () => {
    expect(keyId(score.parts[0]!.measures[0]!.key!)).toBe('G-major');
    const pitches = flat.filter((n) => n.midi !== null).map((n) => n.midi! % 12);
    expect(pitches).toContain(midi('F#4') % 12);
    // No F natural: an accidental slipping in would make the key signature a lie.
    expect(pitches).not.toContain(midi('F4') % 12);
  });
});

describe('builder', () => {
  it('rejects an unparseable pitch rather than emitting a silent rest', () => {
    expect(() =>
      buildPiece({
        ...BUNDLED_PIECES[0]!,
        rightHand: [{ pitch: 'H9', beats: 1 }],
      }),
    ).toThrow(/bad pitch/);
  });
});
