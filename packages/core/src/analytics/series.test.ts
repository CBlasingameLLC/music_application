import { describe, expect, it } from 'vitest';
import {
  attemptGap, diagnosticDistribution, domainTrends, dayRange, practiceByDay,
  tempoProgress, MIN_TREND_DAYS,
} from './series';
import { emptyAppState, foldEvents, type SkillAccumulator } from './fold';
import { currentMastery } from '../progression/mastery';
import { makeEvent, type EtudeEvent } from '../events/types';
import { SKILLS } from '../skills/taxonomy';

const CONTEXT = { deviceId: 'test', appVersion: '0.0.0', streamId: 'practice' };

let clock = 0;
/** Events need increasing ULIDs; the real writer gets that from wall time. */
function event<T extends EtudeEvent['type']>(
  type: T,
  payload: unknown,
  at: string,
): EtudeEvent {
  clock += 1;
  const made = makeEvent(type as never, payload as never, {
    ...CONTEXT,
    seq: clock,
  } as never) as EtudeEvent;
  // makeEvent stamps "now"; these fixtures need to sit on chosen days.
  return { ...made, at } as EtudeEvent;
}

/** One graded attempt against a skill, on a given day. */
function attempt(
  day: string,
  skillId: string,
  correctness: number,
  activityId = `act-${day}-${skillId}`,
  diagnostics: Record<string, number> = {},
): EtudeEvent[] {
  const attemptId = `att-${day}-${skillId}-${Math.random().toString(36).slice(2, 8)}`;
  const at = `${day}T12:00:00.000Z`;
  return [
    event('Activity.Attempted', {
      attemptId, activityId, sessionId: null, responseMs: 2000,
      response: null, scaffolds: [],
    }, at),
    event('Activity.Graded', {
      attemptId, correctness, latencyMs: 2000, diagnostics,
      skillEvidence: [{ skillId, correctness, weight: 1 }],
      xpAwarded: 10, graderVersion: 1,
    }, at),
  ];
}

const DECLARATIVE = SKILLS.find((s) => s.kind === 'declarative')!;
const MOTOR = SKILLS.find((s) => s.kind === 'motor')!;

describe('day ranges', () => {
  it('fills in the days nobody practised', () => {
    // Gaps are the point: a missing day is a day off, and a chart that skipped
    // it would draw a continuous line through the absence.
    expect(dayRange('2026-03-01', '2026-03-05')).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ]);
  });

  it('handles a single day and does not run backwards', () => {
    expect(dayRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
    expect(dayRange('2026-03-05', '2026-03-01')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(dayRange('2026-02-27', '2026-03-02')).toHaveLength(4);
  });
});

describe('practice minutes per day', () => {
  it('reports a zero for days that were skipped', () => {
    const points = practiceByDay({ '2026-03-01': 600, '2026-03-04': 1200 });
    expect(points.map((p) => p.day)).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04',
    ]);
    expect(points.map((p) => p.value)).toEqual([10, 0, 0, 20]);
  });

  it('is empty rather than wrong when nothing has been practised', () => {
    expect(practiceByDay({})).toEqual([]);
  });
});

describe('domain trends', () => {
  const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04',
    '2026-03-05', '2026-03-06'];

  it('says nothing rather than drawing a slope through too few days', () => {
    // The failure this exists to prevent: three points can be joined into any
    // story, and this app opens nearly empty.
    const events = ['2026-03-01', '2026-03-02'].flatMap((d) =>
      attempt(d, DECLARATIVE.id, 1));
    expect(domainTrends(events)).toBeNull();
    expect(MIN_TREND_DAYS).toBeGreaterThan(3);
  });

  it('rises across days of correct practice', () => {
    const events = days.flatMap((d) => attempt(d, DECLARATIVE.id, 1));
    const trends = domainTrends(events);
    expect(trends).not.toBeNull();

    const trend = trends!.find((t) => t.domain === DECLARATIVE.domain)!;
    expect(trend.points).toHaveLength(days.length);
    expect(trend.change).toBeGreaterThan(0);
    expect(trend.points[trend.points.length - 1]!.value)
      .toBeGreaterThan(trend.points[0]!.value);
  });

  it('evaluates each day as of that day, not as of now', () => {
    // The load-bearing property. Mastery decays, so a point on the 3rd must
    // carry three fewer days of forgetting than one evaluated today —
    // otherwise the chart shows a curve that never existed.
    const events = days.flatMap((d) => attempt(d, DECLARATIVE.id, 1));
    const trend = domainTrends(events)!.find((t) => t.domain === DECLARATIVE.domain)!;

    // Practising the same skill correctly every day must not produce a falling
    // line, which is what evaluating every point at "now" would do.
    for (let i = 1; i < trend.points.length; i++) {
      expect(trend.points[i]!.value).toBeGreaterThanOrEqual(
        trend.points[i - 1]!.value - 1e-9,
      );
    }
  });

  it('covers every domain, including untouched ones', () => {
    const events = days.flatMap((d) => attempt(d, DECLARATIVE.id, 1));
    const trends = domainTrends(events)!;
    expect(trends).toHaveLength(7);
    // An untouched domain reads zero rather than being absent, so the chart
    // shows that it has not been started rather than silently omitting it.
    const untouched = trends.filter((t) => t.change === 0);
    expect(untouched.length).toBeGreaterThan(0);
  });
});

