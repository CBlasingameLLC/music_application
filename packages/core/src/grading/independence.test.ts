import { describe, expect, it } from 'vitest';
import {
  judgeIndependence, ENTRAINMENT_LIMIT, type IndependenceExpectation,
} from './independence';
import { synthesizeTake } from './synthesize';
import {
  generateIndependence, assertHandsSeparated, handForPitch,
  type IndependenceParams, type IndependenceRatio,
} from '../score/generate/independence';
import { flattenScore } from '../score/timeline';
import { allKeys, keyId, type Key } from '../theory/scale';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

const SPLIT = 60;

function params(over: Partial<IndependenceParams> = {}): IndependenceParams {
  return {
    key: K('C-major'),
    bars: 8,
    timeSignature: { beats: 4, beatType: 4 },
    ratio: '2:1',
    splitPoint: SPLIT,
    rightCeiling: 79,
    leftMotion: 4,
    articulation: null,
    dynamics: null,
    rightImprovises: false,
    tempo: 80,
    ...over,
  };
}

function expectation(over: Partial<IndependenceExpectation> = {}): IndependenceExpectation {
  return { aspect: 'rhythm', splitPoint: SPLIT, articulation: null, dynamics: null, ...over };
}

describe('the generated exercise', () => {
  const RATIOS: IndependenceRatio[] = ['1:1', '2:1', '3:1', '3:2'];

  it('never lets the hands share a register, across many seeds', () => {
    // The whole live hand-attribution scheme rests on this invariant. A
    // generator change that let the hands overlap would break no rendering and
    // silently start attributing notes to the wrong hand.
    for (const ratio of RATIOS) {
      for (let seed = 0; seed < 120; seed++) {
        const score = generateIndependence(params({ ratio }), seed);
        const report = assertHandsSeparated(score, SPLIT);
        expect(report.ok, `${ratio} seed ${seed}: ${report.highestLeft} / ${report.lowestRight}`)
          .toBe(true);
      }
    }
  });

  it('notates the ratio it was asked for', () => {
    const expected: Record<IndependenceRatio, number> = {
      '1:1': 1, '2:1': 2, '3:1': 3, '3:2': 1.5,
    };
    for (const ratio of RATIOS) {
      const notes = flattenScore(generateIndependence(params({ ratio }), 4));
      const right = notes.filter((n) => n.staff === 1).length;
      const left = notes.filter((n) => n.staff === 2).length;
      expect(right / left, ratio).toBeCloseTo(expected[ratio], 5);
    }
  });

  it('gives every note a staff, because the grader assigns hands from it', () => {
    for (const note of flattenScore(generateIndependence(params(), 11))) {
      expect(note.staff === 1 || note.staff === 2).toBe(true);
    }
  });

  it('attributes a live pitch to the hand that owns that register', () => {
    expect(handForPitch(48, SPLIT)).toBe('left');
    expect(handForPitch(59, SPLIT)).toBe('left');
    expect(handForPitch(60, SPLIT)).toBe('right');
    expect(handForPitch(72, SPLIT)).toBe('right');
  });
});

