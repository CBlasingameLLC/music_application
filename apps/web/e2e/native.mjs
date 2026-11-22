/**
 * The exported app, the way the Android app runs it.
 *
 * The smoke test drives the normal build over `next start`. The APK is a
 * different artefact: a static export, served by Capacitor's asset server inside
 * a WebView, with no service worker. Different build, different server,
 * different engine — so it gets its own check, and this is it.
 *
 *   TARGET=desktop (default)
 *       Chromium at the Fire tablet's shape, against `scripts/serve-export.mjs`,
 *       which reproduces the asset server's routing. Needs `pnpm build:native`
 *       and `pnpm serve:native` first. `window.Capacitor` is stubbed so the
 *       native code paths run. Fast, and catches almost everything that is the
 *       export's fault.
 *
 *   TARGET=android
 *       The real thing: attaches over adb to the WebView of the installed
 *       *debug* build (release builds are not debuggable, by design) on an
 *       emulator or a plugged-in tablet, and runs the same flows. This is what
 *       catches the failures that belong to the WebView, the manifest and the
 *       native routing rule, none of which exist on a desktop.
 *
 *   PHASE=read   (android) persistence across a restart. A normal run ends by
 *       planting a marker in IndexedDB; the caller then force-stops and relaunches
 *       the app and runs again with `PHASE=read`, which asserts the marker is
 *       still there. Progress surviving a restart is the whole point of an app
 *       that keeps everything on the device.
 *
 * Navigation is by tapping, deliberately. Almost every transition in the app is
 * a client-side route change, which is the path the export has to get right; the
 * handful of full page loads (deep link, reload) are tested separately and by
 * name, because they take a different path through the asset server.
 */

import { mkdirSync } from 'node:fs';
import { _android, chromium } from 'playwright';
import { DEFAULT_PROFILE, contextOptions } from './devices.mjs';

const TARGET = process.env.TARGET ?? 'desktop';
const PHASE = process.env.PHASE ?? 'all';
const APP_ID = process.env.APP_ID ?? 'app.etude.practice';
const OUT = process.env.ARTIFACT_DIR ?? 'e2e-artifacts/native';
const CHROME =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

// Capacitor's Android origin. Everything the app loads comes from here.
const BASE = TARGET === 'android' ? 'https://localhost' : (process.env.BASE_URL ?? 'http://127.0.0.1:3312');

const failures = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failures.push(m);
};
const check = (cond, pass, fail = pass) => (cond ? ok(pass) : bad(fail));

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Getting a page
// ---------------------------------------------------------------------------

let page;
let desktopContext = null;
let teardown = async () => {};

if (TARGET === 'android') {
  const [device] = await _android.devices();
  if (!device) {
    console.error('no Android device attached: `adb devices` is empty');
    process.exit(2);
  }
  console.log(`\n(android ${device.model()} ${device.serial()}, attaching to ${APP_ID})`);
  const webview = await device.webView({ pkg: APP_ID }, { timeout: 90_000 });
  page = await webview.page();
  teardown = async () => { await device.close(); };
} else {
  const browser = await chromium.launch(
    process.env.CHROME_PATH === '' ? {} : { executablePath: CHROME },
  );
  const context = await browser.newContext(contextOptions(DEFAULT_PROFILE, browser.version()));
  desktopContext = context;
  // Stand in for the bridge the native side injects, so the code that branches
  // on "am I the app" takes the app's branch.
  await context.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  });
  page = await context.newPage();
  console.log(`\n(desktop, emulating ${DEFAULT_PROFILE}, engine ${browser.version()}, ${BASE})`);
  teardown = async () => { await browser.close(); };
}

// What engine did the device give us? On an emulator this is the only look
// anyone gets at the WebView it actually ships with, so it is always printed.
let engineMajor = null;
if (TARGET === 'android') {
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => '');
  engineMajor = Number(/Chrome\/(\d+)/.exec(ua)?.[1] ?? 0) || null;
  console.log(`  info  WebView user agent: ${ua}`);
  console.log(`  info  WebView Chromium: ${engineMajor ?? 'unknown'} (the theme needs 111)`);
}

