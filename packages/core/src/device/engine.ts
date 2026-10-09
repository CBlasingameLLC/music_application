/**
 * What browser is this, and is its engine new enough for what the app ships?
 *
 * The app's visual system is Tailwind v4 over OKLCH colours. Tailwind v4's
 * documented floor is Chrome 111 (Safari 16.4, Firefox 128): `oklch()`,
 * `color-mix()` and `@property` all arrive in 111, and below it every theme
 * token is *invalid at computed-value time* — which does not fall back to a
 * default colour, it falls back to `initial`. The page then renders as black on
 * white with no theme at all, which looks like a different app entirely rather
 * than a degraded one.
 *
 * So "is this engine new enough" is the first question to ask of any device
 * that "looks weird", and it is answerable from the user agent alone. Silk is
 * Chromium underneath and says so — its UA reads `Silk/<v> like Chrome/<c>` —
 * so the engine version is right there even though the browser is not Chrome.
 *
 * Pure and DOM-free: it takes the string, so the diagnostics page, the tests
 * and any Node-side script can all ask the same question the same way.
 */

export type BrowserFamily =
  | 'silk' | 'chrome' | 'edge' | 'samsung' | 'firefox' | 'safari' | 'unknown';

export interface BrowserInfo {
  readonly family: BrowserFamily;
  /**
   * The Chromium major version the engine corresponds to, or null when the
   * browser is not Chromium-based (Firefox, Safari) or could not be read.
   */
  readonly chromiumMajor: number | null;
  /** The browser's own version string, when it has one distinct from Chromium's. */
  readonly browserVersion: string | null;
  /** Android version, e.g. "11". Null off Android. */
  readonly android: string | null;
  /** `Build.MODEL`, e.g. "KFTRWI" for a Fire tablet. Null when not reported. */
  readonly model: string | null;
  /**
   * Whether the UA asked for the desktop view. Silk and Chrome both do this
   * when the user picks "desktop site", and in that mode the `viewport` meta
   * tag is ignored — a page designed for `width=device-width` is then laid out
   * on a fixed, wider canvas and scaled to fit, which reads as wrong sizing.
   */
  readonly desktopView: boolean;
}

/**
 * Tailwind v4's documented Chromium floor. Below this the theme does not
 * resolve; see the module comment.
 */
export const CHROMIUM_FLOOR = 111;

function firstMatch(ua: string, pattern: RegExp): string | null {
  const match = pattern.exec(ua);
  return match?.[1] ?? null;
}

export function parseUserAgent(ua: string): BrowserInfo {
  const android = firstMatch(ua, /Android\s+([\d.]+)/);
  // `Build.MODEL` sits after the Android version, before `Build/` or `)`.
  const model = firstMatch(ua, /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/);
  const chromeToken = firstMatch(ua, /Chrome\/(\d+)/);
  const chromiumMajor = chromeToken === null ? null : Number(chromeToken);

  // Order matters: Silk, Edge and Samsung Internet all *also* contain a
  // `Chrome/` token, so the specific browser has to be tested for first.
  const silk = firstMatch(ua, /Silk\/([\d.]+)/);
  if (silk !== null) {
    return {
      family: 'silk',
      chromiumMajor,
      browserVersion: silk,
      android,
      model: model === 'Linux' ? null : model,
      // Silk's desktop UA is the only one without an Android token.
      desktopView: android === null && /X11; Linux/.test(ua),
    };
  }

  const edge = firstMatch(ua, /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/);
  if (edge !== null) {
    return {
      family: 'edge', chromiumMajor, browserVersion: edge, android, model,
      desktopView: android === null,
    };
  }

  const samsung = firstMatch(ua, /SamsungBrowser\/([\d.]+)/);
  if (samsung !== null) {
    return {
      family: 'samsung', chromiumMajor, browserVersion: samsung, android, model,
      desktopView: android === null,
    };
  }

  const firefox = firstMatch(ua, /(?:Firefox|FxiOS)\/([\d.]+)/);
  if (firefox !== null) {
    return {
      family: 'firefox', chromiumMajor: null, browserVersion: firefox, android, model,
      desktopView: android === null && !/iPhone|iPad/.test(ua),
    };
  }

  // CriOS is Chrome on iOS, which is WebKit underneath — not Chromium — so it
  // must not be mistaken for an engine version.
  if (/CriOS\//.test(ua)) {
    return {
      family: 'chrome', chromiumMajor: null,
      browserVersion: firstMatch(ua, /CriOS\/([\d.]+)/),
      android: null, model: null, desktopView: false,
    };
  }

  if (chromeToken !== null) {
    return {
      family: 'chrome', chromiumMajor, browserVersion: firstMatch(ua, /Chrome\/([\d.]+)/),
      android, model,
      desktopView: android === null,
    };
  }

  if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    return {
      family: 'safari', chromiumMajor: null,
      browserVersion: firstMatch(ua, /Version\/([\d.]+)/),
      android: null, model: null, desktopView: !/iPhone|iPad/.test(ua),
    };
  }

  return {
    family: 'unknown', chromiumMajor: null, browserVersion: null,
    android, model, desktopView: false,
  };
}

export interface EngineVerdict {
  /** True/false when the engine could be judged, null when it could not. */
  readonly ok: boolean | null;
  readonly detail: string;
}

/**
 * Is the engine new enough for the theme?
 *
 * `null` rather than a guess for anything that is not Chromium: Firefox and
 * Safari have their own floors, and a confident wrong answer here would send
 * someone chasing the wrong cause.
 */
export function engineVerdict(info: BrowserInfo): EngineVerdict {
  if (info.chromiumMajor === null) {
    return {
      ok: null,
      detail: info.family === 'unknown'
        ? 'The browser did not identify itself, so its engine could not be judged.'
        : `Not Chromium-based (${info.family}); the Chromium ${CHROMIUM_FLOOR} floor does not apply.`,
    };
  }

  if (info.chromiumMajor >= CHROMIUM_FLOOR) {
    return {
      ok: true,
      detail: `Chromium ${info.chromiumMajor}, at or above the ${CHROMIUM_FLOOR} that oklch(), color-mix() and @property need.`,
    };
  }

  return {
    ok: false,
    detail:
      `Chromium ${info.chromiumMajor} is below ${CHROMIUM_FLOOR}. oklch(), color-mix() and `
      + '@property are unsupported, so every theme colour falls back to the browser default — '
      + 'expect a white page with black text.',
  };
}

/** A one-line description, for a report someone will paste into a chat. */
export function describeBrowser(info: BrowserInfo): string {
  const name = {
    silk: 'Silk', chrome: 'Chrome', edge: 'Edge', samsung: 'Samsung Internet',
    firefox: 'Firefox', safari: 'Safari', unknown: 'unknown browser',
  }[info.family];

  const parts: string[] = [info.browserVersion ? `${name} ${info.browserVersion}` : name];
  if (info.family !== 'chrome' && info.chromiumMajor !== null) {
    parts.push(`Chromium ${info.chromiumMajor}`);
  }
  if (info.android) parts.push(`Android ${info.android}`);
  if (info.model) parts.push(info.model);
  if (info.desktopView) parts.push('desktop view');
  return parts.join(' · ');
}
