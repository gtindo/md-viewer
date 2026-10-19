// Typed access to the preload's `mdviewShell` IPC surface.

import type {
  FileOp, FileOpResult, FilterMode, FsChange, InitInfo, LinkAction, LoadedFile, MenuState, Preferences,
  ReadResult, TreeSnapshot, WorkspacePrefs, WorkspaceSession, WriteResult,
} from "../common/types";

interface ShellAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, cb: (...args: never[]) => void): void;
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    mdviewShell: ShellAPI;
  }
}

const api = () => window.mdviewShell;
const invoke = <T>(channel: string, ...args: unknown[]) => api().invoke(channel, ...args) as Promise<T>;

export type SessionTabs = Pick<WorkspaceSession, "tabs" | "activeIndex" | "sidebarVisible" | "sidebarWidth">;

export const host = {
  init: () => invoke<InitInfo>("init"),
  tree: (mode: FilterMode) => invoke<TreeSnapshot>("tree:get", mode),
  rescan: () => invoke<void>("tree:rescan"),
  read: (path: string) => invoke<ReadResult>("file:read", path),
  exists: (path: string) => invoke<boolean>("file:exists", path),
  write: (path: string, text: string, like: LoadedFile) => invoke<WriteResult>("file:write", path, text, like),
  saveAs: (path: string, text: string, like: LoadedFile) => invoke<WriteResult>("file:saveAs", path, text, like),
  uniqueName: (dir: string, base: string) => invoke<string>("file:uniqueName", dir, base),
  fileOp: (op: FileOp, path: string, name?: string) => invoke<FileOpResult>("file:op", op, path, name),
  resolveLink: (from: string, href: string, anchor: string | undefined, external: boolean) =>
    invoke<LinkAction>("link:resolve", from, href, anchor, external),
  setWorkspacePrefs: (prefs: WorkspacePrefs) => invoke<void>("ws:setPrefs", prefs),
  setSession: (s: SessionTabs) => invoke<void>("ws:session", s),
  setDirty: (titles: string[]) => invoke<void>("ws:dirty", titles),
  setMenuState: (s: MenuState) => invoke<void>("ws:menuState", s),
  saveAllResult: (id: number, ok: boolean) => invoke<void>("ws:saveAllResult", id, ok),
  copy: (msg: unknown) => invoke<void>("clipboard:write", msg),
  exportDiagram: (msg: unknown, dir: string) => invoke<boolean>("export", msg, dir),
  setFullScreen: (on: boolean) => invoke<void>("window:fullScreen", on),
  setTitle: (title: string) => invoke<void>("window:title", title),
  treeMenu: (node: { path: string; dir: boolean } | null) => invoke<string | null>("menu:tree", node),
  tabMenu: (tab: { pinned: boolean; hasRight: boolean; hasOthers: boolean }) => invoke<string | null>("menu:tab", tab),
  tabsMenu: (titles: string[], active: number) => invoke<string | null>("menu:tabs", titles, active),
  confirmClose: (title: string) => invoke<"save" | "discard" | "cancel">("dialog:confirmClose", title),
  showError: (message: string, detail?: string) => invoke<void>("dialog:error", message, detail),
  openFolderDialog: () => invoke<void>("open:folderDialog"),
  openFileDialog: () => invoke<void>("open:fileDialog"),
  openPaths: (paths: string[]) => invoke<void>("open:paths", paths),
  clearRecents: () => invoke<void>("recents:clear"),
  setPrefs: (prefs: Preferences) => invoke<void>("settings:set", prefs),
  openSettings: () => invoke<void>("settings:open"),
  openExternal: (url: string) => invoke<void>("external:open", url),
  beep: () => void invoke<void>("app:beep"),
  log: (message: string) => void invoke<void>("debug:log", message),

  onTreeChanged: (cb: () => void) => api().on("tree:changed", cb),
  onFsChanged: (cb: (c: FsChange) => void) => api().on("fs:changed", cb),
  onCommand: (cb: (command: string, arg?: unknown) => void) => api().on("menu:command", cb),
  onSettings: (cb: (p: Preferences) => void) => api().on("settings:changed", cb),
  onOpenFile: (cb: (path: string) => void) => api().on("open:file", cb),
  onSaveAll: (cb: (id: number) => void) => api().on("window:saveAll", cb),
  onFullScreen: (cb: (on: boolean) => void) => api().on("window:fullScreenChanged", cb),
  onRecents: (cb: (recents: string[]) => void) => api().on("recents:changed", cb),
  onBlur: (cb: () => void) => api().on("window:blur", cb),
  pathForFile: (file: File) => api().pathForFile(file),
};

/** Paths of files dropped from the desktop (folders included). */
export function droppedPaths(e: DragEvent): string[] {
  const out: string[] = [];
  for (const f of Array.from(e.dataTransfer?.files ?? [])) {
    const p = host.pathForFile(f);
    if (p) out.push(p);
  }
  return out;
}

/** Opens files and folders dropped anywhere on `el` that is not handled more specifically. */
export function acceptFileDrops(el: HTMLElement, onDrop: (paths: string[]) => void = (p) => void host.openPaths(p)): void {
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  el.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    document.body.classList.add("drop-target");
  });
  el.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) document.body.classList.remove("drop-target");
  });
  el.addEventListener("drop", (e) => {
    document.body.classList.remove("drop-target");
    if (!hasFiles(e)) return;
    e.preventDefault();
    const paths = droppedPaths(e);
    if (paths.length) onDrop(paths);
  });
}