describe('agreement with the live projection', () => {
  it('reports for today exactly what the projection reports', () => {
    // If these disagree, the dashboard and the home screen show different
    // numbers for the same thing — worse than having no dashboard at all.
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04',
      '2026-03-05', '2026-03-06'];
    const events = days.flatMap((d) => [
      ...attempt(d, DECLARATIVE.id, 0.9),
      ...attempt(d, MOTOR.id, 0.95),
    ]);

    // The live path: one fold over everything, evaluated at the last day.
    const liveSkills = new Map<string, SkillAccumulator>();
    foldEvents(emptyAppState, liveSkills, events);
    const asOf = new Date('2026-03-06T23:59:59');

    const trends = domainTrends(events)!;
    for (const trend of trends) {
      const skillIds = SKILLS.filter((s) => s.domain === trend.domain).map((s) => s.id);
      let total = 0;
      for (const skillId of skillIds) {
        const acc = liveSkills.get(skillId);
        if (acc) total += currentMastery(acc.mastery, asOf);
      }
      const live = skillIds.length > 0 ? total / skillIds.length : 0;
      const replayed = trend.points[trend.points.length - 1]!.value;
      expect(replayed, trend.domain).toBeCloseTo(live, 6);
    }
  });
});

describe('tempo progress', () => {
  it('tracks the best tempo held, per motor skill', () => {
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04',
      '2026-03-05'];
    const events = days.flatMap((d) => attempt(d, MOTOR.id, 1));
    const points = tempoProgress(events);

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => p.skillId === MOTOR.id)).toBe(true);
    expect(points.every((p) => p.bpm > 0)).toBe(true);
  });

  it('is empty when nothing motor has been practised', () => {
    const events = ['2026-03-01', '2026-03-02'].flatMap((d) =>
      attempt(d, DECLARATIVE.id, 1));
    expect(tempoProgress(events)).toEqual([]);
  });
});

describe('diagnostic distributions', () => {
  function withDeviation(values: number[]): EtudeEvent[] {
    return values.flatMap((v, i) =>
      attempt('2026-03-01', DECLARATIVE.id, 1, `act-${i}`, { meanAbsDeviationMs: v }));
  }

  it('refuses to draw a shape from too few observations', () => {
    expect(diagnosticDistribution(withDeviation([10, 20, 30]), 'meanAbsDeviationMs'))
      .toBeNull();
  });

  it('buckets the values and finds the median', () => {
    const values = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
    const dist = diagnosticDistribution(withDeviation(values), 'meanAbsDeviationMs')!;

    expect(dist.count).toBe(values.length);
    expect(dist.median).toBeCloseTo(21, 6);
    // Every observation lands in exactly one bucket, the largest included.
    expect(dist.buckets.reduce((a, b) => a + b.count, 0)).toBe(values.length);
  });

  it('separates a tight distribution from one with disasters', () => {
    // The reason this is a distribution rather than an average: these two have
    // similar means and call for completely different practice.
    const tight = diagnosticDistribution(
      withDeviation(Array.from({ length: 16 }, () => 30)), 'meanAbsDeviationMs')!;
    const spiky = diagnosticDistribution(
      withDeviation([...Array.from({ length: 14 }, () => 10), 200, 210]),
      'meanAbsDeviationMs')!;

    const busiest = (d: typeof tight) => Math.max(...d.buckets.map((b) => b.count));
    expect(busiest(tight)).toBe(16);
    expect(busiest(spiky)).toBeLessThan(16);
  });

  it('ignores a diagnostic key nothing records', () => {
    expect(diagnosticDistribution(withDeviation([1, 2, 3]), 'nonesuch')).toBeNull();
  });
});

describe('first attempt against later ones', () => {
  it('needs enough first attempts before it says anything', () => {
    expect(attemptGap(attempt('2026-03-01', DECLARATIVE.id, 1))).toBeNull();
  });

  it('separates the first go at a drill from repeats the same day', () => {
    const events: EtudeEvent[] = [];
    for (let i = 0; i < 14; i++) {
      // Cold first, better on the repeat — warmed up rather than learned.
      events.push(...attempt('2026-03-01', DECLARATIVE.id, 0.5, `drill-${i}`));
      events.push(...attempt('2026-03-01', DECLARATIVE.id, 1, `drill-${i}`));
    }

    const gap = attemptGap(events)!;
    expect(gap.firstAttempt).toBeCloseTo(0.5, 6);
    expect(gap.laterAttempts).toBeCloseTo(1, 6);
    expect(gap.sampleSize).toBe(28);
  });
});
