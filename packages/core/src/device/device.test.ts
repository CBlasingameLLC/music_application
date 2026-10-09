import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_FLOOR, describeBrowser, engineVerdict, parseUserAgent,
} from './engine';
import { DARK_GROUND_MAX_LIGHTNESS, parseCssColor, themeVerdict } from './color';
import { formatProbeReport } from './report';

// The Silk strings follow the three templates Amazon publishes (tablet, mobile,
// desktop). Their version numbers and model code are *illustrative*: nothing
// here was captured from a device, and the real values come from the
// diagnostics page on the tablet. The Chrome strings follow Chrome's reduced-UA
// format, and Edge, Samsung Internet, Firefox and Safari are here because they
// either share Chrome's `Chrome/` token or must not be mistaken for it.
const SILK_TABLET =
  'Mozilla/5.0 (Linux; Android 11; KFTRWI Build/RS8332.3115N) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Silk/140.7.11 like Chrome/140.0.0.0 Safari/537.36';
const SILK_MOBILE =
  'Mozilla/5.0 (Linux; Android 11; KFTRWI Build/RS8332.3115N) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Silk/140.7.11 like Chrome/140.0.0.0 Mobile Safari/537.36';
const SILK_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Silk/140.7.11 like Chrome/140.0.0.0 Safari/537.36';
const SILK_OLD =
  'Mozilla/5.0 (Linux; Android 4.4.3; KFTHWI Build/KTU84M) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Silk/44.1.54 like Chrome/44.0.2403.63 Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/141.0.0.0 Mobile Safari/537.36';
const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/141.0.0.0 Safari/537.36';
const EDGE_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36';
const FIREFOX_ANDROID =
  'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';
const SAFARI_IOS =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';

describe('reading a user agent', () => {
  it('recognises Silk by its own token, not by the Chrome one it also carries', () => {
    // Silk's UA contains `like Chrome/140`. Reading that as Chrome would
    // report the wrong browser, and the browser is the thing being asked about.
    const info = parseUserAgent(SILK_TABLET);
    expect(info.family).toBe('silk');
    expect(info.browserVersion).toBe('140.7.11');
    expect(info.chromiumMajor).toBe(140);
    expect(info.android).toBe('11');
    expect(info.model).toBe('KFTRWI');
    expect(info.desktopView).toBe(false);
  });

  it('reads the mobile and tablet Silk views the same way', () => {
    expect(parseUserAgent(SILK_MOBILE)).toMatchObject({
      family: 'silk', chromiumMajor: 140, android: '11', desktopView: false,
    });
  });

  it('flags the desktop view, which makes the browser ignore the viewport tag', () => {
    // In desktop view a page built for width=device-width is laid out on a
    // fixed wider canvas and scaled down, which reads as wrong sizing.
    const info = parseUserAgent(SILK_DESKTOP);
    expect(info.family).toBe('silk');
    expect(info.desktopView).toBe(true);
    expect(info.android).toBeNull();
  });

  it('reads the Chromium version out of an ancient Silk', () => {
    expect(parseUserAgent(SILK_OLD)).toMatchObject({
      family: 'silk', chromiumMajor: 44, browserVersion: '44.1.54', android: '4.4.3',
    });
  });

  it('recognises Chrome on Android and on a desktop', () => {
    expect(parseUserAgent(CHROME_ANDROID)).toMatchObject({
      family: 'chrome', chromiumMajor: 141, android: '14', model: 'Pixel 7', desktopView: false,
    });
    expect(parseUserAgent(CHROME_DESKTOP)).toMatchObject({
      family: 'chrome', chromiumMajor: 141, android: null, desktopView: true,
    });
  });

  it('does not mistake Edge or Samsung Internet for Chrome', () => {
    expect(parseUserAgent(EDGE_ANDROID).family).toBe('edge');
    expect(parseUserAgent(SAMSUNG)).toMatchObject({
      family: 'samsung', chromiumMajor: 121, browserVersion: '25.0',
    });
  });

  it('gives no Chromium version for engines that are not Chromium', () => {
    expect(parseUserAgent(FIREFOX_ANDROID)).toMatchObject({
      family: 'firefox', chromiumMajor: null,
    });
    expect(parseUserAgent(SAFARI_IOS)).toMatchObject({
      family: 'safari', chromiumMajor: null, browserVersion: '17.4',
    });
  });

  it('does not read Chrome on iOS as a Chromium engine', () => {
    // CriOS is WebKit underneath. Treating 123 as a Chromium major would pass
    // the engine check for a browser whose engine is something else entirely.
    expect(parseUserAgent(CHROME_IOS)).toMatchObject({
      family: 'chrome', chromiumMajor: null,
    });
  });

  it('says unknown rather than guessing', () => {
    expect(parseUserAgent('')).toMatchObject({ family: 'unknown', chromiumMajor: null });
    expect(parseUserAgent('curl/8.4.0')).toMatchObject({ family: 'unknown' });
  });
});

