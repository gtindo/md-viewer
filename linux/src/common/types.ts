// Types shared by the Electron main process and the shell UI. The core's own message
// contract lives in core/src/bridge.ts and is imported from there.

import type { Mode, Settings, TabState, WidthMode } from "../../../core/src/bridge";

export type { Mode, Settings, TabState, WidthMode };

export type FilterMode = "markdown" | "markdownAndFolders" | "allFiles";
export type AutosaveMode = "off" | "onFocusLoss" | "afterIdle";

/** Everything persisted app-wide. `core` maps 1:1 onto bridge.ts `Settings`. */
export interface Preferences {
  core: Settings;
  reopenWorkspaces: boolean;
  defaultMode: Mode;
  autosave: AutosaveMode;
  respectGitignore: boolean;
  /** Newline-separated gitignore-style globs. */
  extraIgnoreGlobs: string;
}

export const FONT_SIZE_RANGE = [10, 32] as const;

export const CODE_THEMES = [
  "github-light", "github-dark", "light-plus", "dark-plus", "one-light", "one-dark-pro",
  "min-light", "min-dark", "solarized-light", "solarized-dark", "catppuccin-latte",
  "catppuccin-mocha", "nord", "vitesse-light", "vitesse-dark",
];

export interface WorkspacePrefs {
  filterMode: FilterMode;
  expanded: string[];
}

/** Persisted / reopenable description of a tab. */
export interface TabSnapshot {
  path: string;
  pinned: boolean;
  mode: Mode;
  state: TabState;
}

export interface WorkspaceSession {
  root: string;
  bounds?: { x: number; y: number; width: number; height: number; maximized?: boolean };
  tabs: TabSnapshot[];
  activeIndex?: number;
  sidebarVisible: boolean;
  sidebarWidth?: number;
}

/** A file as read from disk, with the formatting facts needed to write it back unchanged. */
export interface LoadedFile {
  /** Text with line endings normalised to "\n" and any BOM removed. */
  text: string;
  usesCRLF: boolean;
  hasTrailingNewline: boolean;
  hasBOM: boolean;
  isUTF8: boolean;
}

export type ReadResult = { ok: true; file: LoadedFile } | { ok: false; error: "missing" | "unreadable" };
export type WriteResult = { ok: true; file: LoadedFile; path?: string } | { ok: false; error: string };

/** One entry of the scanned workspace, already filtered for the tree's filter mode. */
export interface TreeNode {
  name: string;
  /** Workspace-relative path with "/" separators; "" for the root. */
  path: string;
  dir: boolean;
  mtime: number;
  md: boolean;
  children?: TreeNode[];
}

export interface TreeSnapshot {
  root: TreeNode | null;
  markdownPaths: string[];
  scanning: boolean;
}

/** What the shell should do after the user follows a link (resolved by the main process). */
export type LinkAction =
  | { kind: "none" }
  | { kind: "anchor"; anchor: string }
  | { kind: "tab"; path: string; anchor?: string }
  | { kind: "handled" };

export interface InitInfo {
  kind: "workspace" | "welcome" | "settings";
  version: string;
  prefs: Preferences;
  recents: string[];
  root?: string;
  name?: string;
  workspacePrefs?: WorkspacePrefs;
  session?: WorkspaceSession;
  /** Files to open once the workspace is ready (from the command line or a drop). */
  openFiles?: string[];
}

/** Menu state reported by a workspace window, used to enable and check menu items. */
export interface MenuState {
  hasTab: boolean;
  editable: boolean;
  mode: Mode | null;
  canGoBack: boolean;
  canGoForward: boolean;
  canReopen: boolean;
  tabCount: number;
  sidebarVisible: boolean;
}

export type FileOp =
  | "newFile" | "newFolder" | "rename" | "duplicate" | "trash"
  | "reveal" | "copyPath" | "copyRelativePath" | "openDefault";

export type FileOpResult = { ok: true; path?: string } | { ok: false; error?: string };

/** The workspace file changes the watcher reported, coalesced. */
export interface FsChange {
  paths: string[];
  structural: boolean;
}
