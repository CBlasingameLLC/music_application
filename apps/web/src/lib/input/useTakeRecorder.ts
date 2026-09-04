'use client';

/**
 * Recording a performance, rather than an answer.
 *
 * Every drill so far asks a question and collects a response — a chord, a
 * sequence, a set of taps. A performance is a different object: it has to keep
 * *when* each note started and stopped, how hard, and in which hand, because
 * that is what the grader measures. So this accumulates a `PerformedTake`
 * instead of an answer.
 *
 * Note-off matters as much as note-on here. Articulation is entirely in the
 * release — a player can space onsets perfectly while holding everything down —
 * so a recorder that only captured attacks could not tell staccato from legato
 * at all.
 */

import { useCallback, useRef, useState } from 'react';
import type { MidiNote, PedalEvent, PerformedNote, PerformedTake } from '@etude/core';
import { SUSTAIN_PEDAL_CC, isNoteEvent } from '@etude/core';
import { input } from './manager';

export interface TakeRecorder {
  readonly recording: boolean;
  /** Notes captured so far, for live display. */
  readonly noteCount: number;
  start(): void;
  /** Stop and return the take. Null when nothing was played. */
  stop(): PerformedTake | null;
  cancel(): void;
}

interface OpenNote {
  readonly midi: MidiNote;
  readonly onsetMs: number;
  readonly velocity: number;
}

export function useTakeRecorder(tempoTarget: number | null): TakeRecorder {
  const [recording, setRecording] = useState(false);
  const [noteCount, setNoteCount] = useState(0);

  const notes = useRef<PerformedNote[]>([]);
  const pedal = useRef<PedalEvent[]>([]);
  const open = useRef(new Map<MidiNote, OpenNote>());
  const unsubscribe = useRef<(() => void) | null>(null);
  // Whether anything that actually measures velocity was the source. A take
  // graded for dynamics has to know this, because a touchscreen reports a
  // nominal 0.7 for every note and scoring that would be measuring nothing.
  const sawVelocity = useRef(false);

  const start = useCallback(() => {
    notes.current = [];
    pedal.current = [];
    open.current.clear();
    sawVelocity.current = false;
    setNoteCount(0);
    setRecording(true);

    unsubscribe.current?.();
    unsubscribe.current = input.subscribe((event) => {
      if (!isNoteEvent(event)) {
        if (event.controller === SUSTAIN_PEDAL_CC) {
          pedal.current.push({ timeMs: event.time, value: event.value });
        }
        return;
      }

      if (event.type === 'note-on') {
        if (input.velocityAvailable) sawVelocity.current = true;
        open.current.set(event.midi, {
          midi: event.midi,
          onsetMs: event.time,
          velocity: event.velocity,
        });
        setNoteCount((n) => n + 1);
        return;
      }

      const started = open.current.get(event.midi);
      if (!started) return;
      open.current.delete(event.midi);
      notes.current.push({
        midi: started.midi,
        onsetMs: started.onsetMs,
        offsetMs: event.time,
        velocity: started.velocity,
      });
    });
  }, []);

  const finish = useCallback((): PerformedTake | null => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    setRecording(false);

    // Anything still held when the take ended is still a note that was played.
    // Dropping it would silently lose the final chord of every performance.
    const now = performance.now();
    for (const held of open.current.values()) {
      notes.current.push({
        midi: held.midi,
        onsetMs: held.onsetMs,
        offsetMs: now,
        velocity: held.velocity,
      });
    }
    open.current.clear();

    if (notes.current.length === 0) return null;
    const sorted = [...notes.current].sort((a, b) => a.onsetMs - b.onsetMs);

    return {
      notes: sorted,
      pedal: [...pedal.current],
      tempoTarget,
      hasVelocity: sawVelocity.current,
    };
  }, [tempoTarget]);

  const cancel = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    notes.current = [];
    pedal.current = [];
    open.current.clear();
    setNoteCount(0);
    setRecording(false);
  }, []);

  return { recording, noteCount, start, stop: finish, cancel };
}
