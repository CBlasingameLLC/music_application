'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Key, type MidiNote,
  PitchClassHistogram, detectChord, keyName, midiToSharpName, rankKeys,
  romanNumeral, secondaryDominantOf, spellInKey, toMidi,
} from '@etude/core';
import { useHeldNotes, useInputEvents } from '@/lib/input/useNoteInput';

/** How long a chord shape must hold still before it counts as played. */
const CHORD_SETTLE_MS = 180;

/**
 * Free Play's live readout.
 *
 * Just play; the app keeps up. It names the chord under your hands, infers the
 * key from what you have been playing, and shows the Roman numeral — because
 * "that was a G7" is a fact, while "that was V7 in C" is the thing that
 * transfers to the next song you try to work out.
 *
 * The key estimate decays, so a modulation moves it rather than being averaged
 * away into whatever you played five minutes ago.
 */
export function FreePlayAnalyzer({ onLog }: { onLog?: (chordId: string) => void }) {
  const { notes, velocities, sustainDown } = useHeldNotes();
  const [keyEstimate, setKeyEstimate] = useState<{ key: Key; confidence: number } | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const histogram = useRef(new PitchClassHistogram(14, 0));
  const noteStarts = useRef(new Map<MidiNote, number>());

  // Accumulate sounding time per pitch class, which is what the key profiles
  // expect — a note held for a bar should count for more than a passing one.
  useInputEvents((e) => {
    if (e.type === 'note-on') {
      noteStarts.current.set(e.midi, e.time);
      return;
    }
    if (e.type !== 'note-off') return;
    const started = noteStarts.current.get(e.midi);
    if (started === undefined) return;
    noteStarts.current.delete(e.midi);
    histogram.current.add(e.midi, Math.max(0.05, (e.time - started) / 1000), e.time / 1000);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const snapshot = histogram.current.snapshot(performance.now() / 1000);
      const best = rankKeys(snapshot, 1)[0];
      setKeyEstimate(best && best.confidence > 0.15 ? best : null);
    }, 700);
    return () => clearInterval(timer);
  }, []);

  const matches = useMemo(() => detectChord([...notes], 3), [notes]);
  const top = matches[0];

  // Commit a chord only once it has been held steady, then feed its root into
  // the key estimate.
  //
  // The settle delay is load-bearing, not polish. A chord is built one finger
  // at a time, so every transitional subset is briefly a valid chord of its
  // own: reaching G-B-D-F passes through G major on the way, and counting both
  // would boost G twice and drag the key estimate toward whatever you happen
  // to voice from the bottom up. Waiting for the shape to stop changing keeps
  // one played chord worth exactly one chord.
  const lastLogged = useRef<string | null>(null);
  const settleTimer = useRef<number | null>(null);

  useEffect(() => {
    // Lifting your hands ends the chord. Without this, the same chord played
    // twice would only count once — and a tonic restated is precisely how a
    // key gets established, so under-weighting it skews the whole estimate.
    if (notes.length === 0) {
      lastLogged.current = null;
      return;
    }
    if (!top || notes.length < 3) return;
    if (top.symbol === lastLogged.current) return;

    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    const symbol = top.symbol;
    const rootMidi = toMidi(top.chord.root);

    settleTimer.current = window.setTimeout(() => {
      lastLogged.current = symbol;
      histogram.current.addChordRoot(rootMidi, 0.9, performance.now() / 1000);
      setHistory((h) => [symbol, ...h].slice(0, 12));
      onLog?.(symbol);
    }, CHORD_SETTLE_MS);

    return () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    };
  }, [top, notes.length, onLog]);

  const numeral = useMemo(() => {
    if (!top || !keyEstimate) return null;
    return (
      secondaryDominantOf(top.chord, keyEstimate.key) ??
      romanNumeral(top.chord, keyEstimate.key)
    );
  }, [top, keyEstimate]);

  const spelled = notes.map((m) =>
    keyEstimate ? spellNoteInKey(m, keyEstimate.key) : midiToSharpName(m).replace(/-?\d+$/, ''),
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* The chord under your hands, right now. */}
      <div
        data-testid="analyzer-readout"
        className="panel flex min-h-44 flex-col items-center justify-center px-6 py-8"
      >
        {notes.length === 0 ? (
          <p className="text-center text-ink-faint">
            Play something. Chords, a scale, anything — this keeps up.
          </p>
        ) : (
          <>
            <div className="text-[clamp(2.6rem,8vw,4.6rem)] font-bold leading-none tracking-tight">
              {top ? top.symbol : spelled.join(' ')}
            </div>
            {numeral && (
              <div className="mt-3 text-2xl font-semibold text-accent">
                {numeral}{' '}
                {/* A real space, not just the margin: without it a screen
                    reader says "Iin C major". */}
                <span className="text-base font-normal text-ink-faint">
                  in {keyName(keyEstimate!.key)}
                </span>
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {notes.map((m, i) => (
                <span
                  key={m}
                  className="tabular rounded-lg bg-raised px-3 py-1 text-sm text-ink-dim"
                >
                  {spelled[i]}
                  {velocities.get(m) !== undefined && (
                    <span className="ml-2 text-xs text-ink-faint">
                      {Math.round((velocities.get(m) ?? 0) * 127)}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {sustainDown && (
          <span className="rounded-lg bg-accent/15 px-3 py-1 font-medium text-accent">
            Sustain
          </span>
        )}
        {keyEstimate ? (
          <span className="text-ink-faint">
            Key: <span className="text-ink">{keyName(keyEstimate.key)}</span>
            <span className="ml-2 opacity-60">
              {Math.round(keyEstimate.confidence * 100)}% sure
            </span>
          </span>
        ) : (
          <span className="text-ink-faint">
            Not enough played yet to name a key.
          </span>
        )}
      </div>

      {/* Alternate readings, because a chord often has more than one honest name. */}
      {matches.length > 1 && notes.length >= 3 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Also reads as
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {matches.slice(1).map((m) => (
              <span key={m.symbol} className="rounded-lg bg-surface px-3 py-1.5 text-sm text-ink-dim">
                {m.symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            What you played
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {history.map((sym, i) => (
              <span
                key={`${sym}-${i}`}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm',
                  i === 0 ? 'bg-accent/15 text-accent' : 'bg-surface text-ink-faint',
                ].join(' ')}
              >
                {sym}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function spellNoteInKey(midi: MidiNote, key: Key): string {
  const p = spellInKey(midi, key);
  const acc = p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : '';
  return `${p.step}${acc}`;
}
