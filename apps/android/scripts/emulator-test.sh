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

# What the device was doing when something went wrong. A CI emulator is slow and
# shared, and the failures that matter on it ("the page is 0x0", "the target
# closed") look the same whether the app is at fault or the emulator is, until
# the foreground window, the activity state and the app's own log lines are read
# beside them. Kept as an artifact, and the useful lines echoed into the log.
diagnose() {
  local label="$1" out="$shots/diagnostics-$1.txt"
  {
    echo "## foreground"
    adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp|mInputMethodTarget|isKeyguardShowing|mScreenOn|screenState" | head -8
    echo "## activities"
    adb shell dumpsys activity activities | grep -E "ResumedActivity|mFocusedApp|topResumedActivity|state=" | head -12
    echo "## process"
    adb shell pidof "$app" || echo "(no process)"
    echo "## memory"
    adb shell dumpsys meminfo "$app" 2>/dev/null | grep -E "TOTAL|Native Heap|Dalvik Heap" | head -4
    adb shell cat /proc/meminfo | grep -E "MemAvailable|MemTotal"
    echo "## log (this app, the WebView, the activity manager)"
    adb logcat -d -t 600 | grep -E "etude|chromium|AndroidRuntime|ActivityManager|ANR|lowmemorykiller|WindowManager" | tail -60
  } > "$out" 2>&1
  adb exec-out screencap -p > "$shots/screen-$label.png" 2>/dev/null
  echo "  info  diagnostics kept: $(basename "$out"), screen-$label.png"
  grep -E "^## |mCurrentFocus|ResumedActivity|no process|ANR|lowmemorykiller|FATAL" "$out" | head -20
}

step "device"
# Nothing that can cover the app or turn the screen off during a run: crash and
# ANR dialogs take focus on a slow emulator, and a locked or dark screen makes a
# WebView report a 0x0 viewport.
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
# A CI emulator draws in software, and a 2560x1600 surface is four times the
# pixels of the 1280x800 the app is designed around. Shrinking the display to that
# size at mdpi keeps the layout in CSS pixels exactly what a Fire HD 10 gets (1280
# by 800), and makes everything the WebView draws a quarter as expensive.
adb shell wm size 1280x800 >/dev/null
adb shell wm density 160 >/dev/null
# The display change is applied asynchronously; launching into the middle of it is
# how an activity ends up laid out twice.
sleep 4
adb shell input keyevent KEYCODE_HOME
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
( cd "$web" && TARGET=android node e2e/native.mjs ) || { fail "native suite failed"; diagnose suite; }

step "debug build: force-stop, relaunch, is the data still there"
adb shell am force-stop "$app"
sleep 2
launch
( cd "$web" && TARGET=android PHASE=read node e2e/native.mjs ) || { fail "data did not survive a restart"; diagnose restart; }

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
