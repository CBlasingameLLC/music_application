/**
 * Judging one Independence Lab take.
 *
 * The grader already produces the hard number — `computeIndependence` in
 * `metrics.ts` measures rhythmic entrainment from alignment residuals, and
 * detects the collapse case where the hands land so together that the
 * clusterer merges them. This layer does two things that module cannot:
 *
 * 1. **It knows what the rung was asking for.** "Independence" is not one
 *    thing. A 3:2 rung is asking whether the rhythms stayed apart; an
 *    articulation rung is asking whether one hand stayed short while the other
 *    stayed long. Reporting a single blended score would hide which one failed,
 *    and it is exactly the which that tells you what to practise.
 *
 * 2. **It fills in the two measures the grader stubs.** Articulation and
 *    dynamic separation are only meaningful where the *score asks for a
 *    difference*, so they need the exercise's intent, not just the take.
 *
 * Anything the input cannot measure reports `measurable: false` rather than a
 * number. A touchscreen has no velocity, so scoring dynamic control from one
 * would be reporting a number about nothing.
 */

import type { Score } from '../score/model';
import type { Articulation } from '../score/model';
import { flattenScore, type TimelineNote } from '../score/timeline';
import { gradePerformance, type PerformanceReport } from './grade';
import { measureEntrainment } from './metrics';
import type { PerformedNote, PerformedTake } from './take';

/** What a rung is actually testing. */
export type IndependenceAspect = 'together' | 'rhythm' | 'articulation' | 'dynamics';

export interface AspectVerdict {
  readonly aspect: IndependenceAspect;
  /** False when the input source cannot measure this aspect at all. */
  readonly measurable: boolean;
  /** 0-1. Null when not measurable. */
  readonly score: number | null;
  readonly held: boolean;
  readonly detail: string;
}

export interface IndependenceExpectation {
  /** The aspect this rung is training. Everything else is context. */
  readonly aspect: IndependenceAspect;
  readonly splitPoint: number;
  /** Set when the rung notates different articulations per hand. */
  readonly articulation: { right: Articulation; left: Articulation } | null;
  /** Set when the rung notates different dynamics per hand. */
  readonly dynamics: { right: string; left: string } | null;
}

export interface IndependenceReport {
  readonly performance: PerformanceReport;
  /** The rung's own aspect, first, then whatever else could be measured. */
  readonly verdicts: readonly AspectVerdict[];
  /** 0-1 for the ladder. The rung's own aspect, tempered by note accuracy. */
  readonly correctness: number;
  readonly findings: readonly string[];
}

/**
 * Entrainment above this means one hand is riding the other.
 *
 * Below it the hands are genuinely independent; the metric is a proportion of
 * left-hand onsets that moved *toward* the nearest right-hand onset, so 0.5 is
 * already chance and anything above is a real pull.
 */
export const ENTRAINMENT_LIMIT = 0.5;
/** Staccato should sit well under half its notated length; legato at or over it. */
export const STACCATO_MAX_RATIO = 0.55;
export const LEGATO_MIN_RATIO = 0.85;
/** Decibels of separation the score asks for, below which the hands collapsed. */
export const DYNAMIC_SEPARATION_MIN_DB = 3;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * How long each hand actually held its notes, as a fraction of what was written.
 *
 * Measured from note-off, not from onset spacing: the difference between
 * staccato and legato is entirely in the release, and a player can space onsets
 * perfectly while holding everything down.
 */
function heldRatios(
  take: PerformedTake,
  notated: readonly TimelineNote[],
  splitPoint: number,
  msPerBeat: number,
): { right: number[]; left: number[] } {
  const right: number[] = [];
  const left: number[] = [];

  // Notated length per hand, so the ratio is against what was asked rather
  // than against the neighbouring note.
  const expectedBeats = { right: 0, left: 0 };
  const counts = { right: 0, left: 0 };
  for (const note of notated) {
    if (note.midi === null) continue;
    const hand = note.staff === 2 ? 'left' : 'right';
    expectedBeats[hand] += note.soundingBeats;
    counts[hand] += 1;
  }
  const meanBeats = {
    right: counts.right > 0 ? expectedBeats.right / counts.right : 1,
    left: counts.left > 0 ? expectedBeats.left / counts.left : 1,
  };

  for (const played of take.notes) {
    const hand = played.midi < splitPoint ? 'left' : 'right';
    const held = played.offsetMs - played.onsetMs;
    const written = meanBeats[hand] * msPerBeat;
    if (written <= 1 || held <= 0) continue;
    (hand === 'left' ? left : right).push(held / written);
  }

  return { right, left };
}

