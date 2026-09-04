/**
 * Fitting the tempo the player actually took.
 *
 * The alignment says *which* played cluster corresponds to which notated one.
 * This turns those correspondences into a map from score position to wall
 * time, which is what makes the difference between "you played this note late"
 * and "you played the whole passage slower than written".
 *
 * Fitted with Theil-Sen local slopes — the median of pairwise slopes — rather
 * than least squares. One fumbled note is a large residual, and least squares
 * would tilt the whole curve toward it, converting a single mistake into a
 * systematic timing error on every other note.
 *
 * The fitted curve is also a *diagnostic in its own right*: its local slope is
 * the tempo, and the variance of that slope is rushing and dragging.
 */

export interface TempoAnchor {
  readonly scoreBeats: number;
  readonly wallMs: number;
}

export interface TempoMap {
  readonly anchors: readonly TempoAnchor[];
  /** Median tempo across the take, in BPM. */
  readonly medianBpm: number;
  /** Predicted wall time for a score position. */
  predict(scoreBeats: number): number;
  /** Local tempo at a score position, in BPM. */
  localBpm(scoreBeats: number): number;
}

/** Slope in ms-per-beat between two anchors. */
function slopeBetween(a: TempoAnchor, b: TempoAnchor): number | null {
  const beats = b.scoreBeats - a.scoreBeats;
  if (Math.abs(beats) < 1e-6) return null;
  return (b.wallMs - a.wallMs) / beats;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Robust local slope at an anchor: the median of slopes to its neighbours.
 *
 * Using neighbours on both sides rather than only the next one means a single
 * hesitation shows up as one anomalous residual instead of bending the curve.
 */
function localSlope(anchors: readonly TempoAnchor[], index: number, radius = 3): number {
  const here = anchors[index];
  if (!here) return 0;
  const slopes: number[] = [];
  for (let k = Math.max(0, index - radius); k <= Math.min(anchors.length - 1, index + radius); k++) {
    if (k === index) continue;
    const other = anchors[k];
    if (!other) continue;
    const s = slopeBetween(here, other);
    if (s !== null && s > 0) slopes.push(s);
  }
  return slopes.length > 0 ? median(slopes) : 0;
}

const DEFAULT_MS_PER_BEAT = 60000 / 80;

/**
 * Smooth the anchors into a curve that represents the *pulse*, not the take.
 *
 * This is the difference between a tempo map and a transcript. Interpolating
 * through every anchor reproduces exactly what happened — including the
 * hesitation, including the hand that dragged — so every residual comes out at
 * zero and nothing is measurable. A map that fits the mistakes cannot reveal
 * them.
 *
 * Each anchor is replaced by the median of what its neighbours predict for its
 * position, given the local slope. A single anomaly is one value in the window
 * and the median ignores it; a sustained tempo change moves every neighbour
 * together and the median follows.
 */
function smoothAnchors(anchors: readonly TempoAnchor[], radius = 3): TempoAnchor[] {
  if (anchors.length < 3) return [...anchors];

  const smoothed: TempoAnchor[] = anchors.map((anchor, i) => {
    const slope = localSlope(anchors, i, radius) || DEFAULT_MS_PER_BEAT;
    const projected: number[] = [];
    for (let k = Math.max(0, i - radius); k <= Math.min(anchors.length - 1, i + radius); k++) {
      const other = anchors[k];
      if (!other) continue;
      projected.push(other.wallMs + slope * (anchor.scoreBeats - other.scoreBeats));
    }
    return { scoreBeats: anchor.scoreBeats, wallMs: median(projected) };
  });

  // Score position only moves forward, so the map must too; a non-monotone
  // curve would produce negative durations downstream.
  for (let i = 1; i < smoothed.length; i++) {
    const previous = smoothed[i - 1];
    const current = smoothed[i];
    if (previous && current && current.wallMs < previous.wallMs) {
      smoothed[i] = { scoreBeats: current.scoreBeats, wallMs: previous.wallMs };
    }
  }
  return smoothed;
}

/**
 * Build a tempo map from aligned pairs.
 *
 * Anchors are forced monotone in wall time: score position only ever moves
 * forward, so a map that went backwards would produce negative durations and
 * nonsense residuals downstream.
 */
export function fitTempoMap(pairs: readonly TempoAnchor[]): TempoMap {
  const sorted = [...pairs].sort((a, b) => a.scoreBeats - b.scoreBeats);

  const raw: TempoAnchor[] = [];
  for (const anchor of sorted) {
    const previous = raw[raw.length - 1];
    if (previous && anchor.scoreBeats - previous.scoreBeats < 1e-6) continue;
    if (previous && anchor.wallMs < previous.wallMs) continue;
    raw.push(anchor);
  }

  const anchors = smoothAnchors(raw);

  const slopes = anchors.map((_, i) => localSlope(anchors, i)).filter((s) => s > 0);
  const medianSlope = slopes.length > 0 ? median(slopes) : DEFAULT_MS_PER_BEAT;
  const medianBpm = 60000 / (medianSlope || DEFAULT_MS_PER_BEAT);

  const predict = (scoreBeats: number): number => {
    if (anchors.length === 0) return scoreBeats * DEFAULT_MS_PER_BEAT;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (!first || !last) return scoreBeats * medianSlope;

    if (scoreBeats <= first.scoreBeats) {
      return first.wallMs - (first.scoreBeats - scoreBeats) * medianSlope;
    }
    if (scoreBeats >= last.scoreBeats) {
      return last.wallMs + (scoreBeats - last.scoreBeats) * medianSlope;
    }

    // Piecewise linear between the surrounding anchors.
    let lo = 0;
    let hi = anchors.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((anchors[mid]?.scoreBeats ?? 0) <= scoreBeats) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    if (!a || !b) return scoreBeats * medianSlope;
    const span = b.scoreBeats - a.scoreBeats;
    const t = span < 1e-9 ? 0 : (scoreBeats - a.scoreBeats) / span;
    return a.wallMs + t * (b.wallMs - a.wallMs);
  };

  const localBpm = (scoreBeats: number): number => {
    if (anchors.length < 2) return medianBpm;
    let nearest = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs((anchors[i]?.scoreBeats ?? 0) - scoreBeats);
      if (d < bestDistance) { bestDistance = d; nearest = i; }
    }
    const slope = localSlope(anchors, nearest);
    return slope > 0 ? 60000 / slope : medianBpm;
  };

  return { anchors, medianBpm, predict, localBpm };
}

