# MDView

**A markdown reader and editor for documents with large, complex Mermaid
diagrams.**

Most previewers render a Mermaid diagram as a fixed-size image squeezed into
the text column. Once a flowchart, sequence or architecture diagram grows past
a few dozen nodes, its labels shrink until they are unreadable, and there is
no way to zoom in. MDView is built around fixing that:

- **Zoom and pan any diagram.** Pinch or ⌘/Ctrl + scroll zooms around the
  cursor, drag pans, double-click zooms in, and scrolling the page never gets
  stuck inside a diagram.
- **Expand it to the whole window.** The expanded viewer adds full screen, a
  minimap to see where you are, and search to jump between matching node
  labels.
- **Fix it while you read.** Open the source in a split editor next to the
  preview. A syntax error points to the offending line, and the last good
  version of the diagram stays visible while you fix it.
- **Copy or export it.** SVG or PNG, exactly as it looks on screen.

Around the diagrams, it is a full reader for a folder of markdown: a file tree,
tabs, wide content that uses the whole screen while prose stays readable, code
highlighted like VS Code (including classical **B-Method**), and live reload
that keeps your scroll position and zoom when a file changes on disk (handy
when coding agents write your plans and specs).

MDView runs on macOS 14+ (Apple Silicon and Intel) and on Linux (x86-64 and
ARM64; Ubuntu 22.04+, Fedora 39+, Debian 12+, Wayland or X11). It works
entirely offline and collects nothing.

## Install

Download the latest version from the [Releases page](../../releases).

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `MDView-<version>-macos-arm64.dmg` |
| macOS, Intel | `MDView-<version>-macos-x86_64.dmg` |
| Linux, x86-64 | `MDView-<version>-linux-amd64.AppImage` |
| Linux, ARM64 | `MDView-<version>-linux-arm64.AppImage` |

Each release lists SHA-256 checksums in `SHA256SUMS.txt`.

### macOS

Open the DMG and drag **MDView** to **Applications**.

The app is not notarized by Apple, so the first launch is blocked with "Apple
could not verify…". Open it once from **System Settings → Privacy & Security →
Open Anyway**; later launches work normally. Alternatively, run:

```sh
xattr -dr com.apple.quarantine /Applications/MDView.app
```

### Linux

The AppImage is a single portable file; nothing is installed system-wide.

```sh
chmod +x MDView-*-linux-*.AppImage
./MDView-1.0.0-linux-amd64.AppImage
```

