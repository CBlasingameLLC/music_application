'use client';

/**
 * The input manager.
 *
 * One place where every note in the app arrives, whatever produced it — the
 * on-screen keyboard, a MIDI keyboard, a microphone, or later a LAN bridge from
 * the desktop app. Drills subscribe here and never learn which it was.
 *
 * It also owns the device calibration offset, because that has to be applied
 * once, centrally. Applying it per-consumer would guarantee that some consumer
 * eventually forgets and reports timing that is quietly wrong.
 */

import type { DeviceProfile, InputEvent, NoteEvent, NoteSource } from '@etude/core';
import { WebMidiSource } from './webmidi';

const PROFILE_KEY = 'etude.deviceProfiles';
const PREFERRED_PORT_KEY = 'etude.preferredMidiPort';

type Listener = (event: InputEvent) => void;

class InputManager {
  private readonly listeners = new Set<Listener>();
  private readonly sources = new Map<string, NoteSource>();
  private readonly unsubscribers = new Map<string, () => void>();
  private profiles: Record<string, DeviceProfile> = {};
  private loaded = false;

  /** Notes currently down, so durations can be measured on note-off. */
  private readonly downAt = new Map<number, NoteEvent>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Publish an event. The on-screen keyboard calls this directly; hardware
   * sources are piped in by `register`.
   */
  publish(event: InputEvent): void {
    const adjusted = this.applyOffset(event);
    if (adjusted.type === 'note-on') this.downAt.set(adjusted.midi, adjusted);
    if (adjusted.type === 'note-off') this.downAt.delete(adjusted.midi);
    for (const l of this.listeners) l(adjusted);
  }

  /**
   * Subtract the device's measured offset from the timestamp.
   *
   * Without this, timing metrics carry a constant bias: a player follows the
   * click they *hear*, which is already late by the audio output latency, so
   * every onset lands late by exactly that much.
   */
  private applyOffset(event: InputEvent): InputEvent {
    const profile = this.profileFor(event.sourceId);
    if (!profile || profile.offsetMs === 0) return event;
    return { ...event, time: event.time - profile.offsetMs };
  }

  register(source: NoteSource): void {
    this.sources.set(source.id, source);
    this.unsubscribers.set(source.id, source.subscribe((e) => this.publish(e)));
  }

  unregister(id: string): void {
    this.unsubscribers.get(id)?.();
    this.unsubscribers.delete(id);
    this.sources.get(id)?.stop();
    this.sources.delete(id);
  }

  get activeSources(): NoteSource[] {
    return [...this.sources.values()];
  }

  hasKind(kind: NoteSource['kind']): boolean {
    return [...this.sources.values()].some((s) => s.kind === kind && s.connected);
  }

  /** True once a source that reports real velocity is connected. */
  get velocityAvailable(): boolean {
    return [...this.sources.values()].some((s) => s.hasVelocity && s.connected);
  }

  /** Connect a MIDI keyboard. Returns the source, or throws with a usable reason. */
  async connectMidi(portId: string | null, label: string): Promise<NoteSource> {
    for (const s of this.sources.values()) {
      if (s.kind === 'midi') this.unregister(s.id);
    }
    const source = new WebMidiSource(`midi:${portId ?? 'all'}`, label, portId);
    await source.start();
    this.register(source);
    if (portId) localStorage.setItem(PREFERRED_PORT_KEY, portId);
    return source;
  }

  get preferredPortId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PREFERRED_PORT_KEY);
  }

  // --- Calibration -------------------------------------------------------

  private load(): void {
    if (this.loaded || typeof localStorage === 'undefined') return;
    try {
      this.profiles = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Record<
        string,
        DeviceProfile
      >;
    } catch {
      this.profiles = {};
    }
    this.loaded = true;
  }

  profileFor(sourceId: string): DeviceProfile | null {
    this.load();
    return this.profiles[sourceId] ?? null;
  }

  saveProfile(profile: DeviceProfile): void {
    this.load();
    this.profiles[profile.id] = profile;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profiles));
    } catch {
      // A full or blocked store costs calibration, not the session.
    }
  }

  allProfiles(): DeviceProfile[] {
    this.load();
    return Object.values(this.profiles);
  }
}

export const input = new InputManager();

/**
 * Turn calibration taps into an offset.
 *
 * Reports the **median**, not the mean: one late tap while you find the rhythm
 * would drag a mean far enough to bias every subsequent measurement, and the
 * whole point of calibrating is to remove bias rather than add it.
 */
export function summarizeCalibration(
  deviations: readonly number[],
): { offsetMs: number; jitterMs: number; usable: boolean } {
  if (deviations.length === 0) return { offsetMs: 0, jitterMs: 0, usable: false };

  const sorted = [...deviations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const offsetMs =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  // Median absolute deviation, which shrugs off the same outliers the median does.
  const absDevs = sorted.map((d) => Math.abs(d - offsetMs)).sort((a, b) => a - b);
  const jitterMs = absDevs[Math.floor(absDevs.length / 2)] ?? 0;

  return {
    offsetMs: Math.round(offsetMs),
    jitterMs: Math.round(jitterMs),
    // Too few taps, or too scattered, and the number would be worse than none.
    usable: deviations.length >= 6 && jitterMs < 60,
  };
}
