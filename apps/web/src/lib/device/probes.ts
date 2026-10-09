'use client';

/**
 * Probes for the questions that decide whether the app *looks* right on a
 * device, as opposed to whether it *works* on one.
 *
 * `/diagnostics` already answered the second kind — MIDI, audio latency,
 * storage — because the target tablet's behaviour there is undocumented. These
 * answer the first. Two things make a PWA look wrong on a browser that
 * otherwise runs it fine, and neither is detectable from a desktop:
 *
 *  1. **The engine cannot read the theme.** Every colour is `oklch()`. A browser
 *     that does not understand it does not degrade gracefully; it paints black
 *     on white. See `@etude/core` `device/engine.ts`.
 *  2. **The browser is not treating the page as an app.** An installed PWA that
 *     opens with the toolbar showing is still a browser tab with an icon.
 *
 * Each probe reports what it *measured*, not what it expects. Where a row would
 * have been silently dropped on failure, it is emitted anyway: "not measured"
 * and "not applicable" must stay distinguishable on a page whose job is to tell
 * them apart.
 */

import {
  describeBrowser, engineVerdict, parseUserAgent, themeVerdict,
  type ReportRow,
} from '@etude/core';

export type Probe = ReportRow;

/** Reject rather than hang. Used for anything that can sit behind a prompt. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

const supports = (declaration: string): boolean =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(declaration);

type DisplayMode = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';

function displayMode(): DisplayMode {
  // The spec's own fallback order: each mode falls back to the next.
  for (const mode of ['fullscreen', 'standalone', 'minimal-ui'] as const) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return 'browser';
}

/** What `env(safe-area-inset-*)` actually resolves to here. */
function safeAreaInsets(): string {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) '
    + 'env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const value = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    .join(' / ');
  probe.remove();
  return value;
}

interface CssFeature {
  readonly name: string;
  readonly present: boolean;
  /** Without it the theme or the layout fails, as opposed to merely degrading. */
  readonly breaking: boolean;
}

function cssFeatures(): CssFeature[] {
  return [
    { name: 'oklch()', present: supports('color: oklch(0.5 0.1 200)'), breaking: true },
    {
      name: 'color-mix()',
      present: supports('color: color-mix(in srgb, red 50%, blue)'),
      breaking: true,
    },
    {
      name: '@property',
      present: typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function',
      breaking: true,
    },
    {
      name: '@layer',
      present: typeof (window as { CSSLayerBlockRule?: unknown }).CSSLayerBlockRule !== 'undefined',
      breaking: true,
    },
    { name: 'dvh', present: supports('height: 100dvh'), breaking: false },
    {
      name: 'backdrop-filter',
      present: supports('backdrop-filter: blur(1px)') || supports('-webkit-backdrop-filter: blur(1px)'),
      breaking: false,
    },
  ];
}

/** The manifest the browser was actually handed, read back the way it would. */
async function manifestProbe(): Promise<Probe> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    return {
      label: 'Manifest',
      value: 'no <link rel="manifest"> on this page',
      status: 'bad',
      note: 'Without a manifest the browser cannot treat this as an installable app at all.',
    };
  }

  try {
    const response = await withTimeout(fetch(link.href, { cache: 'no-store' }), 4000, 'timed out');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json() as {
      display?: string; orientation?: string; icons?: unknown[]; start_url?: string;
    };
    const icons = Array.isArray(manifest.icons) ? manifest.icons.length : 0;
    return {
      label: 'Manifest',
      value: `display ${manifest.display ?? '(unset)'} · orientation ${manifest.orientation ?? '(unset)'} · ${icons} icons`,
      status: manifest.display === 'standalone' || manifest.display === 'fullscreen' ? 'good' : 'warn',
      note: 'What the app asks for. Whether the browser grants it is the Display mode row.',
    };
  } catch (error) {
    return {
      label: 'Manifest',
      value: `could not be read — ${(error as Error).message}`,
      status: 'bad',
    };
  }
}

/**
 * Every probe about how the app looks and how it was launched, in the order a
 * person reads them: what browser, then how it was opened, then whether it can
 * render the theme.
 */