describe('judging the engine against the theme', () => {
  it('passes at the floor and above it', () => {
    expect(engineVerdict(parseUserAgent(SILK_TABLET)).ok).toBe(true);
    expect(engineVerdict({
      ...parseUserAgent(CHROME_ANDROID), chromiumMajor: CHROMIUM_FLOOR,
    }).ok).toBe(true);
  });

  it('fails one version below it, and says what that looks like', () => {
    const verdict = engineVerdict({
      ...parseUserAgent(CHROME_ANDROID), chromiumMajor: CHROMIUM_FLOOR - 1,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/white page/);
  });

  it('fails an old Silk', () => {
    expect(engineVerdict(parseUserAgent(SILK_OLD)).ok).toBe(false);
  });

  it('declines to judge what it cannot', () => {
    // A wrong verdict is worse than none: it sends someone chasing a cause that
    // is not there. Firefox and Safari have their own floors.
    expect(engineVerdict(parseUserAgent(FIREFOX_ANDROID)).ok).toBeNull();
    expect(engineVerdict(parseUserAgent(SAFARI_IOS)).ok).toBeNull();
    expect(engineVerdict(parseUserAgent('')).ok).toBeNull();
  });

  it('describes a device in one line a person can paste', () => {
    expect(describeBrowser(parseUserAgent(SILK_TABLET)))
      .toBe('Silk 140.7.11 · Chromium 140 · Android 11 · KFTRWI');
    expect(describeBrowser(parseUserAgent(CHROME_ANDROID)))
      .toBe('Chrome 141.0.0.0 · Android 14 · Pixel 7');
    expect(describeBrowser(parseUserAgent(SILK_DESKTOP))).toMatch(/desktop view/);
  });
});

describe('reading a computed colour', () => {
  it('reads rgb in both the comma and the space syntax', () => {
    const comma = parseCssColor('rgb(13, 15, 20)')!;
    const space = parseCssColor('rgb(13 15 20)')!;
    expect(comma.lightness).toBeCloseTo(space.lightness, 10);
    expect(comma.lightness).toBeLessThan(0.2);
    expect(comma.alpha).toBe(1);
  });

  it('reads alpha in every syntax it can arrive in', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0)')!.alpha).toBe(0);
    expect(parseCssColor('rgb(0 0 0 / 0.25)')!.alpha).toBeCloseTo(0.25, 10);
    expect(parseCssColor('rgb(0 0 0 / 50%)')!.alpha).toBeCloseTo(0.5, 10);
    expect(parseCssColor('transparent')!.alpha).toBe(0);
  });

  it('puts black near 0 and white near 1', () => {
    expect(parseCssColor('rgb(0, 0, 0)')!.lightness).toBeCloseTo(0, 5);
    expect(parseCssColor('rgb(255, 255, 255)')!.lightness).toBeCloseTo(1, 3);
    expect(parseCssColor('#ffffff')!.lightness).toBeCloseTo(1, 3);
    expect(parseCssColor('#000')!.lightness).toBeCloseTo(0, 5);
  });

  it('reads oklch directly, which is how a modern browser returns the theme', () => {
    // The app's own ground. Browsers serialise a computed colour in the space it
    // was authored in, so a working theme arrives as oklch(), not rgb().
    expect(parseCssColor('oklch(0.155 0.008 265)')!.lightness).toBeCloseTo(0.155, 10);
    expect(parseCssColor('oklch(15.5% 0.008 265)')!.lightness).toBeCloseTo(0.155, 10);
    expect(parseCssColor('oklab(0.9 0 0 / 0.5)')).toMatchObject({ alpha: 0.5 });
  });

  it('does not swallow a channel of color(srgb …) as alpha', () => {
    // Four tokens, no alpha. Treating the fourth as alpha would read white as
    // semi-transparent.
    const white = parseCssColor('color(srgb 1 1 1)')!;
    expect(white.alpha).toBe(1);
    expect(white.lightness).toBeCloseTo(1, 3);
  });

  it('returns null for what it cannot read, never a guess', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('var(--color-ground)')).toBeNull();
    expect(parseCssColor('color(display-p3 1 0 0)')).toBeNull();
    expect(parseCssColor('rgb(a b c)')).toBeNull();
  });
});

