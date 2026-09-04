'use client';

/**
 * Microphone pitch input.
 *
 * Monophonic only, and deliberately so. This exists to let you *sing* an answer
 * in ear training — humming an interval back is a far better test of hearing it
 * than picking from four buttons — and for single-line acoustic input. It is
 * not a transcription engine and does not pretend to be.
 *
 * Uses pitchy (McLeod Pitch Method, MIT, ~33 KB). The alternatives are all
 * GPL/AGPL and stale, which for a project that might ship publicly is not a
 * close call.
 */

import { PitchDetector } from 'pitchy';
import type { InputEvent, NoteSource } from '@etude/core';

const FFT_SIZE = 2048;
/** Below this clarity the detector is guessing; silence is not a pitch. */
const CLARITY_THRESHOLD = 0.9;
/** Sung range, roughly C2-C6. Anything outside is noise or a harmonic error. */
const MIN_HZ = 65;
const MAX_HZ = 1100;
/** A pitch must hold this long before it counts as a note, to reject slides. */
const STABLE_MS = 90;

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export class MicPitchSource implements NoteSource {
  readonly id = 'mic';
  readonly kind = 'mic' as const;
  readonly label = 'Microphone';
  /** Loudness is not velocity; reporting it as such would corrupt dynamics metrics. */
  readonly hasVelocity = false;

  private listeners = new Set<(event: InputEvent) => void>();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;

  private currentNote: number | null = null;
  private candidate: { midi: number; since: number } | null = null;

  get connected(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot access a microphone.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Every one of these would fight a pitch detector.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const Ctor = window.AudioContext;
    this.ctx = new Ctor();
    const sourceNode = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    sourceNode.connect(analyser);

    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(detector.inputLength);
    const sampleRate = this.ctx.sampleRate;
    this.running = true;

    const tick = (): void => {
      if (!this.running) return;
      analyser.getFloatTimeDomainData(buffer);
      const [hz, clarity] = detector.findPitch(buffer, sampleRate);
      this.consider(hz, clarity, performance.now());
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private consider(hz: number, clarity: number, now: number): void {
    const valid = clarity >= CLARITY_THRESHOLD && hz >= MIN_HZ && hz <= MAX_HZ;

    if (!valid) {
      this.candidate = null;
      this.releaseCurrent(now);
      return;
    }

    const midi = Math.round(frequencyToMidi(hz));
    if (midi === this.currentNote) return;

    // Require the pitch to settle before committing, so a slide between notes
    // does not fire every semitone it passes through.
    if (!this.candidate || this.candidate.midi !== midi) {
      this.candidate = { midi, since: now };
      return;
    }
    if (now - this.candidate.since < STABLE_MS) return;

    this.releaseCurrent(now);
    this.currentNote = midi;
    this.emit({
      type: 'note-on', midi, velocity: 0.7, time: now, sourceId: this.id,
    });
  }

  private releaseCurrent(now: number): void {
    if (this.currentNote === null) return;
    this.emit({
      type: 'note-off', midi: this.currentNote, velocity: 0, time: now, sourceId: this.id,
    });
    this.currentNote = null;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.releaseCurrent(performance.now());
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  subscribe(listener: (event: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: InputEvent): void {
    for (const l of this.listeners) l(event);
  }
}
