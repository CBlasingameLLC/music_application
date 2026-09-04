import { describe, expect, it } from 'vitest';
import { BandOnsetPicker, midiToFrequency, type DetectedOnset } from './onsetPicker';

const FRAME_MS = 1000 / 43; // Roughly what a 1024-sample FFT gives at 44.1 kHz.

interface Strike {
  readonly atMs: number;
  readonly hand: 'left' | 'right';
  readonly level?: number;
  /** How much of this note's energy leaks into the *other* band. */
  readonly bleed?: number;
}

/**
 * A plausible energy envelope for a struck piano note: near-instant attack,
 * exponential decay. What the detector has to find is the attack edge.
 */
function envelopeAt(strike: Strike, timeMs: number): number {
  const since = timeMs - strike.atMs;
  if (since < 0) return 0;
  const level = strike.level ?? 1;
  return level * Math.exp(-since / 260);
}

/** Render a series of strikes into per-band energy frames. */
function render(strikes: readonly Strike[], durationMs: number, noise = 0.002) {
  const frames: { left: number; right: number; timeMs: number }[] = [];
  // Deterministic pseudo-noise: a fixed seed keeps a threshold test meaningful.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let timeMs = 0; timeMs < durationMs; timeMs += FRAME_MS) {
    let left = noise * rand();
    let right = noise * rand();
    for (const strike of strikes) {
      const energy = envelopeAt(strike, timeMs);
      const leak = energy * (strike.bleed ?? 0);
      if (strike.hand === 'left') { left += energy; right += leak; }
      else { right += energy; left += leak; }
    }
    frames.push({ left, right, timeMs });
  }
  return frames;
}

function run(
  strikes: readonly Strike[],
  durationMs: number,
  options = {},
  noise = 0.002,
): DetectedOnset[] {
  const picker = new BandOnsetPicker(options);
  const found: DetectedOnset[] = [];
  for (const frame of render(strikes, durationMs, noise)) {
    found.push(...picker.push(frame.left, frame.right, frame.timeMs));
  }
  return found;
}

/** Did an onset land near this time, in this hand? */
function near(
  onsets: readonly DetectedOnset[],
  atMs: number,
  hand: 'left' | 'right',
  toleranceMs = 60,
): boolean {
  return onsets.some((o) => o.hand === hand && Math.abs(o.timeMs - atMs) <= toleranceMs);
}

describe('picking onsets out of band energy', () => {
  it('finds a strike in each hand', () => {
    // The detector needs a little history before it knows what is normal, so
    // the run starts with a settling period rather than a note at zero.
    const onsets = run(
      [
        { atMs: 600, hand: 'left' },
        { atMs: 1000, hand: 'right' },
        { atMs: 1400, hand: 'left' },
        { atMs: 1800, hand: 'right' },
      ],
      2400,
    );

    expect(near(onsets, 600, 'left')).toBe(true);
    expect(near(onsets, 1000, 'right')).toBe(true);
    expect(near(onsets, 1400, 'left')).toBe(true);
    expect(near(onsets, 1800, 'right')).toBe(true);
  });

  it('attributes each strike to the band it happened in', () => {
    const onsets = run([{ atMs: 600, hand: 'left' }, { atMs: 1200, hand: 'right' }], 1800);
    const left = onsets.filter((o) => o.hand === 'left');
    const right = onsets.filter((o) => o.hand === 'right');

    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.every((o) => o.timeMs < 900)).toBe(true);
    expect(right.every((o) => o.timeMs > 900)).toBe(true);
  });

  it('does not fire on a decaying note', () => {
    // A single strike, then nothing but its own decay for a second and a half.
    // Flux is rectified precisely so the fall does not read as a new attack.
    const onsets = run([{ atMs: 600, hand: 'left' }], 2200);
    expect(onsets.filter((o) => o.hand === 'left').length).toBe(1);
  });

  it('does not fire on room noise alone', () => {
    expect(run([], 2000).length).toBe(0);
  });

  it('treats one strike as one onset, however fast the frames arrive', () => {
    const onsets = run([{ atMs: 700, hand: 'right' }], 1600);
    expect(onsets.length).toBe(1);
  });

  it('separates strikes that are close but genuinely distinct', () => {
    // 150 ms apart is a pair of quick notes, not one attack — the refractory
    // period has to be short enough to keep them apart.
    const onsets = run(
      [{ atMs: 800, hand: 'right' }, { atMs: 950, hand: 'right' }],
      1800,
    );
    expect(onsets.filter((o) => o.hand === 'right').length).toBe(2);
  });
});

describe('harmonic bleed, the reason this is hard', () => {
  const strikes: Strike[] = [
    // A low note whose harmonics reach well into the right hand's band. This
    // is not an edge case: it is what every bass note does.
    { atMs: 600, hand: 'left', bleed: 0.7 },
    { atMs: 1200, hand: 'left', bleed: 0.7 },
  ];

  it('would otherwise hear a phantom right-hand note under every bass note', () => {
    // Without suppression the leak is a genuine energy jump in the high band,
    // and nothing about the signal marks it as someone else's harmonics.
    const naive = run(strikes, 1800, { harmonicSuppressionMs: 0 });
    expect(naive.some((o) => o.hand === 'right')).toBe(true);
  });

  it('suppresses a high-band jump that arrives with a low-band strike', () => {
    const onsets = run(strikes, 1800);
    expect(onsets.filter((o) => o.hand === 'left').length).toBe(2);
    expect(onsets.filter((o) => o.hand === 'right').length).toBe(0);
  });

  it('still hears a right hand that plays between the bass notes', () => {
    // The suppression must not cost the notes the Lab actually measures: at
    // 2:1 and 3:1 it is exactly the offbeat right-hand notes that matter.
    const onsets = run(
      [...strikes, { atMs: 900, hand: 'right' }, { atMs: 1500, hand: 'right' }],
      2100,
    );
    expect(near(onsets, 900, 'right')).toBe(true);
    expect(near(onsets, 1500, 'right')).toBe(true);
  });
});

describe('band boundaries', () => {
  it('puts middle C where a piano does', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
    expect(midiToFrequency(48)).toBeCloseTo(130.81, 1);
  });
});
