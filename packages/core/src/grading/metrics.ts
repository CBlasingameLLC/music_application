/**
 * What the alignment tells you about your playing.
 *
 * The alignment says which played cluster corresponds to which notated one;
 * the tempo map says where each one should have landed. Everything here is
 * derived from those two, and the split between them is what makes the
 * diagnostics honest:
 *
 * **A wrong note is an alignment event. A badly-timed right note is a large
 * residual on a successful match.** They are structurally different objects,
 * so the distinction costs no heuristic.
 *
 * Several of these metrics are deliberately *not* what they first appear to
 * be. The comments say why, because each correction came from the music rather
 * than from the code, and a later reader would otherwise "simplify" them back
 * into being wrong.
 */

import type { OnsetCluster, TimelineNote } from '../score/timeline';
import type { PerformedCluster, PerformedNote, PerformedTake } from './take';
import type { Alignment } from './align';
import { alignedPairs } from './align';
import type { TempoMap, TempoStability } from './tempoMap';

export interface HandTiming {
  readonly meanAbsDeviationMs: number;
  readonly sdDeviationMs: number;
  readonly noteCount: number;
}

export interface ChordSpreadEvent {
  readonly measureNumber: number;
  readonly spreadMs: number;
  /** Positive when the top voice arrives first — the expert behaviour. */
  readonly signedLeadMs: number;
  readonly faulted: boolean;
}

export interface HesitationEvent {
  readonly measureNumber: number;
  readonly excessMs: number;
}

export interface ErrorLocation {
  readonly measureNumber: number;
  readonly errors: number;
}

export interface TimingMetrics {
  readonly meanAbsDeviationMs: number;
  readonly sdDeviationMs: number;
  /** Null when the score carries no staff assignment to attribute hands with. */
  readonly perHand: { right: HandTiming; left: HandTiming } | null;
}

export interface EvennessMetrics {
  /**
   * Coefficient of variation of *detrended* inter-onset intervals.
   *
   * Raw IOI variance conflates unevenness with tempo change — a perfect
   * accelerando would score terribly. Dividing by the tempo map's prediction
   * measures only the part that is actually uneven.
   */
  readonly detrendedIoiCv: number;
  /**
   * Deviation keyed by fingering, when the score provides it.
   *
   * Scale unevenness is systematic, not random: the thumb-under crossing
   * produces a reproducible bump. "Your 3→1 crossing is consistently 40 ms
   * late" is actionable; "your scale is uneven" is not.
   */
  readonly byFingering: ReadonlyArray<{ fingering: number; meanDeviationMs: number; count: number }>;
}

export interface DynamicsMetrics {
  /** Velocity p95 − p5, catching "everything is mezzo-forte". */
  readonly rangeUtilization: number;
  /**
   * Right-hand loudness over left, in dB.
   *
   * Raw velocity is not comparable across sessions — it moves with the piano's
   * touch-curve setting — so the balance metric has to be scale-invariant.
   */
  readonly balanceDb: number | null;
}

export interface IndependenceMetrics {
  /**
   * How much left-hand onsets drift toward the nearest right-hand onset, 0-1.
   *
   * The direct fingerprint of one hand capturing the other, and the thing that
   * actually makes hands-together fail. Replaces "cross-hand error
   * correlation", which is both statistically fragile and points the wrong
   * way: Ozaki et al. (2021) find difference-between-hands is *larger* in
   * experts. Independence is sustained intended asymmetry, not decorrelated
   * error.
   */
  readonly entrainment: number;
  /** Achieved dB separation between the hands, where the score asks for it. */
  readonly dynamicSeparationDb: number | null;
  readonly articulationSeparation: number | null;
}

export interface PerformanceMetrics {
  readonly noteAccuracy: number;
  readonly timing: TimingMetrics;
  readonly tempo: TempoStability;
  readonly chordSpread: {
    readonly events: readonly ChordSpreadEvent[];
    readonly meanSignedLeadMs: number;
    readonly faultedCount: number;
  };
  readonly evenness: EvennessMetrics;
  /** Null when the input source cannot measure velocity, e.g. a touchscreen. */
  readonly dynamics: DynamicsMetrics | null;
  readonly articulation: { meanRatio: number; slurredNoteCount: number } | null;
  readonly hesitations: readonly HesitationEvent[];
  readonly errorLocations: readonly ErrorLocation[];
  readonly independence: IndependenceMetrics | null;
}

/** Beyond this, a chord's spread stops being expressive and becomes untidy. */
export const CHORD_SPREAD_FAULT_MS = 60;
/** An inter-onset interval this many times its prediction is a hesitation. */
export const HESITATION_RATIO = 1.8;
/**
 * Milliseconds of melody lead attributable to one unit of extra velocity.
 *
 * Goebl (JASA 2001): a harder-struck key's hammer travels faster, so an
 * emphasised melody note sounds earlier even when the fingers moved together.
 * Regressing this out is what stops the metric punishing good voicing.
 */
