// Entry point of the renderer page. Wires the HostBridge to the document view,
// the Mermaid viewer and (lazily) the editor.

import { BRIDGE_VERSION, defaultSettings, postToHost, type Banner, type HostToCore, type Mode, type Settings, type TabState } from "./bridge";
import { DocumentView } from "./renderer/document";
import { configKey, type MermaidOptions } from "./mermaid/engine";
import { isExpandedOpen, focusFind as focusDiagramFind, navigate as navigateDiagram, openExpanded } from "./mermaid/expanded";
import type { EditorHandle } from "./editor/editor";
import { initHighlighter } from "./renderer/highlight";

const settings: Settings = { ...defaultSettings };
let forcedAppearance: "light" | "dark" | null = null;
let mode: Mode = "preview";
let editor: EditorHandle | null = null;
let editorLoading: Promise<EditorHandle> | null = null;
let currentText = "";
let currentPath = "";
let editable = true;
let allowRemote = false;
let pendingState: TabState | null = null;
let splitRatio = 0.5;
let hostBanner: Banner | null = null;
let remoteBanner: Banner | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const main = $("#main");
const previewPane = $("#preview-pane");
const editorPane = $("#editor-pane");
const divider = $("#divider");
const bannerEl = $("#banner");
const docEl = $("#doc");

const media = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (forcedAppearance ? forcedAppearance === "dark" : media.matches);

function mermaidOptions(): MermaidOptions {
  const t = settings.mermaidTheme;
  return { theme: t === "auto" ? (isDark() ? "dark" : "default") : t };
}

const view = new DocumentView(previewPane, docEl, () => settings, mermaidOptions);
view.onBlockedRemote = (n) => {
  remoteBanner =
    n > 0 && !allowRemote
      ? {
          kind: "remoteImages",
          message: `${n} remote image${n === 1 ? " was" : "s were"} blocked.`,
          actions: [{ id: "loadRemoteImages", label: "Load Remote Images", primary: true }, { id: "dismissRemote", label: "Dismiss" }],
        }
      : null;
  renderBanners();
};

// ---------------------------------------------------------------------------
// Settings and appearance

function applySettings(): void {
  const root = document.documentElement;
  root.dataset.width = settings.width;
  root.style.setProperty("--base-size", `${settings.fontSize}px`);
  root.dataset.proseFont = settings.proseFont;
  root.classList.toggle("code-line-numbers", settings.codeLineNumbers);
  if (forcedAppearance) root.dataset.theme = forcedAppearance;
  else delete root.dataset.theme;
  editor?.setOptions({ lineNumbers: settings.editorLineNumbers, vim: settings.vim });
}

function onThemeOrConfigChange(): void {
  const k = configKey(mermaidOptions());
  if (k !== view.diagrams.configKey()) {
    view.diagrams.setConfigKey(k);
    view.diagrams.rerenderAll();
  }
}

media.addEventListener("change", () => {
  if (!forcedAppearance) onThemeOrConfigChange();
});

// ---------------------------------------------------------------------------
// Modes and editor

function loadEditor(): Promise<EditorHandle> {
  if (editor) return Promise.resolve(editor);
  editorLoading ??= import("./editor/editor").then(({ createEditor }) => {
    editor = createEditor(editorPane, {
      text: currentText,
      readOnly: !editable,
      lineNumbers: settings.editorLineNumbers,
      vim: settings.vim,
      onChange: (text) => onEditorChange(text),
      onScroll: (line) => onEditorScroll(line),
      onCursor: (cursor, line) => postToHost({ type: "editorStateChanged", cursor, scrollLine: line }),
      onSave: () => postToHost({ type: "save" }),
    });
    if (pendingState?.editorCursor !== undefined) editor.setCursor(pendingState.editorCursor);
    if (pendingState?.editorScrollLine !== undefined) editor.scrollToLine(pendingState.editorScrollLine);
    return editor;
  });
  return editorLoading;
}

let previewTimer = 0;
function onEditorChange(text: string): void {
  currentText = text;
  postToHost({ type: "edited", text });
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (mode === "edit") return;
    void view.render({ path: currentPath, text: currentText, allowRemoteImages: allowRemote });
  }, 150);
}

function onEditorScroll(line: number): void {
  if (mode !== "split" || !settings.scrollSync) return;
  view.scrollToFractionalLine(line);
}

