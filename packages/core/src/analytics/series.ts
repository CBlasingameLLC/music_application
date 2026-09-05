/**
 * Turning the event log into things you can see over time.
 *
 * Every number the app shows today is an instantaneous snapshot: mastery is a
 * decaying projection, the streak is a count, XP is a total. None of them says
 * whether anything is *going* anywhere, and for a system built on decay that is
 * the question that matters — "Reading 62%" does not distinguish climbing from
 * rotting.
 *
 * ## History is derived, never stored
 *
 * `currentMastery(state, now)` already takes an as-of date, and `foldEvents` is
 * already a pure fold. So a trend is: replay the log up to a day, then evaluate
 * mastery as of that day. Nothing new is written down.
 *
 * That is worth being deliberate about. Storing a daily snapshot would freeze
 * today's mastery model into the record permanently; deriving means **a better
 * model retroactively improves every past point**. It is the same reasoning
 * that put `AttemptGraded` beside `Attempted` rather than mutating it, and the
 * reason the log is append-only at all.
 *
 * ## Nothing here invents data
 *
 * Each series states how much history it needs and returns `null` below that,
 * rather than drawing a line through two points. A slope fitted to almost
 * nothing is noise the reader will mistake for progress, and this app opens
 * nearly empty. The grader already follows this rule when it refuses to report
 * a tempo trend on an unsteady take.
 */

import type { EtudeEvent } from '../events/types';
import { currentMastery } from '../progression/mastery';
import { DOMAINS, SKILLS, type DomainId } from '../skills/taxonomy';
import { localDay } from '../progression/streak';
import {
  emptyAppState, foldEvents, type AppState, type SkillAccumulator,
} from './fold';

/** A day, and whatever was true at the end of it. */
export interface DayPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly value: number;
}

export interface DomainTrend {
  readonly domain: DomainId;
  readonly points: readonly DayPoint[];
  /** Change across the window, in mastery points. Negative means decaying. */
  readonly change: number;
}

export interface TempoPoint {
  readonly day: string;
  readonly skillId: string;
  readonly bpm: number;
}

export interface Distribution {
  /** Bucket lower bounds and how many observations fell in each. */
  readonly buckets: readonly { readonly from: number; readonly to: number; readonly count: number }[];
  readonly median: number;
  readonly count: number;
}

export interface AttemptGap {
  /** Mean correctness on the first attempt at a drill within a day. */
  readonly firstAttempt: number;
  /** Mean correctness on later attempts the same day. */
  readonly laterAttempts: number;
  readonly sampleSize: number;
}

/**
 * Fewest days of history before a trend line means anything.
 *
 * Below this the honest answer is that there is not enough to say — three
 * points can be joined into any story at all.
 */
export const MIN_TREND_DAYS = 5;
/** Fewest observations before a distribution is worth drawing. */
export const MIN_DISTRIBUTION_SAMPLES = 12;

