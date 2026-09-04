import { describe, expect, it } from 'vitest';
import { alignClusters, alignedPairs, defaultBand, pitchSetSimilarity } from './align';
import { clusterPerformance } from './take';
import { synthesizeTake } from './synthesize';
import { flattenScore, onsetClusters, msPerBeat } from '../score/timeline';
import { fitTempoMap, tempoStability } from './tempoMap';
import { generateSightReading } from '../score/generate/sightReading';
import { allKeys, keyId, type Key } from '../theory/scale';
import type { Score } from '../score/model';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

function phrase(bars = 8, seed = 12, hands: 1 | 2 = 1): Score {
  return generateSightReading(
    {
      key: K('C-major'),
      bars,
      timeSignature: { beats: 4, beatType: 4 },
      range: [60, 79],
      hands,
      rhythmUnits: [1, 0.5],
      maxLeap: 3,
      stepBias: 0.75,
      allowRests: false,
      tempo: 80,
    },
    seed,
  );
}

function align(score: Score, faults = {}, tempo = 80, seed = 7) {
  const expected = onsetClusters(flattenScore(score));
  const take = synthesizeTake(score, { tempo, seed, faults });
  const performed = clusterPerformance(take.notes);
  return { expected, performed, take, alignment: alignClusters(expected, performed) };
}

describe('pitch-set similarity', () => {
  it('scores identical sets as 1 and disjoint as 0', () => {
    expect(pitchSetSimilarity([60, 64, 67], [60, 64, 67])).toBe(1);
    expect(pitchSetSimilarity([60, 64, 67], [61, 65, 68])).toBe(0);
  });

  it('scores a partial chord proportionally rather than wholly wrong', () => {
    expect(pitchSetSimilarity([60, 64, 67], [60, 64])).toBeCloseTo(2 / 3, 5);
  });

  it('treats an octave error as an error, because reading is exact pitch', () => {
    expect(pitchSetSimilarity([60], [72])).toBe(0);
  });
});