describe('judging a take', () => {
  const score = generateIndependence(params(), 5);

  it('passes a clean take', () => {
    const take = synthesizeTake(score, { tempo: 80, seed: 3, faults: { jitterMs: 8 } });
    const report = judgeIndependence(score, take, expectation());
    const rhythm = report.verdicts.find((v) => v.aspect === 'rhythm');

    expect(rhythm?.measurable).toBe(true);
    expect(rhythm?.held).toBe(true);
    expect(report.correctness).toBeGreaterThan(0.8);
  });

  it('catches a hand riding the other one', () => {
    const take = synthesizeTake(score, {
      tempo: 80, seed: 3, faults: { entrainment: 0.8, jitterMs: 8 },
    });
    const report = judgeIndependence(score, take, expectation());
    const rhythm = report.verdicts.find((v) => v.aspect === 'rhythm');

    expect(rhythm?.held).toBe(false);
    expect(report.findings.some((f) => /drifting onto/.test(f))).toBe(true);
  });

  it('recovers how entrained the take actually was, at every ratio', () => {
    // The property that matters more than any threshold: the number has to
    // track the fault. A metric can pass a pass/fail test while being
    // non-monotone or uncalibrated, and it would be useless as a progress
    // signal. Two earlier versions of this measure read a confident 0.000 on
    // takes that were entrained to the point of collapse.
    // At 2:1 and 3:1 only the right hand is notated off the other, so every
    // note the measure looks at is one the fixture displaced — the reported
    // number should *be* the injected fault, not merely track it. A scale-free
    // measure is what makes progress comparable across rungs and sessions.
    for (const ratio of ['2:1', '3:1'] as IndependenceRatio[]) {
      const exercise = generateIndependence(params({ ratio }), 5);
      for (const injected of [0, 0.2, 0.4]) {
        const take = synthesizeTake(exercise, {
          tempo: 80, seed: 3, faults: { entrainment: injected, jitterMs: 8 },
        });
        const verdict = judgeIndependence(exercise, take, expectation())
          .verdicts.find((v) => v.aspect === 'rhythm');

        expect(verdict?.measurable, `${ratio} @ ${injected}`).toBe(true);
        expect(1 - (verdict?.score ?? 0), `${ratio} @ ${injected}`)
          .toBeCloseTo(injected, 1);
      }
    }
  });

  it('averages over both hands when both are notated apart', () => {
    // At 3:2 each hand has notes sitting off the other, but only one hand
    // gives way. The measure averages over every note that *could* have
    // drifted, so it lands below the injected figure — which is the honest
    // answer, not a miscalibration: half the notes at risk held their ground.
    const exercise = generateIndependence(params({ ratio: '3:2' }), 5);
    const measured = [0, 0.2, 0.4].map((injected) => {
      const take = synthesizeTake(exercise, {
        tempo: 80, seed: 3, faults: { entrainment: injected, jitterMs: 8 },
      });
      const verdict = judgeIndependence(exercise, take, expectation())
        .verdicts.find((v) => v.aspect === 'rhythm');
      return 1 - (verdict?.score ?? 0);
    });

    expect(measured[0]!).toBeLessThan(0.1);
    expect(measured[1]!).toBeGreaterThan(measured[0]!);
    expect(measured[2]!).toBeGreaterThan(measured[1]!);
  });

  it('fails a badly entrained take at every ratio, however it fell apart', () => {
    // Past a point the hands merge outright and the measure saturates, so this
    // asserts the verdict rather than the number. What must never happen is a
    // collapsed take reading as held — two earlier versions of this measure
    // did exactly that, which is the worst possible failure for a progress
    // signal.
    for (const ratio of ['2:1', '3:1', '3:2'] as IndependenceRatio[]) {
      const exercise = generateIndependence(params({ ratio }), 5);
      for (const injected of [0.7, 1]) {
        const take = synthesizeTake(exercise, {
          tempo: 80, seed: 3, faults: { entrainment: injected, jitterMs: 8 },
        });
        const report = judgeIndependence(exercise, take, expectation());
        const verdict = report.verdicts.find((v) => v.aspect === 'rhythm');

        expect(verdict?.held, `${ratio} @ ${injected}`).toBe(false);
        expect(report.correctness, `${ratio} @ ${injected}`).toBeLessThan(0.75);
      }
    }
  });

  it('has nothing to measure when the hands always play together', () => {
    // 1:1 is the control rung. Every onset carries both hands, so no note can
    // drift toward the other — and saying so is better than reporting a zero
    // that looks like a perfect score.
    const together = generateIndependence(params({ ratio: '1:1' }), 5);
    const take = synthesizeTake(together, { tempo: 80, seed: 3, faults: { entrainment: 0.9 } });
    const verdict = judgeIndependence(together, take, expectation())
      .verdicts.find((v) => v.aspect === 'rhythm');

    expect(verdict?.measurable).toBe(false);
    expect(verdict?.score).toBeNull();
  });
});

