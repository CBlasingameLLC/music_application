/**
 * Deciding that a note just started, from a stream of energy readings.
 *
 * This is the wireless path. Bluetooth MIDI is the primary one and needs
 * nothing new — Android exposes a paired BLE-MIDI device through the same API
 * Web MIDI already reads. But if Fire OS turns out not to expose it, the
 * fallback is a microphone listening to the piano across the room, and that
 * runs into a hard limit: `MicPitchSource` uses the McLeod Pitch Method, which
 * is **monophonic**. On two notes at once it returns one estimate, often
 * neither. It cannot separate two hands, and no threshold fixes that — it is
 * what the method is.
 *
 * What the Independence Lab actually needs from the microphone is not pitch
 * but *when each hand struck*, and that is a far easier question. Split the
 * spectrum at the exercise's own register boundary, watch the energy in each
 * half, and call an onset when it jumps. No transcription required.
 *
 * The energy-to-onset decision is the part with all the tuning risk, so it
 * lives here — pure, DOM-free, and testable against synthesized envelopes
 * rather than requiring a piano.
 *
 * ## What this cannot do
 *
 * A low C's harmonics reach well into the right hand's band, so a left-hand
 * strike raises energy in both. `harmonicSuppressionMs` exists for that: a
 * high-band onset arriving immediately after a low-band one is treated as
 * bleed rather than a note. That is the right call for an exercise where the
 * hands are notated apart — which is every exercise this serves — and the
 * wrong one where they genuinely strike together, so the flag is explicit
 * rather than always on.
 *
 * None of this has been tried against a real piano in a real room. The
 * thresholds below are starting points chosen to behave correctly on
 * synthesized input, not measurements.
 */

/** A detected attack. */
export interface DetectedOnset {
  readonly timeMs: number;
  readonly hand: 'left' | 'right';
  /** How far above the running threshold it was. Not a velocity. */
  readonly strength: number;
}

export interface OnsetPickerOptions {
  /**
   * How many recent frames the running statistics cover.
   *
   * Long enough to average over a note's decay, short enough to follow someone
   * getting louder. About a second at typical frame rates.
   */
  readonly windowFrames?: number;
  /** Standard deviations above the running mean that count as an attack. */
  readonly sensitivity?: number;
  /** Minimum gap between onsets in one band. Below this it is one attack. */
  readonly refractoryMs?: number;
  /**
   * A high-band onset within this long after a low-band one is harmonic bleed
   * from the low note, not a right-hand attack. Zero disables the suppression.
   */
  readonly harmonicSuppressionMs?: number;
  /** Absolute floor, so room noise in silence cannot trip a detection. */
  readonly floor?: number;
}

const DEFAULTS = {
  windowFrames: 43,
  sensitivity: 2.5,
  refractoryMs: 70,
  harmonicSuppressionMs: 25,
  floor: 0.004,
} as const;

/**
 * Picks onsets from two band-energy streams.
 *
 * Fed one pair of readings per audio frame; returns whatever it decided in
 * that frame. Stateful by nature — an attack is defined relative to what came
 * before it, so there is nothing to compute from a single reading.
 */
export class BandOnsetPicker {
  private readonly options: Required<OnsetPickerOptions>;
  private readonly history = { left: [] as number[], right: [] as number[] };
  private readonly previous = { left: 0, right: 0 };
  private readonly lastOnsetMs = { left: -Infinity, right: -Infinity };

  constructor(options: OnsetPickerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset(): void {
    this.history.left.length = 0;
    this.history.right.length = 0;
    this.previous.left = 0;
    this.previous.right = 0;
    this.lastOnsetMs.left = -Infinity;
    this.lastOnsetMs.right = -Infinity;
  }

  /**
   * Feed one frame. Energies are linear magnitudes, not decibels: flux is a
   * difference, and a difference of logarithms would measure ratio rather than
   * attack, so a quiet note would look like a loud one.
   */
  push(leftEnergy: number, rightEnergy: number, timeMs: number): DetectedOnset[] {
    const found: DetectedOnset[] = [];

    // Left first, so a low strike is already on the record when the right band
    // is examined and the harmonic-bleed check has something to compare to.
    const left = this.consider('left', leftEnergy, timeMs);
    if (left) found.push(left);

    const right = this.consider('right', rightEnergy, timeMs);
    if (right) {
      const gap = timeMs - this.lastOnsetMs.left;
      const bleed =
        this.options.harmonicSuppressionMs > 0 &&
        gap >= 0 &&
        gap < this.options.harmonicSuppressionMs;
      if (bleed) {
        // Roll back: it was the low note's harmonics, so it is not an onset
        // and must not start a refractory period of its own either.
        this.lastOnsetMs.right = right.timeMs - this.options.refractoryMs;
      } else {
        found.push(right);
      }
    }

    return found;
  }

  private consider(
    hand: 'left' | 'right',
    energy: number,
    timeMs: number,
  ): DetectedOnset | null {
    const history = this.history[hand];
    // Rectified flux: only a *rise* is an attack. A note decaying is a fall,
    // and counting it would fire an onset at the end of every note.
    const flux = Math.max(0, energy - this.previous[hand]);
    this.previous[hand] = energy;

    history.push(flux);
    if (history.length > this.options.windowFrames) history.shift();

    // Not enough history to know what is normal yet.
    if (history.length < 8) return null;

    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance =
      history.reduce((acc, v) => acc + (v - mean) ** 2, 0) / history.length;
    const threshold = Math.max(
      this.options.floor,
      mean + this.options.sensitivity * Math.sqrt(variance),
    );

    if (flux <= threshold) return null;
    if (timeMs - this.lastOnsetMs[hand] < this.options.refractoryMs) return null;

    this.lastOnsetMs[hand] = timeMs;
    return { timeMs, hand, strength: flux - threshold };
  }
}

/** Frequency of a MIDI note, for turning a split point into a band boundary. */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
