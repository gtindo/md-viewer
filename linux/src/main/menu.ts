// The menu bar of every window, with the Linux shortcuts from the spec. Workspace
// commands are forwarded to the window's shell; app-wide ones run here.

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { FONT_SIZE_RANGE, type MenuState, type Preferences } from "../common/types";

export interface MenuHost {
  /** Workspace command for the shell of `win` (null for windows without a workspace). */
  command(win: BrowserWindow, command: string, arg?: unknown): void;
  newWindow(): void;
  openFolder(win: BrowserWindow | null): void;
  openFile(win: BrowserWindow | null): void;
  openRecent(path: string): void;
  clearRecents(): void;
  showSettings(): void;
  zoomText(delta: number | 0): void;
  setWidth(width: Preferences["core"]["width"]): void;
  toggleFullScreen(win: BrowserWindow): void;
  about(win: BrowserWindow): void;
  quit(): void;
  recents(): string[];
  prefs(): Preferences;
  devTools: boolean;
}

const MODES = ["preview", "split", "edit"] as const;
const WIDTHS = ["readable", "wide", "full"] as const;
const LABEL = { preview: "Preview", split: "Split", edit: "Edit", readable: "Readable", wide: "Wide", full: "Full" };

/** Items that need an open tab. */
const NEEDS_TAB = [
  "toggleEditMode", "cycleModes", "revealInTree", "find", "findNext", "findPrevious", "replace",
  "bold", "italic", "link", "expandFocusedDiagram", "nextDiagram", "previousDiagram",
];

export function buildMenu(host: MenuHost, win: BrowserWindow, workspace: boolean): Menu {
  const cmd = (id: string, label: string, accelerator?: string, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    enabled: workspace,
    click: () => host.command(win, id),
    ...extra,
  });
  const sep: MenuItemConstructorOptions = { type: "separator" };
  const recents = host.recents();
  const prefs = host.prefs();

  const file: MenuItemConstructorOptions[] = [
    { label: "New Window", accelerator: "Ctrl+N", click: () => host.newWindow() },
    sep,
    { label: "Open Folder…", accelerator: "Ctrl+O", click: () => host.openFolder(win) },
    { label: "Open File…", accelerator: "Ctrl+Shift+O", click: () => host.openFile(win) },
    {
      label: "Open Recent",
      submenu: [
        ...recents.map((p) => ({ label: `${path.basename(p)}  —  ${p}`, click: () => host.openRecent(p) })),
        ...(recents.length ? [sep] : []),
        { label: "Clear Menu", enabled: recents.length > 0, click: () => host.clearRecents() },
      ],
    },
    cmd("quickOpen", "Quick Open…", "Ctrl+P"),
    sep,
    cmd("save", "Save", "Ctrl+S"),
    cmd("saveAs", "Save As…", "Ctrl+Shift+S"),
    sep,
    { id: "closeTab", label: workspace ? "Close Tab" : "Close", accelerator: "Ctrl+W", click: () => (workspace ? host.command(win, "closeTab") : win.close()) },
    cmd("reopenClosedTab", "Reopen Closed Tab", "Ctrl+Shift+T"),
    { label: "Close Window", accelerator: "Ctrl+Shift+W", click: () => win.close() },
    sep,
    { label: "Settings…", accelerator: "Ctrl+,", click: () => host.showSettings() },
    sep,
    { label: "Quit", accelerator: "Ctrl+Q", click: () => host.quit() },
  ];

  const edit: MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo", accelerator: "Ctrl+Shift+Z" },
    sep,
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
    sep,
    cmd("find", "Find…", "Ctrl+F"),
    cmd("findNext", "Find Next", "F3"),
    cmd("findPrevious", "Find Previous", "Shift+F3"),
    cmd("replace", "Replace…", "Ctrl+H"),
    sep,
    {
      label: "Format",
      submenu: [
        // The editor handles these keys itself (Ctrl+B also toggles the sidebar outside it).
        cmd("bold", "Bold", "Ctrl+B", { registerAccelerator: false }),
        cmd("italic", "Italic", "Ctrl+I", { registerAccelerator: false }),
        cmd("link", "Link", "Ctrl+K", { registerAccelerator: false }),
      ],
    },
  ];

  const view: MenuItemConstructorOptions[] = [
    ...MODES.map((m) =>
      cmd(`mode-${m}`, LABEL[m], undefined, { type: "radio", click: () => host.command(win, "setMode", m) }),
    ),
    cmd("toggleEditMode", "Toggle Preview / Edit", "Ctrl+E"),
    cmd("cycleModes", "Cycle Modes", "Ctrl+Shift+P"),
    sep,
    cmd("toggleSidebar", "Toggle Sidebar", "Ctrl+B", { type: "checkbox", checked: true }),
    cmd("revealInTree", "Reveal in Tree", "Ctrl+Shift+J"),
    sep,
    {
      label: "Content Width",
      submenu: WIDTHS.map((w) => ({
        id: `width-${w}`,
        label: LABEL[w],
        type: "radio" as const,
        checked: prefs.core.width === w,
        click: () => host.setWidth(w),
      })),
    },
    { id: "zoomIn", label: "Zoom In", accelerator: "Ctrl+=", click: () => host.zoomText(1) },
    { id: "zoomOut", label: "Zoom Out", accelerator: "Ctrl+-", click: () => host.zoomText(-1) },
    { id: "actualSize", label: "Actual Size", accelerator: "Ctrl+0", click: () => host.zoomText(0) },
    sep,
    cmd("expandFocusedDiagram", "Expand Focused Diagram", "Ctrl+Enter"),
    cmd("nextDiagram", "Next Diagram", "Ctrl+Alt+Right"),
    cmd("previousDiagram", "Previous Diagram", "Ctrl+Alt+Left"),
    sep,
    { label: "Full Screen", accelerator: "F11", click: () => host.toggleFullScreen(win) },
    ...(host.devTools ? [sep, { label: "Developer Tools", accelerator: "Ctrl+Shift+I", click: () => win.webContents.toggleDevTools() }] : []),
  ];

  const go: MenuItemConstructorOptions[] = [
    cmd("goBack", "Back", "Alt+Left"),
    cmd("goForward", "Forward", "Alt+Right"),
    sep,
    cmd("nextTab", "Next Tab", "Ctrl+Tab"),
    cmd("previousTab", "Previous Tab", "Ctrl+Shift+Tab"),
    sep,
    ...Array.from({ length: 9 }, (_, i) =>
      cmd(`tab-${i + 1}`, i === 8 ? "Last Tab" : `Tab ${i + 1}`, `Ctrl+${i + 1}`, { click: () => host.command(win, "selectTab", i + 1) }),
    ),
  ];

  const help: MenuItemConstructorOptions[] = [{ label: "About MDView", click: () => host.about(win) }];

  const menu = Menu.buildFromTemplate([
    { label: "&File", submenu: file },
    { label: "&Edit", submenu: edit },
    { label: "&View", submenu: view },
    ...(workspace ? [{ label: "&Go", submenu: go }] : []),
    { label: "&Help", submenu: help },
  ]);
  updateMenu(menu, null, prefs);
  return menu;
}

