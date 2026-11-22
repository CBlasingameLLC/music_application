/**
 * A page that says so, instead of a black-and-white one that does not.
 *
 * The theme is `oklch()` throughout. An engine that cannot read it does not fall
 * back to a plain colour — every token becomes invalid at computed-value time and
 * the page paints as black text on white, with no theme and no explanation. To
 * the person holding the tablet that is not "this device is too old", it is "this
 * app is broken". (`@etude/core` `device/engine.ts` has the reasoning and the
 * Chromium 111 floor.)
 *
 * So the check runs first, in the `<head>`, before any stylesheet or script of
 * the app's own, and sends an engine that cannot draw the page to a plain static
 * page that says what is wrong and what to do about it. It tests *features*, not
 * a version number: Amazon's WebView and Silk report versions that do not always
 * line up with Chromium's, and a version check would be a guess about which of
 * them to trust.
 *
 * It is a string, not a function, because it has to run before the bundle
 * exists. It is written for the oldest engine that could possibly reach it —
 * ES5, no arrow functions, no `const` — for the same reason.
 *
 * The features are the "breaking" ones in `lib/device/probes.ts`; keep the two in
 * step. The escape hatch matters as much as the check: a guard that wrongly
 * judged a working device would lock its owner out of their own app, so the
 * unsupported page offers "try anyway", and this honours it.
 */
export const ENGINE_GUARD = `(function () {
  try {
    if (window.localStorage.getItem('etude-engine-override') === '1') return;
  } catch (e) {}
  var supported = false;
  try {
    supported = !!(window.CSS && CSS.supports)
      && CSS.supports('color: oklch(0.5 0.1 200)')
      && CSS.supports('color: color-mix(in srgb, red 50%, blue)')
      && typeof CSS.registerProperty === 'function';
  } catch (e) {}
  if (!supported) window.location.replace('/unsupported.html');
})();`;
