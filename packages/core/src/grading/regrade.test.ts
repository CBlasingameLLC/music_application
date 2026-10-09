import { describe, expect, it } from 'vitest';
import { gradePerformance } from './grade';
import { synthesizeTake } from './synthesize';
import { generateSightReading } from '../score/generate/sightReading';
import { allKeys, keyId, type Key } from '../theory/scale';
import type { PerformedTake } from './take';

/**
 * Re-grading is the reason takes are stored at all.
 *
 * `Activity.Graded` sits beside `Activity.Attempted` rather than mutating it,
 * and it carries `graderVersion`, so improving the grader appends a new verdict
 * instead of rewriting an old one. That machinery is worth nothing unless the
 * grader's *input* survives a round trip through storage — which is what these
 * check. The persistence layer itself lives in the web app and is covered end
 * to end; the property that has to hold in pure logic is that a take reloaded
 * from JSON is the same object the grader saw live.
 */

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

function phrase(seed: number) {
  return generateSightReading(
    {
      key: K('C-major'),
      bars: 4,
      timeSignature: { beats: 4, beatType: 4 },
      range: [55, 79],
      hands: 2,
      rhythmUnits: [1, 0.5],
      maxLeap: 4,
      stepBias: 0.75,
      allowRests: true,
      tempo: 80,
    },
    seed,
  );
}

/** What the store does: JSON in, JSON out. */
const roundTrip = (take: PerformedTake): PerformedTake =>
  JSON.parse(JSON.stringify(take)) as PerformedTake;

describe('a stored take', () => {
  it('survives serialisation unchanged', () => {
    const take = synthesizeTake(phrase(7), {
      tempo: 80,
      seed: 3,
      faults: { dropped: 2, wrongNotes: 1, jitterMs: 12, hesitations: 1 },
    });
    expect(roundTrip(take)).toEqual(take);
  });

  it('grades identically after a round trip', () => {
    // The property that makes re-grading meaningful. If a reloaded take scored
    // differently, a re-grade would report changes the player never made and
    // the whole stored-take decision would be worse than useless.
    const score = phrase(11);
    const take = synthesizeTake(score, {
      tempo: 80,
      seed: 5,
      faults: { dropped: 1, rolledChords: 1, tempoDrift: 0.08, jitterMs: 15 },
    });

    const live = gradePerformance(score, take);
    const reloaded = gradePerformance(score, roundTrip(take));

    expect(reloaded.score).toBeCloseTo(live.score, 10);
    expect(reloaded.findings).toEqual(live.findings);
    expect(reloaded.metrics.noteAccuracy).toBeCloseTo(live.metrics.noteAccuracy, 10);
    expect(reloaded.metrics.tempo).toEqual(live.metrics.tempo);
    expect(reloaded.metrics.errorLocations).toEqual(live.metrics.errorLocations);
  });

  it('keeps note-off and velocity, which articulation and dynamics need', () => {
    // Articulation lives entirely in the release and dynamics entirely in
    // velocity, so a take serialised without them would still grade for notes
    // and timing while silently reporting nothing about either.
    const take = synthesizeTake(phrase(13), { tempo: 80, seed: 2 });
    const reloaded = roundTrip(take);

    expect(reloaded.notes.length).toBe(take.notes.length);
    expect(reloaded.notes.every((n) => Number.isFinite(n.offsetMs))).toBe(true);
    expect(reloaded.notes.every((n) => Number.isFinite(n.velocity))).toBe(true);
    expect(reloaded.hasVelocity).toBe(take.hasVelocity);
  });
});
