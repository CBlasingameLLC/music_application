/**
 * Seeded RNG.
 *
 * Every generated drill records its seed in the event log, so any drill can be
 * reproduced exactly from `(generatorId, seed)`. That is what lets the log stay
 * small — we never store ten thousand materialized exercises — and it makes a
 * failed attempt reviewable: "show me the one I got wrong" has to regenerate
 * the identical question.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** `count` distinct items, or all of them if count exceeds the pool. */
  sample<T>(items: readonly T[], count: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  bool(probability?: number): boolean;
}

/** mulberry32 — small, fast, and good enough for drill variety. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    Math.floor(next() * (max - min + 1)) + min;

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('cannot pick from an empty list');
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new Error('unreachable: rng picked out of range');
    return item;
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  };

  return {
    next,
    int,
    pick,
    shuffle,
    sample: <T,>(items: readonly T[], count: number): T[] =>
      shuffle(items).slice(0, Math.min(count, items.length)),
    bool: (probability = 0.5): boolean => next() < probability,
  };
}

/** A fresh seed for a new drill. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