async function setMode(next: Mode): Promise<void> {
  const prev = mode;
  mode = next;
  main.className = `mode-${next}`;
  if (next !== "preview") {
    const ed = await loadEditor();
    if (ed.getText() !== currentText) ed.setText(currentText);
    applySplit();
    if (prev === "preview") {
      // Bring the editor to where the reader was.
      ed.scrollToLine(view.topLine() + 1);
    }
    ed.focus();
  }
  if (next !== "edit" && prev === "edit" && view.text !== currentText) {
    await view.render({ path: currentPath, text: currentText, allowRemoteImages: allowRemote });
  }
  if (next === "preview" && editor) {
    const line = editor.topLine();
    if (prev === "edit") view.scrollToLine(Math.floor(line) + 1, false);
  }
}

function applySplit(): void {
  if (mode === "split") {
    editorPane.style.flexBasis = `${splitRatio * 100}%`;
  } else {
    editorPane.style.flexBasis = "";
  }
}

divider.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  const rect = main.getBoundingClientRect();
  const move = (ev: PointerEvent) => {
    splitRatio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
    applySplit();
  };
  const up = () => {
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", up);
    view.diagrams.relayout();
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", up);
});
divider.addEventListener("dblclick", () => {
  splitRatio = 0.5;
  applySplit();
});

// ⌥-click on a rendered block jumps the editor to its source line.
docEl.addEventListener(
  "click",
  (e) => {
    if (!e.altKey) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const line = Number(el.dataset.line) + 1;
    if (mode === "preview") postToHost({ type: "requestMode", mode: "split", line });
    else void loadEditor().then((ed) => ed.gotoLine(line));
  },
  true,
);

// ---------------------------------------------------------------------------
// Banners

function renderBanners(): void {
  const list = [hostBanner, remoteBanner].filter((b): b is Banner => !!b);
  bannerEl.innerHTML = "";
  bannerEl.hidden = list.length === 0;
  for (const b of list) {
    const div = document.createElement("div");
    div.className = `banner banner-${b.kind}`;
    const msg = document.createElement("span");
    msg.className = "banner-msg";
    msg.textContent = b.message;
    div.appendChild(msg);
    for (const a of b.actions) {
      const btn = document.createElement("button");
      btn.textContent = a.label;
      if (a.primary) btn.className = "primary";
      btn.addEventListener("click", () => onBannerAction(b, a.id));
      div.appendChild(btn);
    }
    bannerEl.appendChild(div);
  }
}

function onBannerAction(b: Banner, id: string): void {
  if (id === "dismissRemote") {
    remoteBanner = null;
    renderBanners();
    return;
  }
  if (id === "compare" && b.kind === "conflict" && b.theirs !== undefined) {
    void (async () => {
      if (mode === "preview") postToHost({ type: "requestMode", mode: "split" });
      const ed = await loadEditor();
      ed.showCompare(b.theirs!);
    })();
    return;
  }
  if (b.kind === "conflict") editor?.hideCompare();
  postToHost({ type: "bannerAction", id });
}

// ---------------------------------------------------------------------------
// Host messages

