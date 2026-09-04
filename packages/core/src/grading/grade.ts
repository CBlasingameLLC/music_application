/**
 * The grader: a score and a take in, a report out.
 *
 * Two passes over the alignment. The first fits a tempo map from a loose
 * alignment; the second re-aligns knowing roughly what tempo was taken. That
 * second pass matters when the player is well away from the notated tempo,
 * because the band around the diagonal is only meaningful once the sequences
 * are roughly in register.
 */

import type { Score } from '../score/model';
import { flattenScore, onsetClusters, type OnsetCluster } from '../score/timeline';
import { alignClusters, alignedPairs, type Alignment } from './align';
import { clusterPerformance, type PerformedCluster, type PerformedTake } from './take';
import { fitTempoMap, tempoStability, type TempoMap } from './tempoMap';
import { computeMetrics, type PerformanceMetrics } from './metrics';

/** Bumped whenever grading changes, so re-grades are identifiable in the log. */
export const PERFORMANCE_GRADER_VERSION = 1;

/**
 * Fractional tempo change across a passage worth mentioning: about 6%.
 *
 * Scale-free on purpose. "8 BPM per beat" means something entirely different
 * at 60 than at 160, so the finding keys on the proportion, not the rate.
 */
export const TEMPO_DRIFT_LIMIT = 0.06;
/**
 * Above this much wobble *about the trend*, a fitted trend stops meaning
 * anything. See the comment at its use — this is a trust threshold, not a
 * fault threshold.
 */
export const TEMPO_INSTABILITY_LIMIT = 0.035;

export interface PerformanceReport {
  readonly graderVersion: number;
  readonly alignment: Alignment;
  readonly tempoMap: TempoMap;
  readonly metrics: PerformanceMetrics;
  readonly expected: readonly OnsetCluster[];
  readonly performed: readonly PerformedCluster[];
  /** 0-1, the headline number. Note accuracy, tempered by timing. */
  readonly score: number;
  /** Plain-language findings, most important first. */
  readonly findings: readonly string[];
}

export function gradePerformance(score: Score, take: PerformedTake): PerformanceReport {
  const expected = onsetClusters(flattenScore(score));
  const performed = clusterPerformance(take.notes);

  // Pass one: align on pitch alone, then learn the tempo from the matches.
  const first = alignClusters(expected, performed);
  const anchors = alignedPairs(first)
    .map((pair) => {
      const cluster = expected[pair.expectedIndex];
      const played = performed[pair.performedIndex];
      return cluster && played
        ? { scoreBeats: cluster.absoluteBeats, wallMs: played.onsetMs }
        : null;
    })
    .filter((a): a is { scoreBeats: number; wallMs: number } => a !== null);

  const tempoMap = fitTempoMap(anchors);

  // Pass two: a tighter band now that the sequences are in register.
  const alignment = alignClusters(expected, performed, {
    band: Math.max(20, Math.ceil(Math.abs(expected.length - performed.length)) + 30),
  });

  const stability = tempoStability(tempoMap);
  const base = computeMetrics({ expected, performed, alignment, tempoMap, take });
  const metrics: PerformanceMetrics = { ...base, tempo: stability };

  return {
    graderVersion: PERFORMANCE_GRADER_VERSION,
    alignment,
    tempoMap,
    metrics,
    expected,
    performed,
    score: overallScore(metrics),
    findings: describe(metrics, take),
  };
}

/**
 * One number for the progression system.
 *
 * Note accuracy dominates, because playing the right notes is the precondition
 * for everything else; timing scales it rather than adding to it, so a take
 * cannot score well on rhythm alone.
 */
function overallScore(metrics: PerformanceMetrics): number {
  const timingQuality = Math.max(
    0,
    Math.min(1, 1 - (metrics.timing.meanAbsDeviationMs - 30) / 220),
  );
  return Math.max(0, Math.min(1, metrics.noteAccuracy * (0.65 + 0.35 * timingQuality)));
}

