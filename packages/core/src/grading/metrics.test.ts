import { describe, expect, it } from 'vitest';
import {
  gradePerformance, TEMPO_DRIFT_LIMIT, TEMPO_INSTABILITY_LIMIT,
} from './grade';
import { synthesizeTake, FAULT_PRESETS, type SynthesisFaults } from './synthesize';
import { generateSightReading } from '../score/generate/sightReading';
import { allKeys, keyId, type Key } from '../theory/scale';
import {
  GENERATED_PROVENANCE, makeMeasure, makeNote, type Score,
} from '../score/model';
import { parsePitch } from '../theory/pitch';

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

function grade(score: Score, faults: SynthesisFaults = {}, seed = 7, tempo = 80) {
  return gradePerformance(score, synthesizeTake(score, { tempo, seed, faults }));
}

describe('a perfect take', () => {
  const report = grade(phrase());

  it('scores full marks', () => {
    expect(report.metrics.noteAccuracy).toBe(1);
    expect(report.score).toBeGreaterThan(0.95);
  });

  it('reports essentially no timing error', () => {
    expect(report.metrics.timing.meanAbsDeviationMs).toBeLessThan(1);
  });

  it('recovers the tempo', () => {
    expect(report.metrics.tempo.medianBpm).toBeCloseTo(80, 0);
  });

  it('finds nothing to fix', () => {
    expect(report.findings).toEqual(['Clean take. Nothing to fix here.']);
  });
});

describe('a dropped note', () => {
  const report = grade(phrase(16, 44), { dropped: 1 });

  it('is reported as one missing note, not a ruined take', () => {
    expect(report.alignment.deleted).toBe(1);
    expect(report.metrics.noteAccuracy).toBeGreaterThan(0.9);
  });

  it('leaves the timing of everything else intact', () => {
    // The anti-cascade property, measured rather than assumed.
    expect(report.metrics.timing.meanAbsDeviationMs).toBeLessThan(5);
  });

  it('says which bar it was in', () => {
    expect(report.metrics.errorLocations.length).toBeGreaterThan(0);
    expect(report.findings[0]).toMatch(/bar \d+/);
  });
});

describe('playing the whole passage faster', () => {
  const report = grade(phrase(16, 33), { tempoDrift: 0.15 }, 4);

  it('is not mistaken for playing every note late', () => {
    // The distinction the tempo map exists to make.
    expect(report.metrics.timing.meanAbsDeviationMs).toBeLessThan(25);
    expect(report.metrics.noteAccuracy).toBe(1);
  });

  it('is detected as tempo drift', () => {
    expect(report.metrics.tempo.driftBpmPerBeat).toBeGreaterThan(0);
    expect(report.metrics.tempo.driftFraction).toBeGreaterThan(TEMPO_DRIFT_LIMIT);
    expect(report.findings.some((f) => /speeding up/.test(f))).toBe(true);
  });

  it('is steady while it drifts, which is why variation cannot be the gate', () => {
    // The regression this locks in. An accelerando that is *smooth* barely
    // varies about its own trend, so a finding keyed on the coefficient of
    // variation fires least reliably on exactly the takes where the rush is
    // most controlled. Drift and instability have to be measured separately.
    expect(report.metrics.tempo.instabilityCv).toBeLessThan(TEMPO_INSTABILITY_LIMIT);
    expect(report.metrics.tempo.instabilityCv).toBeLessThan(
      report.metrics.tempo.coefficientOfVariation,
    );
    expect(report.findings.some((f) => /unsteady/.test(f))).toBe(false);
  });
});

describe('a take that stops dead', () => {
  const report = grade(phrase(8, 21), { hesitations: 2, hesitationMs: 800 }, 5);

  it('is located rather than averaged away', () => {
    expect(report.metrics.hesitations.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => /stopped to think/.test(f))).toBe(true);
  });

  it('does not report a phantom accelerando', () => {
    // Pauses shift every later onset without changing the pulse, and a trend
    // fitted through them reads as a large tempo change that never happened.
    // The take is unsteady, so no trend is claimed at all — an honest gap
    // beats a confident wrong number, and the hesitation finding has already
    // named the real problem.
    expect(report.metrics.tempo.instabilityCv).toBeGreaterThan(TEMPO_INSTABILITY_LIMIT);
    expect(report.findings.some((f) => /speeding up|slowing down/.test(f))).toBe(false);
  });
});

