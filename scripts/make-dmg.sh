#!/usr/bin/env bash
# Packages build/MDView.app into build/MDView.dmg (drag-to-Applications layout).
# Run scripts/build-app.sh first. Notarization steps are below, commented out:
# they need a Developer ID certificate and App Store Connect credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/build/MDView.app"
DMG="$ROOT/build/MDView.dmg"

if [[ ! -d "$APP" ]]; then
  echo "error: $APP not found; run scripts/build-app.sh first" >&2
  exit 1
fi

# --- Developer ID signing (replace the ad-hoc signature) ---------------------
# IDENTITY="Developer ID Application: Your Name (TEAMID)"
# codesign --force --deep --options runtime --timestamp -s "$IDENTITY" "$APP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "MDView" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$DMG" >/dev/null
echo "Built $DMG"

# --- Notarization (requires credentials; not run by this script) -------------
# One-time: store credentials in the keychain.
#   xcrun notarytool store-credentials "mdview-notary" \
#     --apple-id "you@example.com" --team-id "TEAMID" --password "app-specific-password"
# Sign the DMG, submit it, wait for the verdict, then staple the ticket:
#   codesign --force --timestamp -s "$IDENTITY" "$DMG"
#   xcrun notarytool submit "$DMG" --keychain-profile "mdview-notary" --wait
#   xcrun stapler staple "$DMG"
#   spctl --assess --type open --context context:primary-signature -v "$DMG"
