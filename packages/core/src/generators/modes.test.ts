import { describe, expect, it } from 'vitest';
import { LADDERS, MODES, generateDrill, gradeDrill, gradeRhythm, modeMeta } from './modes.js';
import { evidenceFor, type ModeId, type Response } from './questions.js';
import { makeRng } from './rng.js';
import { chordVoicing } from '../theory/chord.js';
import { intervalAbbrev } from '../theory/interval.js';
import { SKILLS } from '../skills/taxonomy.js';

const MODE_IDS = MODES.map((m) => m.id);

/** The response that should score 1 for a given drill. */
function perfectResponse(drill: ReturnType<typeof generateDrill>): Response {
  const q = drill.question;
  switch (q.kind) {
    case 'play-chord':
      return { kind: 'notes', midi: chordVoicing(q.chord) };
    case 'identify-degree':
      return { kind: 'choice', value: String(q.degree) };
    case 'identify-interval':
      return { kind: 'choice', value: intervalAbbrev(q.interval) };
    case 'identify-progression':
      return { kind: 'sequence', values: [...q.numerals] };
    case 'key-signature':
      return { kind: 'choice', value: q.answer };
    case 'tap-rhythm': {
      const msPerBeat = 60000 / q.pattern.bpm;
      return {
        kind: 'taps',
        offsetsMs: q.pattern.events
          .filter((e) => !e.isRest)
          .map((e) => e.beat * msPerBeat),
      };
    }
  }
}

