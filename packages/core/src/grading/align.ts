/**
 * Aligning a performance to a score.
 *
 * Banded affine-gap sequence alignment (Gotoh) over onset clusters. Three
 * things about that sentence are load-bearing:
 *
 * **Sequence alignment, not DTW.** Dynamic time warping maps two series onto
 * each other under a *total monotone* correspondence — every element of one
 * must map to something in the other. It therefore cannot express insertion or
 * deletion, so an omitted note gets smeared across its neighbours instead of
 * identified as missing. For a learner who omits notes constantly, that is
 * disqualifying.
 *
 * **Affine gaps, not linear.** A gap costs one opening penalty plus a small
 * charge per element, so skipping an entire bar costs a single gap-open rather
 * than sixteen separate deletions. This is the anti-cascade mechanism: one
 * missed note must cost one note, not the rest of the take.
 *
 * **Clusters, not notes.** A chord is matched as a *set*. Note-by-note matching
 * would score a rolled chord as several timing errors, when a roll is one
 * chord with spread — and often a deliberate one.
 */

import type { MidiNote } from '../theory/pitch';
import type { OnsetCluster } from '../score/timeline';
import type { PerformedCluster } from './take';

export type AlignmentKind = 'match' | 'substitution' | 'insertion' | 'deletion';

export interface AlignmentStep {
  readonly kind: AlignmentKind;
  /** Index into the expected clusters, or null for an insertion. */
  readonly expectedIndex: number | null;
  /** Index into the performed clusters, or null for a deletion. */
  readonly performedIndex: number | null;
  /** Pitch-set similarity for matched pairs, 0-1. */
  readonly similarity: number;
}

export interface Alignment {
  readonly steps: readonly AlignmentStep[];
  /** Total alignment score; only meaningful relative to other alignments. */
  readonly score: number;
  readonly matched: number;
  readonly substituted: number;
  /** Played but not in the score. */
  readonly inserted: number;
  /** In the score but not played. */
  readonly deleted: number;
}

export interface AlignOptions {
  /**
   * Half-width of the Sakoe-Chiba band. Cells further from the diagonal are
   * never considered, which is what keeps memory bounded on a 3 GB tablet:
   * a full N×M×3 matrix is the thing to avoid, not the arithmetic.
   */
  readonly band?: number;
  readonly gapOpen?: number;
  readonly gapExtend?: number;
}

const DEFAULT_GAP_OPEN = 1.2;
const DEFAULT_GAP_EXTEND = 0.18;
/** Score for a perfectly matching pitch set. */
const MATCH_REWARD = 1;
/** Penalty floor for a completely disjoint pair. */
const MISMATCH_PENALTY = -1;

/** Band wide enough to absorb realistic omissions and additions. */
export function defaultBand(expectedLength: number, performedLength: number): number {
  return Math.max(
    50,
    Math.ceil(0.1 * Math.max(expectedLength, performedLength)) + 50,
    Math.abs(expectedLength - performedLength) + 10,
  );
}

/**
 * Similarity of two pitch sets, 0-1.
 *
 * Intersection over the larger set, so playing three of a four-note chord
 * scores 0.75 rather than being judged wholly wrong. Octave is *not* folded
 * away: reading is about exact pitch, and a note played an octave off is a
 * real error rather than a spelling nuance.
 */
export function pitchSetSimilarity(
  a: readonly MidiNote[],
  b: readonly MidiNote[],
): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const pitch of new Set(a)) if (setB.has(pitch)) shared += 1;
  return shared / Math.max(new Set(a).size, setB.size);
}

function substitutionScore(similarity: number): number {
  // Linear from a full mismatch penalty to the full match reward, so a partial
  // chord is worth something rather than being lumped in with a wrong one.
  return MISMATCH_PENALTY + similarity * (MATCH_REWARD - MISMATCH_PENALTY);
}

/** Anything at or above this counts as the same chord, not a substitution. */
export const MATCH_THRESHOLD = 0.999;

type Trace = Int8Array;

/**
 * Align expected against performed clusters.
 *
 * Gotoh's algorithm with three states — M (aligned pair), X (gap in the
 * expected sequence, i.e. an inserted performance cluster), Y (gap in the
 * performed sequence, i.e. a deleted score cluster) — restricted to a band
 * around the diagonal.
 */
