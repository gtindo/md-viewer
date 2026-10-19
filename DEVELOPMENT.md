# Working on MDView

This document explains how the project is put together and how to build,
test and release it. For what the app does and how to use it, see the
[README](README.md); the product spec is in [docs/SPEC.md](docs/SPEC.md).

## Repository layout

Two applications share one rendering core. The core renders markdown, code,
Mermaid and the editor, and runs unchanged in WKWebView (macOS) and Chromium
(Linux). Only the shell (windows, file tree, tabs, file access, settings) is
written twice.

```
core/     TypeScript rendering core (markdown-it, Shiki, Mermaid viewer, CodeMirror editor)
macos/    Swift/SwiftUI shell around WKWebView (Swift Package)
linux/    Electron shell around the same core, packaged as an AppImage
scripts/  build-app.sh, make-dmg.sh, make-icon.swift, smoke-check.mjs
.github/  CI: build, test and release for macOS (arm64, x86_64) and Linux (amd64, arm64)
docs/     product spec
```

The core never touches the file system and does not know which shell hosts
it. Shells talk to it only through the `HostBridge` messages in
[core/src/bridge.ts](core/src/bridge.ts): the host sends `render`,
`setSettings`, `setMode`, `restoreState`, commands and so on; the core posts
`linkClicked`, `scrollChanged`, `edited`, `copy`, `export` and the rest back.
A feature added to the core ships on both platforms with no shell changes
unless it needs a new host capability.

The version lives in `core/package.json` (used for the macOS bundle) and
`linux/package.json`; keep them equal. CI refuses a mismatch.

## Core

Requirements: Node 20+.

```sh
cd core
npm install
npm run build            # dist/: renderer.js + lazy chunks, app.css, index.html
npm run watch
npm test                 # typecheck, interaction tests (WebKit + Chromium), fixture corpus
node test/corpus.mjs --root ../../observy-rs --engine webkit,chromium
node test/corpus.mjs --root ../../formal-method-workbench --shots /tmp/shots
```

The corpus test renders every markdown file under a folder headlessly, renders
all diagrams, reports Mermaid and page errors, and compares diagram geometry
between WebKit and Chromium. Fixtures in `core/fixtures` can declare deliberate
failures with `<!-- expect-mermaid-errors: N -->`.

## macOS app

Requirements: macOS 14+, Xcode command-line tools (Swift 6), Node 20+.

```sh
npm --prefix core install
scripts/build-app.sh          # builds core/dist, the Swift shell, and build/MDView.app (universal)
open build/MDView.app --args ~/Projects/observy-rs
```

- `scripts/build-app.sh --native` builds only this Mac's architecture (faster);
  `--arch arm64` or `--arch x86_64` builds one architecture, as the release
  pipeline does; `--no-core` reuses the existing `core/dist`.
- `scripts/make-dmg.sh [output.dmg]` packages the app (default
  `build/MDView.dmg`) with a drag-to-Applications layout and the app icon as
  the volume icon.
- The app is signed ad hoc. Developer ID signing and notarization would remove
  the Gatekeeper step for users; the commands are sketched, commented out, in
  `scripts/make-dmg.sh`.
- The icon is drawn by `scripts/make-icon.swift`. Run
  `swift scripts/make-icon.swift --preview icon.png` to look at it, including
  the small sizes, without rebuilding. The Linux PNG icons in
  `linux/resources/` are extracted from the same `.icns`.

Development aids (see `macos/Sources/MDView/App/DebugSnapshot.swift`):
`MDVIEW_DEBUG=1` logs to stderr, `MDVIEW_WEB_DIR` points the app at another
core build, `MDVIEW_DEBUG_SNAPSHOT` and `MDVIEW_DEBUG_COMMANDS` capture the
window and drive synthetic input via signals.

## Linux app (Electron)

Requirements to build: Linux, Node 22+ (24 recommended). Targets Ubuntu
22.04+, Fedora 39+ and Debian 12+ on x86-64 and ARM64, under Wayland or X11.

```sh
npm --prefix core ci
npm --prefix linux ci
npm --prefix linux start        # build and run from source (also works on macOS, for development)
npm --prefix linux run dist     # linux/release/MDView-<version>-linux-<arch>.AppImage (host architecture)
```

electron-builder names the x64 AppImage `…-linux-x86_64.AppImage`; the release
pipeline renames it to `amd64`. To cross-build the other architecture, install
its `@parcel/watcher` binary first, e.g.
`npm --prefix linux install --no-save --force @parcel/watcher-linux-x64-glibc@2.6.0`
then `npx electron-builder --linux AppImage --x64`.

### How the shell is put together

- The **main process** (`linux/src/main`) owns windows, the menu bar, dialogs,
  the workspace scan (with `.gitignore` support, `scanner.ts` and
  `gitignore.ts`), the recursive `@parcel/watcher` (inotify) watcher, atomic
  writes (`fileservice.ts`), the `mdview://` scheme (`protocol.ts`: one session
  per workspace window, so `mdview://ws/` never serves files outside that
  workspace), and settings and session state in `~/.config/MDView/`
  (`settings.json`, `session.json`; `MDVIEW_CONFIG_DIR` overrides the folder).
