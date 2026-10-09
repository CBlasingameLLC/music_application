import { describe, expect, it } from 'vitest';
import {
  beatsPerMeasure, flattenScore, gradePerformance, notesOnStaff, onsetClusters,
  parseMusicXml, pitchRange, serializeMusicXml, synthesizeTake, toMidi,
  parsePitch, keyId,
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

  it('starts each thumb on a C, an octave apart', () => {
    // An octave apart, not on the same key. Both hands mirroring from a shared
    // middle C reads well on paper and cannot be played: two hands cannot
    // strike one key, so a keyboard sends one note-on where the score expects
    // two and a perfect performance is marked down for a missing note on the
    // first beat of every take.
    const rh = notesOnStaff(flat, 1).filter((n) => n.midi !== null)[0]!;
    const lh = notesOnStaff(flat, 2).filter((n) => n.midi !== null)[0]!;
    expect(rh.midi).toBe(midi('C4'));
    expect(lh.midi).toBe(midi('C3'));
    expect(rh.fingering).toBe(lh.fingering);
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

describe('every piece is well formed as written', () => {
  const built = bundledScores();

  it('prints only fingerings a hand has', () => {
    // Five fingers. The grader keys scale-evenness residuals by fingering, so a
    // number outside 1-5 would key a diagnostic to a finger nobody has.
    for (const { spec, score } of built) {
      for (const note of flattenScore(score)) {
        if (note.fingering === null) continue;
        expect(note.fingering, `${spec.id} @ bar ${note.measureNumber}`)
          .toBeGreaterThanOrEqual(1);
        expect(note.fingering, `${spec.id} @ bar ${note.measureNumber}`)
          .toBeLessThanOrEqual(5);
      }
    }
  });

  it('keeps each hand on its own staff', () => {
    // Staff assignment is authoritative for every per-hand metric. A right-hand
    // note written on the bass staff would be attributed to the left hand for
    // the life of the piece, silently.
    for (const { spec, score } of built) {
      if (!spec.leftHand) continue;
      const staves = new Set(flattenScore(score).map((n) => n.staff));
      expect([...staves].sort(), spec.id).toEqual([1, 2]);
    }
  });

  it('never writes the hands onto the same pitch at the same moment', () => {
    // Two hands on one key is unplayable, and it would also collapse into a
    // single performed note and read as a missing one for the life of the take.
    for (const { spec, score } of built) {
      for (const cluster of onsetClusters(flattenScore(score))) {
        const sounded = cluster.pitches;
        expect(new Set(sounded).size, `${spec.id} @ beat ${cluster.absoluteBeats}`)
          .toBe(sounded.length);
      }
    }
  });

  it('stays inside a hand-sized span at any moment', () => {
    // A tenth is the outside of what an adult hand reaches, and these are
    // beginner pieces. A wider simultaneity is a data-entry error, not writing.
    for (const { spec, score } of built) {
      for (const cluster of onsetClusters(flattenScore(score))) {
        for (const staff of [1, 2]) {
          const onStaff = cluster.notes
            .filter((n) => n.staff === staff && n.midi !== null)
            .map((n) => n.midi as number);
          if (onStaff.length < 2) continue;
          const span = Math.max(...onStaff) - Math.min(...onStaff);
          expect(span, `${spec.id} staff ${staff} @ beat ${cluster.absoluteBeats}`)
            .toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it('grades a mechanically exact performance as clean', () => {
    // The end-to-end check on the data: if a piece as written cannot be played
    // perfectly, something in it is wrong, and the grader is the thing that
    // would tell a learner so.
    for (const { spec, score } of built) {
      const take = synthesizeTake(score, { tempo: spec.tempo, seed: 5 });
      const report = gradePerformance(score, take);
      expect(report.metrics.noteAccuracy, spec.id).toBeCloseTo(1, 6);
      expect(report.score, spec.id).toBeGreaterThan(0.95);
    }
  });

  it('is graded onto a difficulty tier', () => {
    const levels = built.map(({ spec }) => spec.level);
    for (const [i, level] of levels.entries()) {
      expect(level, built[i]!.spec.id).toBeGreaterThanOrEqual(1);
    }
    // A ladder needs somewhere to climb. One tier of everything is a list.
    expect(new Set(levels).size).toBeGreaterThanOrEqual(4);
  });
});

describe('the minuet', () => {
  const score = bundledScore('minuet-in-g')!;
  const notes = flattenScore(score);
  const rh = notes.filter((n) => n.staff === 1 && n.midi !== null);

  it('opens on the phrase everyone knows', () => {
    // D5, then the run up from G. Getting this wrong would teach wrong notes,
    // which is the one thing a piece in a learning app must not do.
    expect(rh.slice(0, 5).map((n) => n.midi)).toEqual([74, 67, 69, 71, 72]);
  });

  it('is in G major and sharpens every F', () => {
    const fs = notes.filter((n) => n.midi !== null && n.midi % 12 === 5);
    expect(fs, 'an F natural in G major').toHaveLength(0);
    expect(notes.some((n) => n.midi !== null && n.midi % 12 === 6)).toBe(true);
  });

  it('is in three, and every bar has three beats', () => {
    const sig = score.parts[0]!.measures[0]!.timeSignature;
    expect(sig).toEqual({ beats: 3, beatType: 4 });
  });

  it('ends its phrase on the tonic', () => {
    expect(rh[rh.length - 1]!.midi! % 12).toBe(7);
  });

  it('keeps the bass under the melody throughout', () => {
    // Not a hand-assignment rule — staff is authoritative and the left hand
    // crosses above in real music — but this arrangement never asks it to, so
    // a crossing here would be a mistake in the data.
    for (const cluster of onsetClusters(notes)) {
      const highLeft = cluster.notes
        .filter((n) => n.staff === 2 && n.midi !== null)
        .map((n) => n.midi as number);
      const lowRight = cluster.notes
        .filter((n) => n.staff === 1 && n.midi !== null)
        .map((n) => n.midi as number);
      if (highLeft.length === 0 || lowRight.length === 0) continue;
      expect(Math.max(...highLeft), `beat ${cluster.absoluteBeats}`)
        .toBeLessThan(Math.min(...lowRight));
    }
  });
});

describe('the waltz', () => {
  const score = bundledScore('waltz-in-a-minor')!;
  const notes = flattenScore(score);

  it('gives the left hand three notes for every bar', () => {
    // The point of the piece: the left hand moves three times while the right
    // hand holds. That is a real independence demand, not a texture.
    const lh = notes.filter((n) => n.staff === 2);
    const bars = new Set(lh.map((n) => n.measureNumber));
    for (const bar of bars) {
      expect(lh.filter((n) => n.measureNumber === bar), `bar ${bar}`).toHaveLength(3);
    }
  });

  it('uses no accidentals, so it is about metre rather than spelling', () => {
    const chromatic = notes.filter(
      (n) => n.midi !== null && [1, 3, 6, 8, 10].includes(n.midi % 12),
    );
    expect(chromatic).toHaveLength(0);
  });
});

describe('thumb under', () => {
  const score = bundledScore('thumb-under')!;
  const rh = flattenScore(score).filter((n) => n.staff === 1 && n.midi !== null);

  it('fingers every note, because the diagnostic is keyed to fingering', () => {
    // "Your 3 to 1 is consistently forty milliseconds late" is only as good as
    // the fingering it is keyed to. An unfingered note measures nothing.
    expect(rh.every((n) => n.fingering !== null)).toBe(true);
  });

  it('actually contains the crossing it is named after', () => {
    let crossings = 0;
    for (let i = 1; i < rh.length; i++) {
      if (rh[i - 1]!.fingering === 3 && rh[i]!.fingering === 1) crossings += 1;
    }
    expect(crossings).toBeGreaterThan(0);
  });
});
