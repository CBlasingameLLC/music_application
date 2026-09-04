'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { midiToSharpName, spellInKey, type Key as MusicKey } from '@etude/core';
import { audio } from '@/lib/audio';

/**
 * The on-screen keyboard.
 *
 * This is the Phase 1 note source, and it implements the same contract a real
 * MIDI keyboard will: notes go down, notes come up, chords are sets. When the
 * MIDI adapter arrives, drills consuming this need no changes.
 *
 * Multi-touch is the whole point. Chord Sprint asks for three and four notes at
 * once, so every pointer is tracked independently by `pointerId` — a single
 * active-note model would make chords impossible to play and would quietly
 * teach arpeggiation instead.
 */

const WHITE_IN_OCTAVE = [0, 2, 4, 5, 7, 9, 11];
/** Semitone offset -> index of the white key it sits after. */
const BLACK_AFTER_WHITE: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

export interface KeyboardProps {
  /** Lowest sounding note. Defaults to C3. */
  readonly low?: number;
  readonly octaves?: number;
  readonly onNoteOn?: (midi: number) => void;
  readonly onNoteOff?: (midi: number) => void;
  /**
   * Notes to highlight — the keyboard-diagram scaffold. Costs XP when shown.
   * Matched by pitch class, because a chord is correct in any octave and a hint
   * pointing at keys that are not on screen would be worse than no hint.
   */
  readonly highlight?: readonly number[];
  /** Notes shown as correct/incorrect after an answer is checked. */
  readonly marks?: Readonly<Record<number, 'correct' | 'wrong'>>;
  /** Label every key with its note name. A scaffold, and priced as one. */
  readonly showNames?: boolean;
  readonly keyContext?: MusicKey;
  readonly disabled?: boolean;
}

export function Keyboard({
  low = 48,
  octaves = 2,
  onNoteOn,
  onNoteOff,
  highlight = [],
  marks = {},
  showNames = false,
  keyContext,
  disabled = false,
}: KeyboardProps) {
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const pointers = useRef(new Map<number, number>());

  const { whites, blacks, whiteCount } = useMemo(() => {
    const w: number[] = [];
    const b: Array<{ midi: number; afterWhite: number }> = [];
    for (let o = 0; o < octaves; o++) {
      for (const semitone of WHITE_IN_OCTAVE) w.push(low + o * 12 + semitone);
      for (const [semitone, afterIdx] of Object.entries(BLACK_AFTER_WHITE)) {
        b.push({ midi: low + o * 12 + Number(semitone), afterWhite: o * 7 + afterIdx });
      }
    }
    // Close on the octave: a keyboard ending on B reads as truncated.
    w.push(low + octaves * 12);
    return { whites: w, blacks: b, whiteCount: w.length };
  }, [low, octaves]);

  const press = useCallback(
    (midi: number, pointerId: number) => {
      if (disabled) return;
      pointers.current.set(pointerId, midi);
      setHeld((prev) => {
        if (prev.has(midi)) return prev;
        const next = new Set(prev);
        next.add(midi);
        return next;
      });
      void audio.resume().then(() => audio.note(midi, 0.7));
      onNoteOn?.(midi);
    },
    [disabled, onNoteOn],
  );

  const release = useCallback(
    (pointerId: number) => {
      const midi = pointers.current.get(pointerId);
      if (midi === undefined) return;
      pointers.current.delete(pointerId);
      // A note stays down while any other pointer still holds it.
      const stillHeld = [...pointers.current.values()].includes(midi);
      if (!stillHeld) {
        setHeld((prev) => {
          const next = new Set(prev);
          next.delete(midi);
          return next;
        });
        onNoteOff?.(midi);
      }
    },
    [onNoteOff],
  );

  const highlightPcs = useMemo(
    () => new Set(highlight.map((m) => ((m % 12) + 12) % 12)),
    [highlight],
  );

  const label = (midi: number): string => {
    if (!showNames) return '';
    if (keyContext) {
      const p = spellInKey(midi, keyContext);
      const acc = p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : '';
      return `${p.step}${acc}`;
    }
    return midiToSharpName(midi).replace(/-?\d+$/, '');
  };

  const whiteWidth = 100 / whiteCount;
  const blackWidth = whiteWidth * 0.62;

  const keyHandlers = (midi: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      // Touch pointers are implicitly captured by the element they start on,
      // which suppresses pointerenter elsewhere and breaks sliding between
      // keys. Release it — but only if it is actually held: calling this on an
      // uncaptured pointer throws NotFoundError and would swallow the note.
      const el = e.currentTarget;
      if (el.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      press(midi, e.pointerId);
    },
    // Sliding across keys should sound them, the way a glissando does.
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.buttons > 0 || e.pointerType === 'touch') {
        if (pointers.current.has(e.pointerId)) {
          release(e.pointerId);
          press(midi, e.pointerId);
        }
      }
    },
    onPointerUp: (e: React.PointerEvent) => release(e.pointerId),
    onPointerCancel: (e: React.PointerEvent) => release(e.pointerId),
    onPointerLeave: (e: React.PointerEvent) => {
      if (pointers.current.has(e.pointerId)) release(e.pointerId);
    },
  });

  const stateClasses = (midi: number, black: boolean): string => {
    const mark = marks[midi];
    if (mark === 'correct') return black ? 'bg-good' : 'bg-good';
    if (mark === 'wrong') return black ? 'bg-bad' : 'bg-bad';
    if (held.has(midi)) return black ? 'bg-accent-dim' : 'bg-accent';
    if (highlightPcs.has(midi % 12)) {
      return black ? 'bg-accent-dim/60 ring-2 ring-accent' : 'bg-accent/35 ring-2 ring-accent';
    }
    return black ? 'bg-[#12151c]' : 'bg-[#e8e6e1]';
  };

  return (
    <div
      className="relative w-full touch-none select-none"
      style={{ height: 'clamp(150px, 26vh, 230px)' }}
      role="group"
      aria-label="On-screen keyboard"
    >
      {/* White keys */}
      <div className="absolute inset-0 flex gap-px">
        {whites.map((midi) => (
          <button
            key={midi}
            type="button"
            disabled={disabled}
            aria-label={midiToSharpName(midi)}
            className={[
              'relative flex-1 rounded-b-md border border-black/40 transition-colors duration-75',
              'flex items-end justify-center pb-2',
              stateClasses(midi, false),
              disabled ? 'opacity-60' : '',
            ].join(' ')}
            {...keyHandlers(midi)}
          >
            {showNames && (
              <span className="pointer-events-none text-[0.78rem] font-semibold text-black/70">
                {label(midi)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Black keys, overlaid */}
      <div className="pointer-events-none absolute inset-0">
        {blacks.map(({ midi, afterWhite }) => (
          <button
            key={midi}
            type="button"
            disabled={disabled}
            aria-label={midiToSharpName(midi)}
            className={[
              'pointer-events-auto absolute top-0 rounded-b-md border border-black/70',
              'flex items-end justify-center pb-1.5 transition-colors duration-75',
              stateClasses(midi, true),
            ].join(' ')}
            style={{
              left: `${(afterWhite + 1) * whiteWidth - blackWidth / 2}%`,
              width: `${blackWidth}%`,
              height: '62%',
            }}
            {...keyHandlers(midi)}
          >
            {showNames && (
              <span className="pointer-events-none text-[0.68rem] font-semibold text-white/80">
                {label(midi)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
