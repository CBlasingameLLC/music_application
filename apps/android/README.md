# Étude for Android

The web app, bundled into an APK and run in a WebView, so it opens from its own
icon with no browser around it. Installed from a file on the
[Releases](../../releases) page; no store involved.

**It is the same app, not a port.** There is no Android-specific UI and no
second codebase: `apps/web` is built as a static site, copied into the APK, and
served to itself at `https://localhost` by [Capacitor](https://capacitorjs.com).
Everything it stores stays on the device, and it works with the network off.

## Install on the Fire tablet

1. On the tablet, open the [latest release](../../releases/latest) in Silk and
   download `etude-<version>.apk`.
2. Android asks to allow installs from this source. Allow it for the app you
   downloaded with. On a Fire tablet that is **Settings → Security & Privacy →
   Apps from Unknown Sources** (wording varies a little between Fire OS
   versions).
3. Open the downloaded file, tap **Install**, then **Open**.
4. **Check the engine.** Open **Diagnostics** (link on the Today screen) and read
   the first rows. *App shell* must say "Étude Android app", and *Engine* must
   say "new enough". If the app instead opens to a page titled "Étude needs a
   newer web engine", that is the guard described [below](#the-engine-guard)
   doing its job: the tablet's WebView is older than the theme can draw.

**Updating** is installing a newer APK over the old one. Your progress is kept,
provided the new APK is signed by the same key as the old (every official release
is). **Uninstalling deletes everything the app stored.** If you want a copy first,
use **Diagnostics → Export log**; it opens the share sheet.

An `-unofficial` APK (from a pull request's workflow run) is signed with a
throwaway key. It installs, but a later build cannot be installed over it —
Android refuses, and the only way past is to uninstall and lose the data. Use
those to try a change, not to keep.

## What is different from the browser version

| | Browser / PWA | Android app |
|---|---|---|
| Toolbar | Whatever the browser shows | None. System bars are hidden; swipe from an edge to bring them back for a moment |
| Orientation | Whatever the device does | Landscape (both ways round) |
| Offline | A service worker caches the site | The files are inside the APK, so there is nothing to cache and no worker |
| Updates | The next visit after a deploy | Install the next APK |
| Microphone | Browser prompt | Android's permission prompt, the first time a listening drill needs it |
| Backup file | Downloads a file | Opens the share sheet (a WebView cannot download) |
| Web MIDI | Works where the browser supports it | **Unverified.** See below |

### Web MIDI

Chrome implements Web MIDI over `android.media.midi`. Whether *WebView* exposes
it is not something I could confirm from documentation, and nothing has run it
against a keyboard. **Diagnostics → MIDI** answers it on the device in one tap.
If it says unsupported inside the app, the browser version still works, and the
fix is a small native MIDI plugin in this project — not a change to the web app,
which already reads MIDI through one interface.

## How it works

```
apps/web  ──build:native──▶  out/ (static site)  ──cap sync──▶  APK assets  ──Gradle──▶  app-release.apk
```

- **`apps/web`** builds twice from one codebase. `pnpm build` is the PWA;
  `pnpm build:native` sets `ETUDE_TARGET=native`, which switches Next.js to a
  static export and drops the service worker. `scripts/build-native.mjs` then
  checks the output, because every way an export can be wrong is quiet.
- **`apps/android`** is a Capacitor project: `capacitor.config.ts`, and the
  generated Android project in `android/`, committed.
- **`MainActivity`** hides the system bars (and hides them again whenever the
  window regains focus: after a dialog, the share sheet, a permission prompt).
- **`EtudeWebViewClient`** fixes a routing mismatch, below.
- **App id `app.etude.practice`.** It cannot change after release: a different id
  is a different app, with none of the first one's data.

### The routing rule

A static export is a directory per page: `library/index.html`,
`play/free/index.html`. Capacitor's asset server does not look for those. With
its default `html5mode`, any path whose last segment has no `.` is answered with
the *root* `index.html`, whatever was asked for. That is right for a
single-page app and wrong here, and it only shows on a full page load (a reload,
a deep link, a hard navigation): `/library/` arrives as the home page's HTML at
the library's URL, and the drill pages throw a React hydration error on top.
Tapping through the app never hits it, because client-side navigation fetches
`library/index.txt`, a path with a dot.

`EtudeWebViewClient` sits in front of the asset server: for a path with no dot
that names a bundled directory, it serves that directory's page. The address does
not change, which is what the router needs. Everything else falls through
untouched, so a bug in the rewrite degrades to exactly what Capacitor would have
done without it.

`apps/web/scripts/serve-export.mjs` reproduces the same rule for desktop tests
(`--stock` serves Capacitor's rule with nothing in front of it, to show the bug).
**The two must stay in step.** `e2e/native.mjs` fails against `--stock`, which is
how you know it is testing the rule and not just the pages.

### The engine guard

The theme is `oklch()` throughout, and an engine that cannot read it paints black
text on white with no explanation. So the very first thing the page runs (inline,
in `<head>`) tests for the three features the theme needs and, if any is missing,
sends the user to `unsupported.html`: plain HTML, no colour syntax newer than
`rgb()`, saying which Chromium it found and that 111 is needed.

It tests *features*, not a version number, because Amazon's WebView does not
promise a version that lines up with Chromium's, and a version check would be a
guess about which number to trust. It has an escape hatch — **Try anyway** — because
a guard that wrongly judged a working device would lock its owner out of their own
app.

## Building

Needs: Node 22, pnpm 10, JDK 21, the Android SDK (platform 36, build-tools 36.0.0).

```bash
pnpm install
pnpm --filter @etude/web build:native           # static site into apps/web/out
pnpm --filter @etude/android exec cap sync android
cd apps/android/android && ./gradlew assembleDebug assembleRelease
```

The APKs land in `app/build/outputs/apk/{debug,release}/`. A release build is
signed only if `ETUDE_KEYSTORE_FILE`, `ETUDE_KEYSTORE_PASSWORD`,
`ETUDE_KEY_ALIAS` and `ETUDE_KEY_PASSWORD` are set; otherwise it is unsigned and
will not install. Then check what came out:

```bash
ANDROID_HOME=… apps/android/scripts/verify-apk.sh <apk> [--release] [--version X.Y.Z]
```

`verify-apk.sh` checks what a green build does not: v2 and v3 signatures (Fire OS 8
refuses an APK with only the old v1 signature), exactly the three expected
permissions, no native code, the web build inside and no service worker, and that a
release build is not debuggable.

Desktop tests of the exported site, without Android:

```bash
pnpm --filter @etude/web build:native
pnpm --filter @etude/web serve:native &          # http://127.0.0.1:3312
CHROME_PATH='' pnpm --filter @etude/web exec node e2e/native.mjs
```

## Releasing

**Releasing is: change the version in `apps/android/package.json`, merge to main.**

The `Android` workflow builds, verifies, runs the APK on an emulator, and — only on
`main`, only when `v<version>` does not exist yet — creates the GitHub Release with
`etude-<version>.apk` and its SHA-256. Nothing is published from a pull request and
no version is published twice. `versionCode` is derived from the version
(`major·10000 + minor·100 + patch`, so keep minor and patch under 100).

### The signing key

Releases are signed with a key held in four repository secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. **`scripts/make-keystore.sh` creates them**, once; run it on
your own machine, and back up the keystore and its password. They are the only
copy, and losing them means the next release cannot be installed over this one.

The release key is used on `main` only. A pull request builds with a throwaway key,
labelled `-unofficial`, so an unreviewed change can never sign as the real app. If a
version has no release yet and the run has no secrets, the release job **fails
loudly** instead of publishing an unofficial APK — the failure message says how to
fix it. After adding the secrets, use **Re-run all jobs**: "Re-run failed jobs"
reuses the unofficial build.

## What is checked, and by what

| Claim | Checked by | Status |
|---|---|---|
| The site exports, every route has a page and a payload | `build-native.mjs` | every build |
| The export boots and navigates under Capacitor's routing rule | `e2e/native.mjs` on desktop Chromium | every build |
| The existing smoke suite passes against the export | `e2e/smoke.mjs` with `BASE_URL` | by hand |
| The APK is signed (v2+v3), has the right id, version, SDK levels, permissions | `verify-apk.sh` | every build |
| The APK installs and the app runs on a current Android | `emulator-test.sh`, Android 14 | every build |
| Drills, deep links, reload, history, borderless, data survives a restart — **in the real WebView** | `e2e/native.mjs` over adb (`TARGET=android`) | every build |
| The release build installs, reaches the foreground, does not crash | `emulator-test.sh` | every build |
| Behaviour on Android 11, the Fire OS 8 base | same, informational | every build, not a gate |
| **Behaviour on the Fire tablet itself** | nothing | **unverified** |

What no automated test here can know, because it depends on Amazon's software and
the tablet in your hands: the version of the Fire's WebView (the guard and the
Diagnostics page exist to find out), whether Web MIDI is exposed to it, whether
the share sheet offers somewhere to save the exported log, and how the microphone
prompt behaves. Run **Diagnostics → Copy report** on the tablet; it settles most
of these in one paste.