describe('alignment', () => {
  it('matches a perfect take completely', () => {
    const { expected, alignment } = align(phrase());
    expect(alignment.matched).toBe(expected.length);
    expect(alignment.deleted).toBe(0);
    expect(alignment.inserted).toBe(0);
    expect(alignment.substituted).toBe(0);
  });

  it('reports a dropped note as exactly one deletion', () => {
    const { alignment } = align(phrase(), { dropped: 1 });
    expect(alignment.deleted).toBe(1);
    expect(alignment.inserted).toBe(0);
    expect(alignment.substituted).toBe(0);
  });

  it('reports a wrong note as a substitution, not a gap', () => {
    const { alignment } = align(phrase(), { wrongNotes: 1 });
    expect(alignment.substituted).toBe(1);
    expect(alignment.deleted).toBe(0);
    expect(alignment.inserted).toBe(0);
  });

  it('reports an extra note as an insertion', () => {
    const { alignment } = align(phrase(), { extraNotes: 1 });
    expect(alignment.inserted).toBe(1);
    expect(alignment.deleted).toBe(0);
  });

  it('does not let one missed note desync the rest of the take', () => {
    // The property DTW cannot provide, and the reason affine gaps are used.
    const score = phrase(16, 44);
    const expected = onsetClusters(flattenScore(score));
    const { alignment } = align(score, { dropped: 1 });

    expect(alignment.matched).toBe(expected.length - 1);
    expect(alignment.substituted).toBe(0);
    expect(alignment.inserted).toBe(0);

    // Everything after the gap must still be matched in order.
    const firstGap = alignment.steps.findIndex((s) => s.kind === 'deletion');
    const after = alignment.steps.slice(firstGap + 1);
    expect(after.every((s) => s.kind === 'match')).toBe(true);
  });

  it('charges a skipped run once, not once per note', () => {
    // Affine gaps: a long omission should cost one opening plus extends, which
    // is what keeps a lost bar from reading as a catastrophic take.
    const score = phrase(16, 90);
    const expected = onsetClusters(flattenScore(score));
    const take = synthesizeTake(score, { tempo: 80, seed: 3 });
    const performed = clusterPerformance(take.notes);

    // Remove a contiguous run of six clusters.
    const truncated = [...performed.slice(0, 4), ...performed.slice(10)];
    const alignment = alignClusters(expected, truncated);

    expect(alignment.deleted).toBe(6);
    expect(alignment.matched).toBe(expected.length - 6);
    expect(alignment.substituted).toBe(0);
  });

  it('is unaffected by tempo, because timing is the tempo map job', () => {
    const score = phrase();
    const expected = onsetClusters(flattenScore(score));
    const fast = align(score, { tempoDrift: 0.25 });
    expect(fast.alignment.matched).toBe(expected.length);
  });

  it('handles an empty performance without throwing', () => {
    const expected = onsetClusters(flattenScore(phrase()));
    const alignment = alignClusters(expected, []);
    expect(alignment.deleted).toBe(expected.length);
    expect(alignment.matched).toBe(0);
  });

  it('handles an empty score without throwing', () => {
    const take = synthesizeTake(phrase(), { tempo: 80 });
    const alignment = alignClusters([], clusterPerformance(take.notes));
    expect(alignment.inserted).toBeGreaterThan(0);
    expect(alignment.matched).toBe(0);
  });

  it('sizes the band to absorb realistic length differences', () => {
    expect(defaultBand(100, 100)).toBeGreaterThanOrEqual(50);
    expect(defaultBand(1000, 900)).toBeGreaterThan(100);
  });

  it('stays fast enough to run inline on a tablet', () => {
    const score = phrase(32, 5, 2);
    const expected = onsetClusters(flattenScore(score));
    const take = synthesizeTake(score, { tempo: 80, seed: 2, faults: { jitterMs: 15 } });
    const performed = clusterPerformance(take.notes);

    // Date.now rather than performance.now: core targets ES2022 without DOM
    // libs, and millisecond resolution is ample for a "not seconds" assertion.
    const started = Date.now();
    alignClusters(expected, performed);
    const elapsed = Date.now() - started;

    // Generous, because CI machines vary. The point is that it is milliseconds
    // rather than seconds, which is what settles the Web Worker question.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('chord handling', () => {
  it('matches a rolled chord as one chord rather than several events', () => {
    const score = phrase(8, 21, 2);
    const expected = onsetClusters(flattenScore(score));
    const { alignment } = align(score, { rolledChords: 2, rollMs: 90 }, 80, 11);

    // A roll must not manufacture extra clusters or lose notated ones.
    expect(alignment.inserted).toBe(0);
    expect(alignment.deleted).toBe(0);
    expect(alignment.matched).toBe(expected.length);
  });
});

describe('tempo map', () => {
  function anchorsFor(score: Score, faults = {}, tempo = 80, seed = 7) {
    const { expected, performed, alignment } = align(score, faults, tempo, seed);
    return alignedPairs(alignment).map((pair) => ({
      scoreBeats: expected[pair.expectedIndex]!.absoluteBeats,
      wallMs: performed[pair.performedIndex]!.onsetMs,
    }));
  }

  it('recovers the tempo of a clean take', () => {
    const map = fitTempoMap(anchorsFor(phrase(), {}, 96));
    expect(map.medianBpm).toBeCloseTo(96, 0);
  });

  it('predicts onsets with near-zero residuals on a clean take', () => {
    const score = phrase();
    const { expected, performed, alignment } = align(score, {}, 80);
    const map = fitTempoMap(
      alignedPairs(alignment).map((p) => ({
        scoreBeats: expected[p.expectedIndex]!.absoluteBeats,
        wallMs: performed[p.performedIndex]!.onsetMs,
      })),
    );
    for (const pair of alignedPairs(alignment)) {
      const residual =
        performed[pair.performedIndex]!.onsetMs -
        map.predict(expected[pair.expectedIndex]!.absoluteBeats);
      expect(Math.abs(residual)).toBeLessThan(1);
    }
  });

  it('absorbs a tempo change into the map rather than into the residuals', () => {
    // The distinction that matters: playing the whole passage faster is not the
    // same as playing every note late.
    const score = phrase(16, 33);
    const { expected, performed, alignment } = align(score, { tempoDrift: 0.15 }, 80, 4);
    const map = fitTempoMap(
      alignedPairs(alignment).map((p) => ({
        scoreBeats: expected[p.expectedIndex]!.absoluteBeats,
        wallMs: performed[p.performedIndex]!.onsetMs,
      })),
    );

    const residuals = alignedPairs(alignment).map((p) =>
      Math.abs(
        performed[p.performedIndex]!.onsetMs -
          map.predict(expected[p.expectedIndex]!.absoluteBeats),
      ),
    );
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    expect(mean).toBeLessThan(20);

    // And the drift itself is detected.
    expect(tempoStability(map).driftBpmPerBeat).toBeGreaterThan(0);
  });

  it('is not dragged off course by a single hesitation', () => {
    // Least squares would tilt the whole curve toward the outlier; Theil-Sen
    // medians should leave the rest of the take alone.
    const score = phrase(16, 61);
    const { expected, performed, alignment } = align(
      score, { hesitations: 1, hesitationMs: 900 }, 80, 9,
    );
    const map = fitTempoMap(
      alignedPairs(alignment).map((p) => ({
        scoreBeats: expected[p.expectedIndex]!.absoluteBeats,
        wallMs: performed[p.performedIndex]!.onsetMs,
      })),
    );
    expect(map.medianBpm).toBeCloseTo(80, 0);
  });

  it('reports a steady take as steady', () => {
    const map = fitTempoMap(anchorsFor(phrase(), {}, 80));
    expect(tempoStability(map).coefficientOfVariation).toBeLessThan(0.02);
  });

  it('predicts sensibly outside the range of its anchors', () => {
    const map = fitTempoMap([
      { scoreBeats: 4, wallMs: 3000 },
      { scoreBeats: 8, wallMs: 6000 },
    ]);
    expect(map.predict(0)).toBeLessThan(3000);
    expect(map.predict(12)).toBeGreaterThan(6000);
  });

  it('survives having no anchors at all', () => {
    const map = fitTempoMap([]);
    expect(Number.isFinite(map.predict(4))).toBe(true);
    expect(Number.isFinite(map.medianBpm)).toBe(true);
  });
});

describe('performance clustering', () => {
  it('keeps genuine sixteenths apart at a fast tempo', () => {
    // 160 bpm sixteenths are 94 ms apart; a fixed 50 ms window would be fine,
    // but a naive wider one would merge them into chords never played.
    const notes = [0, 94, 188, 282].map((onsetMs, i) => ({
      midi: 60 + i, onsetMs, offsetMs: onsetMs + 80, velocity: 0.7,
    }));
    expect(clusterPerformance(notes)).toHaveLength(4);
  });

  it('groups a rolled chord into one cluster', () => {
    const notes = [0, 28, 55].map((onsetMs, i) => ({
      midi: [60, 64, 67][i]!, onsetMs, offsetMs: onsetMs + 500, velocity: 0.7,
    }));
    const clusters = clusterPerformance(notes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.spreadMs).toBe(55);
  });

  it('records chord spread, which is a metric rather than an error', () => {
    const notes = [0, 40].map((onsetMs, i) => ({
      midi: 60 + i * 4, onsetMs, offsetMs: onsetMs + 400, velocity: 0.7,
    }));
    expect(clusterPerformance(notes)[0]!.spreadMs).toBe(40);
  });

  it('returns nothing for an empty performance', () => {
    expect(clusterPerformance([])).toEqual([]);
  });
});
