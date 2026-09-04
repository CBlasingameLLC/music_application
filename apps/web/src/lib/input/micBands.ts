'use client';

/**
 * Hearing two hands through a microphone.
 *
 * The wireless fallback. Bluetooth MIDI is the primary path and needs no code
 * — Android exposes a paired BLE-MIDI device through the same API Web MIDI
 * already reads — but if Fire OS does not expose it, this is what is left: the
 * tablet on the music stand listening to the piano.
 *
 * `MicPitchSource` cannot do this job. It uses the McLeod Pitch Method, which
 * is monophonic: given two notes at once it returns one estimate, frequently
 * neither of them. That is what the method is, not a threshold to tune. So it
 * stays as it is, for single-line ear training, and two-handed listening works
 * a different way.
 *
 * What the Independence Lab needs is not which notes were played but **when
 * each hand struck**, which is a far easier question than transcription. The
 * spectrum is split at the exercise's own register boundary — a number the
 * generator guarantees and checks — and each half is watched for an attack.
 *
 * Events therefore carry `hand` and `pitchKnown: false`. The pitch is genuinely
 * unknown, and saying so is what stops a band hit being mistaken for a
 * recognised note downstream.
 *
 * **Unverified against a real piano.** The thresholds in `BandOnsetPicker`
 * behave correctly on synthesized envelopes, including the harmonic bleed a
 * bass note pushes into the upper band, but no part of this has met a real
 * instrument in a real room. Expect to calibrate.
 */

import {
  BandOnsetPicker, midiToFrequency,
  type InputEvent, type MidiNote, type NoteSource, type NoteSourceKind,
} from '@etude/core';

/** Ignore everything below this: room rumble, handling noise, HVAC. */
const MIN_HZ = 70;
/** And above this: nothing on a piano fundamentally lives up here. */
const MAX_HZ = 5000;
/** How long a band hit is reported as sounding. Onsets are what matter. */
const NOMINAL_DURATION_MS = 180;

export class MicBandSource implements NoteSource {
  readonly id = 'mic-bands';
  readonly kind: NoteSourceKind = 'mic';
  readonly label = 'Microphone (two hands)';
  /** A microphone hears loudness, but not how hard a key was struck. */
  readonly hasVelocity = false;

  connected = false;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private running = false;

  private readonly listeners = new Set<(event: InputEvent) => void>();
  private readonly picker: BandOnsetPicker;
  private readonly splitPoint: MidiNote;

  constructor(splitPoint: MidiNote = 60) {
    this.splitPoint = splitPoint;
    this.picker = new BandOnsetPicker();
  }

  subscribe(listener: (event: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All three would fight the detector: gain control flattens exactly
        // the attacks it looks for, and noise suppression is tuned for speech
        // and treats a piano as something to remove.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const context = new AudioContext();
    // Under an autoplay policy resume() can hang without ever rejecting, so it
    // is raced rather than awaited — the same trap the diagnostics page hit.
    await Promise.race([
      context.resume(),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);

    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(this.stream).connect(analyser);

    this.context = context;
    this.analyser = analyser;
    this.picker.reset();
    this.running = true;
    this.connected = true;

    this.listen();
  }

  private listen(): void {
    const analyser = this.analyser;
    const context = this.context;
    if (!analyser || !context) return;

    const bins = new Float32Array(analyser.frequencyBinCount);
    const hzPerBin = context.sampleRate / analyser.fftSize;
    const boundaryHz = midiToFrequency(this.splitPoint);

    const lowFrom = Math.max(1, Math.floor(MIN_HZ / hzPerBin));
    const lowTo = Math.floor(boundaryHz / hzPerBin);
    const highTo = Math.min(bins.length - 1, Math.floor(MAX_HZ / hzPerBin));

    const tick = () => {
      if (!this.running) return;
      analyser.getFloatFrequencyData(bins);

      // Sum linear magnitudes, not decibels. Flux is a difference, and a
      // difference of logarithms measures ratio rather than attack — a quiet
      // note would look exactly as sudden as a loud one.
      let low = 0;
      let high = 0;
      for (let i = lowFrom; i <= lowTo; i++) low += 10 ** ((bins[i] ?? -140) / 20);
      for (let i = lowTo + 1; i <= highTo; i++) high += 10 ** ((bins[i] ?? -140) / 20);

      const now = performance.now();
      for (const onset of this.picker.push(low, high, now)) {
        this.emit(onset.hand, onset.timeMs);
      }

      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private emit(hand: 'left' | 'right', timeMs: number): void {
    // A representative pitch for the band, never a claim about what was
    // played: `pitchKnown` is false and anything reading the note number for
    // correctness has to honour that.
    const midi = (hand === 'left' ? this.splitPoint - 1 : this.splitPoint) as MidiNote;

    const on: InputEvent = {
      type: 'note-on', midi, velocity: 0.7, time: timeMs,
      sourceId: this.id, hand, pitchKnown: false,
    };
    for (const listener of this.listeners) listener(on);

    // A microphone hears attacks far better than releases, so the note-off is
    // nominal. Articulation cannot be graded this way, and the Lab says so
    // rather than deriving a number from a duration that means nothing.
    setTimeout(() => {
      const off: InputEvent = {
        type: 'note-off', midi, velocity: 0, time: performance.now(),
        sourceId: this.id, hand, pitchKnown: false,
      };
      for (const listener of this.listeners) listener(off);
    }, NOMINAL_DURATION_MS);
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}
