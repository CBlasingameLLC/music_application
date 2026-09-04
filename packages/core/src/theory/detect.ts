/**
 * Inferring a key from what is actually being played.
 *
 * Free Play needs to say "you are in E♭ major" without being told, because the
 * whole point of that mode is that you just play and the app keeps up. Chord
 * names alone are not enough — a C major triad means something different in C
 * than it does in F or G, and the Roman numeral is the part worth showing.
 *
 * Uses Krumhansl-Schmuckler key profiles: correlate a pitch-class histogram
 * against the 24 major and minor profiles and take the best fit. It is the
 * standard approach, it is cheap, and it degrades sensibly — with too little
 * evidence it reports low confidence rather than a confident wrong answer.
 */

import { type Key, allKeys, keyFifths } from './scale';
import { mod12, toMidi, type MidiNote } from './pitch';

/**
 * Krumhansl-Kessler probe-tone profiles, indexed from the tonic.
 * These are experimental ratings of how well each chromatic degree "fits" a
 * key, gathered from listeners rather than derived from theory.
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;

const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

/** Weight per pitch class, typically total sounding time. */
export type PitchClassWeights = readonly number[];

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i] ?? 0;
    sumB += b[i] ?? 0;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0;
  let devA = 0;
  let devB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const dbv = (b[i] ?? 0) - meanB;
    num += da * dbv;
    devA += da * da;
    devB += dbv * dbv;
  }
  const denom = Math.sqrt(devA * devB);
  return denom === 0 ? 0 : num / denom;
}

function rotate(profile: readonly number[], tonicPc: number): number[] {
  return Array.from({ length: 12 }, (_, i) => profile[mod12(i - tonicPc)] ?? 0);
}

export interface KeyEstimate {
  readonly key: Key;
  /** Correlation with the profile, -1 to 1. Higher is a better fit. */
  readonly score: number;
  /**
   * How much the UI should trust this label, 0-1.
   *
   * Deliberately the product of two different things, because either alone
   * lies. *Margin* is how clearly the winner beats the runner-up — but a sparse
   * input has a large margin simply because few keys fit it, so two notes would
   * otherwise outscore a whole scale. *Evidence* is how many distinct pitch
   * classes have actually been heard. You need both: a distinctive winner drawn
   * from enough material.
   */
  readonly confidence: number;
}

/**
 * Rank every key against a pitch-class histogram.
 *
 * Candidates are the 15 spellings of each mode, but enharmonic spellings of the
 * same pitch collection score identically, so ties are broken toward the
 * simpler key signature. Without that, a run in D♭ major could just as easily
 * come back as C♯ major, which is technically right and practically useless.
 */
export function rankKeys(weights: PitchClassWeights, limit = 4): KeyEstimate[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const scored: Array<{ key: Key; score: number; complexity: number }> = [];

  for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    for (const key of allKeys(mode)) {
      const tonicPc = mod12(toMidi(key.tonic));
      const score = pearson(weights, rotate(profile, tonicPc));
      scored.push({ key, score, complexity: Math.abs(keyFifths(key) ?? 7) });
    }
  }

  scored.sort((a, b) => {
    // Enharmonic equivalents score identically; prefer the simpler signature.
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    return a.complexity - b.complexity;
  });

  const best = scored[0];
  if (!best) return [];

  // Confidence compares the winner against the best key that is not merely an
  // enharmonic respelling of it.
  const bestPc = mod12(toMidi(best.key.tonic));
  const runnerUp = scored.find(
    (s) => mod12(toMidi(s.key.tonic)) !== bestPc || s.key.mode !== best.key.mode,
  );
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  const marginScore = Math.max(0, Math.min(1, margin / 0.12));

  // A pitch class counts as heard once it carries a non-trivial share of the
  // total. Squaring is what makes a two-note fragment stay uncertain no matter
  // how cleanly it happens to fit one profile.
  const distinct = weights.filter((w) => w > total * 0.02).length;
  const evidence = Math.pow(Math.min(1, distinct / 7), 2);

  const confidence = evidence * marginScore;

  return scored.slice(0, limit).map((s) => ({
    key: s.key,
    score: s.score,
    confidence: s === best ? confidence : 0,
  }));
}

/** Single best key, or null when there is not enough evidence to say. */
export function inferKey(
  weights: PitchClassWeights,
  minConfidence = 0.12,
): KeyEstimate | null {
  const ranked = rankKeys(weights, 1);
  const best = ranked[0];
  if (!best || best.confidence < minConfidence) return null;
  return best;
}

/**
 * A decaying pitch-class histogram.
 *
 * Free Play is continuous, so the key estimate has to follow a modulation
 * rather than average the whole session into mush. Weights decay with a
 * half-life, so recent playing dominates and an earlier key fades out.
 */
export class PitchClassHistogram {
  private readonly weights = new Array<number>(12).fill(0);
  private lastUpdate: number;

  constructor(
    /** Seconds for a note's contribution to halve. */
    private readonly halfLifeSeconds = 12,
    now = 0,
  ) {
    this.lastUpdate = now;
  }

  /** Add sounding time for a note. `duration` is in seconds. */
  add(midi: MidiNote, duration: number, now: number): void {
    this.decayTo(now);
    const pc = mod12(midi);
    this.weights[pc] = (this.weights[pc] ?? 0) + Math.max(0, duration);
  }

  /**
   * Add extra weight for a chord root.
   *
   * Raw sounding time alone is a surprisingly weak key signal: a ii-V-I in C
   * spends as long on D, F and G as it does on C, and profile correlation
   * happily ranks G major above C major on that evidence. Roots carry the
   * harmonic function that pitch-class duration throws away, so a recognised
   * chord contributes its root separately and heavily.
   */
  addChordRoot(midi: MidiNote, weight: number, now: number): void {
    this.decayTo(now);
    const pc = mod12(midi);
    this.weights[pc] = (this.weights[pc] ?? 0) + Math.max(0, weight);
  }

  private decayTo(now: number): void {
    const elapsed = Math.max(0, now - this.lastUpdate);
    if (elapsed === 0) return;
    const factor = Math.pow(0.5, elapsed / this.halfLifeSeconds);
    for (let i = 0; i < 12; i++) this.weights[i] = (this.weights[i] ?? 0) * factor;
    this.lastUpdate = now;
  }

  snapshot(now: number): number[] {
    this.decayTo(now);
    return [...this.weights];
  }

  get total(): number {
    return this.weights.reduce((a, b) => a + b, 0);
  }

  reset(now = 0): void {
    this.weights.fill(0);
    this.lastUpdate = now;
  }
}