/**
 * How steady the tempo was — and, separately, where it went.
 *
 * These are two different faults with two different remedies, and conflating
 * them is easy to do and wrong. A *smooth* accelerando is highly directional
 * but barely variable: every anchor sits neatly on a rising line, so the
 * coefficient of variation stays small precisely *because* the rush is
 * controlled. Gating a "you are speeding up" finding on variation therefore
 * fires least reliably exactly when the drift is cleanest. Measured on the
 * bundled repertoire under a 12% injected accelerando, the steepest drift of
 * the three pieces produced the *lowest* variation of the three.
 *
 * So drift is measured on its own terms, as a trend, and instability is
 * measured about that trend. This is the same correction `detrendedIoiCv`
 * applies one level down: divide out the tempo change first, then ask what is
 * left over.
 */
export interface TempoStability {
  readonly medianBpm: number;
  /**
   * Raw coefficient of variation of local tempo.
   *
   * Reported because it is the honest summary of how much the pulse moved in
   * total, but it contains the drift — use `instabilityCv` to ask whether the
   * pulse was *unsteady*.
   */
  readonly coefficientOfVariation: number;
  /** Positive means speeding up. Robust trend, not an endpoint difference. */
  readonly driftBpmPerBeat: number;
  /**
   * The trend expressed as a fraction of the median tempo across the whole
   * take: 0.25 means ending about a quarter faster than starting.
   *
   * This is what a finding should key on, because it is scale-free — 8 BPM per
   * beat means something very different at 60 than at 160.
   */
  readonly driftFraction: number;
  /** Variation of tempo *about its own trend*: wobble that is not drift. */
  readonly instabilityCv: number;
}

const ZERO_STABILITY = (medianBpm: number): TempoStability => ({
  medianBpm,
  coefficientOfVariation: 0,
  driftBpmPerBeat: 0,
  driftFraction: 0,
  instabilityCv: 0,
});

export function tempoStability(map: TempoMap): TempoStability {
  const { anchors } = map;
  if (anchors.length < 3) return ZERO_STABILITY(map.medianBpm);

  const samples = anchors
    .map((a) => ({ beats: a.scoreBeats, bpm: map.localBpm(a.scoreBeats) }))
    .filter((s) => s.bpm > 0);
  if (samples.length < 2) return ZERO_STABILITY(map.medianBpm);

  const tempos = samples.map((s) => s.bpm);
  const mean = tempos.reduce((a, b) => a + b, 0) / tempos.length;
  const variance = tempos.reduce((acc, t) => acc + (t - mean) ** 2, 0) / tempos.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // The trend, from the median of each end rather than the endpoints
  // themselves. A single anomalous first or last anchor — the note you settle
  // into, the one you land on — would otherwise set the entire slope.
  const quarter = Math.max(1, Math.floor(samples.length / 4));
  const head = samples.slice(0, quarter);
  const tail = samples.slice(samples.length - quarter);

  const headBpm = median(head.map((s) => s.bpm));
  const tailBpm = median(tail.map((s) => s.bpm));
  const headBeats = median(head.map((s) => s.beats));
  const tailBeats = median(tail.map((s) => s.beats));

  const anchorSpan = tailBeats - headBeats;
  const driftBpmPerBeat = anchorSpan > 1e-6 ? (tailBpm - headBpm) / anchorSpan : 0;

  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const totalSpan = (lastSample?.beats ?? 0) - (firstSample?.beats ?? 0);
  const driftFraction = mean > 0 ? (driftBpmPerBeat * totalSpan) / mean : 0;

  // Instability is what the trend does not explain.
  const residuals = samples.map(
    (s) => s.bpm - (headBpm + driftBpmPerBeat * (s.beats - headBeats)),
  );
  const residualMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const residualVariance =
    residuals.reduce((acc, r) => acc + (r - residualMean) ** 2, 0) / residuals.length;
  const instabilityCv = mean > 0 ? Math.sqrt(residualVariance) / mean : 0;

  return {
    medianBpm: map.medianBpm,
    coefficientOfVariation: cv,
    driftBpmPerBeat,
    driftFraction,
    instabilityCv,
  };
}