/** Enables and checks items from the window's state (the menu analogue of validateMenuItem). */
export function updateMenu(menu: Menu, state: MenuState | null, prefs: Preferences): void {
  const set = (id: string, enabled: boolean, checked?: boolean) => {
    const item = menu.getMenuItemById(id);
    if (!item) return;
    item.enabled = enabled;
    if (checked !== undefined) item.checked = checked;
  };
  const hasTab = !!state?.hasTab;
  set("save", !!state?.editable);
  set("saveAs", !!state?.editable);
  set("reopenClosedTab", !!state?.canReopen);
  for (const m of MODES) set(`mode-${m}`, hasTab, state?.mode === m);
  for (const id of NEEDS_TAB) set(id, hasTab);
  set("goBack", !!state?.canGoBack);
  set("goForward", !!state?.canGoForward);
  set("nextTab", (state?.tabCount ?? 0) > 1);
  set("previousTab", (state?.tabCount ?? 0) > 1);
  for (let n = 1; n <= 9; n++) set(`tab-${n}`, n === 9 ? (state?.tabCount ?? 0) > 0 : (state?.tabCount ?? 0) >= n);
  if (state) set("toggleSidebar", true, state.sidebarVisible);
  for (const w of WIDTHS) {
    const item = menu.getMenuItemById(`width-${w}`);
    if (item) item.checked = prefs.core.width === w;
  }
  set("zoomIn", prefs.core.fontSize < FONT_SIZE_RANGE[1]);
  set("zoomOut", prefs.core.fontSize > FONT_SIZE_RANGE[0]);
  if (state) set("quickOpen", true);
}
