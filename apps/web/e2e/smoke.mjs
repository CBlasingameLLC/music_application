/**
 * End-to-end smoke test.
 *
 * Runs the real app in Chromium at the target device's shape — a 10" tablet in
 * landscape, with touch — and drives it the way a person would.
 *
 * This exists because unit tests cannot catch the failures that actually matter
 * here. The on-screen keyboard was once silently swallowing every tap
 * (`releasePointerCapture` throws when the pointer is not captured) and the
 * diagnostics page hung blank forever (`AudioContext.resume()` never settles
 * under autoplay policy — it does not reject). Both typechecked. Both passed
 * every unit test. Only playing a chord for real found them.
 *
 * Usage:  pnpm build && pnpm start -p 3311 &  then  pnpm test:e2e
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3311';
const CHROME =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const failures = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failures.push(m);
};

const browser = await chromium.launch(
  process.env.CHROME_PATH === '' ? {} : { executablePath: CHROME },
);
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

try {
  console.log('\n== Today ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (await page.getByRole('heading', { name: 'Étude' }).isVisible()) ok('home renders');
  else bad('home heading missing');
  for (const label of ['Streak', 'Level', 'Today']) {
    if (await page.getByText(label, { exact: true }).first().isVisible()) ok(`stat: ${label}`);
    else bad(`stat missing: ${label}`);
  }
  if (await page.getByText('Independence').first().isVisible()) ok('domain bars render');
  else bad('domain bars missing');

  console.log('\n== Practice ==');
  await page.getByRole('link', { name: 'Start practising' }).click();
  await page.waitForURL('**/practice');
  await page.waitForTimeout(600);
  const begin = page.getByRole('button', { name: /^Begin —/ });
  if (await begin.isVisible()) ok(`session plan: ${(await begin.textContent()).trim()}`);
  else bad('session plan not built');

  console.log('\n== Chord Sprint, played correctly ==');
  await page.goto(`${BASE}/play/chord-sprint`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const keys = await page.locator('div[role="group"] button').all();
  const labels = await Promise.all(keys.map((k) => k.getAttribute('aria-label')));
  if (keys.length >= 20) ok(`keyboard rendered ${keys.length} keys`);
  else bad(`keyboard rendered only ${keys.length} keys`);

  const symbol = (await page.locator('span.font-bold.leading-none').first().textContent()).trim();
  ok(`prompt shows ${symbol}`);

  // Octave-3 voicings, which always fit the visible C3-C5 range.
  const voicings = {
    C: ['C3', 'E3', 'G3'], D: ['D3', 'F#3', 'A3'], E: ['E3', 'G#3', 'B3'],
    F: ['F3', 'A3', 'C4'], G: ['G3', 'B3', 'D4'], A: ['A3', 'C#4', 'E4'],
    B: ['B3', 'D#4', 'F#4'],
  };
  const want = voicings[symbol];
  if (!want) {
    bad(`no reference voicing for ${symbol} — extend the table`);
  } else {
    for (const note of want) {
      const idx = labels.indexOf(note);
      if (idx >= 0) await keys[idx].tap();
      else bad(`key ${note} not on screen`);
    }
    await page.waitForTimeout(250);
    const counter = (await page.locator('.tabular.text-lg').first().textContent()).trim();
    if (counter === `${want.length} / ${want.length}`) ok(`all ${want.length} taps registered`);
    else bad(`taps not registered: counter reads ${counter}`);

    await page.getByRole('button', { name: 'Check' }).click();
    await page.waitForTimeout(500);
    const feedback = (await page.locator('[role="status"]').textContent()).trim();
    if (feedback.startsWith('✓')) ok(`correct chord accepted: ${feedback}`);
    else bad(`correct chord rejected: ${feedback}`);
  }

  console.log('\n== A wrong answer gives specific feedback ==');
  await page.goto(`${BASE}/play/key-signature-blitz`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const choices = await page.locator('button.tap.rounded-xl.border').all();
  if (choices.length >= 2) ok(`${choices.length} choices offered`);
  else bad('no choices rendered');
  await choices[0].click();
  await page.waitForTimeout(500);
  const fb = (await page.locator('[role="status"]').textContent()).trim();
  if (fb.length > 2) ok(`feedback: ${fb.replace(/Next$/, '')}`);
  else bad('no feedback after answering');

  console.log('\n== Attempts persist ==');
  await page.waitForTimeout(500);
  const events = await page.evaluate(async () => {
    const req = indexedDB.open('etude');
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const store = db.transaction(['events'], 'readonly').objectStore('events');
    return new Promise((res) => {
      const r = store.count();
      r.onsuccess = () => res(r.result);
    });
  });
  if (events >= 3) ok(`${events} events in IndexedDB`);
  else bad(`expected at least 3 events, found ${events}`);

  console.log('\n== Free Play live analysis ==');
  await page.goto(`${BASE}/play/free`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (await page.getByText('Free Play').first().isVisible()) ok('free play renders');
  else bad('free play missing');

  {
    const fpKeys = await page.locator('div[role="group"] button').all();
    const fpLabels = await Promise.all(fpKeys.map((k) => k.getAttribute('aria-label')));

    const playChord = async (notes, holdMs) => {
      for (const [j, n] of notes.entries()) {
        const i = fpLabels.indexOf(n);
        if (i >= 0) {
          // Distinct pointer ids: real multi-touch gives each finger its own,
          // and reusing one would release the previous note.
          await fpKeys[i].dispatchEvent('pointerdown', { pointerId: 30 + j, isPrimary: j === 0 });
        } else bad(`free play: key ${n} not on screen`);
      }
      await page.waitForTimeout(holdMs);
    };
    const releaseChord = async (notes) => {
      for (const [j, n] of notes.entries()) {
        const i = fpLabels.indexOf(n);
        if (i >= 0) await fpKeys[i].dispatchEvent('pointerup', { pointerId: 30 + j, isPrimary: j === 0 });
      }
      await page.waitForTimeout(140);
    };

    // Play a ii-V-I and resolve onto the tonic, which is what tells the
    // analyzer where home is.
    for (const chord of [['D4', 'F4', 'A4'], ['G3', 'B3', 'D4', 'F4'], ['C4', 'E4', 'G4']]) {
      await playChord(chord, 420);
      await releaseChord(chord);
    }
    await playChord(['C4', 'E4', 'G4'], 900);

    const readout = await page.getByTestId('analyzer-readout').innerText();
    const firstLine = readout.split('\n')[0] ?? '';
    if (/^C$/.test(firstLine.trim())) ok(`analyzer named the chord: ${firstLine}`);
    else bad(`analyzer did not name C major, showed: ${JSON.stringify(firstLine)}`);

    // The Roman numeral is the part that transfers to the next song you try to
    // work out, so it is worth guarding, not just the chord name.
    if (/\bI\b/.test(readout) && /C major/.test(readout)) {
      ok('analyzer inferred the key and numeral: I in C major');
    } else {
      bad(`analyzer did not infer I in C major, showed: ${JSON.stringify(readout.slice(0, 120))}`);
    }
  }

  console.log('\n== Sight-Read Sprint ==');
  await page.goto(`${BASE}/play/sight-read`, { waitUntil: 'networkidle' });
  await page.getByTestId('reading-question').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);

  {
    const staff = page.getByTestId('score-view');
    const svgNodes = await staff.locator('svg *').count();
    if (svgNodes > 30) ok(`engraved staff rendered (${svgNodes} svg nodes)`);
    else bad(`staff did not engrave, only ${svgNodes} svg nodes`);

    const box = await staff.boundingBox();
    // Read from a music stand at arm's length: a staff squeezed into a corner
    // is the failure mode that matters here.
    if (box && box.width > 600 && box.height > 200) ok(`staff sized for reading: ${Math.round(box.width)}x${Math.round(box.height)}`);
    else bad(`staff too small to read: ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'none'}`);

    // Play the notated phrase, using the expected sequence the page exposes.
    const expected = (await page.getByTestId('reading-question').getAttribute('data-expected'))
      .split(',').filter(Boolean).map(Number);
    if (expected.length > 0) ok(`phrase has ${expected.length} notes`);
    else bad('phrase exposed no notes');

    const srKeys = await page.locator('div[role="group"] button').all();
    const srLabels = await Promise.all(srKeys.map((k) => k.getAttribute('aria-label')));
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const nameOf = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

    let offScreen = 0;
    for (const midi of expected) {
      const i = srLabels.indexOf(nameOf(midi));
      if (i >= 0) await srKeys[i].tap();
      else offScreen += 1;
    }
    if (offScreen === 0) ok('every notated pitch was reachable on the keyboard');
    else bad(`${offScreen} notated pitches were off-screen`);

    const progress = (await page.locator('[data-testid="reading-question"] .tabular').first().innerText()).trim();
    if (progress === `${expected.length} / ${expected.length}`) ok(`cursor followed the whole phrase: ${progress}`);
    else bad(`cursor did not follow: ${progress}`);

    await page.getByRole('button', { name: /Finish|Check/ }).click();
    await page.waitForTimeout(600);
    const verdict = (await page.locator('[role="status"]').innerText()).trim();
    if (verdict.startsWith('✓')) ok(`correct read accepted: ${verdict.replace(/\n/g, ' ')}`);
    else bad(`correct read rejected: ${verdict.replace(/\n/g, ' ')}`);
  }

  console.log('\n== Library: import round-trip ==');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  {
    for (const title of ['Ode to Joy', 'Contrary Motion Study', 'Two Against One']) {
      if (await page.getByText(title).first().isVisible()) ok(`bundled piece listed: ${title}`);
      else bad(`bundled piece missing: ${title}`);
    }
    if (await page.getByText(/PD-composition/).first().isVisible()) ok('licence shown for bundled pieces');
    else bad('licence not shown');

    // A minimal MuseScore-shaped export, uploaded as a real file.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Imported Test Piece</work-title></work>
  <identification><creator type="composer">A. Composer</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

    await page.setInputFiles('input[type="file"]', {
      name: 'test-piece.musicxml',
      mimeType: 'application/xml',
      buffer: Buffer.from(xml, 'utf-8'),
    });
    await page.waitForTimeout(1800);

    if (await page.getByText('Imported Test Piece').first().isVisible()) {
      ok('imported score appears in the library');
    } else bad('imported score did not appear');

    if (await page.getByText('private to this device').first().isVisible()) {
      ok('import is marked private by default');
    } else bad('import was not marked private');

    const previewNodes = await page.getByTestId('score-view').locator('svg *').count();
    if (previewNodes > 20) ok(`imported score engraved (${previewNodes} svg nodes)`);
    else bad(`imported score did not engrave, ${previewNodes} svg nodes`);

    // It must survive a reload — the point of storing it on the device.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    if (await page.getByText('Imported Test Piece').first().isVisible()) {
      ok('imported score persists across a reload');
    } else bad('imported score did not persist');
  }

  console.log('\n== MIDI status is explicit about why ==');
  await page.goto(`${BASE}/diagnostics`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const midiPanel = await page.getByText('MIDI keyboard').first().isVisible();
  if (midiPanel) ok('MIDI connection panel present');
  else bad('MIDI connection panel missing');
  if (await page.getByText('Timing calibration').first().isVisible()) ok('latency calibration present');
  else bad('latency calibration missing');

  console.log('\n== Progress map ==');
  await page.goto(`${BASE}/map`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if (await page.getByRole('heading', { name: 'Progress' }).isVisible()) ok('map renders');
  else bad('map missing');

  console.log('\n== Diagnostics ==');
  await page.goto(`${BASE}/diagnostics`, { waitUntil: 'networkidle' });
  // Probes only settle after the audio timeout; wait on content, not a clock.
  await page.getByRole('button', { name: 'Re-run probes' }).waitFor({ timeout: 20000 });
  const probes = await page.getByTestId('device-probes').textContent();
  for (const key of [
    'Web MIDI', 'Output latency', 'getOutputTimestamp',
    'Persistent storage', 'OPFS', 'Service worker',
  ]) {
    if (probes.includes(key)) ok(`probe: ${key}`);
    else bad(`probe missing: ${key}`);
  }

  console.log('\n== Independence Lab ==');
  await page.goto(`${BASE}/play/independence`, { waitUntil: 'networkidle' });
  {
    // ind3 is Two against one — the first rung where the hands genuinely
    // disagree, so the first one where entrainment is measurable at all.
    await page.getByTestId('rung-ind3').click();
    await page.getByTestId('new-exercise').click();
    await page.waitForTimeout(1200);

    const staff = await page.locator('[data-testid="independence-score"] svg').count();
    if (staff > 0) ok('exercise engraved on two staves');
    else bad('no staff rendered for the exercise');

    const expected = (await page.getByTestId('independence-score')
      .getAttribute('data-expected')).split(',').filter(Boolean);
    if (expected.length > 0) ok(`exercise has ${expected.length} onsets`);
    else bad('exercise exposed no expected notes');

    const keys = await page.locator('div[role="group"] button').all();
    const labels = await Promise.all(keys.map((k) => k.getAttribute('aria-label')));
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const nameOf = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

    // Actually play it. A test that only checks a staff appeared cannot tell a
    // working grader from one that returns the same verdict whatever it gets.
    await page.getByTestId('start-take').click();
    let offKeyboard = 0;
    for (const cluster of expected) {
      for (const midi of cluster.split('+').map(Number)) {
        const i = labels.indexOf(nameOf(midi));
        if (i >= 0) await keys[i].tap();
        else offKeyboard += 1;
      }
      await page.waitForTimeout(200);
    }
    await page.getByTestId('finish-take').click();
    await page.waitForTimeout(1200);

    if (offKeyboard === 0) ok('every notated pitch was reachable on screen');
    else bad(`${offKeyboard} notated pitches fell outside the keyboard`);

    const verdict = (await page.getByTestId('independence-verdicts').innerText()).trim();
    if (/held/.test(verdict)) ok('a correctly played exercise reports independence held');
    else bad(`played correctly but reported: ${JSON.stringify(verdict.slice(0, 120))}`);

    const percent = Number((verdict.match(/(\d+)%/) ?? [])[1] ?? 0);
    if (percent >= 70) ok(`scored ${percent}% on a correct take`);
    else bad(`a correct take scored only ${percent}%`);

    // The microphone fallback exists and discloses what it can and cannot
    // grade. It is not exercised here — a headless container has no piano to
    // listen to — but its presence and its caveat are checkable.
    const micButton = await page.getByTestId('toggle-mic').count();
    if (micButton > 0) ok('microphone fallback is offered');
    else bad('no microphone option on the Lab');

    // The dynamics rung must say so rather than inventing a number, because a
    // touchscreen reports the same nominal velocity for every note.
    await page.getByTestId('rung-ind7').click();
    await page.waitForTimeout(300);
    const body = await page.locator('body').innerText();
    if (/needs\s+a MIDI keyboard/.test(body)) {
      ok('the dynamics rung says it cannot measure dynamics from a touchscreen');
    } else {
      bad('the dynamics rung did not disclose that velocity is unavailable');
    }
  }

  console.log('\n== Grader inspector ==');
  await page.goto(`${BASE}/diagnostics/grader`, { waitUntil: 'networkidle' });
  await page.getByTestId('grader-findings').waitFor({ timeout: 15000 });

  {
    const clean = (await page.getByTestId('grader-findings').innerText()).trim();
    if (/Clean take/.test(clean)) ok('a perfect take reports nothing to fix');
    else bad(`perfect take reported: ${JSON.stringify(clean.slice(0, 90))}`);

    // Switching the injected fault must change what the grader says. A metric
    // that reads the same regardless is measuring nothing.
    await page.getByRole('button', { name: 'Losing your place' }).click();
    await page.waitForTimeout(400);
    const hesitated = (await page.getByTestId('grader-findings').innerText()).trim();
    if (/stopped to think/.test(hesitated)) ok('a hesitation is located and named');
    else bad(`hesitation not reported: ${JSON.stringify(hesitated.slice(0, 90))}`);

    await page.getByRole('button', { name: 'Speeding up' }).click();
    await page.waitForTimeout(400);
    const drifting = (await page.getByTestId('grader-findings').innerText()).trim();
    if (/speeding up/.test(drifting)) ok('tempo drift is detected as drift, not as lateness');
    else bad(`drift not reported: ${JSON.stringify(drifting.slice(0, 90))}`);

    // Drift and wobble are different faults, and the inspector has to tell
    // them apart: a smooth accelerando is steady while it moves, a wandering
    // pulse moves without going anywhere. Keying either on raw tempo variation
    // conflates them, which is the bug this preset exists to catch.
    await page.getByRole('button', { name: 'Wandering pulse' }).click();
    await page.waitForTimeout(400);
    const wobbling = (await page.getByTestId('grader-findings').innerText()).trim();
    if (/unsteady/.test(wobbling) && !/speeding up|slowing down/.test(wobbling)) {
      ok('a wandering pulse reads as unsteadiness, not as drift');
    } else {
      bad(`wobble misreported: ${JSON.stringify(wobbling.slice(0, 120))}`);
    }

    await page.getByRole('button', { name: 'A missed note' }).click();
    await page.waitForTimeout(400);
    const metrics = (await page.getByTestId('grader-metrics').innerText()).trim();
    if (/1 missed/.test(metrics)) ok('a dropped note is reported as exactly one missed note');
    else bad(`dropped note not isolated: ${JSON.stringify(metrics.slice(0, 120))}`);

    await page.getByRole('button', { name: 'Human but clean' }).click();
    await page.waitForTimeout(400);
    const human = (await page.getByTestId('grader-findings').innerText()).trim();
    // Melody lead is expert behaviour; faulting it would train the wrong thing.
    if (!/unevenly/.test(human)) ok('expert melody lead is not faulted');
    else bad(`melody lead was faulted: ${JSON.stringify(human.slice(0, 90))}`);
  }

  console.log('\n== Console ==');
  const real = consoleErrors.filter((e) => !/favicon|DevTools/i.test(e));
  if (real.length === 0) ok('no console errors');
  else real.slice(0, 5).forEach((e) => bad(`console: ${e.slice(0, 160)}`));
} finally {
  await browser.close();
}

console.log(
  `\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
