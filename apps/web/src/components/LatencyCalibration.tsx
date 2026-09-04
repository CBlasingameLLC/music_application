'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceProfile } from '@etude/core';
import { audio } from '@/lib/audio';
import { input, summarizeCalibration } from '@/lib/input/manager';
import { useInputEvents } from '@/lib/input/useNoteInput';

const BPM = 80;
const TAPS_WANTED = 12;
/** The first bar is a count-in and is never measured. */
const COUNT_IN_BEATS = 4;

/**
 * Input latency calibration.
 *
 * Without this, every timing metric carries a constant bias. The player follows
 * the click they *hear*, which is already late by the audio output latency, so
 * their onsets land late by exactly that amount — and grading would read a
 * perfectly steady player as consistently rushing behind the beat.
 *
 * Measures the median deviation, not the mean: one fumbled tap while you find
 * the groove would drag a mean far enough to make things worse than not
 * calibrating at all.
 */
export function LatencyCalibration({ sourceId, label }: { sourceId: string; label: string }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [taps, setTaps] = useState<number[]>([]);
  const [result, setResult] = useState<DeviceProfile | null>(null);

  const beatTimes = useRef<number[]>([]);
  const measuring = useRef(false);

  useEffect(() => {
    setResult(input.profileFor(sourceId));
  }, [sourceId]);

  useInputEvents(
    useCallback((e) => {
      if (!measuring.current || e.type !== 'note-on') return;
      // Nearest scheduled beat, converted onto the same clock the note is on.
      let best = Infinity;
      for (const beat of beatTimes.current) {
        const d = e.time - beat;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
      if (Math.abs(best) < 400) setTaps((prev) => [...prev, best]);
    }, []),
  );

  const start = useCallback(async () => {
    await audio.resume();
    setTaps([]);
    setResult(null);
    setPhase('running');
    beatTimes.current = [];
    measuring.current = false;

    audio.startMetronome(BPM, 4, (beat, audioTime) => {
      // Beats are scheduled on the audio clock; notes are stamped on the
      // performance clock. Converting is the entire point of the exercise.
      const performanceTime = audio.audioTimeToPerformanceTime(audioTime);
      if (beat >= COUNT_IN_BEATS) {
        measuring.current = true;
        beatTimes.current.push(performanceTime);
        if (beatTimes.current.length > 40) beatTimes.current.shift();
      }
    });
  }, []);

  const stop = useCallback(() => {
    audio.stopMetronome();
    measuring.current = false;
    setPhase('done');
  }, []);

  useEffect(() => {
    if (phase === 'running' && taps.length >= TAPS_WANTED) stop();
  }, [phase, taps.length, stop]);

  useEffect(() => () => audio.stopMetronome(), []);

  const save = useCallback(() => {
    const summary = summarizeCalibration(taps);
    const profile: DeviceProfile = {
      id: sourceId,
      label,
      kind: sourceId.startsWith('midi') ? 'midi' : 'onscreen',
      offsetMs: summary.offsetMs,
      jitterMs: summary.jitterMs,
      calibratedAt: new Date().toISOString(),
      sampleCount: taps.length,
    };
    input.saveProfile(profile);
    setResult(profile);
    setPhase('idle');
  }, [taps, sourceId, label]);

  const summary = summarizeCalibration(taps);

  return (
    <section className="panel p-5">
      <h2 className="font-semibold">Timing calibration</h2>
      <p className="mt-1 text-sm text-ink-faint">
        Play any note on each click for a few bars. This measures how far your
        setup is offset, so timing scores measure your playing rather than your
        hardware.
      </p>

      {result && phase === 'idle' && (
        <div className="mt-4 rounded-xl bg-raised p-4">
          <div className="tabular text-2xl font-bold text-accent">
            {result.offsetMs > 0 ? '+' : ''}{result.offsetMs} ms
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            ±{result.jitterMs} ms spread over {result.sampleCount} taps ·{' '}
            {new Date(result.calibratedAt).toLocaleDateString()}
          </p>
        </div>
      )}

      {phase === 'running' && (
        <div className="mt-4">
          <div className="tabular text-3xl font-bold">
            {taps.length} / {TAPS_WANTED}
          </div>
          <p className="mt-1 text-sm text-ink-faint">
            {taps.length === 0 ? 'Wait for the count-in, then play on each click.' : 'Keep going…'}
          </p>
          <button type="button" onClick={stop} className="tap mt-4 rounded-xl bg-raised px-6">
            Stop
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div className="mt-4">
          <div className="tabular text-2xl font-bold">
            {summary.offsetMs > 0 ? '+' : ''}{summary.offsetMs} ms
            <span className="ml-2 text-base font-normal text-ink-faint">
              ±{summary.jitterMs}
            </span>
          </div>
          {summary.usable ? (
            <p className="mt-1 text-sm text-good">Clean measurement.</p>
          ) : (
            <p className="mt-1 text-sm text-warn">
              Too few or too scattered to trust — a bad offset is worse than none.
              Try again, and stay relaxed rather than accurate.
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!summary.usable}
              className="tap rounded-xl bg-accent px-6 font-bold text-accent-ink disabled:opacity-40"
            >
              Save
            </button>
            <button type="button" onClick={() => void start()} className="tap rounded-xl bg-raised px-6">
              Retry
            </button>
          </div>
        </div>
      )}

      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void start()}
          className="tap mt-4 rounded-xl bg-raised px-6 font-semibold"
        >
          {result ? 'Recalibrate' : 'Start calibration'}
        </button>
      )}
    </section>
  );
}