AppImages need FUSE, which most desktops already have. Where it is missing
(for example in containers), run the file with `--appimage-extract-and-run`.
To get MDView in your application menu, use an AppImage manager such as
[Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher.

## Getting started

Open a **folder** (a repository, or a docs directory) as a workspace: use
**Open Folder…** on the welcome screen, drag the folder onto the window (or the
Dock icon on macOS), or pass it on the command line:

```sh
open -a MDView ~/Projects/my-repo                 # macOS
./MDView-1.0.0-linux-amd64.AppImage ~/Projects/my-repo   # Linux
```

Opening a single `.md` file opens its folder as the workspace, with that file
in a tab. Each workspace gets its own window, and MDView reopens your
workspaces, tabs and scroll positions the next time it starts.

### The file tree

The sidebar shows the folder's markdown files (`.md`, `.markdown`, `.mdx`) and
the folders that contain them, and updates as files are created or deleted.

- The menu at the bottom of the sidebar switches between **Markdown Only**,
  **Markdown + All Folders** and **All Files**.
- Type in the **Filter** field to find files by name.
- A small dot marks files changed in the last five minutes, so you can see what
  an agent just touched.
- `.git`, `node_modules` and anything in the workspace's `.gitignore` are
  hidden (you can change this, and add your own patterns, in Settings).
- Right-click for New File, New Folder, Rename, Duplicate, Move to Trash, Copy
  Path and more.

### Tabs

A **single click** opens a file in a *preview* tab (title in italics), which
the next single click reuses. **Double-click** a file, or start editing it, to
keep its tab open. Drag tabs to reorder them; right-click for Close Others and
Close to the Right. Links between markdown files open in tabs too, and
**Back** / **Forward** move through the files you followed.

### Preview, Split and Edit

Each tab can show the rendered document (**Preview**), the editor next to the
preview (**Split**), or the editor alone (**Edit**). Switch with the buttons in
the toolbar, ⌘E / Ctrl+E (Preview ↔ Edit), or ⌘⇧P / Ctrl+Shift+P (cycle).

The editor highlights markdown and the code inside fenced blocks, continues
lists when you press Enter, and has ⌘B / ⌘I / ⌘K (Ctrl on Linux) for bold,
italic and links. Optional line numbers and vim keybindings are in Settings.

Save with ⌘S / Ctrl+S. MDView keeps each file's line endings, byte-order mark
and final newline as they were. If a file changes on disk while you have
unsaved edits, a banner lets you **Keep Mine**, **Load Theirs** or **Compare**
the two side by side; nothing is overwritten silently. Autosave (on focus loss,
or after two seconds idle) can be turned on in Settings.

## Reading diagrams

Scrolling a document never gets stuck inside a diagram: a diagram only takes
over the scroll wheel once you have zoomed into it.

| Action | macOS | Linux |
| --- | --- | --- |
| Zoom around the cursor | pinch, or ⌘ + scroll | pinch (Wayland), or Ctrl + scroll |
| Pan | drag, or ⌥ + scroll | drag, or Alt + scroll |
| Zoom in 2× / fit | double-click / ⌥ double-click | double-click / Alt double-click |
| Open the expanded viewer | Expand button, ⇧ double-click, or ⌘↩ | Expand button, Shift double-click, or Ctrl+Enter |
| Keys (after clicking a diagram) | + − to zoom, 0 fit, 1 actual size, arrows to pan, Esc | same |

Every diagram has a toolbar (zoom out, zoom level, zoom in, fit, expand) and a
**More** menu to copy or export it as SVG or PNG, or to copy and view its
source. Drag the handle under a diagram to make its viewport taller.

The **expanded viewer** fills the document area and starts fitted to the
window. Press **M** to toggle the minimap, ⌘F / Ctrl+F to find text in the
diagram's labels, ⌘⌥← → / Ctrl+Alt+← → to move to the previous or next diagram,
⌃⌘F / F11 for full screen, and Esc to close.

If a diagram has a syntax error, MDView shows Mermaid's message with the
offending line highlighted and keeps the last good version visible while you
fix it.

### Diagram style

Diagrams use MDView's own palette by default, with light and dark variants
that follow your system appearance: soft tinted fills, rounded corners, and
colours that carry meaning (decisions are amber, start and end steps green,
databases violet; each subgraph gets its own tint). Your own `style`,
`classDef` and `linkStyle` statements still win. Mermaid's built-in themes are
available under **Settings → Diagrams → Diagram style**. Copied and exported
diagrams look exactly as they do on screen.

## B-Method

Code fences tagged `b`, `bmethod`, `b-method`, `classicalb`, `mch`, `ref`, `imp`
or `prob` are highlighted as classical B. Untagged fences are detected too: a
block with clear B signals (`MACHINE`, `INVARIANT`, `:=`, `<--`, `|->`,
quantifiers, ProB traces) is highlighted as B, and once a document is clearly
about B, smaller snippets and `diff` blocks follow (`diff-b` forces it).

## Keyboard shortcuts

All shortcuts are also in the menus.

| Action | macOS | Linux |
| --- | --- | --- |
| Open folder / file | ⌘O / ⌘⇧O | Ctrl+O / Ctrl+Shift+O |
| Quick open (find a file by name) | ⌘P | Ctrl+P |
| New window | ⌘N | Ctrl+N |
| Toggle sidebar | ⌃⌘S | Ctrl+B (outside the editor) |
| Reveal the current file in the tree | ⌘⇧J | Ctrl+Shift+J |
| Preview ↔ Edit / cycle modes | ⌘E / ⌘⇧P | Ctrl+E / Ctrl+Shift+P |
| Save / Save As | ⌘S / ⌘⇧S | Ctrl+S / Ctrl+Shift+S |
| Close tab / reopen closed tab | ⌘W / ⌘⇧T | Ctrl+W / Ctrl+Shift+T |
| Next / previous tab | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to tab 1–8 / last tab | ⌘1…⌘8 / ⌘9 | Ctrl+1…Ctrl+8 / Ctrl+9 |
| Back / forward | ⌘[ / ⌘] | Alt+← / Alt+→ |
| Find / next / previous | ⌘F / ⌘G / ⌘⇧G | Ctrl+F / F3 / Shift+F3 |
| Replace (editor) | ⌘⌥F | Ctrl+H |
| Bold / italic / link (editor) | ⌘B / ⌘I / ⌘K | Ctrl+B / Ctrl+I / Ctrl+K |
| Text size bigger / smaller / reset | ⌘+ / ⌘− / ⌘0 | Ctrl++ / Ctrl+− / Ctrl+0 |
| Expand the focused diagram | ⌘↩ | Ctrl+Enter |
| Next / previous diagram (expanded) | ⌘⌥→ / ⌘⌥← | Ctrl+Alt+→ / Ctrl+Alt+← |
| Full screen | ⌃⌘F | F11 |
| Settings | ⌘, | Ctrl+, |
| Quit | ⌘Q | Ctrl+Q |

## Settings

Open Settings with ⌘, / Ctrl+,.

- **General:** reopen workspaces on launch, the default mode for opened files,
  autosave, whether to respect `.gitignore`, and extra ignore patterns
  (gitignore syntax, one per line, e.g. `dist/` or `**/*.generated.md`).
- **Appearance:** content width (Readable, Wide, Full; also in the toolbar),
  base font size, prose font, light and dark code themes, line numbers in code
  blocks and in the editor, vim keybindings, scroll sync in Split mode.
- **Diagrams:** the inline height limit, whether small diagrams show at actual
  size or fit the width, the minimap, and the diagram style.

MDView stores its settings and session (open workspaces, tabs, recent folders)
in `~/Library/Application Support/MDView/` and the app's preferences on macOS,
and in `~/.config/MDView/` on Linux. Deleting them resets the app.

## Privacy

MDView never connects to the network. Documents are rendered from local files
only; images from the web are blocked until you click **Load Remote Images**
for that document. Raw HTML in markdown is sanitised, and Mermaid runs in
strict mode. There is no telemetry and no account.

## Troubleshooting

- **macOS says the app can't be verified:** see [macOS](#macos) above.
- **The AppImage does nothing when double-clicked:** make it executable
  (`chmod +x`), or run it from a terminal to see the error.
- **"FUSE" errors on Linux:** install FUSE (`fuse3` on Ubuntu/Debian/Fedora),
  or run with `--appimage-extract-and-run`.
- **Pinch-zoom doesn't work on Linux under X11:** this is a limitation of X11;
  use Ctrl + scroll, double-click, or the diagram toolbar.
- **A folder doesn't appear in the tree:** it contains no markdown, or it is
  ignored by `.gitignore`. Switch the sidebar to **All Files** or turn off
  **Respect .gitignore** in Settings.

To report a problem, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MDView is released under the [MIT License](LICENSE). It is a personal tool
shared as is; see [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs or
build on it. If you want to build it from source, see
[DEVELOPMENT.md](DEVELOPMENT.md).