export async function collectDeviceProbes(): Promise<Probe[]> {
  const rows: Probe[] = [];
  const ua = navigator.userAgent;
  const info = parseUserAgent(ua);
  const engine = engineVerdict(info);
  const touch = navigator.maxTouchPoints > 0;

  // --- What is this ---------------------------------------------------------
  // Desktop view only means something on a touch device; on a laptop it is just
  // what the browser always sends.
  const desktopOnTouch = info.desktopView && touch;
  rows.push({
    label: 'Browser',
    value: describeBrowser(info),
    status: desktopOnTouch ? 'warn' : 'info',
    note: desktopOnTouch
      ? 'This touch device is asking sites for the desktop view. In that mode the browser ignores the viewport tag, so a page built for the device width is laid out on a wider canvas and scaled — which reads as wrong sizing. Switch back to the mobile or tablet view from the browser menu.'
      : undefined,
  });
  rows.push({
    label: 'Engine',
    value: engine.ok === null ? 'not judged' : engine.ok ? 'new enough' : 'TOO OLD',
    status: engine.ok === null ? 'warn' : engine.ok ? 'good' : 'bad',
    note: engine.detail,
  });
  rows.push({ label: 'User agent', value: ua, status: 'info' });

  // --- How was it opened ----------------------------------------------------
  const mode = displayMode();
  const asApp = mode === 'fullscreen' || mode === 'standalone';
  rows.push({
    label: 'Display mode',
    value: asApp ? `${mode} (running as an app)` : mode === 'minimal-ui'
      ? 'minimal-ui (launched with a reduced toolbar)'
      : 'browser (not launched as an app)',
    status: asApp ? 'good' : 'warn',
    note: 'If you opened this from a home-screen icon and it says browser, the icon only opened a page: the browser made a bookmark rather than launching an app. The manifest asks for standalone; a browser is free to ignore that. The full-screen test below shows whether it can still be made borderless.',
  });

  const screenW = window.screen.width;
  const screenH = window.screen.height;
  const chrome = screenH - window.innerHeight;
  rows.push({
    label: 'Viewport',
    value: `${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x · screen ${screenW}×${screenH}`,
    status: 'info',
  });
  rows.push({
    label: 'Browser chrome',
    value: `about ${chrome} px of ${screenH} px is not the page`,
    status: 'info',
    note: 'Screen height minus page height: the browser toolbar plus the system bars. Compare this in a tab and from the icon — the difference is what the toolbar costs, and is the space the score and keyboard are competing for.',
  });
  const orientation = window.screen.orientation?.type
    ?? (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait');
  rows.push({
    label: 'Orientation',
    value: orientation,
    status: 'info',
    note: 'The manifest asks for landscape, which only an installed app can enforce. In a tab the device decides.',
  });

  const fullscreenApi = Boolean(document.fullscreenEnabled);
  rows.push({
    label: 'Fullscreen API',
    value: fullscreenApi ? 'available' : 'unavailable',
    status: fullscreenApi ? 'good' : 'warn',
    note: fullscreenApi
      ? 'Available is not the same as working — use the test button to see what the browser does with it.'
      : 'Without it a page cannot hide the browser toolbar itself.',
  });
  rows.push({
    label: 'Install prompt API',
    value: 'BeforeInstallPromptEvent' in window ? 'present' : 'absent',
    status: 'info',
    note: 'Chrome offers installable apps through this event. A browser without it handles "Add to Home Screen" itself, and may only create a bookmark.',
  });
  rows.push(await manifestProbe());

  // --- Can it render the theme ---------------------------------------------
  const features = cssFeatures();
  const missing = features.filter((f) => !f.present);
  const breaking = missing.filter((f) => f.breaking);
  rows.push({
    label: 'CSS features',
    value: features.map((f) => `${f.name} ${f.present ? '✓' : '✗'}`).join(' · '),
    status: breaking.length > 0 ? 'bad' : missing.length > 0 ? 'warn' : 'good',
    note: breaking.length > 0
      ? `${breaking.map((f) => f.name).join(', ')} unsupported: the theme will not resolve.`
      : missing.length > 0
        ? `${missing.map((f) => f.name).join(', ')} unsupported: layout or blur degrades, colours are fine.`
        : undefined,
  });

  const background = getComputedStyle(document.body).backgroundColor;
  const theme = themeVerdict(background);
  rows.push({
    label: 'Theme',
    value: theme.ok ? 'resolved' : 'NOT resolved',
    status: theme.ok ? 'good' : 'bad',
    note: `${theme.detail} (computed background: ${background || 'empty'})`,
  });

  rows.push({ label: 'Safe-area insets', value: safeAreaInsets(), status: 'info',
    note: 'Top / right / bottom / left, from env(safe-area-inset-*). Zero on most Android; the bottom bar pads by the last one.' });
  rows.push({
    label: 'Input',
    value: `${window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'} pointer · `
      + `${window.matchMedia('(hover: none)').matches ? 'no hover' : 'hover'} · `
      + `${navigator.maxTouchPoints} touch points`,
    status: 'info',
  });

  return rows;
}
