// HostBridge: the typed message contract between the shared core and a shell.
// The core never touches the file system; everything it needs arrives here.

export const BRIDGE_VERSION = 1;

export type Mode = "preview" | "split" | "edit";
export type WidthMode = "readable" | "wide" | "full";
export type Appearance = "light" | "dark";

export interface DiagramState {
  /** Zoom factor (1 = 100%). */
  zoom: number;
  /** Pan offset of the diagram's centre relative to the viewport centre, in diagram px. */
  cx: number;
  cy: number;
  /** User-chosen inline viewport height in px, if resized. */
  height?: number;
  /** True when the user changed zoom/pan away from the default fit. */
  touched?: boolean;
}

export interface TabState {
  scrollY?: number;
  /** Source line at the top of the preview, for robust restore after edits. */
  topLine?: number;
  /** Keyed by diagram key (index + source hash). */
  diagrams?: Record<string, DiagramState>;
  editorCursor?: number;
  editorScrollLine?: number;
  splitRatio?: number;
}

export interface Settings {
  width: WidthMode;
  fontSize: number;
  proseFont: "system" | "serif";
  codeThemeLight: string;
  codeThemeDark: string;
  codeLineNumbers: boolean;
  diagramMaxHeight: number; // percent of window height
  diagramSmallZoom: "actual" | "fit";
  showMinimap: boolean;
  mermaidTheme: "auto" | "default" | "dark" | "neutral" | "forest" | "base";
  editorLineNumbers: boolean;
  vim: boolean;
  scrollSync: boolean;
}

export const defaultSettings: Settings = {
  width: "readable",
  fontSize: 16,
  proseFont: "system",
  codeThemeLight: "github-light",
  codeThemeDark: "github-dark",
  codeLineNumbers: false,
  diagramMaxHeight: 70,
  diagramSmallZoom: "actual",
  showMinimap: true,
  mermaidTheme: "auto",
  editorLineNumbers: false,
  vim: false,
  scrollSync: true,
};

export interface RenderPayload {
  /** Path relative to the workspace root, using "/" separators. */
  path: string;
  text: string;
  /** False when the file could not be decoded as UTF-8; the editor is then read-only. */
  editable?: boolean;
  /** When set, the host replaced the document (live reload) rather than the user typing. */
  reason?: "open" | "reload" | "edit";
  allowRemoteImages?: boolean;
}

/** Messages the host sends to the core (Swift → JS via callAsyncJavaScript). */
export type HostToCore =
  | { type: "render"; payload: RenderPayload }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "setTheme"; appearance: Appearance | null }
  | { type: "setMode"; mode: Mode }
  | { type: "restoreState"; state: TabState }
  | { type: "scrollToLine"; line: number }
  | { type: "scrollToAnchor"; anchor: string }
  | { type: "command"; command: CoreCommand; arg?: unknown }
  | { type: "banner"; banner: Banner | null }
  /** Returns { text: string } — the editor's current text (or the last rendered text). */
  | { type: "getText" }
  /** Returns the TabState (scroll, diagram states, editor cursor). */
  | { type: "getState" }
  /** Renders every diagram now (not lazily); returns { count, errors }. Used by --render-check. */
  | { type: "renderAllDiagrams" }
  /** After the user saved: the current text is now the clean baseline. */
  | { type: "markSaved" };

export type CoreCommand =
  | "find"
  | "findNext"
  | "findPrevious"
  | "replace"
  | "expandFocusedDiagram"
  | "diagramFullScreenChanged"
  | "nextDiagram"
  | "previousDiagram"
  | "bold"
  | "italic"
  | "link"
  | "focusEditor";

export interface Banner {
  kind: "conflict" | "deleted" | "readonly" | "remoteImages" | "info";
  message: string;
  actions: { id: string; label: string; primary?: boolean }[];
  /** For conflict: the on-disk text, used by Compare. */
  theirs?: string;
}

/** Messages the core sends to the host (JS → Swift via WKScriptMessageHandler). */
export type CoreToHost =
  | { type: "ready"; version: number }
  | { type: "rendered"; path: string; ms: number; diagrams: number }
  | { type: "linkClicked"; href: string; resolvedPath?: string; anchor?: string; external?: boolean; modifier?: boolean }
  | { type: "hoverLink"; href: string | null }
  | { type: "scrollChanged"; scrollY: number; topLine: number }
  | { type: "diagramStateChanged"; key: string; state: DiagramState }
  | { type: "edited"; text: string }
  | { type: "editorStateChanged"; cursor: number; scrollLine: number }
  | { type: "renderError"; message: string; line?: number; diagram?: string }
  | { type: "diagramsRendered"; count: number; errors: { key: string; message: string; line?: number }[] }
  /**
   * Clipboard write. With `asPng`, the host rasterises `svg` (width×height, at 2×) and
   * puts a PNG on the pasteboard — WebKit taints canvases that draw foreignObject labels.
   */
  | { type: "copy"; text?: string; pngBase64?: string; svg?: string; asPng?: boolean; width?: number; height?: number }
  | { type: "export"; format: "svg" | "png"; svg: string; suggestedName: string; width: number; height: number }
  | { type: "requestMode"; mode: Mode; line?: number }
  | { type: "bannerAction"; id: string }
  | { type: "requestFullScreen"; on: boolean }
  | { type: "save" }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, { postMessage(msg: unknown): void }> };
    /** Electron preload exposes this via contextBridge. */
    mdviewHost?: { postMessage(msg: unknown): void; onMessage?(cb: (msg: HostToCore) => void): void };
    /** The core installs this; the macOS shell calls it with callAsyncJavaScript. */
    mdview?: { receive(msg: HostToCore): Promise<unknown>; [k: string]: unknown };
    /** Harness / tests can capture outgoing messages here. */
    __mdviewOutbox?: CoreToHost[];
  }
}

export function postToHost(msg: CoreToHost): void {
  try {
    const wk = window.webkit?.messageHandlers?.mdview;
    if (wk) return wk.postMessage(msg);
    if (window.mdviewHost) return window.mdviewHost.postMessage(msg);
  } catch (e) {
    console.error("postToHost failed", e);
  }
  (window.__mdviewOutbox ??= []).push(msg);
  if (msg.type === "log") console.log("[mdview]", msg.message);
}

export function log(message: string, level: "info" | "warn" | "error" = "info"): void {
  postToHost({ type: "log", level, message });
}
