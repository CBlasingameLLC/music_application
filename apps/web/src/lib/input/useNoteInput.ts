'use client';

/**
 * React bindings for note input.
 *
 * Components subscribe here rather than to a specific device, which is what
 * lets a drill written against the on-screen keyboard start accepting a real
 * MIDI keyboard without a single line changing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InputEvent, MidiNote, NoteEvent } from '@etude/core';
import { SUSTAIN_PEDAL_CC, isNoteEvent } from '@etude/core';
import { input } from './manager';
import { listMidiInputs, type MidiAvailability } from './webmidi';

/** Subscribe to every input event, whatever produced it. */
export function useInputEvents(handler: (event: InputEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => input.subscribe((e) => ref.current(e)), []);
}

export interface HeldNotes {
  /** Notes currently sounding, ascending. */
  readonly notes: readonly MidiNote[];
  /** Velocity per note, for sources that measure it. */
  readonly velocities: ReadonlyMap<MidiNote, number>;
  readonly sustainDown: boolean;
  clear(): void;
}

/**
 * Track what is currently held.
 *
 * Sustain is honoured: with the pedal down a released key keeps sounding, which
 * is what the instrument does and therefore what chord detection has to see.
 */
export function useHeldNotes(): HeldNotes {
  const [notes, setNotes] = useState<MidiNote[]>([]);
  const [velocities, setVelocities] = useState<Map<MidiNote, number>>(new Map());
  const [sustainDown, setSustainDown] = useState(false);
  const sustained = useRef(new Set<MidiNote>());
  const physicallyDown = useRef(new Set<MidiNote>());

  const recompute = useCallback(() => {
    const all = new Set([...physicallyDown.current, ...sustained.current]);
    setNotes([...all].sort((a, b) => a - b));
  }, []);

  useInputEvents(
    useCallback(
      (e: InputEvent) => {
        if (e.type === 'control') {
          if (e.controller !== SUSTAIN_PEDAL_CC) return;
          const down = e.value >= 0.5;
          setSustainDown(down);
          if (!down) {
            // Lifting the pedal drops everything not still held by a finger.
            sustained.current.clear();
            recompute();
          }
          return;
        }
        if (!isNoteEvent(e)) return;

        if (e.type === 'note-on') {
          physicallyDown.current.add(e.midi);
          sustained.current.delete(e.midi);
          setVelocities((prev) => new Map(prev).set(e.midi, e.velocity));
        } else {
          physicallyDown.current.delete(e.midi);
          if (sustainDown) sustained.current.add(e.midi);
        }
        recompute();
      },
      [recompute, sustainDown],
    ),
  );

  const clear = useCallback(() => {
    physicallyDown.current.clear();
    sustained.current.clear();
    setVelocities(new Map());
    setNotes([]);
  }, []);

  return { notes, velocities, sustainDown, clear };
}

/**
 * Notes accumulated since the last reset, rather than only those still held.
 *
 * This is what a chord drill needs: you build a chord one finger at a time, and
 * a set that empties as you release would make four-note chords unanswerable.
 */
export function useCollectedNotes(): {
  notes: readonly MidiNote[];
  reset: () => void;
} {
  const [notes, setNotes] = useState<MidiNote[]>([]);

  useInputEvents(
    useCallback((e: InputEvent) => {
      if (e.type !== 'note-on') return;
      setNotes((prev) => (prev.includes(e.midi) ? prev : [...prev, e.midi]));
    }, []),
  );

  return { notes, reset: useCallback(() => setNotes([]), []) };
}

export interface MidiConnection {
  readonly availability: MidiAvailability | null;
  readonly connectedLabel: string | null;
  readonly error: string | null;
  readonly scanning: boolean;
  scan(): Promise<void>;
  connect(portId: string, label: string): Promise<void>;
}

/** Discover and connect a MIDI keyboard. */
export function useMidiConnection(): MidiConnection {
  const [availability, setAvailability] = useState<MidiAvailability | null>(null);
  const [connectedLabel, setConnectedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setAvailability(await listMidiInputs());
    } finally {
      setScanning(false);
    }
  }, []);

  const connect = useCallback(async (portId: string, label: string) => {
    setError(null);
    try {
      await input.connectMidi(portId, label);
      setConnectedLabel(label);
    } catch (err) {
      setError((err as Error).message);
      setConnectedLabel(null);
    }
  }, []);

  // Reconnect the last-used keyboard on load, so a returning session does not
  // make you pick the same device every time.
  useEffect(() => {
    const preferred = input.preferredPortId;
    if (!preferred || input.hasKind('midi')) return;
    void (async () => {
      const found = await listMidiInputs();
      setAvailability(found);
      if (found.status !== 'ok') return;
      const port = found.ports.find((p) => p.id === preferred);
      if (port) {
        try {
          await input.connectMidi(port.id, port.name);
          setConnectedLabel(port.name);
        } catch {
          // Silent: the device is simply not plugged in right now.
        }
      }
    })();
  }, []);

  return { availability, connectedLabel, error, scanning, scan, connect };
}

export { input };
export type { NoteEvent };