/**
 * Findings in the order a teacher would raise them.
 *
 * Location before statistics: "you stop at bar 12" is worth more than any
 * average, because it names something you can go and practise.
 */
function describe(metrics: PerformanceMetrics, take: PerformedTake): string[] {
  const findings: string[] = [];

  const worst = metrics.errorLocations[0];
  if (worst && worst.errors > 0) {
    findings.push(
      `Most of the trouble is in bar ${worst.measureNumber} — ${worst.errors} error${worst.errors > 1 ? 's' : ''} there.`,
    );
  }

  if (metrics.hesitations.length > 0) {
    const bars = [...new Set(metrics.hesitations.map((h) => h.measureNumber))];
    findings.push(
      `You stopped to think at bar ${bars.slice(0, 3).join(', ')}. That is a fingering or reading problem, not a timing one.`,
    );
  }

  // Drift and instability are separate faults, and the split matters here.
  //
  // Keying this on the coefficient of variation — the obvious choice, and the
  // one this originally made — gets it backwards: a *smooth* accelerando has
  // low variation precisely because it is smooth, so the finding failed to
  // fire on exactly the takes where the rush was most controlled. On the
  // bundled repertoire under a 12% injected accelerando, the steepest drift of
  // the three pieces showed the lowest variation of the three.
  //
  // The trend is only believable when there was a pulse to trend away from,
  // though. Measured on the same repertoire, a take with *no* injected drift
  // at all reported a 47% "accelerando" purely from two 800 ms pauses. So an
  // unsteady take gets no tempo trend reported: a confident wrong number is
  // worse than an honest gap, and the hesitation finding above has already
  // named the real problem and pointed at the bar.
  const { driftFraction, instabilityCv } = metrics.tempo;
  const pulseIsSteady = instabilityCv < TEMPO_INSTABILITY_LIMIT;

  if (pulseIsSteady && Math.abs(driftFraction) > TEMPO_DRIFT_LIMIT) {
    const direction = driftFraction > 0 ? 'speeding up' : 'slowing down';
    findings.push(
      `The pulse moved — you are ${direction} as you go, by about ` +
        `${Math.round(Math.abs(driftFraction) * 100)}% across the passage.`,
    );
  }

  // Not an `else`: the conditions are already mutually exclusive, and chaining
  // them hides that this is a second, different fault rather than a fallback.
  if (!pulseIsSteady && metrics.hesitations.length === 0) {
    // Unsteady with nowhere to point at. That is a different lesson from
    // "practise bar 12": the pulse itself is the thing missing.
    findings.push('The pulse is unsteady throughout — it wanders rather than holding a beat.');
  }

  if (metrics.chordSpread.faultedCount > 0) {
    findings.push(
      `${metrics.chordSpread.faultedCount} chord${metrics.chordSpread.faultedCount > 1 ? 's' : ''} came out unevenly rather than together.`,
    );
  } else if (metrics.chordSpread.meanSignedLeadMs > 12) {
    // Worth saying out loud: this is the behaviour to keep, not fix.
    findings.push('Your melody notes lead the chord slightly — that is good voicing.');
  }

  if (metrics.evenness.detrendedIoiCv > 0.18) {
    findings.push('Note lengths are uneven independently of tempo.');
  }

  const late = metrics.timing.meanAbsDeviationMs;
  if (late > 60) {
    findings.push(`Onsets average ${Math.round(late)} ms off the beat.`);
  }

  if (metrics.independence && metrics.independence.entrainment > 0.5) {
    findings.push(
      'Your left hand is being pulled onto the right hand’s beats. That is the thing to work on.',
    );
  }

  if (!take.hasVelocity) {
    findings.push('Dynamics were not measured: this input has no velocity.');
  }

  if (findings.length === 0) findings.push('Clean take. Nothing to fix here.');
  return findings;
}