describe('did the theme resolve', () => {
  it('passes the dark ground the app is built on', () => {
    expect(themeVerdict('oklch(0.155 0.008 265)').ok).toBe(true);
    expect(themeVerdict('rgb(13, 15, 20)').ok).toBe(true);
  });

  it('fails the signature of an engine that cannot read oklch()', () => {
    // An unresolved custom property falls back to `initial`, which for a
    // background is transparent. This is the failure the check exists for.
    const verdict = themeVerdict('rgba(0, 0, 0, 0)');
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/transparent/);
  });

  it('fails a white page', () => {
    expect(themeVerdict('rgb(255, 255, 255)').ok).toBe(false);
  });

  it('treats an unreadable colour as unresolved', () => {
    // Assuming fine here would make the check pass on exactly the browsers it
    // is there to catch.
    expect(themeVerdict('').ok).toBe(false);
    expect(themeVerdict('var(--color-ground)').ok).toBe(false);
  });

  it('draws its line where the design does', () => {
    // The shipped surfaces are all well under the threshold, so a legitimate
    // palette tweak does not trip the check.
    for (const lightness of [0.155, 0.205, 0.253, 0.318]) {
      expect(lightness).toBeLessThan(DARK_GROUND_MAX_LIGHTNESS + 0.03);
    }
    expect(themeVerdict('oklch(0.155 0.008 265)').ok).toBe(true);
    expect(themeVerdict(`oklch(${DARK_GROUND_MAX_LIGHTNESS + 0.05} 0 0)`).ok).toBe(false);
  });
});

describe('the pasteable report', () => {
  const rows = [
    { label: 'Viewport', value: '1280×688 @ 1.5x', status: 'info' as const },
    { label: 'Theme', value: 'NOT resolved', status: 'bad' as const, note: 'Background is transparent.' },
    { label: 'OPFS', value: 'available', status: 'good' as const, note: 'Where scores live.' },
    { label: 'Display mode', value: 'browser tab', status: 'warn' as const, note: 'Toolbar is showing.' },
  ];

  it('puts failures first, then warnings, then the rest', () => {
    // The row that explains the symptom is nearly always a failure, and it
    // should not be forty lines down a page someone is reading on a phone.
    const lines = formatProbeReport(rows).split('\n').filter((l) => l.startsWith('['));
    expect(lines.map((l) => l.slice(0, 6))).toEqual(['[FAIL]', '[warn]', '[ ok ]', '[info]']);
  });

  it('keeps the explanation for problems and drops it for rows that are fine', () => {
    const text = formatProbeReport(rows);
    expect(text).toContain('Background is transparent.');
    expect(text).toContain('Toolbar is showing.');
    expect(text).not.toContain('Where scores live.');
  });

  it('carries a header and a tally', () => {
    const text = formatProbeReport(rows, ['Screen: 1280×800']);
    expect(text.startsWith('Étude device report\nScreen: 1280×800')).toBe(true);
    expect(text.trimEnd().endsWith('1 bad, 1 warn, 1 good, 1 info')).toBe(true);
  });

  it('copes with nothing to report', () => {
    expect(formatProbeReport([])).toMatch(/no rows/);
  });
});
