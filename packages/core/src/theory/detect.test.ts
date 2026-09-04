import { describe, expect, it } from 'vitest';
import { PitchClassHistogram, inferKey, rankKeys } from './detect';
import { keyId, keyScale, allKeys, type Key } from './scale';
import { chordVoicing, parseChordSymbol } from './chord';
import { realizeProgression } from './harmony';
import { mod12, toMidi } from './pitch';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

/** Equal weight on every pitch class of a key's scale. */
function scaleWeights(key: Key): number[] {
  const w = new Array<number>(12).fill(0);
  for (const n of keyScale(key)) w[mod12(toMidi(n))] = 1;
  return w;
}

/** Weights from actually "playing" a progression, weighted by sounding time. */
function progressionWeights(numerals: string[], key: Key): number[] {
  const w = new Array<number>(12).fill(0);
  for (const chord of realizeProgression(numerals, key)) {
    for (const midi of chordVoicing(chord)) {
      const pc = mod12(midi);
      w[pc] = (w[pc] ?? 0) + 1;
    }
  }
  return w;
}

describe('key inference', () => {
  it('identifies a major key from its own scale', () => {
    for (const id of ['C-major', 'G-major', 'F-major', 'D-major', 'Bb-major', 'Eb-major']) {
      const best = rankKeys(scaleWeights(K(id)), 1)[0];
      expect(best, id).toBeDefined();
      expect(keyId(best!.key), id).toBe(id);
    }
  });

  it('identifies a minor key from its own scale', () => {
    // A natural minor scale shares its notes with the relative major, so the
    // profiles — not the note set — are what separate them.
    for (const id of ['A-minor', 'E-minor', 'D-minor']) {
      const ranked = rankKeys(scaleWeights(K(id)), 4);
      const ids = ranked.map((r) => keyId(r.key));
      expect(ids, id).toContain(id);
    }
  });

  it('identifies the key from a played progression', () => {
    const best = rankKeys(progressionWeights(['I', 'V', 'vi', 'IV'], K('C-major')), 1)[0];
    expect(keyId(best!.key)).toBe('C-major');
  });

  it('follows a progression into a different key', () => {
    const best = rankKeys(progressionWeights(['I', 'IV', 'V', 'I'], K('Eb-major')), 1)[0];
    expect(keyId(best!.key)).toBe('Eb-major');
  });

  it('prefers the simpler signature between enharmonic equivalents', () => {
    // D♭ major and C♯ major contain identical pitch classes and must score the
    // same; the tie-break should land on the five-flat spelling, not seven sharps.
    const best = rankKeys(scaleWeights(K('Db-major')), 1)[0];
    expect(keyId(best!.key)).toBe('Db-major');
  });

  it('needs chord roots to resolve a bare ii-V-I, not just sounding time', () => {
    const key = K('C-major');
    // Pitch-class duration alone is a weak signal here: Dm-G7-C spends as long
    // on D, F and G as on C, and profile correlation ranks G major on top.
    const flat = progressionWeights(['ii', 'V7', 'I'], key);
    expect(keyId(rankKeys(flat, 1)[0]!.key)).not.toBe('C-major');

    // Adding the roots — the harmonic information duration discards — fixes it.
    const withRoots = [...flat];
    for (const [pc, w] of [[2, 0.6], [7, 0.6], [0, 1.2]] as const) {
      withRoots[pc] = (withRoots[pc] ?? 0) + w;
    }
    expect(keyId(rankKeys(withRoots, 1)[0]!.key)).toBe('C-major');
  });

  it('reports no key when there is no evidence', () => {
    expect(rankKeys(new Array(12).fill(0))).toHaveLength(0);
    expect(inferKey(new Array(12).fill(0))).toBeNull();
  });

  it('refuses to commit on genuinely ambiguous input', () => {
    // A fully chromatic histogram fits every key equally badly.
    expect(inferKey(new Array(12).fill(1))).toBeNull();
  });

  it('is more confident about a full scale than about a two-note fragment', () => {
    // Margin alone would get this backwards: a sparse input has a *large*
    // margin precisely because few keys fit it.
    const full = rankKeys(scaleWeights(K('C-major')), 1)[0]!;
    const sparse = new Array<number>(12).fill(0);
    sparse[0] = 1;
    sparse[7] = 1;
    const thin = rankKeys(sparse, 1)[0]!;
    expect(full.confidence).toBeGreaterThan(thin.confidence);
  });

  it('ranks the true key above its relative when the third is emphasised', () => {
    const w = progressionWeights(['I', 'IV', 'V', 'I'], K('C-major'));
    const ranked = rankKeys(w, 4).map((r) => keyId(r.key));
    expect(ranked.indexOf('C-major')).toBeLessThan(
      ranked.indexOf('A-minor') === -1 ? 99 : ranked.indexOf('A-minor'),
    );
  });
});

describe('decaying histogram', () => {
  it('weights a chord root on top of its sounding time', () => {
    const h = new PitchClassHistogram(12, 0);
    h.add(60, 0.5, 0);
    h.addChordRoot(60, 1, 0);
    expect(h.snapshot(0)[0]).toBeCloseTo(1.5, 5);
  });

  it('accumulates sounding time per pitch class', () => {
    const h = new PitchClassHistogram(12, 0);
    h.add(60, 1, 0); // C
    h.add(64, 1, 0); // E
    const snap = h.snapshot(0);
    expect(snap[0]).toBeCloseTo(1, 5);
    expect(snap[4]).toBeCloseTo(1, 5);
    expect(snap[1]).toBe(0);
  });

  it('folds octaves onto one pitch class', () => {
    const h = new PitchClassHistogram(12, 0);
    h.add(60, 1, 0);
    h.add(72, 1, 0);
    expect(h.snapshot(0)[0]).toBeCloseTo(2, 5);
  });

  it('halves a weight after one half-life', () => {
    const h = new PitchClassHistogram(10, 0);
    h.add(60, 1, 0);
    expect(h.snapshot(10)[0]).toBeCloseTo(0.5, 3);
    expect(h.snapshot(20)[0]).toBeCloseTo(0.25, 3);
  });

  it('lets a modulation take over rather than averaging the whole session', () => {
    const h = new PitchClassHistogram(4, 0);
    // Establish C major, then play E flat major material much later.
    for (const n of keyScale(K('C-major'))) h.add(toMidi(n), 2, 0);
    const early = rankKeys(h.snapshot(0), 1)[0]!;
    expect(keyId(early.key)).toBe('C-major');

    for (const n of keyScale(K('Eb-major'))) h.add(toMidi(n), 2, 40);
    const late = rankKeys(h.snapshot(40), 1)[0]!;
    expect(keyId(late.key)).toBe('Eb-major');
  });

  it('resets to empty', () => {
    const h = new PitchClassHistogram(12, 0);
    h.add(60, 5, 0);
    h.reset(0);
    expect(h.total).toBe(0);
  });
});

describe('chord detection feeds the analyzer', () => {
  it('names what is played, including inversions', () => {
    const c = parseChordSymbol('C/E');
    expect(c).not.toBeNull();
    expect(chordVoicing(c!)[0]! % 12).toBe(4); // E in the bass
  });
});