function velocitiesByHand(
  take: PerformedTake,
  splitPoint: number,
): { right: PerformedNote[]; left: PerformedNote[] } {
  const right: PerformedNote[] = [];
  const left: PerformedNote[] = [];
  for (const note of take.notes) {
    (note.midi < splitPoint ? left : right).push(note);
  }
  return { right, left };
}

/**
 * How long the hands kept the notated dynamic gap before it collapsed.
 *
 * Beginners hit the difference for a beat or two and then lose it, so the
 * *collapse time* is the diagnostic rather than the average — an average over a
 * take that started right and ended wrong looks like a mediocre take
 * throughout, which is the wrong lesson.
 */
function timeToCollapseMs(
  take: PerformedTake,
  splitPoint: number,
  wantLouderHand: 'right' | 'left',
): number | null {
  const sorted = [...take.notes].sort((a, b) => a.onsetMs - b.onsetMs);
  const start = sorted[0]?.onsetMs ?? 0;
  const windowMs = 1500;

  let lastHeldAt: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const at = sorted[i]?.onsetMs ?? 0;
    const window = sorted.filter((n) => n.onsetMs >= at - windowMs && n.onsetMs <= at);
    const loud = window.filter((n) =>
      (n.midi < splitPoint ? 'left' : 'right') === wantLouderHand);
    const soft = window.filter((n) =>
      (n.midi < splitPoint ? 'left' : 'right') !== wantLouderHand);
    if (loud.length === 0 || soft.length === 0) continue;

    const gapDb = 20 * Math.log10(Math.max(1e-6, mean(loud.map((n) => n.velocity))) /
      Math.max(1e-6, mean(soft.map((n) => n.velocity))));
    if (gapDb >= DYNAMIC_SEPARATION_MIN_DB) lastHeldAt = at;
    else return lastHeldAt === null ? 0 : lastHeldAt - start;
  }

  return null; // Never collapsed.
}

