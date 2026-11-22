#!/usr/bin/env bash
#
# Installs the APKs on a running Android emulator and meets the app the way a
# person would. Run by .github/workflows/android.yml inside an emulator; also
# usable against a tablet on a cable (`adb devices` shows one device).
#
#   emulator-test.sh <dir containing etude-*-debug.apk and etude-*.apk>
#
# Two builds, two jobs. The *debug* build can be attached to from outside (its
# WebView is inspectable), so it carries the real assertions: it is driven with
# the same suite the desktop uses, then force-stopped and relaunched to prove its
# data survives. The *release* build is the file people actually download and is
# deliberately not inspectable, so it gets what can be checked from outside: it
# installs, it reaches the foreground, it does not crash, and a screenshot of what
# it drew is kept.

set -uo pipefail

dist="${1:?usage: emulator-test.sh <apk dir>}"
app=app.etude.practice
activity="$app/.MainActivity"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$here/../../web"
shots="$web/e2e-artifacts/native"
mkdir -p "$shots"

debug_apk="$(ls "$dist"/*-debug.apk | head -1)"
release_apk="$(ls "$dist"/*.apk | grep -v -- '-debug\.apk$' | head -1)"
failed=0
step() { printf '\n######## %s\n' "$*"; }
fail() { echo "  FAIL  $*"; failed=1; }
launch() { adb shell am start -W -n "$activity" | grep -E "Status|Activity|TotalTime|Error"; }

step "device"
echo "android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), $(adb shell getprop ro.product.model | tr -d '\r')"
# The engine the app will run on, as the OS reports it.
adb shell dumpsys webviewupdate | grep -E "Current WebView package|WebView packages" | head -3 | tr -d '\r'
adb shell wm size | tr -d '\r'
adb shell wm density | tr -d '\r'

step "debug build: install and launch"
adb uninstall "$app" >/dev/null 2>&1 || true
adb install -r "$debug_apk" || { fail "debug APK did not install"; exit 1; }
adb logcat -c
launch

step "debug build: the same suite the desktop runs, against the real WebView"
( cd "$web" && TARGET=android node e2e/native.mjs ) || fail "native suite failed"

step "debug build: force-stop, relaunch, is the data still there"
adb shell am force-stop "$app"
sleep 2
launch
( cd "$web" && TARGET=android PHASE=read node e2e/native.mjs ) || fail "data did not survive a restart"

step "debug build: anything the app logged as an error"
# Capacitor logs through the "Capacitor" tag; Chromium's console reaches logcat as
# "chromium". Print the errors rather than fail on them: the suite already fails
# on the ones that matter, and a platform can log a warning of its own.
adb logcat -d -s Capacitor:E chromium:E AndroidRuntime:E | tail -20 || true
if adb logcat -d | grep -E "FATAL EXCEPTION|Process: $app" ; then fail "the debug build crashed"; fi

step "release build: install and launch"
adb uninstall "$app" >/dev/null 2>&1 || true
adb install "$release_apk" || { fail "release APK did not install"; exit 1; }
adb logcat -c
launch
sleep 10

if adb shell dumpsys activity activities | grep -E "ResumedActivity" | grep -q "$app"; then
  echo "  ok    the release build is in the foreground"
else
  fail "the release build is not in the foreground"
  adb shell dumpsys activity activities | grep -E "ResumedActivity" | head -3
fi
if adb shell pidof "$app" >/dev/null; then echo "  ok    its process is alive"; else fail "its process is gone"; fi
if adb logcat -d | grep -E "FATAL EXCEPTION|Process: $app"; then
  fail "the release build crashed"
else
  echo "  ok    no crash in the log"
fi
adb exec-out screencap -p > "$shots/release-launch.png" && echo "  info  screenshot kept: release-launch.png"

step "summary"
if [ "$failed" -ne 0 ]; then echo "emulator checks FAILED"; exit 1; fi
echo "emulator checks passed"