// On a loaded CI emulator the app can be attached to before its window is laid
// out, or while something else has the screen. A WebView in that state reports a
// 0x0 viewport and never fires animation frames, which Playwright's click waits
// on — so every check that follows fails for a reason that has nothing to do with
// what it checks. Wait for the page to be genuinely on screen, and say what the
// state was if it never is.
if (TARGET === 'android') {
  const state = () => page.evaluate(() => ({
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    size: [innerWidth, innerHeight],
  })).catch((error) => ({ error: String(error).split('\n')[0] }));
  let now = await state();
  for (let waited = 0; waited < 30_000 && !(now.visibility === 'visible' && now.size?.[0] > 0 && now.size?.[1] > 0); waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    now = await state();
  }
  console.log(`  info  page state: ${JSON.stringify(now)}`);
}

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});
page.on('requestfailed', (r) => {
  const reason = r.failure()?.errorText ?? 'unknown';
  // A request the page itself cancels is not a failure of the app. This suite
  // navigates constantly, and Next prefetches every link it can see, so each
  // navigation leaves prefetches in flight that the engine aborts — the first
  // real Android run reported nine of them and nothing else. Anything that
  // failed for a reason of its own (refused, not found, blocked, reset) still counts.
  if (reason === 'net::ERR_ABORTED') return;
  problems.push(`request failed: ${r.url()} (${reason})`);
});
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
});

const settle = (ms = 700) => page.waitForTimeout(ms);
const heading = () => page.locator('h1').first().textContent().catch(() => null);
const shot = (name) => page.screenshot({ path: `${OUT}/${TARGET}-${name}.png` }).catch(() => undefined);

/** Runs a named section, and reports a throw as a failure rather than aborting. */
async function section(title, body) {
  console.log(`\n== ${title} ==`);
  const before = problems.length;
  try {
    await body();
  } catch (error) {
    // The first line says what failed; the call log under it says why ("element
    // is not visible", "intercepts pointer events"), which is the part worth having.
    bad(`${title}: ${String(error).split('\n').slice(0, 8).join(' / ')}`);
  }
  const fresh = problems.slice(before);
  check(fresh.length === 0, 'no console errors, failed requests or 4xx/5xx',
    `${fresh.length} problem(s): ${fresh.slice(0, 10).join(' | ')}`);
}

