'use client';

import { useFullscreen } from '@/lib/fullscreen';

/**
 * Hides the browser's toolbar, where the browser will let a page do that.
 *
 * Shown only when it can help. If the app was launched standalone there is
 * nothing to hide, and if the browser has no Fullscreen API the button would be
 * a promise it cannot keep — so in both cases it renders nothing rather than a
 * control that does nothing. It also renders nothing on the server and on the
 * first client paint, so hydration never sees it appear.
 *
 * It is a button because the API requires a user gesture: going full screen
 * cannot be automatic, and a browser that is asked to do it unprompted refuses.
 */
export function FullscreenButton() {
  const fullscreen = useFullscreen();
  if (!fullscreen.supported || fullscreen.active) return null;

  return (
    <button
      type="button"
      onClick={() => void fullscreen.enter()}
      className="tap shrink-0 rounded-xl bg-raised px-4 text-sm text-ink-dim"
      data-testid="enter-fullscreen"
    >
      Full screen
    </button>
  );
}
