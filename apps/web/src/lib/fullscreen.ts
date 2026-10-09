'use client';

/**
 * Full screen, for browsers that will not launch an installed app standalone.
 *
 * On iOS, "Add to Home Screen" gives an icon that opens with no browser around
 * it. On a Fire tablet the same gesture can leave the app opening inside Silk
 * with its toolbar showing — the page is installed in the sense of having an
 * icon, and not in the sense of being an app. Nothing in the manifest can force
 * a browser to honour `display: standalone`; a browser that does not offer it
 * simply ignores the field.
 *
 * What a page *can* do from inside the browser is ask for the Fullscreen API,
 * which Chromium-based browsers implement independently of any install flow and
 * which hides the toolbar and the system bars. It needs a user gesture, so it
 * cannot be automatic, and it ends when the page is reloaded rather than
 * navigated — which this app, being a client-side router, rarely does.
 *
 * Whether Silk honours it is not documented. `/diagnostics` tests it on the
 * device and reports what happened, so the answer is a fact rather than a hope.
 */

import { useCallback, useEffect, useState } from 'react';

export interface FullscreenAttempt {
  readonly ok: boolean;
  /** What happened, in a form worth pasting into a report. */
  readonly detail: string;
}

/** Already running as an app: installed standalone, or fullscreen by manifest. */
export function runningAsApp(): boolean {
  return ['fullscreen', 'standalone'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

const viewport = (): string => `${window.innerWidth}×${window.innerHeight}`;
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask for full screen and report what came of it.
 *
 * Resolving without an exception is not the same as working: a browser can
 * accept the request and leave the viewport exactly as it was. So success is
 * judged by whether the page ended up *in* fullscreen, and the before/after
 * viewport is returned so the difference is visible.
 */
export async function requestFullscreen(): Promise<FullscreenAttempt> {
  const root = document.documentElement;
  if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') {
    return { ok: false, detail: 'The Fullscreen API is not available in this browser.' };
  }

  const before = viewport();
  try {
    await root.requestFullscreen({ navigationUI: 'hide' });
  } catch (error) {
    return { ok: false, detail: `Rejected: ${(error as Error).message}` };
  }

  // The viewport resizes a moment after the promise settles.
  await settle(350);
  const entered = document.fullscreenElement !== null;
  return {
    ok: entered,
    detail: entered
      ? `Entered. Viewport ${before} → ${viewport()}.`
      : `The request resolved but the page is not fullscreen. Viewport ${before} → ${viewport()}.`,
  };
}

export interface FullscreenState {
  /** The API exists and the browser will allow it. False until mounted. */
  readonly supported: boolean;
  /** Filling the screen already, via the API or by being an installed app. */
  readonly active: boolean;
  /**
   * Full screen *because this page asked for it*. Distinct from `active`: an
   * installed app is fullscreen without the API, and there is nothing to
   * "leave" — offering to would be a button that does nothing.
   */
  readonly entered: boolean;
  readonly enter: () => Promise<FullscreenAttempt>;
  readonly exit: () => Promise<void>;
}

export function useFullscreen(): FullscreenState {
  // All three start false and are set in an effect, so the server render and the
  // first client render agree and nothing flashes in and out on hydration.
  const [supported, setSupported] = useState(false);
  const [viaApi, setViaApi] = useState(false);
  const [asApp, setAsApp] = useState(false);

  useEffect(() => {
    const sync = (): void => {
      setViaApi(document.fullscreenElement !== null);
      setAsApp(runningAsApp());
    };
    setSupported(
      Boolean(document.fullscreenEnabled) && typeof document.documentElement.requestFullscreen === 'function',
    );
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const enter = useCallback(() => requestFullscreen(), []);
  const exit = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  }, []);

  return { supported, active: viaApi || asApp, entered: viaApi, enter, exit };
}
