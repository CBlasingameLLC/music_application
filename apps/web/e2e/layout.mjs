/**
 * Layout lint across emulated Android devices.
 *
 * The smoke test asks "does it work". This asks "does it fit": at the sizes real
 * devices actually hand the app, is anything wider than the screen, too small to
 * hit, hidden under the bottom bar, or painted in a colour that did not resolve.
 * Those are the failures that make an app look wrong without being broken, and
 * none of them show up on a desktop window.
 *
 * Read `devices.mjs` first for what emulation can and cannot see. In short:
 * this is the real engine at a device's size, not a device's engine — it catches
 * layout bugs and cannot catch an old browser, Android fonts, or how Silk
 * launches an installed app.
 *
 *   node e2e/layout.mjs                     every profile, every route
 *   DEVICE=fire-hd-10,pixel-7 node e2e/layout.mjs
 *   node e2e/layout.mjs --verbose           also list every small target
 *
 * Full-page screenshots land in `e2e-artifacts/<profile>/`, because a number
 * saying "overflows by 40px" is a clue and a picture is an answer.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { PROFILES, contextOptions, profileNames } from './devices.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3311';
const CHROME =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.ARTIFACT_DIR ?? 'e2e-artifacts';
const VERBOSE = process.argv.includes('--verbose');

// WCAG 2.2 SC 2.5.8 makes 24 CSS px the AA minimum for a target, which is a
// failure here. The app's own rule is 48, and Android's guidance is 48dp, so
// anything under 44 is reported as a warning rather than silently accepted.
const TARGET_FAIL_BELOW = 24;
const TARGET_WARN_BELOW = 44;

const wanted = (process.env.DEVICE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const names = wanted.length > 0 ? wanted : profileNames();

const ROUTES = [
  { path: '/', name: 'today' },
  { path: '/practice', name: 'practice' },
  { path: '/map', name: 'skills' },
  { path: '/progress', name: 'trends' },
  { path: '/library', name: 'library' },
  {
    path: '/diagnostics', name: 'diagnostics',
    ready: '[data-testid="device-probes"] > div',
  },
  {
    path: '/play/repertoire?piece=ode-to-joy', name: 'repertoire',
    ready: '[data-testid="repertoire-score"] svg',
  },
  { path: '/play/independence', name: 'independence' },
  { path: '/play/chord-sprint', name: 'drill' },
  { path: '/play/free', name: 'free-play' },
];

/**
 * Runs inside the page. Everything it reports is something measured from the
 * rendered DOM, not inferred from class names — a Tailwind utility that looks
 * right and does nothing is exactly the kind of bug this is for.
 */