async function receive(msg: HostToCore): Promise<unknown> {
  switch (msg.type) {
    case "render": {
      const p = msg.payload;
      const pathChanged = p.path !== currentPath;
      currentPath = p.path;
      currentText = p.text;
      editable = p.editable !== false;
      allowRemote = !!p.allowRemoteImages;
      document.title = p.path.split("/").pop() ?? "";
      if (editor) {
        editor.setReadOnly(!editable);
        if (editor.getText() !== p.text) editor.setText(p.text, { preserveCursor: !pathChanged, newDocument: pathChanged });
        else if (pathChanged) editor.setText(p.text, { newDocument: true });
      }
      const ms = await view.render({ path: p.path, text: p.text, allowRemoteImages: allowRemote });
      if (document.hasFocus()) focusPreviewIfIdle();
      return { ms };
    }
    case "setSettings": {
      const before = configKey(mermaidOptions());
      const themesBefore = settings.codeThemeLight + settings.codeThemeDark;
      const diagramBefore = `${settings.diagramMaxHeight}|${settings.diagramSmallZoom}`;
      Object.assign(settings, msg.settings);
      applySettings();
      if (configKey(mermaidOptions()) !== before) onThemeOrConfigChange();
      if (settings.codeThemeLight + settings.codeThemeDark !== themesBefore && currentPath) {
        view.render({ path: currentPath, text: currentText, allowRemoteImages: allowRemote });
      }
      if (`${settings.diagramMaxHeight}|${settings.diagramSmallZoom}` !== diagramBefore || msg.settings.width || msg.settings.fontSize) {
        requestAnimationFrame(() => view.diagrams.relayout());
      }
      return true;
    }
    case "setTheme":
      forcedAppearance = msg.appearance;
      applySettings();
      onThemeOrConfigChange();
      return true;
    case "setMode":
      await setMode(msg.mode);
      return true;
    case "restoreState":
      pendingState = msg.state;
      if (msg.state.splitRatio) {
        splitRatio = msg.state.splitRatio;
        applySplit();
      }
      view.restore(msg.state);
      if (editor) {
        if (msg.state.editorCursor !== undefined) editor.setCursor(msg.state.editorCursor);
        if (msg.state.editorScrollLine !== undefined) editor.scrollToLine(msg.state.editorScrollLine);
      }
      return true;
    case "scrollToLine":
      if (mode !== "preview") (await loadEditor()).gotoLine(msg.line);
      if (mode !== "edit") view.scrollToLine(msg.line);
      return true;
    case "scrollToAnchor":
      return view.scrollToAnchor(msg.anchor);
    case "banner":
      hostBanner = msg.banner;
      if (!msg.banner) editor?.hideCompare();
      renderBanners();
      return true;
    case "getText":
      return { text: editor ? editor.getText() : currentText };
    case "getState":
      return {
        ...view.state(),
        editorCursor: editor?.cursor(),
        editorScrollLine: editor ? Math.floor(editor.topLine()) + 1 : undefined,
        splitRatio,
      } satisfies TabState;
    case "renderAllDiagrams":
      return view.diagrams.renderAll();
    case "markSaved":
      editor?.markClean();
      return true;
    case "command":
      return command(msg.command, msg.arg);
  }
  return null;
}

function editorFocused(): boolean {
  return !!editor && mode !== "preview" && (mode === "edit" || editor.hasFocus());
}

async function command(cmd: string, _arg?: unknown): Promise<unknown> {
  switch (cmd) {
    case "find":
      if (isExpandedOpen()) focusDiagramFind();
      else if (editorFocused()) editor!.command("find");
      else view.openFind();
      return true;
    case "findNext":
    case "findPrevious":
      if (editorFocused()) editor!.command(cmd);
      else view.findStep(cmd === "findNext" ? 1 : -1);
      return true;
    case "replace":
      if (mode === "preview") return false;
      (await loadEditor()).command("replace");
      return true;
    case "bold":
    case "italic":
    case "link":
      if (mode === "preview") return false;
      (await loadEditor()).command(cmd);
      return true;
    case "focusEditor":
      if (mode !== "preview") (await loadEditor()).focus();
      return true;
    case "expandFocusedDiagram": {
      const b = view.diagrams.focused();
      if (!b) return false;
      openExpanded(view.diagrams, b);
      return true;
    }
    case "nextDiagram":
    case "previousDiagram":
      if (!isExpandedOpen()) {
        const b = view.diagrams.focused() ?? view.diagrams.blocks.find((x) => x.lastGood);
        if (b) openExpanded(view.diagrams, b);
        return true;
      }
      await navigateDiagram(cmd === "nextDiagram" ? 1 : -1);
      return true;
  }
  return false;
}

// Keyboard fallbacks for hosts without a menu (browser harness, Linux web UI).
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && view && !isExpandedOpen()) view.closeFind();
});

// The document scrolls inside #preview-pane, not the page, so WebKit's keyboard scrolling
// (space, arrows, page keys) only works while focus is inside the pane. Park focus there
// whenever it would otherwise sit on the body.
function focusPreviewIfIdle(): void {
  const a = document.activeElement;
  if ((!a || a === document.body) && mode !== "edit") previewPane.focus({ preventScroll: true });
}
window.addEventListener("focus", focusPreviewIfIdle);
document.addEventListener("focusout", () => setTimeout(() => document.hasFocus() && focusPreviewIfIdle(), 0));

window.mdview = { receive, version: BRIDGE_VERSION };
// Warm the highlighter and its themes while the host reads the file.
void initHighlighter({ light: settings.codeThemeLight, dark: settings.codeThemeDark });
applySettings();
postToHost({ type: "ready", version: BRIDGE_VERSION });
