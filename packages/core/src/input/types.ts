/**
 * The note-input contract.
 *
 * This is the seam that makes the unverified Web MIDI situation survivable.
 * Every drill consumes this interface and nothing else, so the on-screen
 * keyboard, a real MIDI keyboard, a microphone, and a LAN bridge from the
 * desktop app are all interchangeable — and if Fire OS turns out not to expose
 * Web MIDI, no game-mode code changes at all.
 *
 * Types live in core (they are DOM-free); implementations live in the client,
 * because each one wraps a browser or platform API.
 */

import type { MidiNote } from '../theory/pitch';

export type NoteSourceKind = 'onscreen' | 'midi' | 'mic' | 'bridge';

export interface NoteEvent {
  readonly type: 'note-on' | 'note-off';
  readonly midi: MidiNote;
  /**
   * 0-1. The on-screen keyboard has no real velocity and reports a nominal
   * value; anything reading velocity for a *metric* must check `hasVelocity`
   * on the source, because scoring dynamics against a touchscreen would be
   * measuring nothing.
   */
  readonly velocity: number;
  /**
   * Milliseconds on the `performance.now()` clock.
   *
   * Web MIDI stamps events on this clock while audio is scheduled on
   * `AudioContext.currentTime`; they have different origins and they drift, so
   * anything comparing a played note to a scheduled beat must convert rather
   * than assume.
   */
  readonly time: number;
  readonly sourceId: string;
  readonly channel?: number;
  /**
   * Which hand struck, when the source can attribute it.
   *
   * Absent for every ordinary source, and deliberately so: a pitch alone does
   * not say which hand played it, and guessing from a middle-C threshold would
   * corrupt every per-hand metric the moment the hands crossed. It is set only
   * where something actually knows — a drill that constructed a register gap
   * and checked it, or a microphone listening to one band.
   */
  readonly hand?: 'left' | 'right';
  /**
   * False when the source detected that a note happened but not which one.
   *
   * Band-split onset detection over a microphone can hear *that* a hand
   * struck without recovering the pitch, which is enough to grade timing and
   * nothing else. Marking it keeps a band hit from being mistaken for a
   * recognised note.
   */
  readonly pitchKnown?: boolean;
}

/** Continuous controllers worth capturing. Pedal is the one that matters. */
export interface ControlEvent {
  readonly type: 'control';
  /** 64 is the sustain pedal. */
  readonly controller: number;
  /** 0-1. */
  readonly value: number;
  readonly time: number;
  readonly sourceId: string;
}

export type InputEvent = NoteEvent | ControlEvent;

export interface NoteSource {
  readonly id: string;
  readonly kind: NoteSourceKind;
  readonly label: string;
  /** False when the source reports a nominal velocity rather than a measured one. */
  readonly hasVelocity: boolean;
  readonly connected: boolean;

  start(): Promise<void>;
  stop(): void;
  subscribe(listener: (event: InputEvent) => void): () => void;
}

/**
 * Measured input timing offset for a device.
 *
 * Grading against a click without this is silently wrong: the player plays in
 * time with the click they *hear*, which is already late by the audio output
 * latency, so every onset lands late by that amount.
 */
export interface DeviceProfile {
  readonly id: string;
  readonly label: string;
  readonly kind: NoteSourceKind;
  /** Milliseconds to subtract from measured onsets. */
  readonly offsetMs: number;
  /** Spread of the calibration samples; large means the measurement is unreliable. */
  readonly jitterMs: number;
  readonly calibratedAt: string;
  readonly sampleCount: number;
}

export function isNoteEvent(e: InputEvent): e is NoteEvent {
  return e.type === 'note-on' || e.type === 'note-off';
}

export const SUSTAIN_PEDAL_CC = 64;