describe('a pulse that wanders with nothing to point at', () => {
  const report = grade(phrase(12, 44), { tempoWobble: 0.4, wobblePeriodBeats: 8 }, 9);

  it('is named as unsteadiness rather than as drift', () => {
    expect(report.metrics.tempo.instabilityCv).toBeGreaterThan(TEMPO_INSTABILITY_LIMIT);
    expect(report.findings.some((f) => /unsteady/.test(f))).toBe(true);
    expect(report.findings.some((f) => /speeding up|slowing down/.test(f))).toBe(false);
  });

  it('is a different fault from noise around a steady pulse', () => {
    // The distinction the two measures exist to draw. Independent per-onset
    // jitter is noise *around* a pulse: the tempo map's median filter removes
    // it by design, so it belongs in the timing residuals, not in the tempo.
    // A wobble is correlated across neighbouring onsets, so it survives the
    // filter and reads as the pulse itself moving.
    // 130 rather than 110: capping the clustering window stopped noisy onsets
    // being absorbed into their neighbours, so the same noise now reads a few
    // milliseconds lower. Chosen from a sweep to clear the 60 ms reporting
    // threshold while staying well under the instability limit, so the test
    // measures the distinction rather than a boundary — at 145 the noise does
    // begin to leak into the pulse, which is real and is why this is not set
    // arbitrarily high.
    const jittered = grade(phrase(12, 44), { jitterMs: 130 }, 9);
    // Each fault has to land in its own metric: the noise in the residuals,
    // the wobble in the tempo. Their magnitudes are not comparable — they are
    // parameterised in different units — so what is asserted is where each one
    // shows up, not which is bigger.
    expect(jittered.metrics.timing.meanAbsDeviationMs).toBeGreaterThan(50);
    expect(jittered.metrics.tempo.instabilityCv).toBeLessThan(TEMPO_INSTABILITY_LIMIT);
    expect(jittered.findings.some((f) => /unsteady/.test(f))).toBe(false);
    expect(jittered.findings.some((f) => /ms off the beat/.test(f))).toBe(true);
  });
});

describe('uncalibrated latency', () => {
  it('does not read as an error, because a constant offset is not unsteadiness', () => {
    // Every onset 90 ms late. The tempo map absorbs the constant, which is
    // exactly why calibration failure must not masquerade as bad rhythm.
    const report = grade(phrase(), { latencyMs: 90 });
    expect(report.metrics.timing.meanAbsDeviationMs).toBeLessThan(5);
    expect(report.metrics.noteAccuracy).toBe(1);
  });
});

describe('chord spread', () => {
  it('does not fault melody lead, which is expert behaviour', () => {
    // Goebl (2001): skilled pianists lead the melody ~30 ms. A metric that
    // punished this would be training the wrong thing.
    const report = grade(phrase(8, 21, 2), {
      melodyLeadMs: 30, melodyVelocity: 0.85, accompanimentVelocity: 0.5,
    }, 11);
    expect(report.metrics.chordSpread.faultedCount).toBe(0);
  });

  it('reports the lead as positive so good voicing is visible', () => {
    const report = grade(phrase(8, 21, 2), {
      melodyLeadMs: 40, melodyVelocity: 0.85, accompanimentVelocity: 0.5,
    }, 11);
    expect(report.metrics.chordSpread.meanSignedLeadMs).toBeGreaterThan(0);
  });

  it('scores a rolled chord as spread rather than as several timing errors', () => {
    const report = grade(phrase(8, 21, 2), { rolledChords: 2, rollMs: 90 }, 11);
    expect(report.alignment.deleted).toBe(0);
    expect(report.alignment.inserted).toBe(0);
    expect(report.metrics.chordSpread.events.some((e) => e.spreadMs > 50)).toBe(true);
  });
});

describe('hesitation', () => {
  const report = grade(phrase(16, 61), { hesitations: 2, hesitationMs: 800 }, 9);

  it('is located rather than averaged into the take', () => {
    expect(report.metrics.hesitations.length).toBeGreaterThan(0);
    expect(report.metrics.hesitations[0]!.measureNumber).toBeGreaterThan(0);
  });

  it('is named as a reading problem, not a timing one', () => {
    expect(report.findings.some((f) => /stopped to think/.test(f))).toBe(true);
  });
});