export function judgeIndependence(
  score: Score,
  take: PerformedTake,
  expectation: IndependenceExpectation,
): IndependenceReport {
  const performance = gradePerformance(score, take);
  const notated = flattenScore(score);
  const msPerBeat = 60000 / Math.max(1, performance.metrics.tempo.medianBpm);
  const verdicts: AspectVerdict[] = [];

  // --- Rhythmic independence: the primary measure -------------------------
  //
  // Shared with the repertoire grader rather than reimplemented: one
  // definition of entrainment, so a fix to it cannot land in one place and
  // not the other.
  const entrainment = measureEntrainment({
    expected: performance.expected,
    performed: performance.performed,
    alignment: performance.alignment,
  });
  if (entrainment === null) {
    // Two very different reasons the measure can come back empty, and telling
    // the player the wrong one is worse than saying nothing. At 1:1 every
    // onset carries both hands, so there is genuinely nothing to drift — that
    // is the rung working as designed. Anywhere else it means the take
    // collapsed so far that the hands could no longer be told apart, which is
    // the opposite of reassuring.
    const notatedApart = performance.expected.some((c) => {
      const left = c.notes.some((n) => n.staff === 2);
      const right = c.notes.some((n) => n.staff === 1);
      return left !== right;
    });

    verdicts.push({
      aspect: 'rhythm',
      measurable: false,
      score: null,
      held: !notatedApart,
      detail: notatedApart
        ? 'The hands ended up so far together that they could not be told apart. ' +
          'Slow right down and play them separately before putting them back together.'
        : 'The hands play together on every note here, so there is no drift to measure. ' +
          'That is what this rung is for — the ratios above it are where independence starts.',
    });
  } else {
    const held = entrainment.value <= ENTRAINMENT_LIMIT;
    verdicts.push({
      aspect: 'rhythm',
      measurable: true,
      score: Math.max(0, 1 - entrainment.value),
      held,
      detail: held
        ? 'The hands kept their own rhythms.'
        : `Your hands are drifting onto each other's beats (${Math.round(entrainment.value * 100)}% of the notes that should sit apart).`,
    });
  }

  // --- Articulation: only where the score asks for a difference ------------
  if (expectation.articulation) {
    const ratios = heldRatios(take, notated, expectation.splitPoint, msPerBeat);
    if (ratios.right.length === 0 || ratios.left.length === 0) {
      verdicts.push({
        aspect: 'articulation',
        measurable: false,
        score: null,
        held: false,
        detail: 'Not enough was played in both hands to compare articulation.',
      });
    } else {
      const want = expectation.articulation;
      const check = (hand: 'right' | 'left', ratio: number): boolean =>
        want[hand] === 'staccato' ? ratio <= STACCATO_MAX_RATIO : ratio >= LEGATO_MIN_RATIO;

      const rightRatio = mean(ratios.right);
      const leftRatio = mean(ratios.left);
      const rightOk = check('right', rightRatio);
      const leftOk = check('left', leftRatio);
      const held = rightOk && leftOk;

      verdicts.push({
        aspect: 'articulation',
        measurable: true,
        score: (rightOk ? 0.5 : 0) + (leftOk ? 0.5 : 0),
        held,
        detail: held
          ? `Both hands kept their articulation — ${want.right} over ${want.left}.`
          : `The ${rightOk ? 'left' : 'right'} hand lost its ${rightOk ? want.left : want.right}; ` +
            `both hands are coming out the same length.`,
      });
    }
  }

  // --- Dynamics: only over a source that measures velocity ------------------
  if (expectation.dynamics) {
    if (!take.hasVelocity) {
      verdicts.push({
        aspect: 'dynamics',
        measurable: false,
        score: null,
        held: false,
        detail: 'This input has no velocity, so dynamics were not measured. Connect the piano over MIDI.',
      });
    } else {
      const { right, left } = velocitiesByHand(take, expectation.splitPoint);
      if (right.length === 0 || left.length === 0) {
        verdicts.push({
          aspect: 'dynamics',
          measurable: false,
          score: null,
          held: false,
          detail: 'Not enough was played in both hands to compare dynamics.',
        });
      } else {
        // Which hand the score asked to be louder. Dynamic marks are ordered,
        // so comparing them directly is enough to know the intent.
        const order = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
        const rightRank = order.indexOf(expectation.dynamics.right);
        const leftRank = order.indexOf(expectation.dynamics.left);
        const louder: 'right' | 'left' = rightRank >= leftRank ? 'right' : 'left';

        const gapDb = 20 * Math.log10(
          Math.max(1e-6, mean((louder === 'right' ? right : left).map((n) => n.velocity))) /
          Math.max(1e-6, mean((louder === 'right' ? left : right).map((n) => n.velocity))),
        );
        const collapsedAt = timeToCollapseMs(take, expectation.splitPoint, louder);
        const held = gapDb >= DYNAMIC_SEPARATION_MIN_DB && collapsedAt === null;

        verdicts.push({
          aspect: 'dynamics',
          measurable: true,
          score: Math.max(0, Math.min(1, gapDb / (DYNAMIC_SEPARATION_MIN_DB * 2))),
          held,
          detail: held
            ? `The ${louder} hand stayed ${gapDb.toFixed(1)} dB above the other throughout.`
            : collapsedAt !== null
              ? `The dynamic gap held for ${(collapsedAt / 1000).toFixed(1)}s and then collapsed — that is the thing to extend.`
              : `Only ${gapDb.toFixed(1)} dB separates the hands; the score asks for a clear difference.`,
        });
      }
    }
  }

  // --- The rung's own aspect drives the ladder -----------------------------
  const primary =
    verdicts.find((v) => v.aspect === expectation.aspect) ??
    verdicts.find((v) => v.aspect === 'rhythm');

  // Notes first: independence over the wrong notes is not independence. When
  // the rung's own aspect could not be measured, accuracy alone carries the
  // rung rather than a fabricated zero.
  const accuracy = performance.metrics.noteAccuracy;
  const aspectScore = primary?.measurable ? (primary.score ?? 0) : null;
  const correctness = aspectScore === null
    ? accuracy
    : Math.max(0, Math.min(1, accuracy * (0.5 + 0.5 * aspectScore)));

  const findings: string[] = [];
  if (primary) findings.push(primary.detail);
  for (const verdict of verdicts) {
    if (verdict !== primary && !verdict.held) findings.push(verdict.detail);
  }
  if (accuracy < 0.9) {
    findings.push(
      `${Math.round((1 - accuracy) * 100)}% of the notes did not land. Slow it down until they do — ` +
        'independence at the wrong notes is not independence.',
    );
  }

  return { performance, verdicts, correctness, findings };
}
