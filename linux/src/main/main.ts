// MDView for Linux: the Electron main process. It owns windows, menus, dialogs, files,
// watching and persisted state; each window's shell UI (tree, tabs, toolbar) and the
// shared core run in that window's renderer.

import {
  app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell,
  type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as files from "./fileservice";
import { buildMenu, updateMenu, type MenuHost } from "./menu";
import { distDir, installProtocol, registerScheme } from "./protocol";
import { svgToPng } from "./raster";
import { defaultPreferences, Store } from "./store";
import { parseVerification, runVerification } from "./verify";
import { debugLog, Workspace } from "./workspace";
import type {
  FileOp, FilterMode, InitInfo, LoadedFile, MenuState, Preferences, WorkspacePrefs, WorkspaceSession,
} from "../common/types";

registerScheme();
app.setName("MDView");
if (process.env.MDVIEW_CONFIG_DIR) app.setPath("userData", process.env.MDVIEW_CONFIG_DIR);

const userArgs = process.argv.slice(process.defaultApp ? 2 : 1);
const preloadPath = path.join(__dirname, "preload.js");
const iconPath = () => path.join(distDir(), "icon.png");

// ---------------------------------------------------------------------------
// Verification modes (headless; no single-instance lock, no windows on screen)

const verification = parseVerification(userArgs);
if (verification) {
  app.whenReady().then(async () => {
    if ("error" in verification) {
      process.stderr.write(verification.error + "\n");
      app.exit(2);
      return;
    }
    const code = await runVerification(verification, preloadPath).catch((e) => {
      process.stderr.write(`MDView: ${e}\n`);
      return 2;
    });
    app.exit(code);
  });
} else if (!app.requestSingleInstanceLock({ argv: userArgs, cwd: process.cwd() })) {
  app.exit(0);
} else {
  startApp();
}

// ---------------------------------------------------------------------------
// Windows

interface WorkspaceWindow {
  kind: "workspace";
  win: BrowserWindow;
  ws: Workspace;
  menu: Menu;
  state: MenuState | null;
  /** The latest tab session reported by the shell. */
  tabs: Pick<WorkspaceSession, "tabs" | "activeIndex" | "sidebarVisible" | "sidebarWidth">;
  restore?: WorkspaceSession;
  dirty: string[];
  closeConfirmed: boolean;
  initialized: boolean;
  pendingOpen: string[];
}

interface UtilityWindow {
  kind: "welcome" | "settings";
  win: BrowserWindow;
  menu: Menu;
}

type AppWindow = WorkspaceWindow | UtilityWindow;

function startApp(): void {
  const store = new Store();
  const windows = new Map<number, AppWindow>(); // by webContents id
  let welcome: UtilityWindow | null = null;
  let settingsWindow: UtilityWindow | null = null;
  let partitionCounter = 0;
  let quitting = false;
  let quitConfirmed = false;
  const devTools = !app.isPackaged || !!process.env.MDVIEW_DEBUG;

  const workspaceWindows = () => [...windows.values()].filter((w): w is WorkspaceWindow => w.kind === "workspace");

  store.collectWorkspaces = () =>
    workspaceWindows().map((w) => {
      const b = w.win.getNormalBounds();
      return {
        root: w.ws.root,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.win.isMaximized() },
        ...w.tabs,
      };
    });

  // ---- Menus --------------------------------------------------------------

  const menuHost: MenuHost = {
    command: (win, command, arg) => send(win.webContents, "menu:command", command, arg),
    newWindow: () => showWelcome(),
    openFolder: (win) => void openFolderDialog(win),
    openFile: (win) => void openFileDialog(win),
    openRecent: (p) => {
      fs.access(p).then(() => openPaths([p]), () => shell.beep());
    },
    clearRecents: () => {
      store.clearRecents();
      recentsChanged();
    },
    showSettings: () => showSettings(),
    zoomText: (delta) => {
      const p = clonePrefs();
      p.core.fontSize = delta === 0 ? defaultPreferences().core.fontSize : p.core.fontSize + delta;
      setPrefs(p);
    },
    setWidth: (width) => {
      const p = clonePrefs();
      p.core.width = width;
      setPrefs(p);
    },
    toggleFullScreen: (win) => win.setFullScreen(!win.isFullScreen()),
    about: (win) =>
      void dialog.showMessageBox(win, {
        type: "info",
        title: "About MDView",
        icon: nativeImage.createFromPath(iconPath()),
        message: `MDView ${app.getVersion()}`,
        detail:
          "Markdown and Mermaid, readable at any size.\n\n" +
          `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n` +
          `© ${new Date().getFullYear()} Yvan Guekeng`,
        buttons: ["OK"],
        noLink: true,
      }),
    quit: () => app.quit(),
    recents: () => store.session.recent,
    prefs: () => store.prefs,
    devTools,
  };

  function rebuildMenus(): void {
    for (const w of windows.values()) {
      w.menu = buildMenu(menuHost, w.win, w.kind === "workspace");
      if (w.kind === "workspace") updateMenu(w.menu, w.state, store.prefs);
      w.win.setMenu(w.menu);
    }
  }

  function recentsChanged(): void {
    rebuildMenus();
    for (const w of windows.values()) send(w.win.webContents, "recents:changed", store.session.recent);
  }

  // ---- Preferences --------------------------------------------------------

  const clonePrefs = (): Preferences => JSON.parse(JSON.stringify(store.prefs));

  function setPrefs(next: Preferences): void {
    const old = store.prefs;
    store.setPrefs(next);
    const p = store.prefs;
    for (const w of windows.values()) {
      send(w.win.webContents, "settings:changed", p);
      if (w.kind === "workspace") updateMenu(w.menu, w.state, p);
    }
    if (old.respectGitignore !== p.respectGitignore || old.extraIgnoreGlobs !== p.extraIgnoreGlobs) {
      for (const w of workspaceWindows()) w.ws.rescan();
    }
  }

  // ---- Window creation ----------------------------------------------------

  function send(wc: WebContents, channel: string, ...args: unknown[]): void {
    if (!wc.isDestroyed()) wc.send(channel, ...args);
  }

  function backgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff";
  }

  function harden(win: BrowserWindow): void {
    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    // Only our own pages may load. A file dropped onto a document navigates to file://:
    // open it instead, as the macOS shell does.
    wc.on("will-frame-navigate", (e) => {
      const url = e.url;
      if (url.startsWith("mdview://app/")) return;
      e.preventDefault();
      if (url.startsWith("file://")) {
        try {
          openPaths([decodeURIComponent(new URL(url).pathname)]);
        } catch {
          // ignore malformed URLs
        }
      } else if (/^(https?|mailto):/i.test(url) && e.isMainFrame === false) {
        void shell.openExternal(url);
      }
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("did-finish-load", () => void wc.setVisualZoomLevelLimits(1, 1));
    wc.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown" || !input.control || input.alt || input.meta) return;
      // Alternate spellings of menu shortcuts.
      if (input.key === "+") {
        e.preventDefault();
        menuHost.zoomText(1);
      } else if (input.key === "PageDown" || input.key === "PageUp") {
        const w = windows.get(wc.id);
        if (w?.kind !== "workspace") return;
        e.preventDefault();
        send(wc, "menu:command", input.key === "PageDown" ? "nextTab" : "previousTab");
      }
    });
    wc.on("render-process-gone", (_e, details) => {
      debugLog(`renderer gone: ${details.reason}`);
      if (details.reason !== "clean-exit" && !win.isDestroyed()) wc.reload();
    });
  }

  function createWindow(
    kind: AppWindow["kind"],
    root: string | null,
    options: Electron.BrowserWindowConstructorOptions,
  ): BrowserWindow {
    const partition = root ? `mdview-ws-${++partitionCounter}` : "mdview-ui";
    const ses = session.fromPartition(partition);
    if (root || !ses.protocol.isProtocolHandled("mdview")) installProtocol(ses, root);
    ses.setSpellCheckerEnabled(false);
    const win = new BrowserWindow({
      show: false,
      backgroundColor: backgroundColor(),
      icon: iconPath(),
      autoHideMenuBar: false,
      ...options,
      webPreferences: {
        preload: preloadPath,
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: true,
        backgroundThrottling: true,
      },
    });
    harden(win);
    win.once("ready-to-show", () => win.show());
    void win.loadURL(`mdview://app/shell/index.html?kind=${kind}`);
    return win;
  }

  function cascadeBounds(width: number, height: number): Electron.Rectangle {
    const last = BrowserWindow.getFocusedWindow() ?? workspaceWindows().at(-1)?.win;
    if (last && !last.isDestroyed()) {
      const b = last.getNormalBounds();
      return { x: b.x + 28, y: b.y + 28, width, height };
    }
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    };
  }

  function validBounds(b: WorkspaceSession["bounds"]): Electron.Rectangle | null {
    if (!b || b.width < 200 || b.height < 150) return null;
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y < area.y + area.height - 40 && b.y + b.height > area.y;
    return visible ? b : null;
  }

  async function openWorkspace(rootPath: string, restore?: WorkspaceSession, openFiles: string[] = []): Promise<WorkspaceWindow | null> {
    let root: string;
    try {
      root = await fs.realpath(rootPath);
    } catch {
      return null;
    }
    const existing = workspaceWindows().find((w) => w.ws.root === root);
    if (existing) {
      focus(existing.win);
      for (const f of openFiles) openInWindow(existing, f);
      return existing;
    }
    const bounds = validBounds(restore?.bounds) ?? cascadeBounds(1240, 820);
    const win = createWindow("workspace", root, { ...bounds, minWidth: 560, minHeight: 360, title: path.basename(root) });
    if (restore?.bounds?.maximized) win.once("ready-to-show", () => win.maximize());
    const w: WorkspaceWindow = {
      kind: "workspace",
      win,
      ws: null as unknown as Workspace,
      menu: buildMenu(menuHost, win, true),
      state: null,
      tabs: {
        tabs: restore?.tabs ?? [],
        activeIndex: restore?.activeIndex,
        sidebarVisible: restore?.sidebarVisible ?? true,
        sidebarWidth: restore?.sidebarWidth,
      },
      restore,
      dirty: [],
      closeConfirmed: false,
      initialized: false,
      pendingOpen: [...openFiles],
    };
    w.ws = new Workspace(
      root,
      () => store.prefs,
      () => send(win.webContents, "tree:changed"),
      (change) => send(win.webContents, "fs:changed", change),
      (abs) => openPaths([abs]),
    );
    win.setMenu(w.menu);
    const id = win.webContents.id;
    windows.set(id, w);
    void w.ws.start();

    win.on("close", (e) => {
      if (quitConfirmed || w.closeConfirmed || w.dirty.length === 0) return;
      e.preventDefault();
      void confirmClose(w);
    });
    win.on("closed", () => {
      w.ws.close();
      windows.delete(id);
      if (!quitting) store.scheduleSave();
    });
    for (const ev of ["resize", "move", "maximize", "unmaximize"] as const) win.on(ev as "resize", () => store.scheduleSave());
    win.on("blur", () => send(win.webContents, "window:blur"));
    win.on("enter-full-screen", () => send(win.webContents, "window:fullScreenChanged", true));
    win.on("leave-full-screen", () => send(win.webContents, "window:fullScreenChanged", false));

    store.noteRecent(root);
    recentsChanged();
    welcome?.win.close();
    store.scheduleSave();
    return w;
  }

  function focus(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function openInWindow(w: WorkspaceWindow, absFile: string): void {
    const rel = w.ws.relative(absFile);
    if (rel === null || rel === "") return;
    if (w.initialized) send(w.win.webContents, "open:file", rel);
    else w.pendingOpen.push(absFile);
  }

  async function openFile(file: string): Promise<void> {
    const abs = await files.canonical(file);
    const owner = workspaceWindows()
      .filter((w) => w.ws.relative(abs) !== null)
      .sort((a, b) => b.ws.root.length - a.ws.root.length)[0];
    if (owner) {
      focus(owner.win);
      openInWindow(owner, abs);
    } else {
      await openWorkspace(path.dirname(abs), undefined, [abs]);
    }
  }

  function openPaths(paths: string[]): void {
    void (async () => {
      for (const p of paths) {
        try {
          const st = await fs.stat(p);
          if (st.isDirectory()) await openWorkspace(p);
          else await openFile(p);
        } catch {
          debugLog(`cannot open ${p}`);
        }
      }
    })();
  }

  function showWelcome(): void {
    if (welcome && !welcome.win.isDestroyed()) return focus(welcome.win);
    const win = createWindow("welcome", null, { ...cascadeBounds(680, 440), resizable: false, maximizable: false, title: "Welcome to MDView" });
    const w: UtilityWindow = { kind: "welcome", win, menu: buildMenu(menuHost, win, false) };
    win.setMenu(w.menu);
    const id = win.webContents.id;
    windows.set(id, w);
    welcome = w;
    win.on("closed", () => {
      windows.delete(id);
      if (welcome === w) welcome = null;
    });
  }

  function showSettings(): void {
    if (settingsWindow && !settingsWindow.win.isDestroyed()) return focus(settingsWindow.win);
    const parent = BrowserWindow.getFocusedWindow() ?? undefined;
    const win = createWindow("settings", null, {
      ...cascadeBounds(600, 600),
      minWidth: 520,
      minHeight: 420,
      maximizable: false,
      minimizable: false,
      title: "Settings",
      parent,
    });
    const w: UtilityWindow = { kind: "settings", win, menu: buildMenu(menuHost, win, false) };
    win.setMenu(w.menu);
    const id = win.webContents.id;
    windows.set(id, w);
    settingsWindow = w;
    win.on("closed", () => {
      windows.delete(id);
      if (settingsWindow === w) settingsWindow = null;
    });
  }

  async function openFolderDialog(win: BrowserWindow | null): Promise<void> {
    const opts: Electron.OpenDialogOptions = {
      title: "Open Folder",
      buttonLabel: "Open",
      properties: ["openDirectory", "multiSelections", "createDirectory"],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (!r.canceled) openPaths(r.filePaths);
  }

  async function openFileDialog(win: BrowserWindow | null): Promise<void> {
    const opts: Electron.OpenDialogOptions = {
      title: "Open File",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }, { name: "All Files", extensions: ["*"] }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (!r.canceled) openPaths(r.filePaths);
  }

  // ---- Unsaved changes ----------------------------------------------------

  let saveRequest = 0;
  const saveWaiters = new Map<number, (ok: boolean) => void>();

  function requestSaveAll(w: WorkspaceWindow): Promise<boolean> {
    const id = ++saveRequest;
    return new Promise<boolean>((resolve) => {
      saveWaiters.set(id, resolve);
      send(w.win.webContents, "window:saveAll", id);
    });
  }

  async function askToSave(win: BrowserWindow | null, titles: string[], action: "closing" | "quitting"): Promise<"save" | "discard" | "cancel"> {
    const n = titles.length;
    const opts: Electron.MessageBoxOptions = {
      type: "warning",
      message:
        n === 1
          ? `Do you want to save the changes you made to “${titles[0]}”${action === "quitting" ? " before quitting" : ""}?`
          : `You have ${n} documents with unsaved changes. Save them before ${action}?`,
      detail: "Your changes will be lost if you don’t save them.",
      buttons: [n === 1 ? "Save" : "Save All", "Don’t Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return r.response === 0 ? "save" : r.response === 1 ? "discard" : "cancel";
  }

  async function confirmClose(w: WorkspaceWindow): Promise<void> {
    const answer = await askToSave(w.win, w.dirty, "closing");
    if (answer === "cancel") return;
    if (answer === "save" && !(await requestSaveAll(w))) return;
    w.closeConfirmed = true;
    if (!w.win.isDestroyed()) w.win.close();
  }

  app.on("before-quit", (e) => {
    if (quitConfirmed) return;
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      const dirty = workspaceWindows().filter((w) => w.dirty.length > 0);
      const titles = dirty.flatMap((w) => w.dirty);
      if (titles.length) {
        const answer = await askToSave(BrowserWindow.getFocusedWindow(), titles, "quitting");
        if (answer === "cancel") {
          quitting = false;
          return;
        }
        if (answer === "save") {
          for (const w of dirty) {
            if (!(await requestSaveAll(w))) {
              quitting = false;
              return;
            }
          }
        }
      }
      store.tracksOpenWorkspaces = true;
      await store.saveNow();
      store.tracksOpenWorkspaces = false;
      quitConfirmed = true;
      app.quit();
    })();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("second-instance", (_e, _argv, workingDirectory, data) => {
    const d = data as { argv?: string[]; cwd?: string } | null;
    const paths = pathArgs(d?.argv ?? [], d?.cwd ?? workingDirectory);
    if (paths.length) openPaths(paths);
    else {
      const any = BrowserWindow.getFocusedWindow() ?? workspaceWindows()[0]?.win ?? welcome?.win;
      if (any) focus(any);
      else showWelcome();
    }
  });

  // ---- IPC ----------------------------------------------------------------

  function fromShell(e: IpcMainInvokeEvent): AppWindow | null {
    if (e.senderFrame !== e.sender.mainFrame) return null;
    return windows.get(e.sender.id) ?? null;
  }

  function handle<A extends unknown[]>(channel: string, fn: (w: AppWindow, ...args: A) => unknown): void {
    ipcMain.handle(channel, (e, ...args) => {
      const w = fromShell(e);
      if (!w) throw new Error("not a shell frame");
      return fn(w, ...(args as A));
    });
  }

  function handleWs<A extends unknown[]>(channel: string, fn: (w: WorkspaceWindow, ...args: A) => unknown): void {
    handle<A>(channel, (w, ...args) => {
      if (w.kind !== "workspace") throw new Error("not a workspace window");
      return fn(w, ...args);
    });
  }

  handle("init", (w): InitInfo => {
    const base = { version: app.getVersion(), prefs: store.prefs, recents: store.session.recent };
    if (w.kind !== "workspace") return { kind: w.kind, ...base };
    w.initialized = true;
    const openFiles = w.pendingOpen.map((f) => w.ws.relative(f)).filter((r): r is string => !!r);
    w.pendingOpen = [];
    const wsPrefs: WorkspacePrefs = store.workspacePrefs(w.ws.root) ?? { filterMode: "markdown", expanded: [] };
    return { kind: "workspace", ...base, root: w.ws.root, name: w.ws.name, workspacePrefs: wsPrefs, session: w.restore, openFiles };
  });

  handleWs("tree:get", (w, mode: FilterMode) => w.ws.tree(mode));
  handleWs("tree:rescan", (w) => w.ws.rescan());
  handleWs("file:read", (w, rel: string) => w.ws.read(rel));
  handleWs("file:exists", (w, rel: string) => w.ws.exists(rel));
  handleWs("file:write", (w, rel: string, text: string, like: LoadedFile) => w.ws.write(rel, text, like));
  handleWs("file:uniqueName", (w, dir: string, base: string) => w.ws.uniqueName(dir, base));
  handleWs("file:op", (w, op: FileOp, rel: string, name?: string) => w.ws.fileOp(op, rel, name));
  handleWs("file:saveAs", async (w, rel: string, text: string, like: LoadedFile) => {
    const r = await dialog.showSaveDialog(w.win, {
      title: "Save As",
      defaultPath: w.ws.abs(rel),
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }, { name: "All Files", extensions: ["*"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (r.canceled || !r.filePath) return { ok: false, error: "canceled" };
    const result = await w.ws.writeTo(r.filePath, text, like);
    if (result.ok && result.path === undefined) openPaths([r.filePath]);
    return result;
  });
  handleWs("link:resolve", (w, from: string, href: string, anchor: string | undefined, external: boolean) =>
    w.ws.resolveLink(from, href, anchor, external),
  );
  handleWs("ws:setPrefs", (w, prefs: WorkspacePrefs) => store.setWorkspacePrefs(w.ws.root, prefs));
  handleWs("ws:session", (w, tabs: WorkspaceWindow["tabs"]) => {
    w.tabs = tabs;
    store.scheduleSave();
  });
  handleWs("ws:dirty", (w, titles: string[]) => {
    w.dirty = titles;
  });
  handleWs("ws:menuState", (w, state: MenuState) => {
    w.state = state;
    updateMenu(w.menu, state, store.prefs);
  });
  handleWs("ws:saveAllResult", (_w, id: number, ok: boolean) => {
    saveWaiters.get(id)?.(ok);
    saveWaiters.delete(id);
  });

  handle("clipboard:write", async (_w, msg: { text?: string; svg?: string; pngBase64?: string; asPng?: boolean; width?: number; height?: number }) => {
    if (msg.asPng && msg.svg) {
      const png = await svgToPng(msg.svg, msg.width ?? 800, msg.height ?? 600);
      if (png) await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
      else shell.beep();
      return;
    }
    const items: Record<string, string | Blob> = {};
    if (msg.svg !== undefined) {
      items["image/svg+xml"] = new Blob([msg.svg], { type: "image/svg+xml" });
      items["text/plain"] = msg.svg;
    } else if (msg.text !== undefined) {
      items["text/plain"] = msg.text;
    }
    if (msg.pngBase64) items["image/png"] = new Blob([Buffer.from(msg.pngBase64, "base64")], { type: "image/png" });
    if (Object.keys(items).length) await clipboard.write([new ClipboardItem(items)]);
  });

  handleWs("export", async (w, msg: { format: string; svg: string; suggestedName: string; width: number; height: number }, dir: string) => {
    const isPNG = msg.format === "png";
    const base = (msg.suggestedName || "diagram").replace(/\.(svg|png)$/i, "").replace(/[/\\]/g, "-") || "diagram";
    const r = await dialog.showSaveDialog(w.win, {
      title: isPNG ? "Export PNG" : "Export SVG",
      defaultPath: path.join(w.ws.abs(dir ?? ""), `${base}.${isPNG ? "png" : "svg"}`),
      filters: [isPNG ? { name: "PNG Image", extensions: ["png"] } : { name: "SVG Image", extensions: ["svg"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (r.canceled || !r.filePath) return false;
    try {
      if (isPNG) {
        const png = await svgToPng(msg.svg, msg.width, msg.height);
        if (!png) throw new Error("The diagram could not be rasterised.");
        await fs.writeFile(r.filePath, png);
      } else {
        await fs.writeFile(r.filePath, msg.svg, "utf8");
      }
      return true;
    } catch (e) {
      await dialog.showMessageBox(w.win, { type: "error", message: "The diagram could not be exported.", detail: (e as Error).message });
      return false;
    }
  });

  handle("window:fullScreen", (w, on: boolean) => {
    if (w.win.isFullScreen() !== on) w.win.setFullScreen(on);
  });
  handle("window:title", (w, title: string) => w.win.setTitle(title));

  function popup(win: BrowserWindow, template: (pick: (id: string) => void) => MenuItemConstructorOptions[]): Promise<string | null> {
    return new Promise((resolve) => {
      let done = false;
      const pick = (id: string) => {
        if (!done) {
          done = true;
          resolve(id);
        }
      };
      Menu.buildFromTemplate(template(pick)).popup({
        window: win,
        callback: () => setTimeout(() => !done && ((done = true), resolve(null)), 100),
      });
    });
  }

  handleWs("menu:tree", (w, node: { path: string; dir: boolean } | null) =>
    popup(w.win, (pick) => {
      const item = (id: string, label: string): MenuItemConstructorOptions => ({ label, click: () => pick(id) });
      return [
        item("newFile", "New File…"),
        item("newFolder", "New Folder…"),
        ...(node
          ? [{ type: "separator" as const }, item("rename", "Rename…"), item("duplicate", "Duplicate"), item("trash", "Move to Trash")]
          : []),
        { type: "separator" },
        item("reveal", "Open Containing Folder"),
        item("copyPath", "Copy Path"),
        item("copyRelativePath", "Copy Relative Path"),
        ...(node && !node.dir ? [item("openDefault", "Open in Default App")] : []),
      ];
    }),
  );

  handleWs("menu:tab", (w, tab: { pinned: boolean; hasRight: boolean; hasOthers: boolean }) =>
    popup(w.win, (pick) => [
      { label: "Close", click: () => pick("close") },
      { label: "Close Others", enabled: tab.hasOthers, click: () => pick("closeOthers") },
      { label: "Close to the Right", enabled: tab.hasRight, click: () => pick("closeRight") },
      { type: "separator" },
      ...(tab.pinned ? [] : [{ label: "Keep Open", click: () => pick("pin") }]),
      { label: "Copy Path", click: () => pick("copyPath") },
      { label: "Reveal in Tree", click: () => pick("reveal") },
    ]),
  );

  handleWs("menu:tabs", (w, titles: string[], active: number) =>
    popup(w.win, (pick) =>
      titles.map((t, i) => ({ label: t, type: "checkbox" as const, checked: i === active, click: () => pick(String(i)) })),
    ),
  );

  handle("dialog:confirmClose", async (w, title: string) => askToSave(w.win, [title], "closing"));
  handle("dialog:error", async (w, message: string, detail?: string) => {
    await dialog.showMessageBox(w.win, { type: "error", message, detail, buttons: ["OK"], noLink: true });
  });
  handle("open:folderDialog", (w) => openFolderDialog(w.win));
  handle("open:fileDialog", (w) => openFileDialog(w.win));
  handle("open:paths", (_w, paths: string[]) => openPaths(paths.filter((p) => typeof p === "string" && path.isAbsolute(p))));
  handle("recents:clear", () => menuHost.clearRecents());
  handle("settings:set", (_w, prefs: Preferences) => setPrefs(prefs));
  handle("settings:open", () => showSettings());
  handle("external:open", (_w, url: string) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
  handle("app:beep", () => shell.beep());
  handle("debug:log", (_w, message: string) => debugLog(message));

  // ---- Launch -------------------------------------------------------------

  nativeTheme.themeSource = "system";
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const launchPaths = pathArgs(userArgs, process.cwd());
    if (store.prefs.reopenWorkspaces) {
      store.tracksOpenWorkspaces = false;
      for (const ws of store.session.workspaces) {
        const ok = await fs.stat(ws.root).then((s) => s.isDirectory(), () => false);
        if (ok) await openWorkspace(ws.root, ws);
      }
      store.tracksOpenWorkspaces = true;
    }
    openPaths(launchPaths);
    setTimeout(() => {
      if (windows.size === 0) showWelcome();
    }, launchPaths.length ? 400 : 0);
  });
}

/** Folder and file paths among command-line arguments (flags are skipped). */
function pathArgs(argv: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) continue;
    out.push(path.resolve(cwd, a));
  }
  return out;
}