describe('per-hand attribution', () => {
  it('is unavailable when the score has only one staff', () => {
    // An honest gap beats a confident wrong number.
    const report = grade(phrase(8, 12, 1));
    expect(report.metrics.timing.perHand).toBeNull();
    expect(report.metrics.independence).toBeNull();
  });

  it('is reported when the score assigns staves', () => {
    const report = grade(phrase(8, 12, 2));
    expect(report.metrics.timing.perHand).not.toBeNull();
    expect(report.metrics.timing.perHand!.left.noteCount).toBeGreaterThan(0);
    expect(report.metrics.timing.perHand!.right.noteCount).toBeGreaterThan(0);
  });
});

/**
 * Hands that genuinely disagree rhythmically.
 *
 * The generated sight-reading material puts the left hand on downbeats, where
 * it always coincides with the right — so there is nothing for entrainment to
 * pull toward. Measuring one hand capturing the other needs material where the
 * hands are actually independent, which is what this builds: right hand on the
 * beat, left hand on the offbeat.
 */
function independentHands(bars = 8): Score {
  const measures = [];
  for (let bar = 0; bar < bars; bar++) {
    const notes = [];
    for (let beat = 0; beat < 4; beat++) {
      notes.push(makeNote({
        midi: 67 + (beat % 3), spelled: parsePitch('G4'),
        onsetBeats: beat, durationBeats: 1, staff: 1, voice: 1,
      }));
      // Offbeat, so it never shares an onset with the right hand.
      notes.push(makeNote({
        midi: 48 + (beat % 3), spelled: parsePitch('C3'),
        onsetBeats: beat + 0.5, durationBeats: 0.5, staff: 2, voice: 2,
      }));
    }
    measures.push(makeMeasure({
      number: bar + 1,
      notes,
      timeSignature: bar === 0 ? { beats: 4, beatType: 4 } : null,
      tempo: bar === 0 ? { bpm: 80, beatUnit: 1 } : null,
    }));
  }
  return {
    id: 'independence-fixture',
    title: 'Independence fixture',
    composer: null,
    parts: [{ id: 'P1', name: 'Piano', staffCount: 2, measures }],
    provenance: GENERATED_PROVENANCE,
  };
}

describe('independence', () => {
  it('detects the left hand being pulled onto the right hand beats', () => {
    const score = independentHands(8);
    const entrained = grade(score, { entrainment: 0.85, jitterMs: 8 }, 5);
    const independent = grade(score, { jitterMs: 8 }, 5);
    expect(entrained.metrics.independence!.entrainment)
      .toBeGreaterThan(independent.metrics.independence!.entrainment);
  });

  it('names entrainment as the thing to work on when it is bad', () => {
    const report = grade(independentHands(8), { entrainment: 0.9, jitterMs: 8 }, 5);
    expect(report.findings.some((f) => /pulled onto/.test(f))).toBe(true);
  });

  it('reports hand balance in dB, which survives a touch-curve change', () => {
    const report = grade(phrase(8, 12, 2), {
      melodyVelocity: 0.8, accompanimentVelocity: 0.4,
    });
    const balance = report.metrics.independence!.dynamicSeparationDb!;
    expect(balance).toBeGreaterThan(3);

    // Halving every velocity is a touch-curve change, not a playing change.
    const quieter = grade(phrase(8, 12, 2), {
      melodyVelocity: 0.4, accompanimentVelocity: 0.2,
    });
    expect(quieter.metrics.independence!.dynamicSeparationDb!).toBeCloseTo(balance, 1);
  });
});

describe('dynamics', () => {
  it('are not reported at all when the source cannot measure velocity', () => {
    const score = phrase(8, 12, 2);
    const take = synthesizeTake(score, { tempo: 80 });
    const report = gradePerformance(score, { ...take, hasVelocity: false });
    expect(report.metrics.dynamics).toBeNull();
    expect(report.findings.some((f) => /no velocity/.test(f))).toBe(true);
  });
});

describe('every fault preset', () => {
  it('grades without throwing and produces findings', () => {
    const score = phrase(12, 5, 2);
    for (const preset of FAULT_PRESETS) {
      const report = grade(score, preset.faults, 3);
      expect(report.findings.length, preset.id).toBeGreaterThan(0);
      expect(report.score, preset.id).toBeGreaterThanOrEqual(0);
      expect(report.score, preset.id).toBeLessThanOrEqual(1);
    }
  });

  it('ranks a clean take above a messy one', () => {
    const score = phrase(12, 5, 2);
    const clean = grade(score, {}, 3);
    const messy = grade(score, FAULT_PRESETS.find((p) => p.id === 'messy')!.faults, 3);
    expect(clean.score).toBeGreaterThan(messy.score);
  });
});