const LEAD_PER_VELOCITY_UNIT_MS = 45;

/**
 * How long a gap between two notated clusters *should* take.
 *
 * Derived from the smoothed local tempo rather than by differencing the
 * interpolating tempo map. That map passes through every anchor, so
 * differencing it would reproduce whatever actually happened — including a
 * hesitation — and every ratio would come out at 1. Nothing would ever be
 * measurable. The local tempo is a median over neighbouring slopes, so it
 * tracks a real accelerando while ignoring a single stumble.
 */
function predictedIoiMs(
  from: OnsetCluster,
  to: OnsetCluster,
  tempoMap: TempoMap,
): number {
  const beats = to.absoluteBeats - from.absoluteBeats;
  const bpm = tempoMap.localBpm(from.absoluteBeats);
  return bpm > 0 ? beats * (60000 / bpm) : 0;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

export interface MetricsInput {
  readonly expected: readonly OnsetCluster[];
  readonly performed: readonly PerformedCluster[];
  readonly alignment: Alignment;
  readonly tempoMap: TempoMap;
  readonly take: PerformedTake;
}

export function computeMetrics(input: MetricsInput): PerformanceMetrics {
  const { expected, performed, alignment, tempoMap, take } = input;
  const pairs = alignedPairs(alignment);

  // --- Residuals: the basis of everything timing-related --------------------
  interface Residual {
    readonly ms: number;
    readonly note: TimelineNote | undefined;
    readonly cluster: OnsetCluster;
    readonly performedCluster: PerformedCluster;
  }

  const residuals: Residual[] = [];
  for (const pair of pairs) {
    const cluster = expected[pair.expectedIndex];
    const played = performed[pair.performedIndex];
    if (!cluster || !played) continue;
    residuals.push({
      ms: played.onsetMs - tempoMap.predict(cluster.absoluteBeats),
      note: cluster.notes[0],
      cluster,
      performedCluster: played,
    });
  }

  const deviations = residuals.map((r) => r.ms);
  const totalExpected = expected.length || 1;
  const noteAccuracy = alignment.matched / totalExpected;

  // --- Per-hand timing, from staff assignment ------------------------------
  //
  // Never from a pitch threshold: the left hand crosses above middle C
  // constantly, and a split there would silently corrupt every per-hand number.
  const rightResiduals: number[] = [];
  const leftResiduals: number[] = [];
  for (const r of residuals) {
    for (const note of r.cluster.notes) {
      if (note.staff === 1) rightResiduals.push(r.ms);
      else if (note.staff === 2) leftResiduals.push(r.ms);
    }
  }
  const hasBothHands = rightResiduals.length > 0 && leftResiduals.length > 0;

  const timing: TimingMetrics = {
    meanAbsDeviationMs: mean(deviations.map(Math.abs)),
    sdDeviationMs: sd(deviations),
    perHand: hasBothHands
      ? {
          right: {
            meanAbsDeviationMs: mean(rightResiduals.map(Math.abs)),
            sdDeviationMs: sd(rightResiduals),
            noteCount: rightResiduals.length,
          },
          left: {
            meanAbsDeviationMs: mean(leftResiduals.map(Math.abs)),
            sdDeviationMs: sd(leftResiduals),
            noteCount: leftResiduals.length,
          },
        }
      : null,
  };

  // --- Chord spread, signed and velocity-regressed --------------------------
  const spreadEvents: ChordSpreadEvent[] = [];
  for (const r of residuals) {
    if (r.cluster.pitches.length < 2) continue;
    // A notated roll is an instruction, not a fault.
    if (r.cluster.arpeggiated) continue;

    const notes = [...r.performedCluster.notes].sort((a, b) => a.midi - b.midi);
    const top = notes[notes.length - 1];
    const body = notes.slice(0, -1);
    if (!top || body.length === 0) continue;

    const bodyOnset = mean(body.map((n) => n.onsetMs));
    const signedLeadMs = bodyOnset - top.onsetMs;

    // Remove the part of the lead explained by striking the melody harder.
    const velocityGap = top.velocity - mean(body.map((n) => n.velocity));
    const explained = take.hasVelocity ? velocityGap * LEAD_PER_VELOCITY_UNIT_MS : 0;
    const unexplainedLead = signedLeadMs - explained;

    const spreadMs = r.performedCluster.spreadMs;
    // Fault only a large spread that is *not* melody lead: an untidy chord,
    // rather than a voiced one.
    const faulted = spreadMs > CHORD_SPREAD_FAULT_MS && unexplainedLead <= 0;

    spreadEvents.push({
      measureNumber: r.cluster.measureNumber,
      spreadMs,
      signedLeadMs,
      faulted,
    });
  }

  // --- Evenness: detrended, and keyed by fingering --------------------------
  const ratios: number[] = [];
  const byFingeringMap = new Map<number, number[]>();
  for (let i = 1; i < residuals.length; i++) {
    const previous = residuals[i - 1];
    const current = residuals[i];
    if (!previous || !current) continue;

    const predicted = predictedIoiMs(previous.cluster, current.cluster, tempoMap);
    const actual = current.performedCluster.onsetMs - previous.performedCluster.onsetMs;
    if (predicted > 1) ratios.push(actual / predicted);

    const fingering = current.note?.fingering;
    if (fingering != null) {
      const list = byFingeringMap.get(fingering) ?? [];
      list.push(current.ms);
      byFingeringMap.set(fingering, list);
    }
  }

  const ratioMean = mean(ratios);
  const evenness: EvennessMetrics = {
    detrendedIoiCv: ratioMean > 0 ? sd(ratios) / ratioMean : 0,
    byFingering: [...byFingeringMap.entries()]
      .map(([fingering, values]) => ({
        fingering,
        meanDeviationMs: mean(values),
        count: values.length,
      }))
      .sort((a, b) => a.fingering - b.fingering),
  };

  // --- Dynamics, only where velocity was actually measured ------------------
  let dynamics: DynamicsMetrics | null = null;
  if (take.hasVelocity && take.notes.length > 0) {
    const velocities = take.notes.map((n) => n.velocity);
    const rightVelocities: number[] = [];
    const leftVelocities: number[] = [];
    for (const r of residuals) {
      for (const note of r.cluster.notes) {
        const played = r.performedCluster.notes.find((p) => p.midi === note.midi);
        if (!played) continue;
        if (note.staff === 1) rightVelocities.push(played.velocity);
        else if (note.staff === 2) leftVelocities.push(played.velocity);
      }
    }
    const rightMean = mean(rightVelocities);
    const leftMean = mean(leftVelocities);
    dynamics = {
      rangeUtilization: percentile(velocities, 95) - percentile(velocities, 5),
      balanceDb:
        rightMean > 0 && leftMean > 0 ? 20 * Math.log10(rightMean / leftMean) : null,
    };
  }

  // --- Articulation, only where a slur asks for legato ----------------------
  const articulationRatios: number[] = [];
  for (let i = 1; i < residuals.length; i++) {
    const previous = residuals[i - 1];
    const current = residuals[i];
    if (!previous || !current) continue;
    const slurred = previous.cluster.notes.some((n) => n.slurStart || n.slurStop);
    if (!slurred) continue;

    const previousNote = previous.performedCluster.notes[0];
    const currentNote = current.performedCluster.notes[0];
    if (!previousNote || !currentNote) continue;

    const ioi = currentNote.onsetMs - previousNote.onsetMs;
    if (ioi <= 0) continue;
    // Negative means the notes overlapped, which is what legato sounds like.
    articulationRatios.push((previousNote.offsetMs - currentNote.onsetMs) / ioi * -1);
  }

  // --- Hesitations, located rather than averaged away -----------------------
  const hesitations: HesitationEvent[] = [];
  for (let i = 1; i < residuals.length; i++) {
    const previous = residuals[i - 1];
    const current = residuals[i];
    if (!previous || !current) continue;
    const predicted = predictedIoiMs(previous.cluster, current.cluster, tempoMap);
    const actual = current.performedCluster.onsetMs - previous.performedCluster.onsetMs;
    if (predicted > 1 && actual / predicted > HESITATION_RATIO) {
      hesitations.push({
        measureNumber: current.cluster.measureNumber,
        excessMs: actual - predicted,
      });
    }
  }

  // --- Left-hand onsets swallowed by a right-hand cluster --------------------
  //
  // A deleted left-hand cluster whose pitch appears in a nearby performed
  // cluster was not missed; it was played on top of the other hand.
  let mergedCount = 0;
  let leftOnlyDeletions = 0;
  for (const step of alignment.steps) {
    if (step.kind !== 'deletion' || step.expectedIndex === null) continue;
    const cluster = expected[step.expectedIndex];
    if (!cluster) continue;
    const isLeftOnly =
      cluster.notes.some((n) => n.staff === 2) && !cluster.notes.some((n) => n.staff === 1);
    if (!isLeftOnly) continue;

    leftOnlyDeletions += 1;
    const predictedMs = tempoMap.predict(cluster.absoluteBeats);
    const swallowed = performed.some(
      (p) =>
        Math.abs(p.onsetMs - predictedMs) < 400 &&
        cluster.pitches.some((pitch) => p.pitches.includes(pitch)),
    );
    if (swallowed) mergedCount += 1;
  }
  const mergedLeftHand = { merged: mergedCount, total: leftOnlyDeletions };

  // --- Where the errors are, which is the most actionable output there is ---
  const errorsByMeasure = new Map<number, number>();
  for (const step of alignment.steps) {
    if (step.kind === 'match') continue;
    const measure =
      step.expectedIndex !== null
        ? expected[step.expectedIndex]?.measureNumber
        : undefined;
    if (measure === undefined) continue;
    errorsByMeasure.set(measure, (errorsByMeasure.get(measure) ?? 0) + 1);
  }

  return {
    noteAccuracy,
    timing,
    // Filled in by the grader, which owns the stability fit; computed here it
    // would need the tempo map's own anchors, which are its business not ours.
    tempo: {
      medianBpm: tempoMap.medianBpm,
      coefficientOfVariation: 0,
      driftBpmPerBeat: 0,
      driftFraction: 0,
      instabilityCv: 0,
    },
    chordSpread: {
      events: spreadEvents,
      meanSignedLeadMs: mean(spreadEvents.map((e) => e.signedLeadMs)),
      faultedCount: spreadEvents.filter((e) => e.faulted).length,
    },
    evenness,
    dynamics,
    articulation:
      articulationRatios.length > 0
        ? { meanRatio: mean(articulationRatios), slurredNoteCount: articulationRatios.length }
        : null,
    hesitations,
    errorLocations: [...errorsByMeasure.entries()]
      .map(([measureNumber, errors]) => ({ measureNumber, errors }))
      .sort((a, b) => b.errors - a.errors),
    independence: hasBothHands
      ? computeIndependence(residuals, take, mergedLeftHand)
      : null,
  };
}

/**
 * The three measures that actually characterise hand independence.
 *
 * Entrainment is the primary one: when the hands have different notated
 * rhythms, does the left-hand onset drift toward the nearest right-hand onset?
 * That is one hand capturing the other, and it is what makes hands-together
 * collapse.
 */
function computeIndependence(
  residuals: ReadonlyArray<{
    ms: number;
    cluster: OnsetCluster;
    performedCluster: PerformedCluster;
  }>,
  take: PerformedTake,
  mergedLeftHand: { merged: number; total: number },
): IndependenceMetrics {
  const rightOnsets: number[] = [];
  for (const r of residuals) {
    if (r.cluster.notes.some((n) => n.staff === 1)) {
      rightOnsets.push(r.performedCluster.onsetMs);
    }
  }

  let pulled = 0;
  let considered = 0;
  for (const r of residuals) {
    const isLeftOnly =
      r.cluster.notes.some((n) => n.staff === 2) &&
      !r.cluster.notes.some((n) => n.staff === 1);
    if (!isLeftOnly) continue;

    const onset = r.performedCluster.onsetMs;
    let nearest: number | null = null;
    let bestDistance = Infinity;
    for (const rh of rightOnsets) {
      const d = Math.abs(rh - onset);
      if (d < bestDistance) { bestDistance = d; nearest = rh; }
    }
    if (nearest === null || bestDistance > 500) continue;

    considered += 1;
    // A residual pointing toward the nearest right-hand onset is the hand
    // being pulled; one pointing away is not.
    if (Math.sign(nearest - onset) === Math.sign(r.ms) && Math.abs(r.ms) > 8) {
      pulled += 1;
    }
  }

  const rightVelocities: number[] = [];
  const leftVelocities: number[] = [];
  for (const r of residuals) {
    for (const note of r.cluster.notes) {
      const played = r.performedCluster.notes.find((p) => p.midi === note.midi);
      if (!played) continue;
      if (note.staff === 1) rightVelocities.push(played.velocity);
      else if (note.staff === 2) leftVelocities.push(played.velocity);
    }
  }
  const rightMean = mean(rightVelocities);
  const leftMean = mean(leftVelocities);

  // Severe entrainment hides from the measurement above: once the hands land
  // together the clusterer merges them, so the left-hand cluster is never
  // matched and there is no residual to inspect. A notated left-hand onset
  // whose pitch turns up inside a right-hand cluster *is* the collapse, and
  // counting it is what keeps the metric monotone in the fault.
  const collapsed = mergedLeftHand.merged;
  const collapseTotal = mergedLeftHand.total;

  const totalConsidered = considered + collapseTotal;
  const totalPulled = pulled + collapsed;

  return {
    entrainment: totalConsidered > 0 ? totalPulled / totalConsidered : 0,
    dynamicSeparationDb:
      take.hasVelocity && rightMean > 0 && leftMean > 0
        ? 20 * Math.log10(rightMean / leftMean)
        : null,
    articulationSeparation: null,
  };
}
