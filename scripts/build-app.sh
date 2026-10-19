#!/usr/bin/env bash
# Builds build/MDView.app: the shared core (npm), the Swift shell (SwiftPM, release),
# the bundle layout and an ad-hoc signature.
#
#   scripts/build-app.sh            # full build, universal (Apple Silicon + Intel)
#   scripts/build-app.sh --no-core  # reuse the existing core/dist
#   scripts/build-app.sh --native   # this Mac's architecture only (faster)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/build/MDView.app"
BUILD_CORE=1
ARCHS=(--arch arm64 --arch x86_64)
for arg in "$@"; do
  case "$arg" in
    --no-core) BUILD_CORE=0 ;;
    --native) ARCHS=() ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ $BUILD_CORE -eq 1 ]]; then
  echo "==> Building core"
  npm --prefix "$ROOT/core" run build
fi
if [[ ! -f "$ROOT/core/dist/index.html" ]]; then
  echo "error: core/dist/index.html is missing; build the core first" >&2
  exit 1
fi

echo "==> Building Swift shell (release${ARCHS:+, universal})"
swift build -c release --package-path "$ROOT/macos" ${ARCHS[@]+"${ARCHS[@]}"}
BIN_DIR="$(swift build -c release --package-path "$ROOT/macos" ${ARCHS[@]+"${ARCHS[@]}"} --show-bin-path)"

ICON="$ROOT/macos/Resources/AppIcon.icns"
if [[ ! -f "$ICON" ]]; then
  echo "==> Generating app icon"
  (cd "$ROOT" && swift scripts/make-icon.swift "$ICON")
fi

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/MDView" "$APP/Contents/MacOS/MDView"
cp -R "$ROOT/core/dist" "$APP/Contents/Resources/web"
cp "$ICON" "$APP/Contents/Resources/AppIcon.icns"

VERSION="$(node -p "require('$ROOT/core/package.json').version" 2>/dev/null || echo 0.1.0)"
BUILD_NUMBER="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>MDView</string>
  <key>CFBundleIdentifier</key><string>dev.gtindo.mdview</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>MDView</string>
  <key>CFBundleDisplayName</key><string>MDView</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSSupportsAutomaticTermination</key><false/>
  <key>NSSupportsSuddenTermination</key><false/>
  <key>NSHumanReadableCopyright</key><string>© $(date +%Y) Yvan Guekeng</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Folder</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array><string>public.folder</string></array>
    </dict>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array><string>net.daringfireball.markdown</string></array>
      <key>CFBundleTypeExtensions</key>
      <array><string>md</string><string>markdown</string><string>mdx</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> Signing (ad hoc)"
codesign --force --deep -s - "$APP"
codesign --verify --deep "$APP"

echo "Built $APP"
