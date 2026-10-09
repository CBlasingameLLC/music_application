/**
 * Emulated Android devices for the headless run.
 *
 * ## What this is, and what it is not
 *
 * Playwright can open Chromium with an Android device's viewport, pixel ratio,
 * touch input and user agent. That is a real test of everything that depends on
 * those four things: whether the layout fits, whether anything overflows,
 * whether a control is big enough to hit, whether the bottom bar covers the
 * last row. It runs headless in a container with no hardware virtualisation,
 * in seconds.
 *
 * It is **not** an Android browser. The engine is whatever Chromium Playwright
 * ships (141 at the time of writing), on desktop Linux fonts, with no system
 * bars and no browser toolbar. So it cannot reproduce:
 *
 *  - an old engine (the page would pass here and paint black-on-white on one),
 *  - Android's own fonts and text metrics,
 *  - the status bar, gesture bar and toolbar eating into the viewport,
 *  - how a particular browser launches an *installed* app — the Fire tablet's
 *    header bar is a fact about Silk's install flow, and nothing here sees it.
 *
 * One gotcha for anyone writing a script against these profiles: a
 * `fullPage` screenshot silently turns touch emulation **off** for that page
 * (`pointer: coarse` → `fine`, `hover: none` → `hover`, `maxTouchPoints` → 0).
 * Open a fresh page after taking one. `layout.mjs` does.
 *
 * The on-device probes on `/diagnostics` exist for exactly that gap: this run
 * proves the layout is sound at the sizes that matter, and the probes report
 * what the real browser does with it. Neither replaces the other.
 *
 * ## Where the numbers come from
 *
 * Built-in descriptors (Pixel 7, Galaxy Tab S9) are Playwright's own. The Fire
 * HD 10 is not among them — the only Kindle in the list is a first-generation
 * HDX on WebKit — so it is defined here, from the panel's 1920×1200 at the 1.5
 * device pixel ratio Fire tablets of this class report. **Those are
 * assumptions.** The `Viewport` row on `/diagnostics` is the source of truth;
 * if it disagrees, change the numbers here.
 */

import { devices } from 'playwright';

/**
 * Silk's tablet user agent, in the shape Amazon documents:
 * `Silk/<browser> like Chrome/<chromium>`.
 *
 * The engine version is the one actually under test rather than an invented
 * one, so the app's own engine check reads the true value, and the model token
 * is generic because nothing here depends on the real build code.
 */
export function silkUserAgent(engineVersion) {
  const major = engineVersion.split('.')[0];
  return (
    'Mozilla/5.0 (Linux; Android 11; Fire HD 10 Build/RS0000) AppleWebKit/537.36 '
    + `(KHTML, like Gecko) Silk/${major}.0.0 like Chrome/${major}.0.0.0 Safari/537.36`
  );
}

/**
 * How many CSS pixels the browser toolbar and system bars take from a Fire
 * tablet's 800 px landscape height when the page is in a tab rather than
 * launched as an app.
 *
 * An estimate — Amazon does not publish it. It exists so the layout is tested
 * at a plausibly *shorter* viewport, where the score and keyboard compete for
 * space and a fixed bottom bar matters most. Replace it with the `Browser
 * chrome` row from `/diagnostics` once measured on the tablet.
 */
export const FIRE_TAB_CHROME_PX = 84;

const FIRE = { deviceScaleFactor: 1.5, isMobile: true, hasTouch: true };

/**
 * `blocking` profiles fail the run when something is wrong. The rest are
 * reported but do not: the app is designed for a landscape tablet on a music
 * stand, so a phone is information about how it degrades, not a target it
 * promises to meet.
 */
export const PROFILES = {
  'fire-hd-10': {
    label: 'Fire HD 10, landscape, no toolbar (launched as an app)',
    blocking: true,
    engine: 'silk',
    options: { ...FIRE, viewport: { width: 1280, height: 800 } },
  },
  'fire-hd-10-tab': {
    label: `Fire HD 10, landscape, in a Silk tab (about ${FIRE_TAB_CHROME_PX}px shorter)`,
    blocking: true,
    engine: 'silk',
    options: { ...FIRE, viewport: { width: 1280, height: 800 - FIRE_TAB_CHROME_PX } },
  },
  'fire-hd-10-portrait': {
    label: 'Fire HD 10, held upright',
    blocking: false,
    engine: 'silk',
    options: { ...FIRE, viewport: { width: 800, height: 1280 - FIRE_TAB_CHROME_PX } },
  },
  'galaxy-tab-s9': {
    label: 'Galaxy Tab S9, landscape',
    blocking: true,
    engine: 'chrome',
    options: { ...devices['Galaxy Tab S9 landscape'] },
  },
  'pixel-7': {
    label: 'Pixel 7, portrait',
    blocking: false,
    engine: 'chrome',
    options: { ...devices['Pixel 7'] },
  },
  'pixel-7-landscape': {
    label: 'Pixel 7, landscape',
    blocking: false,
    engine: 'chrome',
    options: { ...devices['Pixel 7 landscape'] },
  },
};

/** The device the app is built for, and what the smoke test runs as. */
export const DEFAULT_PROFILE = 'fire-hd-10';

export function profileNames() {
  return Object.keys(PROFILES);
}

/** Playwright context options for a named profile. */
export function contextOptions(name, engineVersion) {
  const profile = PROFILES[name];
  if (!profile) {
    throw new Error(
      `unknown device profile "${name}" — known profiles: ${profileNames().join(', ')}`,
    );
  }
  const options = { ...profile.options };
  // Playwright's descriptors carry a browser hint that newContext() does not take.
  delete options.defaultBrowserType;
  if (profile.engine === 'silk') options.userAgent = silkUserAgent(engineVersion);
  return options;
}
