# MDView

A Mermaid-first markdown previewer for project docs written by agents. Any
Mermaid diagram, however large, can be zoomed, panned and read comfortably;
code blocks are highlighted with VS Code grammars, including **B-Method**.

The product spec is in [docs/SPEC.md](docs/SPEC.md). This repository holds the
shared rendering core and the native macOS shell; the Linux (Electron) shell is
a later milestone.

```
core/    TypeScript rendering core (markdown-it, Shiki, Mermaid viewer, CodeMirror editor)
macos/   Swift/SwiftUI shell around WKWebView (Swift Package)
scripts/ build-app.sh, make-dmg.sh, make-icon.swift
docs/    product spec
```

## Build and run (macOS 14+)

Requirements: Xcode command-line tools (Swift 6), Node 20+.

```sh
npm --prefix core install
scripts/build-app.sh          # builds core/dist, the Swift shell, and build/MDView.app
open build/MDView.app --args ~/Projects/observy-rs
```

Drop a folder (or a `.md` file) on the window or the Dock icon to open it as a
workspace. `scripts/make-dmg.sh` packages `build/MDView.dmg`.

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