describe('holding two articulations at once', () => {
  const articulation = { right: 'legato' as const, left: 'staccato' as const };
  const score = generateIndependence(params({ articulation }), 12);
  const expect_ = expectation({ aspect: 'articulation', articulation });

  it('passes a take that keeps them apart', () => {
    const take = synthesizeTake(score, { tempo: 80, seed: 4, faults: { jitterMs: 8 } });
    const verdict = judgeIndependence(score, take, expect_)
      .verdicts.find((v) => v.aspect === 'articulation');

    expect(verdict?.measurable).toBe(true);
    expect(verdict?.held).toBe(true);
  });

  it('catches both hands coming out the same length', () => {
    // The signature of articulation independence failing: the staccato hand
    // quietly starts holding as long as the legato one.
    const take = synthesizeTake(score, {
      tempo: 80, seed: 4, faults: { articulationCollapse: true, jitterMs: 8 },
    });
    const report = judgeIndependence(score, take, expect_);
    const verdict = report.verdicts.find((v) => v.aspect === 'articulation');

    expect(verdict?.measurable).toBe(true);
    expect(verdict?.held).toBe(false);
    expect(report.findings.some((f) => /same length/.test(f))).toBe(true);
  });
});

describe('holding two dynamics at once', () => {
  const dynamics = { right: 'f', left: 'p' };
  const score = generateIndependence(params({ dynamics }), 15);
  const expect_ = expectation({ aspect: 'dynamics', dynamics });

  it('passes a take that keeps the hands apart in volume', () => {
    const take = synthesizeTake(score, { tempo: 80, seed: 6, faults: { jitterMs: 8 } });
    const verdict = judgeIndependence(score, take, expect_)
      .verdicts.find((v) => v.aspect === 'dynamics');

    expect(verdict?.measurable).toBe(true);
    expect(verdict?.held).toBe(true);
  });

  it('catches the quiet hand coming up to meet the loud one', () => {
    const take = synthesizeTake(score, {
      tempo: 80, seed: 6, faults: { dynamicCollapse: true, jitterMs: 8 },
    });
    const verdict = judgeIndependence(score, take, expect_)
      .verdicts.find((v) => v.aspect === 'dynamics');

    expect(verdict?.measurable).toBe(true);
    expect(verdict?.held).toBe(false);
  });
});

describe('dynamics without a velocity source', () => {
  it('reports unavailable rather than a number about nothing', () => {
    const dynamics = { right: 'f', left: 'p' };
    const score = generateIndependence(params({ dynamics }), 9);
    const take = synthesizeTake(score, { tempo: 80, seed: 2 });
    // A touchscreen take: velocities are nominal, so nothing can be concluded.
    const report = judgeIndependence(
      score,
      { ...take, hasVelocity: false },
      expectation({ aspect: 'dynamics', dynamics }),
    );

    const verdict = report.verdicts.find((v) => v.aspect === 'dynamics');
    expect(verdict?.measurable).toBe(false);
    expect(verdict?.score).toBeNull();
    expect(verdict?.detail).toMatch(/no velocity/);
  });

  it('falls back to note accuracy so the rung is still gradeable', () => {
    const dynamics = { right: 'f', left: 'p' };
    const score = generateIndependence(params({ dynamics }), 9);
    const take = synthesizeTake(score, { tempo: 80, seed: 2 });
    const report = judgeIndependence(
      score,
      { ...take, hasVelocity: false },
      expectation({ aspect: 'dynamics', dynamics }),
    );
    expect(report.correctness).toBeCloseTo(report.performance.metrics.noteAccuracy, 5);
  });
});
