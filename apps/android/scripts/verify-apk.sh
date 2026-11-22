#!/usr/bin/env bash
#
# Checks an APK against what Étude promises, instead of trusting the build.
#
#   verify-apk.sh <apk> [--release] [--version X.Y.Z]
#
# A green Gradle build says the APK was produced. It does not say the APK will
# install on the tablet, is signed in a way that tablet accepts, asks for only the
# permissions the app uses, or contains the app. Each of those fails quietly:
# the file downloads, and then does not install, or installs and opens blank.
#
#  - **Signature schemes.** Fire OS 8 will not install or update an app that is
#    signed only with the old v1 (JAR) scheme, so v2 and v3 must both be present.
#  - **Permissions.** The set is exactly what the app uses. A new one appearing
#    is a decision somebody should make on purpose, so it fails here.
#  - **No native code.** The app is a WebView around web assets. With no `.so`
#    files it is not tied to a CPU architecture, so one APK installs on every
#    device; a stray native library would quietly change that.
#  - **The app is inside.** The web build is under `assets/public`, and the
#    service worker is not.
#  - **Debuggable only when it should be.** A release build that can be attached
#    to from a computer is a release build whose storage can be read.
#
# Needs the Android build-tools (`apksigner`, `aapt2`) on ANDROID_HOME.

set -uo pipefail

apk="${1:?usage: verify-apk.sh <apk> [--release] [--version X.Y.Z]}"
shift
kind=debug
want_version=""
while (($#)); do
  case "$1" in
    --release) kind=release ;;
    --version) want_version="${2:?--version needs a value}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -d "$sdk/build-tools" ] || { echo "ANDROID_HOME has no build-tools" >&2; exit 2; }
tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
aapt2="$tools/aapt2"
apksigner="$tools/apksigner"

fails=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fails=$((fails + 1)); }
# expect <description> <failure detail> <command...>: runs the command, no eval.
expect() {
  local description="$1" detail="$2"
  shift 2
  if "$@"; then ok "$description"; else bad "$detail"; fi
}
has()     { grep -qE -- "$1" <<<"$2"; }
lacks()   { ! grep -qE -- "$1" <<<"$2"; }
equals()  { [ "$1" = "$2" ]; }

echo "== $apk ($kind, build-tools $(basename "$tools")) =="

# --- signature ---------------------------------------------------------------
sig="$("$apksigner" verify --verbose --print-certs "$apk" 2>&1)" || { bad "apksigner rejected the APK: $sig"; sig=""; }
expect "signed with the v2 scheme" \
  "not signed with the v2 scheme: Fire OS 8 will refuse to install it" \
  has 'v2 scheme \(APK Signature Scheme v2\): true' "$sig"
if [ "$kind" = release ]; then
  # Debug builds are v2-only, which is all an emulator needs. A release is what
  # people keep and update, so it carries v3 as well (it is what lets a signing
  # key be rotated later without stranding every installed copy).
  expect "signed with the v3 scheme" "release build is not signed with the v3 scheme" \
    has 'v3 scheme \(APK Signature Scheme v3\): true' "$sig"
fi
fingerprint="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$sig" | head -1)"
echo "  info  signing certificate SHA-256: ${fingerprint:-unknown}"

# --- manifest ----------------------------------------------------------------
badging="$("$aapt2" dump badging "$apk" 2>&1)"
# The value of key='...' on the first line starting with "<prefix>:".
field() {
  grep -m1 -- "^$1:" <<<"$badging" | grep -oE -- "(^| )$2='[^']*'" | head -1 | sed "s/.*$2='\(.*\)'/\1/"
}

id="$(field package name)"
expect "package is app.etude.practice" \
  "package is '$id', and a different id installs as a different app" \
  equals "$id" "app.etude.practice"

name="$(field package versionName)"
code="$(field package versionCode)"
if [[ "$name" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  expected=$(( BASH_REMATCH[1] * 10000 + BASH_REMATCH[2] * 100 + BASH_REMATCH[3] ))
  expect "versionCode $code matches versionName $name" \
    "versionCode is $code but $name should give $expected" \
    equals "$code" "$expected"
else
  bad "versionName '$name' is not X.Y.Z"
fi
[ -z "$want_version" ] || expect "version is $want_version" "version is $name, expected $want_version" \
  equals "$name" "$want_version"

expect "minSdk 24 (Android 7)" "minSdk is not 24" \
  has "^minSdkVersion:'24'" "$badging"
expect "targetSdk 36" "targetSdk is not 36" \
  has "^targetSdkVersion:'36'" "$badging"
expect "launcher label is Étude" "launcher label is not Étude" \
  has "^application-label:'Étude'" "$badging"
expect "launches MainActivity" "no launchable MainActivity" \
  has "launchable-activity: name='app.etude.practice.MainActivity'" "$badging"

# AndroidX adds a permission of the app's own (`<package>.DYNAMIC_RECEIVER_...`)
# to every app that uses it. It grants nothing, so it is not counted.
permissions="$(sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" <<<"$badging" \
  | grep -v '^app\.etude\.practice\.' | sort | tr '\n' ' ')"
expected_permissions="android.permission.INTERNET android.permission.MODIFY_AUDIO_SETTINGS android.permission.RECORD_AUDIO "
expect "permissions are exactly internet, microphone, audio settings" \
  "permissions are: $permissions" \
  equals "$permissions" "$expected_permissions"
expect "the microphone is optional, so a device without one can still install it" \
  "the microphone is a required feature" \
  has "uses-feature-not-required: name='android.hardware.microphone'" "$badging"
expect "no native code, so it installs on any CPU" \
  "contains native code: $(grep '^native-code:' <<<"$badging")" \
  lacks '^native-code:' "$badging"

if [ "$kind" = release ]; then
  expect "release build is not debuggable" \
    "release build is debuggable: its storage could be read from a computer" \
    lacks '^application-debuggable' "$badging"
else
  expect "debug build is debuggable (the emulator test attaches to it)" \
    "debug build is not debuggable, so the emulator test cannot attach" \
    has '^application-debuggable' "$badging"
fi

# --- contents ----------------------------------------------------------------
listing="$(unzip -Z1 "$apk")"
for required in assets/public/index.html assets/public/unsupported.html \
                assets/public/manifest.webmanifest assets/capacitor.config.json \
                classes.dex resources.arsc; do
  expect "contains $required" "missing $required" has "^${required//./\\.}\$" "$listing"
done
expect "contains the web build's chunks" "no _next chunks inside" \
  has '^assets/public/_next/static/' "$listing"
expect "no service worker inside" "a service worker is bundled in the APK" \
  lacks '(^|/)(sw\.js|swe-worker-[^/]*\.js)$' "$listing"

size=$(stat -c %s "$apk")
expect "size $(( size / 1024 / 1024 )) MB" "size $(( size / 1024 / 1024 )) MB is unexpectedly large" \
  test "$size" -lt 41943040

if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed"
  exit 1
fi
echo "all APK checks passed"
