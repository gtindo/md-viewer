# MDView

A Mermaid-first markdown previewer for project docs written by agents. Any
Mermaid diagram, however large, can be zoomed, panned and read comfortably;
code blocks are highlighted with VS Code grammars, including **B-Method**.

The product spec is in [docs/SPEC.md](docs/SPEC.md). This repository holds the
shared rendering core, the native macOS shell and the Linux (Electron) shell.
Current version: **1.0.0**.

```
core/     TypeScript rendering core (markdown-it, Shiki, Mermaid viewer, CodeMirror editor)
macos/    Swift/SwiftUI shell around WKWebView (Swift Package)
linux/    Electron shell around the same core, packaged as an AppImage
scripts/  build-app.sh, make-dmg.sh, make-icon.swift, smoke-check.mjs
.github/  CI: build, test and release for macOS (arm64, x86_64) and Linux (amd64, arm64)
docs/     product spec
```

## Build and run (macOS 14+)

Requirements: Xcode command-line tools (Swift 6), Node 20+.

```sh
npm --prefix core install
scripts/build-app.sh          # builds core/dist, the Swift shell, and build/MDView.app
open build/MDView.app --args ~/Projects/observy-rs
```

Drop a folder (or a `.md` file) on the window or the Dock icon to open it as a
workspace. `scripts/make-dmg.sh` packages `build/MDView.dmg`, a universal build
(Apple Silicon and Intel, macOS 14+) with a drag-to-Applications layout.
`scripts/build-app.sh --arch arm64` (or `x86_64`) builds a single architecture,
and `scripts/make-dmg.sh <output.dmg>` names the image, as the release pipeline does.

### Sharing the DMG

The app is signed ad hoc, not with a Developer ID, so macOS blocks it on first
launch on another Mac ("Apple could not verify…"). After dragging it to
Applications, the recipient opens it once with **System Settings → Privacy &
Security → Open Anyway**. Alternatively, they can run
`xattr -dr com.apple.quarantine /Applications/MDView.app`. Developer ID signing
and notarization remove this step; they are sketched in `scripts/make-dmg.sh`.

The icon is drawn by `scripts/make-icon.swift`. Run
`swift scripts/make-icon.swift --preview icon.png` to look at it, including the
small sizes, without rebuilding.

## Linux (Electron, AppImage)

Targets Ubuntu 22.04+, Fedora 39+ and Debian 12+, on x86-64 and ARM64, under
Wayland or X11. Requirements to build: Node 22+ (24 recommended), on Linux.

```sh
npm --prefix core ci
npm --prefix linux ci
npm --prefix linux run dist     # linux/release/MDView-1.0.0-linux-<arch>.AppImage (host architecture)
chmod +x linux/release/MDView-*.AppImage
linux/release/MDView-1.0.0-linux-x86_64.AppImage ~/Projects/observy-rs
```

The AppImage is portable: it uses AppImage's static runtime, so it needs no
zlib or libfuse2 on the system (only FUSE, or `--appimage-extract-and-run`
where FUSE is unavailable, e.g. in containers). During development,
`npm --prefix linux start` builds and runs the app from source.

How the shell is put together:

- The **main process** (`linux/src/main`) owns windows, the menu bar, dialogs, the
  workspace scan (with `.gitignore` support), the recursive `@parcel/watcher`
  (inotify) watcher, atomic writes, the `mdview://` scheme (one session per
  workspace window, so `mdview://ws/` never serves files outside that workspace),
  and settings and session state in `~/.config/MDView/` (`settings.json`,
  `session.json`).
- The **shell UI** (`linux/src/shell`, plain TypeScript) draws the sidebar, tab
  bar, toolbar, quick open and the Welcome and Settings windows. Tabs are views
  inside the window's one renderer: each open document is the unchanged core in
  an iframe, at most 8 kept alive per window.
- The **preload** exposes the core's `HostBridge` (`window.mdviewHost`) in core
  frames and a narrow IPC surface in the shell frame. Context isolation,
  the renderer sandbox and no Node integration are on; navigation and new windows
  are blocked; Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
  `--inspect`, and the app only loads from its asar archive.
- Inside an AppImage, Chromium's sandbox needs unprivileged user namespaces. The
  launcher keeps the sandbox on where the kernel allows them and passes
  `--no-sandbox` where it does not (Ubuntu 23.10+ AppArmor policy, root).
- JetBrains Mono is bundled for code; prose uses the desktop's UI font. Light and
  dark follow the desktop setting.

Linux shortcuts follow the spec: Ctrl in place of ⌘, Ctrl+B toggles the sidebar
(inside the editor it makes text bold), Alt+←/→ go back and forward, F11 is full
screen, Ctrl+Alt+←/→ move between diagrams in the expanded viewer, Ctrl+H
replaces, F3 / Shift+F3 find next and previous. Diagram panning uses plain
click-drag, since many window managers take Alt+drag; Ctrl+scroll and the
toolbar zoom wherever pinch is unavailable (X11).