describe('mode metadata', () => {
  it('describes every mode, including why it exists', () => {
    for (const m of MODES) {
      expect(m.name.length, m.id).toBeGreaterThan(0);
      expect(m.why.length, m.id).toBeGreaterThan(20);
      expect(modeMeta(m.id).id).toBe(m.id);
    }
  });

  it('has a ladder for every mode with at least three rungs', () => {
    for (const id of MODE_IDS) {
      expect(LADDERS[id].rungs.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('only references skills that exist in the taxonomy', () => {
    const known = new Set(SKILLS.map((s) => s.id));
    for (const id of MODE_IDS) {
      for (const rung of LADDERS[id].rungs) {
        expect(rung.skillIds.length, `${id}/${rung.id}`).toBeGreaterThan(0);
        for (const sk of rung.skillIds) {
          expect(known.has(sk), `${id}/${rung.id} -> ${sk}`).toBe(true);
        }
      }
    }
  });

  it('gives every rung a unique id within its ladder', () => {
    for (const id of MODE_IDS) {
      const ids = LADDERS[id].rungs.map((r) => r.id);
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });
});

describe('drill generation', () => {
  it('is deterministic: the same seed regenerates the same drill', () => {
    for (const modeId of MODE_IDS) {
      for (let rung = 0; rung < LADDERS[modeId].rungs.length; rung++) {
        const a = generateDrill({ modeId, rungIndex: rung, seed: 12345 });
        const b = generateDrill({ modeId, rungIndex: rung, seed: 12345 });
        expect(JSON.stringify(b), `${modeId}/${rung}`).toBe(JSON.stringify(a));
      }
    }
  });

  it('produces different drills from different seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(JSON.stringify(generateDrill({ modeId: 'chord-sprint', rungIndex: 2, seed }).question));
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('clamps an out-of-range rung instead of throwing', () => {
    expect(() => generateDrill({ modeId: 'degrees', rungIndex: 99, seed: 1 })).not.toThrow();
    expect(() => generateDrill({ modeId: 'degrees', rungIndex: -5, seed: 1 })).not.toThrow();
  });

  it('always includes the correct answer among the offered choices', () => {
    const rng = makeRng(7);
    for (const modeId of MODE_IDS) {
      for (let rung = 0; rung < LADDERS[modeId].rungs.length; rung++) {
        for (let i = 0; i < 25; i++) {
          const drill = generateDrill({ modeId, rungIndex: rung, seed: rng.int(0, 1e9) });
          const q = drill.question;
          const label = `${modeId}/${rung}`;
          if (q.kind === 'identify-degree') {
            expect(q.choices, label).toContain(q.degree);
          } else if (q.kind === 'identify-interval') {
            expect(q.choices, label).toContain(intervalAbbrev(q.interval));
          } else if (q.kind === 'key-signature') {
            expect(q.choices, label).toContain(q.answer);
          } else if (q.kind === 'identify-progression') {
            for (const n of q.numerals) expect(q.choices, `${label} ${n}`).toContain(n);
          }
        }
      }
    }
  });

  it('scores a perfect response as fully correct, in every mode and rung', () => {
    const rng = makeRng(99);
    for (const modeId of MODE_IDS) {
      for (let rung = 0; rung < LADDERS[modeId].rungs.length; rung++) {
        for (let i = 0; i < 20; i++) {
          const drill = generateDrill({ modeId, rungIndex: rung, seed: rng.int(0, 1e9) });
          const grade = gradeDrill(drill, perfectResponse(drill));
          expect(grade.correctness, `${modeId}/${rung} seed ${drill.seed}`).toBeCloseTo(1, 5);
          expect(grade.correct, `${modeId}/${rung}`).toBe(true);
        }
      }
    }
  });

  it('scores a skip as zero and never crashes', () => {
    for (const modeId of MODE_IDS) {
      const drill = generateDrill({ modeId, rungIndex: 0, seed: 5 });
      expect(gradeDrill(drill, { kind: 'skipped' }).correctness).toBe(0);
    }
  });

  it('rejects a response of the wrong shape rather than throwing', () => {
    const drill = generateDrill({ modeId: 'chord-sprint', rungIndex: 0, seed: 3 });
    const grade = gradeDrill(drill, { kind: 'choice', value: 'nonsense' });
    expect(grade.correct).toBe(false);
  });

  it('gives specific feedback on a wrong chord, not just "wrong"', () => {
    const drill = generateDrill({ modeId: 'chord-sprint', rungIndex: 0, seed: 3 });
    if (drill.question.kind !== 'play-chord') throw new Error('expected a chord drill');
    const voicing = chordVoicing(drill.question.chord);
    // Drop the fifth.
    const grade = gradeDrill(drill, { kind: 'notes', midi: voicing.slice(0, 2) });
    expect(grade.correct).toBe(false);
    expect(grade.detail).toMatch(/missing/i);
  });

  it('awards base XP that rises with the rung', () => {
    const low = generateDrill({ modeId: 'chord-sprint', rungIndex: 0, seed: 1 });
    const high = generateDrill({ modeId: 'chord-sprint', rungIndex: 6, seed: 1 });
    expect(high.baseXp).toBeGreaterThan(low.baseXp);
  });

  it('emits skill evidence for every drill', () => {
    for (const modeId of MODE_IDS) {
      const drill = generateDrill({ modeId, rungIndex: 0, seed: 11 });
      const evidence = evidenceFor(drill, gradeDrill(drill, perfectResponse(drill)));
      expect(evidence.length, modeId).toBeGreaterThan(0);
      for (const e of evidence) expect(e.correctness).toBeCloseTo(1, 5);
    }
  });
});

describe('rhythm grading', () => {
  const pattern = {
    events: [
      { beat: 0, duration: 1, isRest: false },
      { beat: 1, duration: 1, isRest: false },
      { beat: 2, duration: 1, isRest: false },
      { beat: 3, duration: 1, isRest: false },
    ],
    beatsPerBar: 4, bars: 1, bpm: 60,
  };
  const perfect = [0, 1000, 2000, 3000];

  it('scores an exact performance as perfect', () => {
    expect(gradeRhythm(pattern, perfect).correctness).toBeCloseTo(1, 5);
  });

  it('scores slightly-off taps below perfect but still passing', () => {
    const g = gradeRhythm(pattern, [20, 1030, 1975, 3040]);
    expect(g.correctness).toBeGreaterThan(0.85);
    expect(g.correctness).toBeLessThanOrEqual(1);
  });

  it('penalizes consistently late taps', () => {
    const late = gradeRhythm(pattern, perfect.map((t) => t + 150));
    expect(late.correctness).toBeLessThan(0.6);
  });

  it('penalizes missing taps harder than imprecise ones', () => {
    const missing = gradeRhythm(pattern, [0, 1000, 2000]);
    const imprecise = gradeRhythm(pattern, [60, 1060, 2060, 3060]);
    expect(missing.correctness).toBeLessThan(imprecise.correctness);
  });

  it('penalizes extra taps', () => {
    const extra = gradeRhythm(pattern, [0, 500, 1000, 2000, 3000]);
    expect(extra.correctness).toBeLessThan(1);
    expect(extra.diagnostics.extraTaps).toBe(1);
  });

  it('reports mean absolute deviation, the metric MIDI timing will reuse', () => {
    const g = gradeRhythm(pattern, [50, 1050, 2050, 3050]);
    expect(g.diagnostics.meanAbsDeviationMs).toBe(50);
  });

  it('scores an empty attempt as zero', () => {
    expect(gradeRhythm(pattern, []).correctness).toBe(0);
  });
});
