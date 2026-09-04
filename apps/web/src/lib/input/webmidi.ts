'use client';

/**
 * Web MIDI input.
 *
 * The whole reason the rest of the app talks to `NoteSource` rather than to
 * this file directly: on the target device (Fire HD 10 / Silk) it is genuinely
 * unknown whether Web MIDI is exposed at all. Chromium implements it over
 * `android.media.midi`, gated behind a feature flag Amazon does not document.
 * If this turns out to be unavailable, a different implementation of the same
 * interface takes its place and no drill changes.
 */

import type { InputEvent, NoteSource } from '@etude/core';
import { SUSTAIN_PEDAL_CC } from '@etude/core';

export interface MidiPortInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: string;
}

export type MidiAvailability =
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'timeout'; readonly reason: string }
  | { readonly status: 'ok'; readonly ports: MidiPortInfo[] };

/** Reject rather than hang: a pending permission prompt never settles. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

let cachedAccess: MIDIAccess | null = null;

export async function requestMidiAccess(timeoutMs = 6000): Promise<MIDIAccess> {
  if (cachedAccess) return cachedAccess;
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
    throw new Error('Web MIDI is not available in this browser.');
  }
  // Since Chrome 124 every MIDI request prompts, not just sysex, and the prompt
  // can sit unanswered forever. Never await it bare.
  cachedAccess = await withTimeout(
    navigator.requestMIDIAccess({ sysex: false }),
    timeoutMs,
    'MIDI permission was not answered.',
  );
  return cachedAccess;
}

export async function listMidiInputs(): Promise<MidiAvailability> {
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
    return {
      status: 'unsupported',
      reason:
        'This browser does not expose the Web MIDI API. On a Fire tablet, try sideloading Chrome, or use the desktop bridge.',
    };
  }
  try {
    const access = await requestMidiAccess();
    const ports = [...access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? 'Unnamed device',
      manufacturer: i.manufacturer ?? '',
      state: i.state,
    }));
    return { status: 'ok', ports };
  } catch (err) {
    const message = (err as Error).message;
    return message.includes('not answered')
      ? { status: 'timeout', reason: message }
      : { status: 'denied', reason: message };
  }
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;

export class WebMidiSource implements NoteSource {
  readonly kind = 'midi' as const;
  /** A real keyboard reports genuine velocity, so dynamics are measurable. */
  readonly hasVelocity = true;

  private listeners = new Set<(event: InputEvent) => void>();
  private attached: MIDIInput[] = [];
  private running = false;

  constructor(
    readonly id: string,
    readonly label: string,
    /** Null listens to every input, which is the sane default for one keyboard. */
    private readonly portId: string | null = null,
  ) {}

  get connected(): boolean {
    return this.running && this.attached.some((i) => i.state === 'connected');
  }

  async start(): Promise<void> {
    const access = await requestMidiAccess();
    const inputs = [...access.inputs.values()].filter(
      (i) => this.portId === null || i.id === this.portId,
    );
    if (inputs.length === 0) {
      throw new Error('No MIDI input matched. Is the keyboard connected and powered on?');
    }

    for (const input of inputs) {
      input.onmidimessage = (e) => this.handle(e);
      this.attached.push(input);
    }
    this.running = true;

    // A device unplugged mid-session should stop silently rather than throw.
    access.onstatechange = () => {
      this.attached = this.attached.filter((i) => i.state === 'connected');
    };
  }

  stop(): void {
    for (const input of this.attached) input.onmidimessage = null;
    this.attached = [];
    this.running = false;
  }

  subscribe(listener: (event: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: InputEvent): void {
    for (const l of this.listeners) l(event);
  }

  private handle(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;

    const status = data[0] ?? 0;
    const a = data[1] ?? 0;
    const b = data[2] ?? 0;
    const command = status & 0xf0;
    const channel = status & 0x0f;

    // `timeStamp` is a DOMHighResTimeStamp on the same clock as
    // performance.now(), which is what every timing metric is measured against.
    const time = e.timeStamp;

    if (command === NOTE_ON && b > 0) {
      this.emit({
        type: 'note-on', midi: a, velocity: b / 127, time, sourceId: this.id, channel,
      });
      return;
    }
    // A note-on with zero velocity is a note-off; plenty of keyboards send it
    // that way, and treating it as an onset would double every note.
    if (command === NOTE_OFF || (command === NOTE_ON && b === 0)) {
      this.emit({
        type: 'note-off', midi: a, velocity: 0, time, sourceId: this.id, channel,
      });
      return;
    }
    if (command === CONTROL_CHANGE) {
      this.emit({
        type: 'control', controller: a, value: b / 127, time, sourceId: this.id,
      });
    }
  }
}

export { SUSTAIN_PEDAL_CC };