Not in 1.0.0 (from the spec's M7): `.deb` / `.rpm` packages, AppImage
auto-update, and spell checking (Electron would download dictionaries).
The embedded ASAR integrity fuse is not enabled: Electron documents it for macOS and Windows builds.

Headless checks work as on macOS: `mdview --render-check <folder>` and
`mdview --screenshot <file.md> <out.png>`.

### Tests

```sh
npm --prefix linux test          # typecheck, unit tests, end-to-end tests (Playwright drives the real app)
xvfb-run -a npm --prefix linux run test:e2e   # on a Linux machine without a display
node scripts/smoke-check.mjs <app binary or AppImage>   # packaged build renders the fixtures
```

The end-to-end suite also runs on macOS against the development build.
To build and test on Linux from a Mac, an Incus (or any) Ubuntu 22.04
container with Node 24, `xvfb` and the GTK/NSS runtime libraries is enough;
copy the tree without `node_modules` and run the same commands.

## Releases (GitHub Actions)

`.github/workflows/build.yml` runs on every push to `main` and every pull
request: it builds the macOS app for Apple Silicon (`macos-15`) and Intel
(`macos-15-intel`), smoke-tests each with `--render-check`, and packages a DMG;
on Linux it builds on `ubuntu-22.04` (amd64) and `ubuntu-22.04-arm` (arm64) for
older-glibc compatibility, runs the typecheck, unit and end-to-end tests under
Xvfb, packages the AppImage and smoke-tests it. The four packages are kept as
workflow artifacts.

To publish a release, keep `core/package.json` and `linux/package.json` at the
same version, then push a matching tag:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The release job attaches `MDView-1.0.0-macos-arm64.dmg`,
`MDView-1.0.0-macos-x86_64.dmg`, `MDView-1.0.0-linux-amd64.AppImage`,
`MDView-1.0.0-linux-arm64.AppImage` and `SHA256SUMS.txt`. "Run workflow" with
*draft release* creates a draft from any branch instead. The `ubuntu-22.04-arm`
runner is free for public repositories; a private repository needs a plan
with Linux ARM64 hosted runners.

## Reading diagrams

| Input | Inline diagram | Expanded viewer |
| --- | --- | --- |
| Two-finger scroll / wheel | scrolls the page | pans |
| Pinch, or ⌘ + scroll | zooms around the cursor | zooms around the cursor |
| ⌥ + scroll, or drag | pans | pans |
| Double click / ⌥ double click | zoom 2× / fit | zoom 2× / fit |
| ⇧ double click, ⌘↩, Expand button | opens the expanded viewer | — |
| Keys (after clicking) | + − 0 1, arrows, Esc | same, M minimap, ⌘F find, ⌘⌥←/→ next diagram |

A diagram becomes "engaged" after a pinch; two-finger scroll then pans it until
the pointer leaves or Esc is pressed. Syntax errors show an error card with the
offending line, and the last good render stays visible while you fix it.

## Diagram style

Diagrams use MDView's own palette by default (Settings → Diagrams → Diagram
style), with light and dark variants that follow the app's appearance:

- Soft tinted fills, thin borders a shade darker, and rounded corners.
- Colour carries meaning: decisions are amber, start and end steps green,
  databases violet. Each subgraph gets its own pale tint, and its nodes share it.
- Sequence actors, classes and ER entities each get their own colour.

Your own `style`, `classDef` and `linkStyle` statements still take precedence.
The styling is embedded in the SVG, so copied and exported diagrams look the
same. Mermaid's built-in themes remain available in the same menu.

## B-Method

Fences tagged `b`, `bmethod`, `b-method`, `classicalb`, `mch`, `ref`, `imp` or
`prob` are highlighted as classical B. Untagged fences are detected
automatically: a block with strong B signals (clauses such as `MACHINE` or
`INVARIANT`, `:=`, `<--`, `|->`, quantifiers, `x : SET` typing, ProB traces)
is highlighted as B, and once a document is known to be about B, looser
snippets and `diff` blocks are highlighted as B too (`diff-b` forces it). The
editor highlights B fences with a matching CodeMirror mode.

## Core development

```sh
cd core
npm run build            # dist/: renderer.js + lazy chunks, app.css, index.html
npm run watch
npm test                 # typecheck, interaction tests (WebKit + Chromium), fixture corpus
node test/corpus.mjs --root ../../observy-rs --engine webkit,chromium
node test/corpus.mjs --root ../../formal-method-workbench --shots /tmp/shots
```

The corpus test renders every markdown file under a folder headlessly, renders
all diagrams, reports Mermaid and page errors, and compares diagram geometry
between WebKit and Chromium. Fixtures can declare deliberate failures with
`<!-- expect-mermaid-errors: N -->`.

The core never touches the file system. Shells talk to it only through the
`HostBridge` messages in [core/src/bridge.ts](core/src/bridge.ts).
