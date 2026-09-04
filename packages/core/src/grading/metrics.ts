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


  // Entrainment, from the shared measure. Computed here rather than inside
  // computeIndependence because it needs the notated grid, not the residuals.
  const entrainment = measureEntrainment({ expected, performed, alignment });

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
      ? computeIndependence(residuals, take, entrainment)
      : null,
  };
}

/**
 * How far one hand is being pulled onto the other's beats, 0-1.
 *
 * Measured as a *phase*, which is what makes it trustworthy. A note notated
 * between two of the other hand's onsets sits at a known fraction of the way
 * between them — a left hand on the offbeat is at 0.5, a triplet's second note
 * at 1/3. Entrainment is that fraction collapsing toward 0 or 1, because
 * landing on 0 or 1 *is* playing together.
 *
 * Working in phase rather than in milliseconds means no absolute time
 * reference is needed: it is a ratio between events the player actually
 * produced, so it survives any tempo, any drift, and a take that has fallen
 * apart entirely. Three earlier attempts here all failed for want of that.
 *
 *  - Comparing each residual's *sign* against the nearest other-hand onset was
 *    knife-edge unstable: on one fixture a 4 ms jitter difference swung the
 *    result from 0.97 to 0.16, because a sign test with a fixed threshold sits
 *    right on the tempo map's smoothing boundary.
 *  - Measuring displacement against the *fitted* tempo map lost the worst
 *    takes: fitting a map to a fully collapsed 3:1 take produced 0.9 BPM and
 *    put beat 1 at 70 seconds, so the collapse became unmeasurable.
 *  - Measuring against a target-tempo grid needed an anchor, and material where
 *    the hands never coincide offers none — a constant shift of one hand is
 *    indistinguishable from a constant shift of the other.
 *
 * It also does not care *which* hand is being captured. At 2:1 or 3:1 the left
 * hand coincides with a right-hand note on every one of its onsets, and it is
 * the right hand's offbeats that collapse onto the beat; a measure that only
 * inspects the left hand reads a confident zero on exactly those exercises.
 */
export interface EntrainmentInput {
  readonly expected: readonly OnsetCluster[];
  readonly performed: readonly PerformedCluster[];
  readonly alignment: Alignment;
}

export function measureEntrainment(
  input: EntrainmentInput,
): { value: number; considered: number } | null {
  const { expected, performed, alignment } = input;

  // Identity comes from the alignment, not from hunting for a pitch by time:
  // the same pitch recurs many times in an ostinato, so a nearest-match search
  // lands wherever it likes. The alignment is what already answers "which
  // played cluster is this notated one".
  const playedAt = new Map<number, number>();
  for (const pair of alignedPairs(alignment)) {
    const performedCluster = performed[pair.performedIndex];
    if (performedCluster) playedAt.set(pair.expectedIndex, performedCluster.onsetMs);
  }

  const carries = (cluster: OnsetCluster, left: boolean): boolean =>
    cluster.notes.some((n) => (n.staff === 2) === left);

  const fractions: number[] = [];

  for (let i = 0; i < expected.length; i++) {
    const cluster = expected[i];
    if (!cluster) continue;
    const hasLeft = carries(cluster, true);
    const hasRight = carries(cluster, false);
    // A note already sounding with the other hand has nowhere to be pulled.
    if (hasLeft === hasRight) continue;
    const otherIsLeft = !hasLeft;

    // The other hand's onsets that bracket this one, and that were matched.
    let before: number | null = null;
    let beforeBeats = 0;
    let after: number | null = null;
    let afterBeats = 0;
    for (let k = i - 1; k >= 0; k--) {
      const c = expected[k];
      const at = playedAt.get(k);
      if (c && at !== undefined && carries(c, otherIsLeft)) {
        before = at; beforeBeats = c.absoluteBeats; break;
      }
    }
    for (let k = i + 1; k < expected.length; k++) {
      const c = expected[k];
      const at = playedAt.get(k);
      if (c && at !== undefined && carries(c, otherIsLeft)) {
        after = at; afterBeats = c.absoluteBeats; break;
      }
    }
    if (before === null || after === null) continue;

    const span = afterBeats - beforeBeats;
    const playedSpan = after - before;
    if (span <= 1e-9 || playedSpan <= 1e-6) continue;

    const notatedPhase = (cluster.absoluteBeats - beforeBeats) / span;
    if (notatedPhase <= 1e-6 || notatedPhase >= 1 - 1e-6) continue;

    const ownMs = playedAt.get(i);
    if (ownMs === undefined) {
      // Unmatched between two matched neighbours of the other hand. Under
      // severe entrainment the note lands exactly on one of them and the
      // clusterer merges the two, so there is nothing left to match — and
      // skipping it would drop precisely the worst takes.
      const swallowed = performed.some(
        (p) =>
          (Math.abs(p.onsetMs - before) < 60 || Math.abs(p.onsetMs - after) < 60) &&
          cluster.pitches.some((pitch) => p.pitches.includes(pitch)),
      );
      if (swallowed) fractions.push(1);
      continue;
    }

    const playedPhase = (ownMs - before) / playedSpan;

    // How far it travelled toward whichever coincidence it moved toward, as a
    // fraction of the distance available in that direction. 0 is where it was
    // written, 1 is dead on top of the other hand.
    const toward = playedPhase < notatedPhase
      ? (notatedPhase - playedPhase) / notatedPhase
      : (playedPhase - notatedPhase) / (1 - notatedPhase);

    fractions.push(Math.max(0, Math.min(1, toward)));
  }

  if (fractions.length === 0) return null;
  return {
    value: fractions.reduce((a, b) => a + b, 0) / fractions.length,
    considered: fractions.length,
  };
}

/**
 * The three measures that actually characterise hand independence.
 *
 * Entrainment is the primary one and lives in `measureEntrainment`, shared with
 * the Independence Lab so there is exactly one definition of it. The version
 * that used to live here compared each left-hand residual's sign against the
 * nearest right-hand onset, and it was knife-edge unstable: measured on the
 * same fixture, a 4 ms difference in jitter swung it from 0.97 to 0.16, because
 * a sign test with a fixed threshold sits right on the tempo map's smoothing
 * boundary. It also only ever looked at the *left* hand, which cannot see the
 * case where the subdivided right hand is the one collapsing onto the beat.
 */
function computeIndependence(
  residuals: ReadonlyArray<{
    ms: number;
    cluster: OnsetCluster;
    performedCluster: PerformedCluster;
  }>,
  take: PerformedTake,
  entrainment: { value: number; considered: number } | null,
): IndependenceMetrics {
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

  return {
    // Zero when the hands never play apart: there is nothing to be pulled, and
    // that is a property of the music rather than of the playing.
    entrainment: entrainment?.value ?? 0,
    dynamicSeparationDb:
      take.hasVelocity && rightMean > 0 && leftMean > 0
        ? 20 * Math.log10(rightMean / leftMean)
        : null,
    articulationSeparation: null,
  };
}
