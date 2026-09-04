/**
 * Audio.
 *
 * The digital piano makes its own sound, so this engine never has to voice the
 * notes you play — which removes the entire Android output-latency problem from
 * the critical path. It only produces ear-training playback and the click.
 *
 * Two things here are deliberate:
 *
 *  1. The metronome is scheduled with a lookahead against `AudioContext`'s own
 *     clock, not with `setInterval`. Timer callbacks on a 3 GB Android tablet
 *     under render load drift audibly within seconds; the audio clock does not.
 *
 *  2. The timbre is synthesised additively rather than sampled. A multi-megabyte
 *     sample library would be the single heaviest asset in the app and would
 *     stall first-load on the tablet, for a tone difference that does not affect
 *     interval or chord recognition.
 */

const MASTER_GAIN = 0.22;

/** Harmonic weights giving a soft electric-piano tone with no samples. */
const PARTIALS: ReadonlyArray<{ ratio: number; gain: number }> = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.36 },
  { ratio: 3, gain: 0.14 },
  { ratio: 4, gain: 0.08 },
  { ratio: 6, gain: 0.03 },
];

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Metronome scheduler state. */
  private clickTimer: number | null = null;
  private nextClickTime = 0;
  private clickBeat = 0;
  private bpm = 72;
  private beatsPerBar = 4;
  private onBeat: ((beat: number, time: number) => void) | null = null;

  /** How far ahead to schedule, and how often to top up. */
  private static readonly LOOKAHEAD_S = 0.12;
  private static readonly TICK_MS = 25;

  /**
   * Create or resume the context.
   *
   * Must be called from a user gesture: mobile browsers start every context
   * suspended, and a drill that plays nothing on first tap reads as broken.
   */
  async resume(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio is unavailable in this browser.');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * Round-trip output latency, needed to keep timing metrics honest.
   *
   * The player hears the click late by exactly this much and plays in time with
   * what they hear, so grading against the click without subtracting it puts a
   * constant bias into every timing number.
   */
  get outputLatencyMs(): number {
    if (!this.ctx) return 0;
    const base = this.ctx.baseLatency ?? 0;
    const output = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return (base + output) * 1000;
  }

  /**
   * Map the audio clock onto `performance.now()`.
   *
   * Web MIDI timestamps live on the performance clock while audio scheduling
   * lives on the context clock. They have different origins and they drift, so
   * anything comparing a played note against a scheduled beat has to go through
   * this. Getting it wrong biases every metric silently.
   */
  audioTimeToPerformanceTime(audioTime: number): number {
    if (!this.ctx) return performance.now();
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (audioTime - ts.contextTime) * 1000;
    }
    return performance.now() + (audioTime - this.ctx.currentTime) * 1000;
  }

  /** Sound one note. `when` is on the audio clock; 0 means "now". */
  note(midi: number, durationS = 0.9, when = 0, velocity = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const start = when > 0 ? when : ctx.currentTime + 0.01;
    const freq = midiToFrequency(midi);

    const voice = ctx.createGain();
    voice.connect(master);

    // Percussive envelope: fast attack, exponential decay, short release.
    const peak = 0.9 * velocity;
    voice.gain.setValueAtTime(0.0001, start);
    voice.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    voice.gain.exponentialRampToValueAtTime(peak * 0.28, start + 0.18);
    voice.gain.exponentialRampToValueAtTime(0.0001, start + durationS);

    for (const partial of PARTIALS) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * partial.ratio;
      // Upper partials decay faster, as they do on a real string.
      gain.gain.value = partial.gain / (1 + partial.ratio * 0.25);
      osc.connect(gain);
      gain.connect(voice);
      osc.start(start);
      osc.stop(start + durationS + 0.05);
    }
  }

  /** Sound several notes together. */
  chord(midis: readonly number[], durationS = 1.4, when = 0): void {
    for (const m of midis) this.note(m, durationS, when, 0.85);
  }

  /** Play a sequence of chords with a fixed gap. Returns total duration in ms. */
  sequence(
    groups: ReadonlyArray<readonly number[]>,
    noteDurationS = 0.75,
    gapS = 0.62,
  ): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const start = ctx.currentTime + 0.06;
    groups.forEach((group, i) => {
      this.chord(group, noteDurationS, start + i * gapS);
    });
    return (groups.length * gapS + noteDurationS) * 1000;
  }

  /** A short click. Downbeats are pitched higher so the bar is audible. */
  click(when: number, accented: boolean): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accented ? 1600 : 1050;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accented ? 0.5 : 0.3, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  /**
   * Start the metronome.
   *
   * `onBeat` fires with the *audio-clock* time of each beat so callers can
   * convert it for timing comparisons rather than guessing from wall time.
   */
  startMetronome(
    bpm: number,
    beatsPerBar = 4,
    onBeat?: (beat: number, audioTime: number) => void,
  ): void {
    if (!this.ctx) return;
    this.stopMetronome();

    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this.onBeat = onBeat ?? null;
    this.clickBeat = 0;
    this.nextClickTime = this.ctx.currentTime + 0.15;

    const tick = (): void => {
      const ctx = this.ctx;
      if (!ctx) return;
      const secondsPerBeat = 60 / this.bpm;

      // Schedule everything falling inside the lookahead window. The window is
      // what absorbs timer jitter — the notes themselves are already placed on
      // the audio clock and will not move.
      while (this.nextClickTime < ctx.currentTime + Engine.LOOKAHEAD_S) {
        const accented = this.clickBeat % this.beatsPerBar === 0;
        this.click(this.nextClickTime, accented);
        this.onBeat?.(this.clickBeat, this.nextClickTime);
        this.clickBeat += 1;
        this.nextClickTime += secondsPerBeat;
      }
    };

    tick();
    this.clickTimer = window.setInterval(tick, Engine.TICK_MS);
  }

  stopMetronome(): void {
    if (this.clickTimer !== null) {
      window.clearInterval(this.clickTimer);
      this.clickTimer = null;
    }
    this.onBeat = null;
  }

  get metronomeRunning(): boolean {
    return this.clickTimer !== null;
  }
}

export const audio = new Engine();

/** Establish a key in the listener's ear before asking a question about it. */
export function playCadence(chordVoicings: ReadonlyArray<readonly number[]>): number {
  return audio.sequence(chordVoicings, 0.7, 0.58);
}
