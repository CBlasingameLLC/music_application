# Testing against Android, headless

Étude's target is an Amazon Fire HD 10 running Silk. There is no way to run
*Silk* headless, so "test it on Android" is really four different things, each
catching different bugs. This page says which is which, so a green run is not
mistaken for a tested device.

| | What it is | Catches | Cannot catch | Runs here | Built |
|---|---|---|---|---|---|
| **1. Emulated profile** | Playwright's Chromium at a device's size, pixel ratio, touch and UA | Overflow, targets too small, content under the bottom bar, wrong sizing | Old engines, Android fonts, system bars, Silk's install flow | yes, ~2 min | **yes** |
| **2. On-device probes** | `/diagnostics` run on the real tablet | Engine too old, theme not resolving, how the app was launched, whether full screen works | Nothing — it *is* the device — but needs a person holding it | n/a | **yes** |
| **3. Android emulator** | Headless AVD (`-no-window`) running the **APK** — the app in a real Android WebView | Real fonts and system bars, the WebView's own engine, the APK's manifest and routing, data surviving a restart | Silk; Amazon's WebView; installing a PWA | **no** — no `/dev/kvm`; it runs in CI | **yes**, in CI |
| **4. Real device** | The tablet, driven over `adb` | Everything, including Silk | — | n/a | runbook below |

For Apple the analogue of (1) is Playwright's WebKit build and of (3) is Xcode's
Simulator, which is macOS-only. This repo runs Chromium only; there is no
WebKit coverage yet.

## Running tier 1

```bash
pnpm --filter @etude/web build && pnpm --filter @etude/web start -p 3311 &

pnpm --filter @etude/web test:e2e                    # smoke flows, as a Fire HD 10
DEVICE=galaxy-tab-s9 pnpm --filter @etude/web test:e2e   # same flows, another tablet
pnpm --filter @etude/web test:layout                 # every route × six devices
DEVICE=fire-hd-10 pnpm --filter @etude/web test:layout -- --verbose
```

Profiles live in `devices.mjs`. **Tablet profiles fail the run; phone profiles
are reported without failing it**, because the app is built for a landscape
tablet. Screenshots land in `e2e-artifacts/<profile>/` (gitignored, uploaded by
CI): `<route>.png` is what you see on arrival, `<route>-full.png` the whole page.

`layout.mjs` checks, from the rendered DOM rather than from class names: no
horizontal overflow, no target under 24 px (warning under 44), nothing hidden
under the fixed bottom bar, the dark theme resolved, touch emulation actually on,
and that Chromium considers the manifest installable. **It breaks each of those
on purpose first and refuses to run if it does not notice** — a lint that has
only ever passed has proven nothing.

### Two traps this has already fallen into

- A `fullPage` screenshot **silently turns touch emulation off** for that page
  (`pointer: coarse` → `fine`, `hover: none` → `hover`, `maxTouchPoints` → 0).
  Open a fresh page afterwards. Until this was caught, every route after the
  first was being judged as a mouse device.
- Playwright's contexts are incognito, so Chromium reports `in-incognito` as an
  installability error on every page. It says nothing about the app and is
  filtered; the rest of the installability errors are real.

## Where the emulated Fire numbers come from — and why to distrust them

The Fire HD 10 is not among Playwright's descriptors (its only Kindle is a
first-generation HDX on WebKit). `devices.mjs` defines it as **1280×800 at 1.5×**
(the 1920×1200 panel at the density Fire tablets of this class report) with a
Silk-shaped user agent, and a "tab" variant 84 px shorter for the toolbar.
**Those are assumptions.** The `Viewport` and `Browser chrome` rows on
`/diagnostics` are the truth; copy them into `devices.mjs`.

## When it looks wrong on the tablet

1. Open `/diagnostics` on the tablet.
2. Read the top rows. They are ordered so the answer is first:
   - **Engine / Theme / CSS features** — can this browser render the app at all?
     The theme is `oklch()`; below Chromium 111 every colour falls back to the
     browser default (a white page, black text), not to something close.
   - **Display mode** — `browser` means the icon only opened a page. The
     manifest asks for `standalone`; a browser is free to ignore that.
   - **Browser chrome** — pixels lost to the toolbar and system bars.
3. Tap **Test full screen**. If it enters, the **Full screen** button on the
   Today screen will hide the toolbar for the session.
4. Tap **Copy report** and paste it. Failures are listed first.

### What is and is not known about Silk

Verified: Silk reports `Silk/<version> like Chrome/<chromium>` in its user agent,
and a Fire tablet's default is the *tablet* view (Amazon's user-agent doc).
Silk can be inspected over `adb` with `chrome://inspect`
([Amazon: remote debugging](https://docs.aws.amazon.com/silk/latest/developerguide/remote-debugging.html)).
Recent Silk builds are numbered 138 and 140 on APKMirror, which suggests the
version tracks Chromium's — if so an old engine is unlikely, but **the Browser
row is what settles it**.

**Not found, in any documentation I could reach:** whether Silk offers a
standalone window for an installed PWA. The header bar on the installed icon is
consistent with it not doing so; nothing here can prove that, because it is a
property of Silk's install flow, not of the page. Treat it as unverified until
the Display mode row on the tablet says otherwise.

## Tier 3, the real emulator: built, for the APK

This container has no `/dev/kvm`, so an Android emulator cannot run here. GitHub's
`ubuntu-latest` runners can, and this repo is public, so it is free: the
`Android` workflow runs the app on an emulator on every relevant change. See
[`apps/android/README.md`](../../android/README.md) for the whole pipeline; what
matters for testing is below.

What runs on the emulator is **the APK**, not Chrome and not Silk. That is a
different target from the one this page originally sketched, and a better one: the
Fire tablet's browser is not available to an emulator, but the thing that makes
the tablet look like an app is now an APK, and an APK can be tested.

- `emulator-test.sh` installs the **debug** build (its WebView is inspectable) and
  runs `e2e/native.mjs` with `TARGET=android`. Playwright's experimental
  [`_android`](https://playwright.dev/docs/api/class-android) API attaches to the
  app's WebView over adb, so the *same* flows that run on desktop Chromium run
  inside the real WebView: boot, navigation, every drill route, deep link, reload,
  history, the borderless check, and the Diagnostics rows.
- It then force-stops and relaunches the app and checks, with `PHASE=read`, that an
  IndexedDB marker written before the restart is still there.
- It installs the **release** build, which is deliberately not inspectable, and
  checks from outside: it reaches the foreground, its process is alive, nothing
  crashed, and a screenshot is kept.
- Two emulators run. **Android 14 gates the change.** **Android 11** is the base of
  Fire OS 8, so it is the nearest a runner gets to the tablet, but an emulator
  image's stock WebView is whatever it shipped with. It is informational: if that
  WebView is too old for the theme, the run proves the engine guard on a real old
  WebView; if not, it proves the app runs on Android 11.

`e2e/native.mjs` also runs on desktop (`TARGET=desktop`, the default) against
`scripts/serve-export.mjs`, which reproduces Capacitor's asset-server routing. That
is what makes the rule testable without Android. It is run against `--stock` as a
negative control: with nothing in front of Capacitor's rule, six checks fail.

Still untested, and not testable on a runner: **Amazon's WebView**, the Fire OS
install flow, Web MIDI, and the share sheet's destinations.

## Tier 4: the real tablet

Enable ADB on the Fire (Developer options), plug it in, open Silk on the page and
inspect it from desktop Chrome at `chrome://inspect`. That gives the console, the
network and screenshots from the actual browser — the only way to see Silk itself.