try {
  if (TARGET === 'android' && engineMajor !== null && engineMajor < 111) {
    // An engine that cannot read the theme must be stopped at the door with an
    // explanation, not shown a black-on-white app. That is the guard's whole job,
    // and a real WebView that old is the one place it can be proved for real.
    await section('this WebView is too old for the theme', async () => {
      await page.waitForURL(/unsupported\.html$/, { timeout: 15_000 }).catch(() => undefined);
      const where = new URL(page.url()).pathname;
      check(where === '/unsupported.html', 'the app sent the user to the explanation page',
        `the app is at ${where}, not the explanation page`);
      const said = await page.locator('body').innerText();
      check(new RegExp(`Chromium ${engineMajor}\\. Étude needs 111`).test(said),
        'the page names the engine it found', said.slice(0, 160));
      await shot('unsupported');
    });
  } else if (PHASE === 'read') {
    await section('persistence across a restart', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      const stored = await page.evaluate(() => new Promise((resolve) => {
        const open = indexedDB.open('etude-native-e2e', 1);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('marker')) return resolve(null);
          const get = db.transaction('marker').objectStore('marker').get('written');
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => resolve(null);
        };
      }));
      check(stored === 'before-restart', 'IndexedDB marker survived the restart',
        `marker after restart: ${JSON.stringify(stored)}`);
    });
  } else {
    // ----------------------------------------------------------------------
    await section('boot', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle();
      check((await heading()) === 'Étude', 'home renders');

      const shell = await page.evaluate(() => ({
        native: window.Capacitor?.isNativePlatform?.() === true,
        platform: window.Capacitor?.getPlatform?.(),
        ua: navigator.userAgent,
        workers: 'serviceWorker' in navigator ? 'present' : 'absent',
      }));
      console.log(`  ua    ${shell.ua}`);
      check(shell.native && shell.platform === 'android', 'running as the native app (Capacitor, android)');

      const registrations = await page.evaluate(
        async () => (await navigator.serviceWorker?.getRegistrations?.() ?? []).length,
      );
      check(registrations === 0, 'no service worker registered',
        `${registrations} service worker(s) registered; the app bundles its files and must not cache them`);

      // Painted pixels, not a parsed string: a canvas resolves whatever colour
      // syntax the engine understands, and reads back black-with-no-alpha for
      // one it does not — the signature of a theme that failed to resolve.
      const ground = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const g = canvas.getContext('2d');
        g.fillStyle = getComputedStyle(document.body).backgroundColor;
        g.fillRect(0, 0, 1, 1);
        const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
        return { r, g: gr, b, a, css: getComputedStyle(document.body).backgroundColor };
      });
      check(ground.a === 255 && ground.r + ground.g + ground.b < 150,
        `theme resolved to a dark ground (${ground.css})`,
        `theme did not resolve: body background is ${ground.css} (rgba ${ground.r},${ground.g},${ground.b},${ground.a})`);

      if (TARGET === 'android') {
        // Borderless is the point of the app existing: the status bar and the
        // navigation buttons are hidden, so the page is the whole screen.
        const frame = await page.evaluate(() => ({
          screen: [screen.width, screen.height], inner: [innerWidth, innerHeight],
        }));
        const bars = Math.abs(frame.screen[1] - frame.inner[1]) + Math.abs(frame.screen[0] - frame.inner[0]);
        check(bars <= 4, `system bars are hidden: the page fills ${frame.inner.join('×')} of a ${frame.screen.join('×')} screen`,
          `the page is ${frame.inner.join('×')} on a ${frame.screen.join('×')} screen: ${bars}px of system bars are showing`);
      }

      const fullscreenButton = await page.getByTestId('enter-fullscreen').count();
      check(fullscreenButton === 0, 'no "Full screen" button: the app has no browser toolbar to hide',
        'a "Full screen" button is showing inside the app');
      await shot('home');
    });

    // ----------------------------------------------------------------------
    await section('client-side navigation', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      for (const [link, expected] of [
        ['Practice', 'Practice'], ['Skills', 'Progress'], ['Trends', 'Over time'], ['Today', 'Étude'],
      ]) {
        await page.getByRole('link', { name: link, exact: true }).first().click();
        await settle();
        check((await heading()) === expected, `${link} → "${expected}"`,
          `${link} → ${JSON.stringify(await heading())}, expected "${expected}"`);
      }
    });

    // ----------------------------------------------------------------------
    await section('every mode has a page', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await page.getByRole('link', { name: 'Practice', exact: true }).first().click();
      await settle();
      const hrefs = await page.$$eval('a[href^="/play/"]', (links) => [
        ...new Set(links.map((a) => a.getAttribute('href').split('?')[0])),
      ]);
      check(hrefs.length >= 8, `the Practice page links ${hrefs.length} drills`,
        `only ${hrefs.length} drill links found on Practice`);

      // Reached by tapping, not by URL: the route has to exist as a payload for
      // client navigation, and as a page for the reload below.
      for (const href of hrefs) {
        await page.goto(`${BASE}/practice/`, { waitUntil: 'networkidle' });
        await page.locator(`a[href="${href}"]`).first().click();
        await settle(500);
        const notFound = await page.getByText('This page could not be found').count();
        const landed = await page.evaluate(() => location.pathname);
        check(notFound === 0 && landed === href, `${href} opens`,
          `${href} → ${landed}${notFound ? ' (404 page)' : ''}`);
      }
    });

    // ----------------------------------------------------------------------
    await section('full page loads (deep link and reload)', async () => {
      // The asset server answers any path with no dot with the root page. The
      // app corrects that for directories; this proves it did.
      await page.goto(`${BASE}/library/`, { waitUntil: 'networkidle' });
      await settle();
      check((await heading()) === 'Library', 'a deep link lands on its own page',
        `/library/ shows ${JSON.stringify(await heading())}`);

      await page.reload({ waitUntil: 'networkidle' });
      await settle();
      check((await heading()) === 'Library', 'a reload stays on the page',
        `after reload /library/ shows ${JSON.stringify(await heading())}`);

      await page.goto(`${BASE}/play/chord-sprint/`, { waitUntil: 'networkidle' });
      await settle();
      const hydration = problems.filter((p) => /#418|#423|#425|hydrat/i.test(p));
      check(hydration.length === 0, 'a drill deep link hydrates cleanly',
        `hydration errors: ${hydration.join(' | ')}`);
      await shot('drill');

      // Not a page at all: the fallback is the home page, never an error page
      // and never a blank WebView.
      await page.goto(`${BASE}/no-such-page/`, { waitUntil: 'networkidle' }).catch(() => undefined);
      await settle();
      check((await page.locator('body').innerText()).trim().length > 0, 'an unknown path is not a blank page');
      problems.length = 0; // the unknown path is allowed to be noisy
    });

    // ----------------------------------------------------------------------
    // Desktop only: it needs an engine that can be told to fail, which a real
    // device cannot be asked to do on demand.
    if (desktopContext) {
      await section('an engine that cannot draw the theme', async () => {
        const old = await desktopContext.newPage();
        await old.addInitScript(() => {
          // What an engine without oklch() looks like to the page.
          const real = CSS.supports.bind(CSS);
          CSS.supports = (...args) => (/oklch/.test(String(args[0])) ? false : real(...args));
        });
        await old.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        await old.waitForURL(/unsupported\.html$/, { timeout: 10_000 }).catch(() => undefined);
        const where = new URL(old.url()).pathname;
        check(where === '/unsupported.html', 'is sent to the explanation page instead of a broken one',
          `ended up at ${where}`);
        const said = await old.locator('body').innerText();
        check(/needs a newer web engine/i.test(said) && /Chromium \d+\. Étude needs 111/.test(said),
          'the page says what is wrong and which engine it found', said.slice(0, 120));

        // The check can be wrong, and must not be able to lock someone out.
        await old.getByRole('link', { name: 'Try anyway' }).click();
        await old.waitForLoadState('networkidle');
        await old.waitForTimeout(700);
        check((await old.locator('h1').first().textContent()) === 'Étude',
          '"Try anyway" gets into the app, and the choice sticks');
        await old.close();
      });
    }

    // ----------------------------------------------------------------------
    await section('history', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await page.getByRole('link', { name: 'Practice', exact: true }).first().click();
      await settle();
      await page.getByRole('link', { name: 'Trends', exact: true }).first().click();
      await settle();
      await page.goBack();
      await settle();
      check((await heading()) === 'Practice', 'back returns to the previous page',
        `back → ${JSON.stringify(await heading())}`);
    });

    // ----------------------------------------------------------------------
    await section('diagnostics reports the app shell', async () => {
      await page.goto(`${BASE}/diagnostics/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => document.body.innerText.includes('App shell'),
        undefined, { timeout: 20_000 },
      ).catch(() => undefined);
      const text = await page.locator('body').innerText();
      check(/App shell/.test(text) && /Étude Android app/.test(text), 'App shell row says Étude Android app',
        'App shell row missing or wrong');
      check(/native app \(no browser around it\)/.test(text), 'Display mode reads as a native app');
      // Print what the device actually reported — in an emulator run this is the
      // only look anyone gets at the WebView's real version.
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const label of ['Browser', 'Engine', 'Viewport', 'CSS features', 'Theme', 'Input']) {
        const at = lines.indexOf(label);
        if (at >= 0) console.log(`  info  ${label}: ${(lines[at + 1] ?? '').slice(0, 150)}`);
      }
      await shot('diagnostics');
    });

    // ----------------------------------------------------------------------
    if (TARGET === 'android') {
      await section('persistence marker', async () => {
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => new Promise((resolve, reject) => {
          const open = indexedDB.open('etude-native-e2e', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('marker');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('marker', 'readwrite');
            tx.objectStore('marker').put('before-restart', 'written');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }));
        ok('marker written to IndexedDB');
      });
    }
  }
} finally {
  await teardown().catch(() => undefined);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nall native checks passed');