/** Every local day between two dates, inclusive, with no gaps. */
export function dayRange(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${fromDay}T12:00:00`);
  const end = new Date(`${toDay}T12:00:00`);
  while (cursor <= end) {
    days.push(localDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Practice minutes per day, straight off the ledger the projection keeps. */
export function practiceByDay(
  secondsByDay: Readonly<Record<string, number>>,
): DayPoint[] {
  const days = Object.keys(secondsByDay).sort();
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return [];

  // Gaps are the point of this chart — a missing day is a day not practised,
  // and omitting it would draw a continuous line through the absence.
  return dayRange(first, last).map((day) => ({
    day,
    value: Math.round((secondsByDay[day] ?? 0) / 60),
  }));
}

interface ReplayStep {
  readonly day: string;
  readonly state: AppState;
  readonly skills: ReadonlyMap<string, SkillAccumulator>;
}

/**
 * Replay the log one day at a time, keeping what was true at each day's end.
 *
 * The accumulators are mutated in place by the fold, so each step snapshots the
 * mastery values it needs rather than the map itself — keeping the map would
 * hand every step a reference to the same object and every day would report the
 * final state.
 */
function replayByDay(events: readonly EtudeEvent[]): ReplayStep[] {
  if (events.length === 0) return [];

  const ordered = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byDay = new Map<string, EtudeEvent[]>();
  for (const event of ordered) {
    const day = localDay(new Date(event.at));
    const bucket = byDay.get(day);
    if (bucket) bucket.push(event);
    else byDay.set(day, [event]);
  }

  const days = [...byDay.keys()].sort();
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return [];

  const skills = new Map<string, SkillAccumulator>();
  let state = emptyAppState;
  const steps: ReplayStep[] = [];

  // Every calendar day, not only the ones with events: a day off is real, and
  // mastery decays through it. Skipping empty days would hide the decay the
  // whole model is built around.
  for (const day of dayRange(first, last)) {
    state = foldEvents(state, skills, byDay.get(day) ?? []);
    steps.push({
      day,
      state,
      skills: new Map([...skills].map(([id, acc]) => [id, { ...acc }])),
    });
  }

  return steps;
}

/**
 * Mastery per domain, evaluated as of each day rather than as of now.
 *
 * The as-of date is what makes this honest: mastery decays, so asking "what was
 * it on the 3rd" has to apply three fewer days of forgetting than asking today.
 * Evaluating every point at `now` would draw a curve that has never existed.
 */
export function domainTrends(events: readonly EtudeEvent[]): DomainTrend[] | null {
  const steps = replayByDay(events);
  if (steps.length < MIN_TREND_DAYS) return null;

  const byDomain = new Map<DomainId, string[]>();
  for (const domain of DOMAINS) {
    byDomain.set(
      domain.id,
      SKILLS.filter((s) => s.domain === domain.id).map((s) => s.id),
    );
  }

  return DOMAINS.map((domain) => {
    const skillIds = byDomain.get(domain.id) ?? [];
    const points = steps.map((step) => {
      const asOf = new Date(`${step.day}T23:59:59`);
      let total = 0;
      for (const skillId of skillIds) {
        const acc = step.skills.get(skillId);
        if (acc) total += currentMastery(acc.mastery, asOf);
      }
      return {
        day: step.day,
        value: skillIds.length > 0 ? total / skillIds.length : 0,
      };
    });

    const firstValue = points[0]?.value ?? 0;
    const lastValue = points[points.length - 1]?.value ?? 0;
    return { domain: domain.id, points, change: lastValue - firstValue };
  });
}

/**
 * The best tempo held at criterion, per motor skill, over time.
 *
 * "Clean at 96 BPM" is the unit of progress for anything motor — an accuracy
 * percentage without the tempo it was achieved at says almost nothing, because
 * accuracy is trivially bought by slowing down.
 */
export function tempoProgress(events: readonly EtudeEvent[]): TempoPoint[] {
  const steps = replayByDay(events);
  const points: TempoPoint[] = [];

  for (const step of steps) {
    for (const [skillId, acc] of step.skills) {
      if (!acc.motor) continue;
      points.push({ day: step.day, skillId, bpm: acc.motor.achievedTempo });
    }
  }
  return points;
}

/**
 * How a numeric diagnostic is distributed across attempts.
 *
 * Deliberately a distribution rather than an average. "Your timing averages
 * 45 ms off" hides whether that is every note slightly loose or most notes tight
 * with a few disasters, and those are different problems with different
 * remedies.
 */
export function diagnosticDistribution(
  events: readonly EtudeEvent[],
  key: string,
  bucketCount = 8,
): Distribution | null {
  const values: number[] = [];
  for (const event of events) {
    if (event.type !== 'Activity.Graded') continue;
    const value = event.payload.diagnostics[key];
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  if (values.length < MIN_DISTRIBUTION_SAMPLES) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const span = max - min;
  const width = span > 0 ? span / bucketCount : 1;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));

  for (const value of sorted) {
    // The top value belongs in the last bucket rather than one past the end.
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }

  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);

  return { buckets, median, count: sorted.length };
}

/**
 * First attempt of the day against later ones.
 *
 * The plan's own test of whether material is *learned* or merely warmed up. A
 * large gap means yesterday's practice did not survive the night, which calls
 * for different work than a small one — more consolidation, not more reps.
 */
export function attemptGap(events: readonly EtudeEvent[]): AttemptGap | null {
  const seenToday = new Set<string>();
  let currentDay = '';
  const first: number[] = [];
  const later: number[] = [];

  const graded = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'Activity.Graded') {
      graded.set(event.payload.attemptId, event.payload.correctness);
    }
  }

  for (const event of events) {
    if (event.type !== 'Activity.Attempted') continue;
    const day = localDay(new Date(event.at));
    if (day !== currentDay) {
      currentDay = day;
      seenToday.clear();
    }

    const correctness = graded.get(event.payload.attemptId);
    if (correctness === undefined) continue;

    const key = event.payload.activityId;
    if (seenToday.has(key)) later.push(correctness);
    else { seenToday.add(key); first.push(correctness); }
  }

  if (first.length < MIN_DISTRIBUTION_SAMPLES || later.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    firstAttempt: mean(first),
    laterAttempts: mean(later),
    sampleSize: first.length + later.length,
  };
}

// ---------------------------------------------------------------------------
// Repertoire
// ---------------------------------------------------------------------------

export interface PieceAttempt {
  readonly day: string;
  /** The passage played, so a loop is not averaged into a whole-piece score. */
  readonly activityId: string;
  readonly fromMeasure: number;
  readonly toMeasure: number;
  readonly correctness: number;
  /** The tempo actually held. Zero when the take was too short to fit one. */
  readonly tempoBpm: number;
  readonly worstBar: number;
  readonly worstBarErrors: number;
}

/** A bar that keeps going wrong, and how often it has. */
export interface TroubleBar {
  readonly measureNumber: number;
  /** Takes in which this was the worst bar. */
  readonly takes: number;
  /** Of how many takes considered. */
  readonly outOf: number;
}

/**
 * Fewest takes before a recurring bar means anything.
 *
 * Two takes agreeing is a coincidence. This is the same rule the rest of the
 * analytics follow: below the threshold there is nothing honest to report.
 */
export const MIN_TAKES_FOR_TROUBLE = 3;

/**
 * Every graded take of one piece, oldest first.
 *
 * `Activity.Attempted` carries the activity id, and a repertoire drill's id
 * *is* the passage — piece and bar range — so a prefix match finds every take
 * of a piece without needing the mode denormalised onto the grade.
 */
export function pieceAttempts(
  events: readonly EtudeEvent[],
  activityIdPrefix: string,
): PieceAttempt[] {
  const activityOfAttempt = new Map<string, string>();

  for (const event of events) {
    if (event.type !== 'Activity.Attempted') continue;
    if (!event.payload.activityId.startsWith(activityIdPrefix)) continue;
    activityOfAttempt.set(event.payload.attemptId, event.payload.activityId);
  }

  const attempts: PieceAttempt[] = [];
  for (const event of events) {
    if (event.type !== 'Activity.Graded') continue;
    const activityId = activityOfAttempt.get(event.payload.attemptId);
    if (!activityId) continue;

    const d = event.payload.diagnostics;
    attempts.push({
      day: localDay(new Date(event.at)),
      activityId,
      fromMeasure: d.fromMeasure ?? 0,
      toMeasure: d.toMeasure ?? 0,
      correctness: event.payload.correctness,
      tempoBpm: d.tempoBpm ?? 0,
      worstBar: d.worstBar ?? 0,
      worstBarErrors: d.worstBarErrors ?? 0,
    });
  }
  return attempts;
}

/**
 * The bar that keeps failing, across takes.
 *
 * The plan calls per-bar failure clustering the most actionable output the
 * grader produces, and this is why: "you fail at bar 7 in six of eight takes"
 * names something to go and practise, which no average does. It is also the
 * input to a practice loop — the app can offer those bars instead of asking for
 * the whole piece again to fix four of its bars.
 *
 * Only takes that actually recorded an error count toward the denominator. A
 * clean take is not evidence *for* any bar being the problem, and counting it
 * against every bar would bury a real pattern under successful practice.
 */
export function troubleBars(attempts: readonly PieceAttempt[]): TroubleBar[] {
  const faulted = attempts.filter((a) => a.worstBar > 0 && a.worstBarErrors > 0);
  if (faulted.length < MIN_TAKES_FOR_TROUBLE) return [];

  const counts = new Map<number, number>();
  for (const attempt of faulted) {
    counts.set(attempt.worstBar, (counts.get(attempt.worstBar) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([measureNumber, takes]) => ({
      measureNumber,
      takes,
      outOf: faulted.length,
    }))
    .sort((a, b) => b.takes - a.takes || a.measureNumber - b.measureNumber);
}

/** The best tempo held cleanly on a passage, and the take that did it. */
export function bestCleanTempo(
  attempts: readonly PieceAttempt[],
  criterion = 0.95,
): number {
  let best = 0;
  for (const attempt of attempts) {
    if (attempt.correctness >= criterion) best = Math.max(best, attempt.tempoBpm);
  }
  return best;
}
