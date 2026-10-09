import { describe, expect, it } from 'vitest';
import {
  LADDERS, MODES, generateDrill, gradeDrill, gradeReading, gradeRhythm, modeMeta,
} from './modes';
import { evidenceFor, type ModeId, type Response } from './questions';
import { makeRng } from './rng';
import { chordVoicing } from '../theory/chord';
import { intervalAbbrev } from '../theory/interval';
import { SKILLS } from '../skills/taxonomy';
import { synthesizeTake } from '../grading/synthesize';
import { registerRepertoire } from '../score/repertoire';
import { generateSightReading } from '../score/generate/sightReading';
import { allKeys, keyId } from '../theory/scale';

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
    case 'read-notation':
      return { kind: 'notes', midi: [...q.expected] };
    case 'play-independence':
      // A mechanically exact rendering of the exercise. Unlike every other
      // mode, this one is graded on a continuous measure rather than on
      // whether the answer matched, so "perfect" here means a take with no
      // injected fault, not a take that scores a literal 1.
      return {
        kind: 'take',
        take: synthesizeTake(q.score, { tempo: q.tempo, seed: 1 }),
      };
    case 'play-piece':
      // Also continuous rather than matched, and for the same reason: this is
      // the performance grader's score, not a comparison against an answer.
      return {
        kind: 'take',
        take: synthesizeTake(q.score, { tempo: q.tempoTarget, seed: 1 }),
      };
  }
}

/**
 * A catalogue for the Repertoire mode to draw on.
 *
 * Core cannot import `@etude/content` — content depends on core, not the other
 * way round — so the tests register material of their own, which is exactly the
 * seam the registry exists for. Generated phrases stand in for pieces: what is
 * under test is the mode, not the engraving.
 */
function registerTestRepertoire(): void {
  const key = [...allKeys('major')].find((k) => keyId(k) === 'C-major')!;
  registerRepertoire([1, 2, 3, 4, 5].map((level) => ({
    id: `fixture-${level}`,
    title: `Fixture ${level}`,
    composer: null,
    level,
    teaches: `Level ${level} fixture.`,
    tempo: 60 + level * 8,
    score: generateSightReading(
      {
        key,
        bars: 4,
        timeSignature: { beats: 4, beatType: 4 },
        range: [55, 79],
        hands: 2,
        rhythmUnits: [1, 0.5],
        maxLeap: 4,
        stepBias: 0.75,
        allowRests: true,
        tempo: 60 + level * 8,
      },
      100 + level,
    ),
  })));
}

registerTestRepertoire();

describe('mode metadata', () => {
  it('describes every mode, including why it exists', () => {
    for (const m of MODES) {
      expect(m.name.length, m.id).toBeGreaterThan(0);
      expect(m.why.length, m.id).toBeGreaterThan(20);
      expect(modeMeta(m.id).id).toBe(m.id);
    }
  });

  it('marks exactly the modes that record a performance as standalone', () => {
    // The invariant that keeps the flag honest. A take needs a metronome, a
    // count-in and a report; the shared runner has none of those and renders
    // nothing for a question kind it does not know, so a mode whose question is
    // a performance must not be schedulable into a session, and one whose
    // question is an answer must not be shut out of them.
    const TAKE_KINDS = new Set(['play-independence', 'play-piece']);
    for (const mode of MODES) {
      const drill = generateDrill({ modeId: mode.id, rungIndex: 0, seed: 17 });
      expect(TAKE_KINDS.has(drill.question.kind), mode.id).toBe(mode.standalone);
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
          const label = `${modeId}/${rung} seed ${drill.seed}`;
          if (modeId === 'independence' || modeId === 'repertoire') {
            // The two modes graded on a measurement rather than a match. Even
            // a mechanically exact take reads a percent or two of entrainment,
            // or a millisecond or two of timing deviation, because the measure
            // is continuous — demanding a literal 1 would be asserting a
            // precision the number does not carry.
            expect(grade.correctness, label).toBeGreaterThan(0.95);
          } else {
            expect(grade.correctness, label).toBeCloseTo(1, 5);
          }
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
      const continuous = modeId === 'independence' || modeId === 'repertoire';
      for (const e of evidence) {
        if (continuous) expect(e.correctness, modeId).toBeGreaterThan(0.95);
        else expect(e.correctness, modeId).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('reading grading', () => {
  const expected = [60, 62, 64, 65];

  it('scores a perfect read as correct', () => {
    const g = gradeReading(expected, [60, 62, 64, 65]);
    expect(g.correctness).toBe(1);
    expect(g.correct).toBe(true);
  });

  it('does not let one wrong note desync the rest', () => {
    // A single wrong note early must cost one note, not everything after it.
    const g = gradeReading(expected, [60, 61, 62, 64, 65]);
    expect(g.correctness).toBeGreaterThan(0.85);
    expect(g.diagnostics.matched).toBe(4);
  });

  it('reports missed notes', () => {
    const g = gradeReading(expected, [60, 62]);
    expect(g.diagnostics.missed).toBe(2);
    expect(g.correct).toBe(false);
    expect(g.detail).toMatch(/missed/);
  });

  it('penalises extra notes without erasing a mostly-correct read', () => {
    const g = gradeReading(expected, [60, 62, 64, 65, 67, 69]);
    expect(g.correctness).toBeLessThan(1);
    expect(g.correctness).toBeGreaterThan(0.5);
    expect(g.diagnostics.extraNotes).toBe(2);
  });

  it('scores an empty attempt as zero', () => {
    expect(gradeReading(expected, []).correctness).toBe(0);
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