function inspectInPage({ failBelow, warnBelow }) {
  const vw = window.innerWidth;

  const describe = (el) => {
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  // Content inside a scroll container is *meant* to be wider than the page.
  const insideScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
    }
    return false;
  };

  // --- 1. Horizontal overflow ------------------------------------------------
  const overflowBy = document.documentElement.scrollWidth - vw;
  const culprits = [];
  if (overflowBy > 1) {
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const right = el.getBoundingClientRect().right;
      if (right > vw + 1 && !insideScroller(el)) {
        culprits.push(`${describe(el)} reaches ${Math.round(right)}px of ${vw}px`);
        if (culprits.length >= 4) break;
      }
    }
  }

  // --- 2. Tap targets --------------------------------------------------------
  // Piano keys and chart columns are narrow by nature, and each is one of dozens
  // in a control that is itself the target.
  const exempt =
    '[role="group"] button, [data-testid="practice-chart"] button, '
    + '[data-testid="timing-distribution"] button';
  const targets = [];
  const selector =
    'button, a[href], [role="button"], summary, select, textarea, input:not([type="hidden"])';
  for (const el of document.querySelectorAll(selector)) {
    if (el.matches(exempt) || !visible(el)) continue;
    // A checkbox inside a label is hit through the label, which is the real
    // target: measuring the 13px box would flag a control that works fine.
    const hit = el.matches('input') && el.closest('label') ? el.closest('label') : el;
    const r = hit.getBoundingClientRect();
    const smaller = Math.min(r.width, r.height);
    if (smaller < warnBelow) {
      targets.push({
        what: describe(hit),
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        fail: smaller < failBelow,
      });
    }
  }

  // --- 3. The fixed bottom bar must not sit on the last of the content --------
  let navOverlap = null;
  const nav = document.querySelector('nav.fixed');
  if (nav && visible(nav)) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const navTop = nav.getBoundingClientRect().top;
    let lowest = 0;
    let lowestEl = null;
    for (const el of document.querySelectorAll('main *')) {
      if (!visible(el) || nav.contains(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const bottom = el.getBoundingClientRect().bottom;
      if (bottom > lowest) { lowest = bottom; lowestEl = el; }
    }
    if (lowestEl && lowest > navTop + 1) {
      navOverlap = { by: Math.round(lowest - navTop), what: describe(lowestEl) };
    }
    window.scrollTo(0, 0);
  }

  // --- 4. Did the theme resolve ----------------------------------------------
  // Painted through a canvas rather than parsed, so any colour syntax the engine
  // understands is handled by the engine itself. The canvas starts white: a
  // colour the engine cannot read leaves it white and fails, where starting from
  // black would make an unreadable colour pass as "dark".
  const bg = getComputedStyle(document.body).backgroundColor;
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  const luminance = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
  const transparent = /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|^transparent$/.test(bg);

  // The precondition for everything above: that this is being judged as the
  // touch device it claims to be. See `openPage` for how this once was not.
  const touch = navigator.maxTouchPoints > 0
    && window.matchMedia('(pointer: coarse)').matches
    && !window.matchMedia('(hover: hover)').matches;

  return {
    vw, vh: window.innerHeight, overflowBy, culprits, targets, navOverlap, touch,
    theme: { ok: !transparent && luminance < 0.1, bg, luminance },
  };
}

/**
 * Each check is broken on purpose and must notice.
 *
 * A lint that has only ever passed has proven nothing: a selector that matches
 * nothing and a threshold that nothing can cross look exactly like a clean app.
 * So before any real route is judged, a known-bad change is made to a real page
 * and the lint has to flag it. If it does not, the lint is what is broken and
 * the run stops.
 */
const SELF_TESTS = [
  {
    what: 'horizontal overflow',
    break: () => {
      const wide = document.createElement('div');
      wide.style.cssText = 'width:4000px;height:10px';
      document.querySelector('main').appendChild(wide);
    },
    caught: (f) => f.overflowBy > 1 && f.culprits.length > 0,
  },
  {
    what: 'the bottom bar covering content',
    break: () => {
      const main = document.querySelector('main');
      main.style.paddingBottom = '0';
      const tall = document.createElement('div');
      tall.style.cssText = 'height:3000px';
      main.appendChild(tall);
    },
    caught: (f) => f.navOverlap !== null,
  },
  {
    what: 'a theme that did not resolve',
    break: () => { document.body.style.background = 'transparent'; },
    caught: (f) => f.theme.ok === false,
  },
  {
    what: 'a page that is not being judged as a touch device',
    break: () => {
      // Cannot switch emulation off from inside the page, so shadow the
      // property the check reads — the same observable symptom.
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    },
    caught: (f) => f.touch === false,
  },
  {
    what: 'a target too small to hit',
    break: () => {
      const tiny = document.createElement('button');
      tiny.textContent = 'x';
      tiny.style.cssText = 'width:10px;height:10px;padding:0';
      document.querySelector('main').appendChild(tiny);
    },
    caught: (f) => f.targets.some((t) => t.fail),
  },
];