export function alignClusters(
  expected: readonly OnsetCluster[],
  performed: readonly PerformedCluster[],
  options: AlignOptions = {},
): Alignment {
  const n = expected.length;
  const m = performed.length;

  if (n === 0 || m === 0) {
    const steps: AlignmentStep[] = [
      ...expected.map((_, i) => ({
        kind: 'deletion' as const, expectedIndex: i, performedIndex: null, similarity: 0,
      })),
      ...performed.map((_, j) => ({
        kind: 'insertion' as const, expectedIndex: null, performedIndex: j, similarity: 0,
      })),
    ];
    return {
      steps, score: 0, matched: 0, substituted: 0,
      inserted: m, deleted: n,
    };
  }

  const band = options.band ?? defaultBand(n, m);
  const gapOpen = options.gapOpen ?? DEFAULT_GAP_OPEN;
  const gapExtend = options.gapExtend ?? DEFAULT_GAP_EXTEND;

  const width = 2 * band + 1;
  const inBand = (i: number, j: number): boolean => Math.abs(i - j) <= band;
  // Column j of row i lives at offset (j - i + band), so only the band is stored.
  const at = (i: number, j: number): number => i * width + (j - i + band);

  const size = (n + 1) * width;
  const NEG = -1e9;

  const M = new Float32Array(size).fill(NEG);
  const X = new Float32Array(size).fill(NEG);
  const Y = new Float32Array(size).fill(NEG);
  // Which state each cell came from, so the path can be walked back.
  const traceM: Trace = new Int8Array(size);
  const traceX: Trace = new Int8Array(size);
  const traceY: Trace = new Int8Array(size);

  const set = (arr: Float32Array, i: number, j: number, v: number): void => {
    if (inBand(i, j)) arr[at(i, j)] = v;
  };
  const get = (arr: Float32Array, i: number, j: number): number =>
    inBand(i, j) ? (arr[at(i, j)] ?? NEG) : NEG;

  set(M, 0, 0, 0);
  for (let j = 1; j <= m && j <= band; j++) {
    set(X, 0, j, -gapOpen - (j - 1) * gapExtend);
  }
  for (let i = 1; i <= n && i <= band; i++) {
    set(Y, i, 0, -gapOpen - (i - 1) * gapExtend);
  }

  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - band);
    const hi = Math.min(m, i + band);
    for (let j = lo; j <= hi; j++) {
      const similarity = pitchSetSimilarity(
        expected[i - 1]?.pitches ?? [],
        performed[j - 1]?.pitches ?? [],
      );
      const sub = substitutionScore(similarity);

      const fromM = get(M, i - 1, j - 1);
      const fromX = get(X, i - 1, j - 1);
      const fromY = get(Y, i - 1, j - 1);
      let best = fromM;
      let from = 0;
      if (fromX > best) { best = fromX; from = 1; }
      if (fromY > best) { best = fromY; from = 2; }
      set(M, i, j, best + sub);
      if (inBand(i, j)) traceM[at(i, j)] = from;

      // X: a gap in the expected sequence — an extra played cluster.
      const openX = get(M, i, j - 1) - gapOpen;
      const extendX = get(X, i, j - 1) - gapExtend;
      set(X, i, j, Math.max(openX, extendX));
      if (inBand(i, j)) traceX[at(i, j)] = openX >= extendX ? 0 : 1;

      // Y: a gap in the performed sequence — a missed score cluster.
      const openY = get(M, i - 1, j) - gapOpen;
      const extendY = get(Y, i - 1, j) - gapExtend;
      set(Y, i, j, Math.max(openY, extendY));
      if (inBand(i, j)) traceY[at(i, j)] = openY >= extendY ? 0 : 2;
    }
  }

  // Walk back from whichever state ends best.
  const steps: AlignmentStep[] = [];
  let i = n;
  let j = m;
  let state: 0 | 1 | 2 = 0;
  {
    const endM = get(M, n, m);
    const endX = get(X, n, m);
    const endY = get(Y, n, m);
    let best = endM;
    if (endX > best) { best = endX; state = 1; }
    if (endY > best) { best = endY; state = 2; }
  }
  const finalScore = Math.max(get(M, n, m), get(X, n, m), get(Y, n, m));

  let guard = 0;
  const maxSteps = (n + m) * 2 + 16;

  while ((i > 0 || j > 0) && guard++ < maxSteps) {
    if (state === 0) {
      if (i === 0 || j === 0) {
        // Fell out of the band or off the grid; drain what remains.
        state = i > 0 ? 2 : 1;
        continue;
      }
      const similarity = pitchSetSimilarity(
        expected[i - 1]?.pitches ?? [],
        performed[j - 1]?.pitches ?? [],
      );
      steps.push({
        kind: similarity >= MATCH_THRESHOLD ? 'match' : 'substitution',
        expectedIndex: i - 1,
        performedIndex: j - 1,
        similarity,
      });
      state = (inBand(i, j) ? traceM[at(i, j)] : 0) as 0 | 1 | 2;
      i -= 1;
      j -= 1;
    } else if (state === 1) {
      if (j === 0) { state = 2; continue; }
      steps.push({
        kind: 'insertion', expectedIndex: null, performedIndex: j - 1, similarity: 0,
      });
      state = (inBand(i, j) ? traceX[at(i, j)] : 0) as 0 | 1 | 2;
      j -= 1;
    } else {
      if (i === 0) { state = 1; continue; }
      steps.push({
        kind: 'deletion', expectedIndex: i - 1, performedIndex: null, similarity: 0,
      });
      state = (inBand(i, j) ? traceY[at(i, j)] : 0) as 0 | 1 | 2;
      i -= 1;
    }
  }

  steps.reverse();

  return {
    steps,
    score: finalScore,
    matched: steps.filter((s) => s.kind === 'match').length,
    substituted: steps.filter((s) => s.kind === 'substitution').length,
    inserted: steps.filter((s) => s.kind === 'insertion').length,
    deleted: steps.filter((s) => s.kind === 'deletion').length,
  };
}

/** Matched and substituted pairs, which are what timing is measured on. */
export function alignedPairs(
  alignment: Alignment,
): Array<{ expectedIndex: number; performedIndex: number; similarity: number }> {
  return alignment.steps
    .filter(
      (s): s is AlignmentStep & { expectedIndex: number; performedIndex: number } =>
        s.expectedIndex !== null && s.performedIndex !== null,
    )
    .map((s) => ({
      expectedIndex: s.expectedIndex,
      performedIndex: s.performedIndex,
      similarity: s.similarity,
    }));
}