- The **shell UI** (`linux/src/shell`, plain TypeScript) draws the sidebar, tab
  bar, toolbar, quick open, and the Welcome and Settings windows. Tabs are views
  inside the window's one renderer: each open document is the unchanged core in
  an iframe (`docview.ts`), at most 8 kept alive per window.
  `workspace.ts` follows the macOS `WorkspaceStore` closely.
- The **preload** exposes the core's `HostBridge` (`window.mdviewHost`) in core
  frames and a narrow IPC surface (`window.mdviewShell`) in the shell frame.
  Context isolation, the renderer sandbox and no Node integration are on;
  navigation and new windows are blocked; spell checking is off (Electron would
  download dictionaries).
- **Packaging** (`linux/electron-builder.yml`, `linux/scripts/after-pack.cjs`):
  AppImage with the static type2 runtime (no zlib or libfuse2 needed); Electron
  fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and the
  app only loads from its asar archive. Inside an AppImage, Chromium's sandbox
  needs unprivileged user namespaces, so a launcher script keeps the sandbox on
  where the kernel allows them and passes `--no-sandbox` where it does not
  (Ubuntu 23.10+ AppArmor policy, running as root). The embedded ASAR
  integrity fuse is not enabled: Electron documents it for macOS and Windows.
- JetBrains Mono is bundled for code (`core-linux.css`, injected into the
  core's page by the protocol handler); prose uses the desktop's UI font.

Linux shortcuts follow the spec. Ctrl+B toggles the sidebar but is registered
as a normal menu accelerator, so the editor consumes it first for bold; the
Format menu shows Ctrl+B/I/K without registering them.

Not in 1.0.0 (from the spec's M7): `.deb` / `.rpm` packages and AppImage
auto-update.

### Tests

```sh
npm --prefix linux test                        # typecheck, unit tests, end-to-end tests
xvfb-run -a npm --prefix linux run test:e2e    # on a Linux machine without a display
E2E_LOG=1 MDVIEW_DEBUG=1 npm --prefix linux run test:e2e   # with the app's logs
```

- `linux/test/unit.mjs` covers gitignore matching, the scanner and the file
  service's encoding round trip.
- `linux/test/e2e.mjs` drives the real app with Playwright (tree, tabs, editing
  and saving, live reload, conflicts, links and history, session restore,
  settings, clipboard). Menu shortcuts are sent the way the menu sends them; it
  runs on macOS against the development build too.

To build and test on Linux from a Mac, an Incus (or any) Ubuntu 22.04
container with Node 24, `xvfb` and the GTK/NSS runtime libraries is enough;
copy the tree without `node_modules` and run the same commands. `xdotool` under
Xvfb is handy to check real keyboard accelerators against a packaged build.

## Headless checks

Both apps have the same verification modes, which render without showing a
window:

```sh
MDView --render-check <folder>                      # JSON line per file, then a summary
MDView --screenshot <file.md> <out.png> [--width 1400] [--height 900] [--dark] [--root <dir>] [--scroll <y>]
node scripts/smoke-check.mjs <app binary or AppImage>   # render-check of core/fixtures vs expected errors
```

For an AppImage in a container, set `APPIMAGE_EXTRACT_AND_RUN=1`.

## Releases

`.github/workflows/build.yml` runs only when a version tag (`v*`) is pushed;
pushes to branches and pull requests do not trigger it. It runs these jobs:

- **Version:** checks that `core/package.json` and `linux/package.json` agree
  and match the tag.
- **macOS:** builds the app for Apple Silicon (`macos-15`) and Intel
  (`macos-15-intel`), smoke-tests each with `--render-check`, and packages a
  DMG.
- **Linux:** builds on `ubuntu-22.04` (amd64) and `ubuntu-22.04-arm` (arm64),
  the oldest supported Ubuntu, so the AppImage runs on older glibc; runs the
  typecheck, unit and end-to-end tests under Xvfb; packages the AppImage and
  smoke-tests it.
- **Release:** publishes a GitHub release for the tag.

To publish a release, set the same version in `core/package.json` and
`linux/package.json`, commit, then push a matching tag:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The release attaches `MDView-<version>-macos-arm64.dmg`,
`MDView-<version>-macos-x86_64.dmg`, `MDView-<version>-linux-amd64.AppImage`,
`MDView-<version>-linux-arm64.AppImage` and `SHA256SUMS.txt`. If a job fails,
fix it on a branch, then move the tag to the fixed commit and push it again
(delete any partial release on GitHub first):

```sh
git tag -f v1.0.0 && git push -f origin v1.0.0
```

Run the tests locally before tagging (see [Tests](#tests)), since nothing runs
them on ordinary pushes.

The `ubuntu-22.04-arm` runner is free for public repositories; a private
repository needs a plan with Linux ARM64 hosted runners.