async function selfTest(browser, profileName) {
  const ctx = await browser.newContext(contextOptions(profileName, browser.version()));
  const page = await ctx.newPage();
  const missed = [];
  for (const test of SELF_TESTS) {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.evaluate(test.break);
    const found = await page.evaluate(inspectInPage, {
      failBelow: TARGET_FAIL_BELOW, warnBelow: TARGET_WARN_BELOW,
    });
    if (!test.caught(found)) missed.push(test.what);
  }
  await ctx.close();
  return missed;
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME_PATH === '' ? {} : { executablePath: CHROME },
);

console.log('\n== self-test ==');
const missed = await selfTest(browser, names[0]);
if (missed.length > 0) {
  console.log(`  FAIL  the lint did not notice: ${missed.join(', ')}`);
  console.log('\nThe lint itself is broken; its results mean nothing until that is fixed.\n');
  await browser.close();
  process.exit(2);
}
console.log(`  ok    notices ${SELF_TESTS.map((t) => t.what).join(', ')}`);

/** Failures in a blocking profile fail the run; the rest are only reported. */
const blockingFailures = [];
const informational = [];
let checked = 0;

for (const name of names) {
  const profile = PROFILES[name];
  if (!profile) {
    console.log(`unknown profile "${name}" — known: ${profileNames().join(', ')}`);
    process.exit(2);
  }

  const options = contextOptions(name, browser.version());
  const ctx = await browser.newContext(options);
  const consoleErrors = [];

  /**
   * A fresh page, every time.
   *
   * Reusing one page across routes is a trap: a `fullPage` screenshot silently
   * switches touch emulation off for that page, so `pointer: coarse` becomes
   * `fine`, `hover: none` becomes `hover`, and `maxTouchPoints` drops to 0 —
   * measured, not assumed. Every route after the first was then being judged as
   * a mouse device, and Tailwind v4 only applies its `hover:` styles under
   * `(hover: hover)`, so the lint was looking at a different app than a tablet
   * runs. A page opened afterwards in the same context is unaffected.
   */
  const openPage = async () => {
    const fresh = await ctx.newPage();
    fresh.on('pageerror', (e) => consoleErrors.push(String(e)));
    fresh.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    return fresh;
  };

  const { width, height } = options.viewport;
  console.log(
    `\n== ${name} — ${profile.label} ==\n   ${width}×${height} @ ${options.deviceScaleFactor}x`
    + `${profile.blocking ? '' : '   (informational: does not fail the run)'}`,
  );
  mkdirSync(`${OUT}/${name}`, { recursive: true });

  const record = (route, severity, message) => {
    const line = `${name} ${route.path}: ${message}`;
    if (severity === 'fail') (profile.blocking ? blockingFailures : informational).push(line);
    console.log(`  ${severity === 'fail' ? 'FAIL' : 'warn'}  ${route.path.padEnd(34)} ${message}`);
  };

  for (const route of ROUTES) {
    checked += 1;
    consoleErrors.length = 0;
    let problems = 0;
    const page = await openPage();

    const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
    if (!response || !response.ok()) {
      record(route, 'fail', `HTTP ${response ? response.status() : 'no response'}`);
      await page.close();
      continue;
    }
    if (route.ready) {
      await page.waitForSelector(route.ready, { timeout: 15000 }).catch(() => {
        problems += 1;
        record(route, 'fail', `never became ready (${route.ready})`);
      });
    }
    await page.waitForTimeout(500);

    const found = await page.evaluate(inspectInPage, {
      failBelow: TARGET_FAIL_BELOW, warnBelow: TARGET_WARN_BELOW,
    });

    if (!found.touch) {
      problems += 1;
      record(route, 'fail',
        'touch emulation is off, so this page was judged as a mouse device — the result means nothing');
    }
    if (found.overflowBy > 1) {
      problems += 1;
      record(route, 'fail',
        `the page is ${found.overflowBy}px wider than the screen — ${found.culprits.join('; ') || 'culprit not found'}`);
    }
    if (found.navOverlap) {
      problems += 1;
      record(route, 'fail',
        `the bottom bar covers the last ${found.navOverlap.by}px of content (${found.navOverlap.what})`);
    }
    if (!found.theme.ok) {
      problems += 1;
      record(route, 'fail',
        `the theme did not resolve — background ${found.theme.bg}, lightness ${found.theme.luminance.toFixed(2)}`);
    }
    for (const t of found.targets.filter((x) => x.fail)) {
      problems += 1;
      record(route, 'fail', `target too small to hit: ${t.what} is ${t.size}px`);
    }
    for (const message of consoleErrors.slice(0, 3)) {
      problems += 1;
      record(route, 'fail', `console error: ${message.slice(0, 120)}`);
    }

    const small = found.targets.filter((x) => !x.fail);
    if (small.length > 0 && VERBOSE) {
      for (const t of small) record(route, 'warn', `small target: ${t.what} is ${t.size}px`);
    } else if (small.length > 0) {
      record(route, 'warn',
        `${small.length} target${small.length === 1 ? '' : 's'} under ${TARGET_WARN_BELOW}px `
        + `(e.g. ${small[0].what} ${small[0].size}) — run with --verbose for all`);
    }

    if (problems === 0 && small.length === 0) {
      console.log(`  ok    ${route.path}`);
    }

    // What the person sees on arrival — the viewport, with the bottom bar where
    // it really sits.
    await page.screenshot({ path: `${OUT}/${name}/${route.name}.png` });
    // And the whole page. A fixed element in a stitched full-page capture is
    // drawn once at its viewport position, which lands it mid-page and reads as
    // an overlap bug that is not there, so the bar is made static for this shot.
    await page.addStyleTag({ content: 'nav.fixed { position: static !important; }' });
    await page.screenshot({ path: `${OUT}/${name}/${route.name}-full.png`, fullPage: true });
    await page.close();
  }

  // --- Installability, once per profile --------------------------------------
  // The closest thing a headless run has to "would a browser treat this as an
  // installable app". It is Chromium's answer, not Silk's — Silk's install flow
  // is exactly what this cannot see — but a manifest Chromium rejects is a
  // manifest nothing will install, so a failure here is real.
  try {
    const page = await openPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Page.enable');
    const manifest = await cdp.send('Page.getAppManifest');
    const install = await cdp.send('Page.getInstallabilityErrors');
    const critical = (manifest.errors ?? []).filter((e) => e.critical);
    const route = { path: '(manifest)' };
    for (const e of critical) record(route, 'fail', `manifest error: ${e.message}`);
    // `in-incognito` is a property of the harness, not the app: Playwright's
    // contexts are non-persistent, which Chromium treats as incognito, so it is
    // reported on every page whatever the manifest says. Counting it would make
    // this check fail permanently and teach everyone to ignore it.
    const errors = (install.installabilityErrors ?? []).filter((e) => e.errorId !== 'in-incognito');
    for (const e of errors) {
      record(route, 'fail', `not installable: ${e.errorId}`);
    }
    if (critical.length === 0 && errors.length === 0) {
      console.log('  ok    (manifest)                         installable by Chromium\'s criteria');
    }
  } catch (error) {
    console.log(`  warn  (manifest)                         could not query installability: ${error.message}`);
  }

  await ctx.close();
}

await browser.close();

console.log(`\n${checked} page${checked === 1 ? '' : 's'} checked, screenshots in ${OUT}/`);
if (informational.length > 0) {
  console.log(`\n${informational.length} problem${informational.length === 1 ? '' : 's'} on informational profiles (not failing the run):`);
  for (const line of informational) console.log(`  - ${line}`);
}
if (blockingFailures.length > 0) {
  console.log(`\n${blockingFailures.length} PROBLEM(S) ON BLOCKING PROFILES:`);
  for (const line of blockingFailures) console.log(`  - ${line}`);
  process.exit(1);
}
console.log('\nLAYOUT CHECKS PASSED\n');
