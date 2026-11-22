#!/usr/bin/env bash
#
# Creates the key that signs Étude's releases, and hands it to GitHub Actions.
#
#   make-keystore.sh [--repo owner/name] [keystore path]
#
# Run it ONCE, on your own machine (or in a Codespace), not in CI and not in a
# shared terminal. Needs `keytool` (any JDK) and `openssl`.
#
# Why the key matters. Android installs an update over an existing app only when
# the new APK is signed by the same key as the installed one. Sign release 1 with
# one key and release 2 with another and the tablet refuses the update; the only
# way past is to uninstall first, which deletes everything the app stored on the
# device — the whole practice history. So the key has to be created once and kept
# for as long as the app is.
#
# What it does:
#   1. Creates a PKCS12 keystore (RSA 3072, ~27 years) at the path given, by
#      default ~/etude-release.keystore. It will not overwrite an existing file.
#   2. With --repo and a logged-in GitHub CLI that may write secrets, stores the
#      four values GitHub Actions needs as repository secrets, printing none of
#      them. Otherwise prints them for you to paste into
#      Settings → Secrets and variables → Actions → New repository secret.
#
# The keystore file and its password are the only copy. Back both up somewhere
# private (a password manager's secure notes is fine). Never commit either:
# anyone holding them can publish an "update" your tablet will accept.
#
# The certificate carries no personal details: its subject is "Etude release".

set -euo pipefail

repo=""
keystore="$HOME/etude-release.keystore"
while (($#)); do
  case "$1" in
    --repo) repo="${2:?--repo needs owner/name}"; shift ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) keystore="$1" ;;
  esac
  shift
done

command -v keytool >/dev/null || { echo "keytool not found: install a JDK (17 or newer)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
if [ -e "$keystore" ]; then
  echo "$keystore already exists. Refusing to overwrite a signing key." >&2
  echo "If it is the key you already use, you do not need this script; if you want a new one, choose another path." >&2
  exit 1
fi

alias_name=etude
# Letters and digits only, so the value survives being pasted anywhere.
password="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"

keytool -genkeypair \
  -keystore "$keystore" -storetype PKCS12 \
  -alias "$alias_name" -keyalg RSA -keysize 3072 -validity 10000 \
  -dname "CN=Etude release" \
  -storepass "$password" -keypass "$password" 2>/dev/null
chmod 600 "$keystore"

fingerprint="$(keytool -list -keystore "$keystore" -storepass "$password" 2>/dev/null \
  | sed -n 's/.*SHA-256): \(.*\)/\1/p; s/^Certificate fingerprint (SHA-256): //p' | head -1)"
base64_keystore="$(base64 -w0 "$keystore" 2>/dev/null || base64 "$keystore" | tr -d '\n')"

echo "Created $keystore"
echo "Certificate SHA-256: ${fingerprint:-see: keytool -list -keystore $keystore}"
echo

set_secret() { printf '%s' "$2" | gh secret set "$1" --repo "$repo" >/dev/null && echo "  set  $1"; }

if [ -n "$repo" ] && command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo "Storing the secrets on $repo (values are not printed):"
  if set_secret ANDROID_KEYSTORE_BASE64 "$base64_keystore" \
     && set_secret ANDROID_KEYSTORE_PASSWORD "$password" \
     && set_secret ANDROID_KEY_ALIAS "$alias_name" \
     && set_secret ANDROID_KEY_PASSWORD "$password"; then
    echo
    echo "Done. Now back up $keystore and its password: they are not stored anywhere else."
    echo "Password: $password"
    exit 0
  fi
  echo "Could not write the secrets with the GitHub CLI; printing them instead." >&2
fi

cat <<OUT
Add these four as repository secrets (Settings → Secrets and variables → Actions):

  ANDROID_KEY_ALIAS            $alias_name
  ANDROID_KEYSTORE_PASSWORD    $password
  ANDROID_KEY_PASSWORD         $password
  ANDROID_KEYSTORE_BASE64      (the single long line below)

$base64_keystore

Then back up $keystore and the password. They are not stored anywhere else.
OUT
