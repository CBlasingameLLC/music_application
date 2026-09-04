'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ulid } from '@etude/core';
import { FreePlayAnalyzer } from '@/components/FreePlayAnalyzer';
import { Keyboard } from '@/components/Keyboard';
import { MidiStatus } from '@/components/MidiStatus';
import { audio } from '@/lib/audio';
import { input } from '@/lib/input/manager';
import { recordSession } from '@/db/store';

/**
 * Free Play.
 *
 * Deliberately ungraded. Practice that feels unmonitored still has to count,
 * so the session is logged toward the day and the streak — but nothing here is
 * scored, because the moment noodling is scored people stop noodling, and
 * unstructured playing is where musical intuition actually forms.
 */
export default function FreePlayPage() {
  const [sessionId] = useState(() => ulid());
  const startedAt = useRef(0);
  const chordCount = useRef(0);
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [hasMidi, setHasMidi] = useState(false);

  useEffect(() => {
    startedAt.current = Date.now();
    void audio.resume();
    setHasMidi(input.hasKind('midi'));
    // With a real keyboard attached, the on-screen one is just wasted space.
    if (input.hasKind('midi')) setShowKeyboard(false);
  }, []);

  // Log the session on the way out so it counts toward today and the streak.
  useEffect(
    () => () => {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      if (seconds > 20) void recordSession(sessionId, seconds, chordCount.current);
    },
    [sessionId],
  );

  const onLog = useCallback(() => {
    chordCount.current += 1;
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <Link href="/practice" aria-label="Leave free play" className="tap rounded-lg bg-raised px-3 text-ink-dim">
          ✕
        </Link>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Free Play</div>
          <div className="text-xs text-ink-faint">Nothing is scored. It still counts toward today.</div>
        </div>
        <MidiStatus compact />
        <button
          type="button"
          onClick={() => setShowKeyboard((v) => !v)}
          className="tap rounded-lg bg-raised px-4 text-sm text-ink-dim"
        >
          {showKeyboard ? 'Hide keys' : 'Show keys'}
        </button>
      </header>

      <div className="flex-1 px-4 pt-6">
        <FreePlayAnalyzer onLog={onLog} />
        {!hasMidi && !showKeyboard && (
          <p className="mx-auto mt-6 max-w-4xl text-center text-sm text-ink-faint">
            No MIDI keyboard connected. Show the on-screen keys, or connect one from{' '}
            <Link href="/diagnostics" className="underline">diagnostics</Link>.
          </p>
        )}
      </div>

      {showKeyboard && (
        <div className="pb-4">
          <Keyboard low={48} octaves={3} />
        </div>
      )}
    </div>
  );
}
