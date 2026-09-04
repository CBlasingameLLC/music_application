'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/**
 * Engraved notation, via OpenSheetMusicDisplay.
 *
 * OSMD at 2 MB against Verovio's 27 MB is what decides it on a 3 GB tablet, and
 * BSD-3 is friendlier than LGPL-3. VexFlow 5 is out: no release in eighteen
 * months, and OSMD pins vexflow@1.2.93 internally, so using both would ship two
 * engraving engines with different visual vocabularies — which matters more to
 * a learner than to a developer.
 *
 * Loaded dynamically inside an effect. OSMD reaches for the DOM at module
 * scope, so a static import would break the server render.
 */

export interface ScoreViewProps {
  readonly musicXml: string;
  /** How many notes have been played correctly; drives the cursor. */
  readonly cursorIndex?: number;
  readonly showCursor?: boolean;
  /** Fingering numbers, as printed in real editions. A mild scaffold. */
  readonly showFingering?: boolean;
  readonly onReady?: () => void;
  readonly onError?: (message: string) => void;
  /**
   * Engraving scale. The default is deliberately large: this is read from a
   * music stand at roughly arm's length, not from a desk.
   */
  readonly zoom?: number;
}

export function ScoreView({
  musicXml,
  cursorIndex = 0,
  showCursor = true,
  showFingering = true,
  onReady,
  onError,
  zoom = 1.5,
}: ScoreViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  // Render on score change. Not on cursor change — re-engraving on every note
  // would be both slow and visually unstable.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    setStatus('loading');
    setMessage(null);

    void (async () => {
      try {
        const { OpenSheetMusicDisplay: OSMD } = await import('opensheetmusicdisplay');
        if (cancelled) return;

        osmdRef.current?.clear();
        host.innerHTML = '';

        const osmd = new OSMD(host, {
          backend: 'svg',
          // Landscape is locked, so resize is not a hot path; handling it
          // ourselves avoids OSMD re-rendering mid-drill.
          autoResize: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawFingerings: showFingering,
          // Light ink on the dark ground the rest of the app uses. OSMD draws
          // black on white by default, which would glare off a music desk in a
          // dim room — the exact condition this app is used in.
          defaultColorMusic: '#e8e6e1',
          pageBackgroundColor: '#00000000',
        });

        await osmd.load(musicXml);
        if (cancelled) return;

        // Short phrases otherwise engrave at their natural width and occupy a
        // third of the screen. This is read at arm's length from a music desk,
        // so it has to fill the space it is given.
        try {
          osmd.EngravingRules.StretchLastSystemLine = true;
          osmd.EngravingRules.RenderSingleHorizontalStaffline = false;
        } catch {
          // Engraving rules are internal API; losing them costs layout polish,
          // not correctness.
        }

        osmd.zoom = zoom;
        osmd.render();

        osmdRef.current = osmd;
        setStatus('ready');
        onReady?.();
      } catch (err) {
        if (cancelled) return;
        const text = (err as Error).message || 'The score could not be rendered.';
        setStatus('error');
        setMessage(text);
        onError?.(text);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicXml, showFingering, zoom]);

  // Move the cursor without re-rendering the staff.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready') return;

    try {
      const cursor = osmd.cursor;
      if (!cursor) return;
      if (!showCursor) {
        cursor.hide();
        return;
      }
      cursor.reset();
      cursor.show();
      for (let i = 0; i < cursorIndex; i++) cursor.next();
    } catch {
      // A cursor that will not advance is a cosmetic failure, never a scoring
      // one — grading reads the model, not the renderer.
    }
  }, [cursorIndex, showCursor, status]);

  useEffect(
    () => () => {
      osmdRef.current?.clear();
      osmdRef.current = null;
    },
    [],
  );

  return (
    <div className="relative w-full">
      <div
        ref={hostRef}
        data-testid="score-view"
        className="w-full overflow-x-auto rounded-xl bg-surface px-3 py-5"
        style={{ minHeight: 180 }}
      />
      {status === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
          Engraving…
        </p>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm text-bad">This score could not be rendered.</p>
          {message && <p className="text-xs text-ink-faint">{message}</p>}
        </div>
      )}
    </div>
  );
}
