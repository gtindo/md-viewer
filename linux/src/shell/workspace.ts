// A workspace window's shell: sidebar (filter, tree, filter mode), toolbar, tab bar and
// the document views. Tab behaviour follows macos/.../Workspace/WorkspaceStore.swift.

import type { Banner, CoreCommand, CoreToHost, HostToCore, Mode, TabState } from "../../../core/src/bridge";
import type { FilterMode, FsChange, InitInfo, LoadedFile, MenuState, Preferences, TabSnapshot, TreeNode, WorkspaceSession } from "../common/types";
import { DocPool, type DocView } from "./docview";
import { basename, dirname, h, icons } from "./dom";
import { acceptFileDrops, host } from "./host";
import { closeOverlay, overlayOpen, promptName, showQuickOpen } from "./overlays";
import { TabBar } from "./tabbar";
import { TreeView } from "./tree";

interface HistoryEntry {
  path: string;
  state: TabState;
}

let nextTabId = 1;

class Tab {
  readonly id = nextTabId++;
  dirty = false;
  deleted = false;
  /** Latest text reported by the editor (`edited`), when it differs from disk. */
  editedText: string | null = null;
  /** Last contents read from or written to disk. */
  disk: LoadedFile = { text: "", usesCRLF: false, hasTrailingNewline: true, hasBOM: false, isUTF8: true };
  banner: Banner | null = null;
  allowRemoteImages = false;
  state: TabState = {};
  back: HistoryEntry[] = [];
  forward: HistoryEntry[] = [];
  /** On-disk contents that conflict with unsaved edits, while the conflict banner is shown. */
  theirs: LoadedFile | null = null;
  autosaveTimer = 0;

  constructor(public path: string, public pinned: boolean, public mode: Mode) {}

  get title(): string {
    return basename(this.path);
  }
  get editable(): boolean {
    return this.disk.isUTF8;
  }
  get currentText(): string {
    return this.editedText ?? this.disk.text;
  }
  get snapshot(): TabSnapshot {
    return { path: this.path, pinned: this.pinned, mode: this.mode, state: this.state };
  }
}

const deletedBanner: Banner = {
  kind: "deleted",
  message: "This file was deleted on disk.",
  actions: [{ id: "close", label: "Close" }, { id: "saveAs", label: "Save As…", primary: true }],
};
const readonlyBanner: Banner = { kind: "readonly", message: "This file is not valid UTF-8. It is shown read-only.", actions: [] };
const conflictBanner = (theirs: string): Banner => ({
  kind: "conflict",
  message: "This file changed on disk and you have unsaved edits.",
  actions: [{ id: "keepMine", label: "Keep Mine" }, { id: "loadTheirs", label: "Load Theirs" }, { id: "compare", label: "Compare", primary: true }],
  theirs,
});

const normalize = (t: string) => (t.includes("\r\n") ? t.replace(/\r\n/g, "\n") : t);
const sameBanner = (a: Banner | null, b: Banner | null) => JSON.stringify(a) === JSON.stringify(b);

const MODES: Mode[] = ["preview", "split", "edit"];
const FILTER_LABELS: Record<FilterMode, string> = {
  markdown: "Markdown Only",
  markdownAndFolders: "Markdown + All Folders",
  allFiles: "All Files",
};

export class WorkspaceWindow {
  private prefs: Preferences;
  private readonly root: string;
  private readonly name: string;
  private filterMode: FilterMode;
  private markdownPaths: string[] = [];
  private scanning = true;
  private tabs: Tab[] = [];
  private activeId: number | null = null;
  private closedTabs: TabSnapshot[] = [];
  private sidebarVisible = true;
  private sidebarWidth = 260;
  private readonly pool: DocPool;
  private readonly tree: TreeView;
  private readonly tabbar: TabBar;

  // DOM
  private readonly app: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterClear: HTMLButtonElement;
  private readonly filterModeSelect: HTMLSelectElement;
  private readonly spinner: HTMLElement;
  private readonly docs: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly emptyText: HTMLElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly widthSelect: HTMLSelectElement;
  private readonly titleName: HTMLElement;
  private readonly titlePath: HTMLElement;

  constructor(info: InitInfo) {
    this.prefs = info.prefs;
    this.root = info.root!;
    this.name = info.name!;
    this.filterMode = info.workspacePrefs?.filterMode ?? "markdown";

    this.pool = new DocPool(
      (this.docs = h("div", { class: "docs" })),
      (tabId, view) => this.attach(tabId, view),
      (tabId, state) => {
        const t = this.tabById(tabId);
        if (t) t.state = state as TabState;
      },
      () => this.activeId,
    );

    this.tree = new TreeView(
      {
        open: (path, pinned) => {
          this.open(path, pinned);
          if (pinned) setTimeout(() => this.focusDocument(), 0);
        },
        openDefault: (path) => void host.fileOp("openDefault", path),
        contextMenu: (node) => void this.treeMenu(node),
        expandedChanged: () => this.persistWorkspacePrefs(),
      },
      info.workspacePrefs?.expanded ?? [],
    );

    this.tabbar = new TabBar({
      activate: (id) => {
        const t = this.tabById(id);
        if (t) this.activate(t);
      },
      pin: (id) => {
        const t = this.tabById(id);
        if (t) this.pin(t);
      },
      close: (id) => {
        const t = this.tabById(id);
        if (t) void this.requestClose(t);
      },
      move: (id, beforeId) => this.moveTab(id, beforeId),
      contextMenu: (id) => void this.tabMenu(id),
      overflowMenu: () => void this.overflowMenu(),
    });

    // Sidebar
    this.filterInput = h("input", { class: "filter-input", type: "text", placeholder: "Filter", spellcheck: "false", "aria-label": "Filter files" });
    this.filterClear = h("button", { class: "filter-clear icon-button", title: "Clear filter", html: icons.clear, hidden: true });
    this.filterModeSelect = h(
      "select",
      { class: "filter-mode", title: "Choose which files the tree shows" },
      ...(Object.keys(FILTER_LABELS) as FilterMode[]).map((m) => h("option", { value: m }, FILTER_LABELS[m])),
    );
    this.filterModeSelect.value = this.filterMode;
    this.spinner = h("span", { class: "spinner", title: "Scanning…" });
    this.sidebar = h(
      "aside",
      { class: "sidebar" },
      h("div", { class: "filter" }, h("span", { class: "filter-icon", html: icons.filter }), this.filterInput, this.filterClear),
      this.tree.el,
      h("div", { class: "sidebar-footer" }, this.filterModeSelect, this.spinner),
    );
    const sash = h("div", { class: "sash", title: "Drag to resize the sidebar" });

    // Toolbar
    const sidebarButton = h("button", { class: "icon-button", title: "Toggle Sidebar (Ctrl+B)", html: icons.sidebar });
    sidebarButton.addEventListener("click", () => this.toggleSidebar());
    this.titleName = h("span", { class: "title-name" }, this.name);
    this.titlePath = h("span", { class: "title-path" });
    this.modeButtons = MODES.map((m) => {
      const b = h("button", { class: "segment", "data-mode": m }, m[0].toUpperCase() + m.slice(1));
      b.addEventListener("click", () => {
        const t = this.activeTab;
        if (t) this.setMode(m, t);
      });
      return b;
    });
    this.widthSelect = h(
      "select",
      { class: "width-select", title: "Content width" },
      h("option", { value: "readable" }, "Readable"),
      h("option", { value: "wide" }, "Wide"),
      h("option", { value: "full" }, "Full"),
    );
    this.widthSelect.addEventListener("change", () => {
      const p = structuredClone(this.prefs);
      p.core.width = this.widthSelect.value as Preferences["core"]["width"];
      void host.setPrefs(p);
    });
    const toolbar = h(
      "header",
      { class: "toolbar" },
      sidebarButton,
      h("div", { class: "title" }, this.titleName, this.titlePath),
      h("div", { class: "segmented", role: "group", title: "Preview, Split or Edit (Ctrl+E toggles, Ctrl+Shift+P cycles)" }, ...this.modeButtons),
      h("label", { class: "width-label", html: icons.width }, this.widthSelect),
    );

    // Document area
    this.emptyText = h("div", { class: "empty-title" }, "Select a file in the sidebar");
    this.empty = h(
      "div",
      { class: "empty" },
      h("div", { class: "empty-icon", html: icons.docSearch }),
      this.emptyText,
      h("div", { class: "empty-hint" }, "Ctrl+P to quick open"),
    );
    this.docs.append(this.empty);
    const content = h("main", { class: "content" }, this.tabbar.el, this.docs);

    this.app = h("div", { class: "workspace" }, toolbar, h("div", { class: "body" }, this.sidebar, sash, content));
    document.body.append(this.app);
    acceptFileDrops(document.body);

    this.wireSidebar(sash);
    this.wireHost();
    this.applyPrefs();
    void this.loadTree();
    setInterval(() => this.tree.refresh(), 30_000);

    if (info.session) this.restore(info.session);
    for (const f of info.openFiles ?? []) this.open(f, true);
    this.update();
    // Start in the document, or in the tree when no file is open.
    requestAnimationFrame(() => (this.activeTab ? this.focusDocument() : this.tree.focus()));
  }

  // MARK: Wiring

  private wireSidebar(sash: HTMLElement): void {
    this.filterInput.addEventListener("input", () => {
      this.tree.setQuery(this.filterInput.value);
      this.filterClear.hidden = this.filterInput.value === "";
    });
    this.filterInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.setFilterQuery("");
        this.tree.focus();
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        this.tree.focus();
      }
    });
    this.filterClear.addEventListener("click", () => this.setFilterQuery(""));
    this.filterModeSelect.addEventListener("change", () => {
      this.filterMode = this.filterModeSelect.value as FilterMode;
      this.persistWorkspacePrefs();
      void this.loadTree();
    });

    sash.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sash.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing");
      const move = (ev: PointerEvent) => {
        this.sidebarWidth = Math.min(400, Math.max(180, ev.clientX));
        this.applySidebar();
      };
      const up = () => {
        sash.removeEventListener("pointermove", move);
        sash.removeEventListener("pointerup", up);
        document.body.classList.remove("resizing");
        this.saveSession();
      };
      sash.addEventListener("pointermove", move);
      sash.addEventListener("pointerup", up);
    });
    sash.addEventListener("dblclick", () => {
      this.sidebarWidth = 260;
      this.applySidebar();
      this.saveSession();
    });
  }

  private wireHost(): void {
    host.onTreeChanged(() => void this.loadTree());
    host.onFsChanged((c) => this.handleFsChange(c));
    host.onCommand((cmd, arg) => this.command(cmd, arg));
    host.onSettings((p) => {
      const old = this.prefs;
      this.prefs = p;
      this.applyPrefs();
      if (JSON.stringify(old.core) !== JSON.stringify(p.core)) this.pool.broadcast({ type: "setSettings", settings: p.core });
    });
    host.onOpenFile((path) => this.open(path, true));
    host.onSaveAll((id) => void this.saveAll().then((ok) => host.saveAllResult(id, ok)));
    host.onFullScreen((on) => this.send("diagramFullScreenChanged", on));
    host.onBlur(() => this.autosaveAll());
  }

  private applyPrefs(): void {
    this.widthSelect.value = this.prefs.core.width;
  }

  private persistWorkspacePrefs(): void {
    void host.setWorkspacePrefs({ filterMode: this.filterMode, expanded: [...this.tree.expandedPaths].sort() });
  }

  private setFilterQuery(q: string): void {
    this.filterInput.value = q;
    this.filterClear.hidden = q === "";
    this.tree.setQuery(q);
  }

  private async loadTree(): Promise<void> {
    const snap = await host.tree(this.filterMode);
    this.scanning = snap.scanning;
    this.markdownPaths = snap.markdownPaths;
    if (snap.root || !this.tree.hasData) this.tree.setData(snap.root);
    this.tree.select(this.activeTab?.path ?? null, false);
    this.spinner.hidden = !(snap.scanning && !snap.root);
    this.update();
  }

  // MARK: Tabs

  private tabById(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  private get activeTab(): Tab | undefined {
    return this.activeId === null ? undefined : this.tabById(this.activeId);
  }

  open(path: string, pinned: boolean, mode?: Mode, state?: TabState, activate = true): Tab {
    const existing = this.tabs.find((t) => t.path === path);
    if (existing) {
      if (pinned && !existing.pinned) existing.pinned = true;
      if (activate) this.activate(existing);
      else this.update();
      return existing;
    }
    const m = mode ?? this.prefs.defaultMode;
    const preview = pinned ? undefined : this.tabs.find((t) => !t.pinned && !t.dirty);
    if (preview) {
      preview.path = path;
      preview.mode = m;
      preview.state = state ?? {};
      preview.back = [];
      preview.forward = [];
      preview.allowRemoteImages = false;
      void this.load(preview).then(() => {
        const v = this.pool.live(preview.id);
        if (!v) return;
        if (v.remoteImages) {
          v.load(false);
          this.sendOpenSequence(preview, v);
        } else {
          this.showDocument(preview, v);
        }
      });
      if (activate) this.activate(preview);
      this.saveSession();
      return preview;
    }
    const tab = new Tab(path, pinned, m);
    if (state) tab.state = state;
    const loaded = this.load(tab);
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    if (i >= 0) this.tabs.splice(i + 1, 0, tab);
    else this.tabs.push(tab);
    // The view is attached once the file is read, so the first render has its text.
    void loaded.then(() => {
      if (this.tabs.includes(tab) && tab.id === this.activeId) this.showActive();
    });
    if (activate) {
      this.activeId = tab.id;
      this.update();
    } else {
      this.update();
    }
    this.saveSession();
    return tab;
  }

  private loading = new Map<number, Promise<void>>();

  private load(tab: Tab): Promise<void> {
    tab.editedText = null;
    tab.dirty = false;
    tab.theirs = null;
    const p = host.read(tab.path).then((r) => {
      if (r.ok) {
        tab.disk = r.file;
        tab.deleted = false;
        tab.banner = r.file.isUTF8 ? null : readonlyBanner;
      } else {
        tab.disk = { text: "", usesCRLF: false, hasTrailingNewline: true, hasBOM: false, isUTF8: true };
        tab.deleted = true;
        tab.banner = deletedBanner;
      }
      this.update();
    });
    this.loading.set(tab.id, p);
    return p;
  }

  activate(tab: Tab): void {
    this.activeId = tab.id;
    this.update();
    this.saveSession();
  }

  /** Shows the active tab's view, creating it when needed. */
  private showActive(): void {
    const t = this.activeTab;
    const shown = this.pool.all().find((v) => v.iframe.classList.contains("active"));
    if (t && shown && shown === this.pool.live(t.id)) return;
    shown?.iframe.classList.remove("active");
    if (!t) return;
    const loading = this.loading.get(t.id);
    if (loading) {
      // Attach after the first read so the view opens with the file's text.
      void loading.then(() => {
        this.loading.delete(t.id);
        if (this.activeId === t.id) this.showActive();
      });
      return;
    }
    const hadFocus = !!shown?.hasFocus() || document.activeElement === document.body;
    const v = this.pool.view(t.id);
    v.iframe.classList.add("active");
    if (hadFocus) v.focus();
  }

  private focusDocument(): void {
    const t = this.activeTab;
    if (!t) return;
    const v = this.pool.live(t.id);
    if (v) v.focus();
    else setTimeout(() => this.pool.live(t.id)?.focus(), 50);
  }

  private removeTab(tab: Tab): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    clearTimeout(tab.autosaveTimer);
    const wasActive = tab.id === this.activeId;
    this.tabs.splice(i, 1);
    if (wasActive) this.activeId = this.tabs.length ? this.tabs[Math.min(i, this.tabs.length - 1)].id : null;
    void (async () => {
      const v = this.pool.live(tab.id);
      if (v?.isReady) {
        const s = await v.send<TabState>({ type: "getState" });
        if (s) tab.state = s;
      }
      this.pool.discardNow(tab.id);
      this.closedTabs.push(tab.snapshot);
      if (this.closedTabs.length > 30) this.closedTabs.shift();
      this.update();
    })();
    this.update();
    this.saveSession();
    if (wasActive && this.activeTab) setTimeout(() => this.focusDocument(), 0);
  }

  async requestClose(tab: Tab): Promise<void> {
    if (!tab.dirty) return this.removeTab(tab);
    const answer = await host.confirmClose(tab.title);
    if (answer === "save") {
      if (await this.save(tab)) this.removeTab(tab);
    } else if (answer === "discard") {
      this.removeTab(tab);
    }
  }

  private async reopenClosedTab(): Promise<void> {
    while (this.closedTabs.length) {
      const snap = this.closedTabs.pop()!;
      if (!(await host.exists(snap.path))) continue;
      this.open(snap.path, true, snap.mode, snap.state);
      return;
    }
    host.beep();
  }

  private selectTab(offset: number): void {
    if (!this.tabs.length) return;
    const i = Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId));
    this.activate(this.tabs[(i + offset + this.tabs.length) % this.tabs.length]);
  }

  private selectTabNumber(n: number): void {
    if (!this.tabs.length) return;
    // Ctrl+9 always selects the last tab, as in browsers.
    const i = n === 9 ? this.tabs.length - 1 : n - 1;
    if (i >= 0 && i < this.tabs.length) this.activate(this.tabs[i]);
  }

  private moveTab(id: number, beforeId: number | null): void {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const to = beforeId === null ? this.tabs.length : this.tabs.findIndex((t) => t.id === beforeId);
    this.tabs.splice(to < 0 ? this.tabs.length : to, 0, tab);
    this.update();
    this.saveSession();
  }

  private pin(tab: Tab): void {
    if (tab.pinned) return;
    tab.pinned = true;
    this.update();
    this.saveSession();
  }

  // MARK: Documents

  private payload(tab: Tab, reason: "open" | "reload" | "edit") {
    return { path: tab.path, text: tab.currentText, editable: tab.editable, reason, allowRemoteImages: tab.allowRemoteImages };
  }

  /** Wires a freshly created view to its tab and loads the document. */
  private attach(tabId: number, v: DocView): void {
    v.onMessage = (msg) => {
      const t = this.tabById(tabId);
      if (t) this.handleCore(msg, t, v);
    };
    v.onReloaded = () => {
      const t = this.tabById(tabId);
      if (t) this.sendOpenSequence(t, v);
    };
    const t = this.tabById(tabId);
    v.load(t?.allowRemoteImages ?? false);
    if (t) this.sendOpenSequence(t, v);
  }

  private sendOpenSequence(tab: Tab, v: DocView): void {
    void v.enqueue({ type: "setSettings", settings: this.prefs.core });
    this.showDocument(tab, v);
  }

  private showDocument(tab: Tab, v: DocView): void {
    void v.enqueue({ type: "setMode", mode: tab.mode });
    void v.enqueue({ type: "render", payload: this.payload(tab, "open") });
    void v.enqueue({ type: "restoreState", state: tab.state });
    void v.enqueue({ type: "banner", banner: tab.banner });
  }

  private setBanner(banner: Banner | null, tab: Tab): void {
    if (sameBanner(tab.banner, banner)) return;
    tab.banner = banner;
    void this.pool.live(tab.id)?.enqueue({ type: "banner", banner });
  }

  private async refreshFromDisk(tab: Tab): Promise<void> {
    const live = this.pool.live(tab.id);
    const r = await host.read(tab.path);
    if (!r.ok) {
      if (r.error === "missing" && !tab.deleted) {
        tab.deleted = true;
        this.setBanner(deletedBanner, tab);
        this.update();
      }
      return;
    }
    const f = r.file;
    if (tab.deleted) {
      tab.deleted = false;
      this.setBanner(f.isUTF8 ? null : readonlyBanner, tab);
    }
    if (f.text === tab.disk.text && f.isUTF8 === tab.disk.isUTF8) {
      tab.disk = f;
      this.update();
      return;
    }
    if (tab.dirty) {
      if (tab.editedText === f.text) {
        tab.disk = f;
        tab.dirty = false;
        tab.theirs = null;
        this.setBanner(null, tab);
        void live?.enqueue({ type: "markSaved" });
      } else if (tab.theirs?.text !== f.text) {
        tab.theirs = f;
        this.setBanner(conflictBanner(f.text), tab);
      }
      this.update();
      return;
    }
    tab.disk = f;
    tab.editedText = null;
    this.setBanner(f.isUTF8 ? null : readonlyBanner, tab);
    void live?.enqueue({ type: "render", payload: this.payload(tab, "reload") });
    this.update();
  }

  private handleFsChange(c: FsChange): void {
    const changed = new Set(c.paths);
    for (const tab of this.tabs) {
      const touched = changed.has(tab.path) || c.paths.some((p) => tab.path.startsWith(p + "/"));
      if (touched || tab.deleted || c.structural) void this.refreshFromDisk(tab);
    }
  }

  // MARK: Messages from the core

  private handleCore(msg: CoreToHost, tab: Tab, v: DocView): void {
    switch (msg.type) {
      case "ready":
      case "rendered":
      case "hoverLink":
        break;
      case "log":
        if (msg.level !== "info") host.log(`core ${msg.level}: ${msg.message}`);
        break;
      case "renderError":
        host.log(`render error ${tab.path}:${msg.line ?? 0} ${msg.message}`);
        break;
      case "diagramsRendered":
        break;
      case "linkClicked":
        void this.followLink(msg, tab);
        break;
      case "scrollChanged":
        tab.state.scrollY = msg.scrollY;
        tab.state.topLine = msg.topLine;
        this.saveSession();
        break;
      case "diagramStateChanged":
        tab.state.diagrams = { ...(tab.state.diagrams ?? {}), [msg.key]: msg.state };
        this.saveSession();
        break;
      case "editorStateChanged":
        tab.state.editorCursor = msg.cursor;
        tab.state.editorScrollLine = msg.scrollLine;
        this.saveSession();
        break;
      case "edited": {
        const text = normalize(msg.text);
        tab.editedText = text;
        const dirty = text !== tab.disk.text;
        if (tab.dirty !== dirty) {
          tab.dirty = dirty;
          this.update();
        }
        if (dirty) this.pin(tab);
        this.scheduleIdleAutosave(tab);
        break;
      }
      case "copy":
        void host.copy(msg);
        break;
      case "export":
        void host.exportDiagram(msg, dirname(tab.path));
        break;
      case "requestMode":
        this.setMode(msg.mode, tab);
        if (msg.line !== undefined) void v.enqueue({ type: "scrollToLine", line: msg.line });
        break;
      case "bannerAction":
        void this.handleBannerAction(msg.id, tab, v);
        break;
      case "requestFullScreen":
        void host.setFullScreen(msg.on);
        break;
      case "save":
        void this.save(tab);
        break;
    }
  }

  private async handleBannerAction(id: string, tab: Tab, v: DocView): Promise<void> {
    switch (id) {
      case "keepMine":
        if (tab.theirs) tab.disk = tab.theirs;
        tab.theirs = null;
        tab.dirty = tab.currentText !== tab.disk.text;
        this.setBanner(null, tab);
        break;
      case "loadTheirs":
        if (tab.theirs) tab.disk = tab.theirs;
        else await this.load(tab);
        tab.theirs = null;
        tab.editedText = null;
        tab.dirty = false;
        this.setBanner(tab.disk.isUTF8 ? null : readonlyBanner, tab);
        void v.enqueue({ type: "render", payload: this.payload(tab, "reload") });
        void v.enqueue({ type: "markSaved" });
        break;
      case "compare":
        break; // handled by the core
      case "close":
        await this.requestClose(tab);
        break;
      case "saveAs":
        await this.saveAs(tab);
        break;
      case "loadRemoteImages": {
        tab.allowRemoteImages = true;
        if (tab.banner?.kind === "remoteImages") tab.banner = null;
        if (v.isReady) {
          const s = await v.send<TabState>({ type: "getState" });
          if (s) tab.state = s;
        }
        v.load(true);
        this.sendOpenSequence(tab, v);
        break;
      }
      default:
        this.setBanner(null, tab);
    }
    this.update();
  }

  // MARK: Links and history

  private async followLink(msg: Extract<CoreToHost, { type: "linkClicked" }>, tab: Tab): Promise<void> {
    if (msg.href.startsWith("#")) {
      // The core already scrolled; just record where we came from.
      this.pushAnchorHistory(tab);
      return;
    }
    const action = await host.resolveLink(tab.path, msg.href, msg.anchor, !!msg.external);
    switch (action.kind) {
      case "none":
      case "handled":
        return;
      case "anchor":
        this.pushAnchorHistory(tab);
        void this.pool.view(tab.id).enqueue({ type: "scrollToAnchor", anchor: action.anchor });
        return;
      case "tab": {
        let destination: Tab;
        const existing = this.tabs.find((t) => t.path === action.path);
        if (msg.modifier) destination = this.open(action.path, true);
        else if (existing) {
          destination = existing;
          this.activate(existing);
        } else if (!tab.pinned && !tab.dirty) {
          return this.navigate(tab, action.path, action.anchor);
        } else {
          destination = this.open(action.path, false);
        }
        if (action.anchor) {
          await this.loading.get(destination.id);
          void this.pool.view(destination.id).enqueue({ type: "scrollToAnchor", anchor: action.anchor });
        }
      }
    }
  }

  private async currentState(tab: Tab): Promise<TabState> {
    const v = this.pool.live(tab.id);
    if (v?.isReady) {
      const s = await v.send<TabState>({ type: "getState" });
      if (s) tab.state = s;
    }
    return tab.state;
  }

  private async navigate(tab: Tab, path: string, anchor?: string): Promise<void> {
    const state = await this.currentState(tab);
    tab.back.push({ path: tab.path, state });
    tab.forward = [];
    tab.path = path;
    tab.state = {};
    await this.load(tab);
    this.loading.delete(tab.id);
    const v = this.pool.view(tab.id);
    this.showDocument(tab, v);
    if (anchor) void v.enqueue({ type: "scrollToAnchor", anchor });
    this.update();
    this.saveSession();
  }

  /** Uses the last reported scroll position: the core may already be scrolling to the target. */
  private pushAnchorHistory(tab: Tab): void {
    tab.back.push({ path: tab.path, state: { ...tab.state } });
    tab.forward = [];
    this.update();
  }

  private async traverseHistory(back: boolean): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const entry = back ? tab.back.at(-1) : tab.forward.at(-1);
    if (!entry) return host.beep();
    if (entry.path !== tab.path && tab.dirty) return host.beep();
    const state = await this.currentState(tab);
    const current = { path: tab.path, state };
    if (back) {
      tab.back.pop();
      tab.forward.push(current);
    } else {
      tab.forward.pop();
      tab.back.push(current);
    }
    const v = this.pool.view(tab.id);
    tab.state = entry.state;
    if (entry.path !== tab.path) {
      tab.path = entry.path;
      await this.load(tab);
      this.loading.delete(tab.id);
      this.showDocument(tab, v);
    } else {
      void v.enqueue({ type: "restoreState", state: entry.state });
    }
    this.update();
    this.saveSession();
  }

  // MARK: Modes and commands

  private setMode(mode: Mode, tab: Tab): void {
    if (tab.mode === mode) return;
    tab.mode = mode;
    void this.pool.live(tab.id)?.enqueue({ type: "setMode", mode });
    this.update();
    this.saveSession();
  }

  private send(command: CoreCommand, arg?: unknown): void {
    const t = this.activeTab;
    if (!t) return;
    void this.pool.view(t.id).enqueue({ type: "command", command, arg } as HostToCore);
  }

  private toggleSidebar(show = !this.sidebarVisible): void {
    this.sidebarVisible = show;
    this.applySidebar();
    this.update();
    this.saveSession();
  }

  private applySidebar(): void {
    this.app.classList.toggle("sidebar-hidden", !this.sidebarVisible);
    this.sidebar.style.width = `${this.sidebarWidth}px`;
  }

  private revealActiveFile(): void {
    const t = this.activeTab;
    if (!t) return;
    if (this.filterInput.value) this.setFilterQuery("");
    if (!this.sidebarVisible) this.toggleSidebar(true);
    this.tree.select(t.path, true);
    this.tree.focus();
  }

  command(cmd: string, arg?: unknown): void {
    const t = this.activeTab;
    switch (cmd) {
      case "quickOpen":
        if (overlayOpen()) return closeOverlay();
        showQuickOpen(() => this.markdownPaths, (p) => {
          this.open(p, true);
          setTimeout(() => this.focusDocument(), 0);
        }, host.beep);
        return;
      case "save":
        if (t) void this.save(t);
        return;
      case "saveAs":
        if (t) void this.saveAs(t);
        return;
      case "closeTab":
        if (overlayOpen()) return closeOverlay();
        if (t) void this.requestClose(t);
        else window.close();
        return;
      case "reopenClosedTab":
        void this.reopenClosedTab();
        return;
      case "find":
      case "findNext":
      case "findPrevious":
      case "replace":
      case "bold":
      case "italic":
      case "link":
      case "nextDiagram":
      case "previousDiagram":
        this.send(cmd);
        return;
      case "expandFocusedDiagram":
        if (!t) return;
        this.pin(t);
        if (this.pool.live(t.id)?.hasFocus()) this.send("expandFocusedDiagram");
        return;
      case "setMode":
        if (t && MODES.includes(arg as Mode)) this.setMode(arg as Mode, t);
        return;
      case "toggleEditMode":
        if (t) this.setMode(t.mode === "preview" ? "edit" : "preview", t);
        return;
      case "cycleModes":
        if (t) this.setMode(t.mode === "preview" ? "split" : t.mode === "split" ? "edit" : "preview", t);
        return;
      case "toggleSidebar":
        this.toggleSidebar();
        return;
      case "revealInTree":
        this.revealActiveFile();
        return;
      case "goBack":
        void this.traverseHistory(true);
        return;
      case "goForward":
        void this.traverseHistory(false);
        return;
      case "nextTab":
        this.selectTab(1);
        return;
      case "previousTab":
        this.selectTab(-1);
        return;
      case "selectTab":
        this.selectTabNumber(Number(arg));
        return;
    }
  }

  // MARK: Saving

  /** Ctrl+S: asks the editor for its text, then writes atomically. */
  async save(tab: Tab): Promise<boolean> {
    if (!tab.editable) {
      host.beep();
      return false;
    }
    let text = tab.currentText;
    const v = this.pool.live(tab.id);
    if (v?.isReady) {
      const r = await v.send<{ text: string }>({ type: "getText" });
      if (r && typeof r.text === "string") text = r.text;
    }
    const result = await host.write(tab.path, text, tab.disk);
    if (!result.ok) {
      await host.showError(`“${tab.title}” could not be saved.`, result.error);
      return false;
    }
    this.didWrite(tab, result.file);
    return true;
  }

  private didWrite(tab: Tab, file: LoadedFile, path?: string): void {
    if (path !== undefined && path !== tab.path) tab.path = path;
    tab.disk = file;
    tab.editedText = null;
    tab.dirty = false;
    tab.deleted = false;
    tab.theirs = null;
    clearTimeout(tab.autosaveTimer);
    if (tab.banner?.kind === "conflict" || tab.banner?.kind === "deleted") this.setBanner(null, tab);
    void this.pool.live(tab.id)?.enqueue({ type: "markSaved" });
    this.update();
    this.saveSession();
  }

  private async saveAs(tab: Tab): Promise<void> {
    let text = tab.currentText;
    const v = this.pool.live(tab.id);
    if (v?.isReady) {
      const r = await v.send<{ text: string }>({ type: "getText" });
      if (r && typeof r.text === "string") text = r.text;
    }
    const result = await host.saveAs(tab.path, text, tab.disk);
    if (!result.ok) {
      if (result.error !== "canceled") await host.showError(`“${tab.title}” could not be saved.`, result.error);
      return;
    }
    // Saved inside the workspace: the tab now shows that file. Outside, it opened in its own window.
    if (result.path !== undefined) {
      this.didWrite(tab, result.file, result.path);
      void this.pool.live(tab.id)?.enqueue({ type: "render", payload: this.payload(tab, "reload") });
    }
  }

  private async saveAll(): Promise<boolean> {
    for (const t of this.tabs.filter((x) => x.dirty)) {
      if (!(await this.save(t))) return false;
    }
    return true;
  }

  private autosaveAll(): void {
    if (this.prefs.autosave !== "onFocusLoss") return;
    for (const t of this.tabs) if (t.dirty && t.editable && !t.deleted) void this.save(t);
  }

  private scheduleIdleAutosave(tab: Tab): void {
    if (this.prefs.autosave !== "afterIdle" || !tab.editable) return;
    clearTimeout(tab.autosaveTimer);
    tab.autosaveTimer = window.setTimeout(() => {
      if (tab.dirty && !tab.deleted && this.tabs.includes(tab)) void this.save(tab);
    }, 2000);
  }

  // MARK: Context menus and file operations

  private async treeMenu(node: TreeNode | null): Promise<void> {
    const action = await host.treeMenu(node ? { path: node.path, dir: node.dir } : null);
    if (!action) return;
    const path = node?.path ?? "";
    const dir = node ? (node.dir ? node.path : dirname(node.path)) : "";
    switch (action) {
      case "newFile": {
        const name = await promptName("New File", await host.uniqueName(dir, "Untitled.md"), "Create", true);
        if (!name) return;
        const r = await host.fileOp("newFile", dir, name);
        if (!r.ok) return this.opFailed(r.error);
        if (dir) this.tree.select(r.path ?? null, true);
        if (r.path && /\.(md|markdown|mdx)$/i.test(r.path)) {
          this.open(r.path, true, "edit");
          setTimeout(() => this.focusDocument(), 50);
        }
        return;
      }
      case "newFolder": {
        const name = await promptName("New Folder", await host.uniqueName(dir, "New Folder"), "Create", false);
        if (!name) return;
        const r = await host.fileOp("newFolder", dir, name);
        if (!r.ok) return this.opFailed(r.error);
        if (dir) {
          this.tree.expandedPaths.add(dir);
          this.persistWorkspacePrefs();
        }
        return;
      }
      case "rename": {
        if (!node) return;
        const name = await promptName(`Rename “${node.name}”`, node.name, "Rename", !node.dir);
        if (!name || name === node.name) return;
        const r = await host.fileOp("rename", path, name);
        if (!r.ok) return this.opFailed(r.error);
        if (r.path) this.didMove(path, r.path);
        return;
      }
      case "duplicate":
      case "trash":
      case "reveal":
      case "copyPath":
      case "copyRelativePath":
      case "openDefault": {
        const r = await host.fileOp(action, path);
        if (!r.ok) return this.opFailed(r.error);
      }
    }
  }

  private opFailed(error?: string): void {
    if (error) void host.showError("The operation could not be completed.", error);
    else host.beep();
  }

  /** Keeps open tabs pointing at files after a rename inside the workspace. */
  private didMove(from: string, to: string): void {
    for (const t of this.tabs) {
      if (t.path === from) t.path = to;
      else if (t.path.startsWith(from + "/")) t.path = to + t.path.slice(from.length);
    }
    const exp = this.tree.expandedPaths;
    for (const p of [...exp]) {
      if (p === from || p.startsWith(from + "/")) {
        exp.delete(p);
        exp.add(to + p.slice(from.length));
      }
    }
    this.persistWorkspacePrefs();
    this.update();
    this.saveSession();
  }

  private async tabMenu(id: number): Promise<void> {
    const tab = this.tabById(id);
    if (!tab) return;
    const i = this.tabs.indexOf(tab);
    const action = await host.tabMenu({ pinned: tab.pinned, hasRight: i < this.tabs.length - 1, hasOthers: this.tabs.length > 1 });
    switch (action) {
      case "close":
        return this.requestClose(tab);
      case "closeOthers":
        for (const t of this.tabs.filter((x) => x !== tab)) await this.requestClose(t);
        return;
      case "closeRight":
        for (const t of this.tabs.slice(this.tabs.indexOf(tab) + 1)) await this.requestClose(t);
        return;
      case "pin":
        return this.pin(tab);
      case "copyPath":
        void host.fileOp("copyPath", tab.path);
        return;
      case "reveal":
        this.activate(tab);
        this.revealActiveFile();
        return;
    }
  }

  private async overflowMenu(): Promise<void> {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const r = await host.tabsMenu(this.tabs.map((t) => t.title), i);
    if (r !== null && this.tabs[Number(r)]) this.activate(this.tabs[Number(r)]);
  }

  // MARK: Rendering and reporting

  private updateQueued = false;
  private lastMenu = "";
  private lastDirty = "";
  private lastTitle = "";

  /** Re-renders the chrome and reports state to the main process (coalesced per frame). */
  private update(): void {
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => {
      this.updateQueued = false;
      this.render();
    });
  }

  private render(): void {
    const t = this.activeTab;
    this.tabbar.render(
      this.tabs.map((x) => ({ id: x.id, title: x.title, path: x.path, pinned: x.pinned, dirty: x.dirty, deleted: x.deleted })),
      this.activeId,
    );
    this.showActive();
    this.empty.hidden = !!t;
    this.emptyText.textContent = this.markdownPaths.length === 0 && !this.scanning ? "No markdown files in this folder" : "Select a file in the sidebar";
    for (const b of this.modeButtons) {
      b.disabled = !t;
      b.classList.toggle("selected", !!t && b.dataset.mode === t.mode);
    }
    this.titlePath.textContent = t ? t.path : "";
    this.tree.select(t?.path ?? null, false);
    this.applySidebar();

    const anyDirty = this.tabs.some((x) => x.dirty);
    const title = `${anyDirty ? "● " : ""}${t ? `${t.title} — ` : ""}${this.name} — MDView`;
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      document.title = title;
      void host.setTitle(title);
    }
    const dirty = this.tabs.filter((x) => x.dirty).map((x) => x.title);
    const dirtyKey = JSON.stringify(dirty);
    if (dirtyKey !== this.lastDirty) {
      this.lastDirty = dirtyKey;
      void host.setDirty(dirty);
    }
    const menu: MenuState = {
      hasTab: !!t,
      editable: !!t && t.editable,
      mode: t?.mode ?? null,
      canGoBack: !!t && t.back.length > 0,
      canGoForward: !!t && t.forward.length > 0,
      canReopen: this.closedTabs.length > 0,
      tabCount: this.tabs.length,
      sidebarVisible: this.sidebarVisible,
    };
    const menuKey = JSON.stringify(menu);
    if (menuKey !== this.lastMenu) {
      this.lastMenu = menuKey;
      void host.setMenuState(menu);
    }
  }

  // MARK: Session

  private sessionTimer = 0;

  private saveSession(): void {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => {
      const i = this.tabs.findIndex((t) => t.id === this.activeId);
      void host.setSession({
        tabs: this.tabs.map((t) => t.snapshot),
        activeIndex: i >= 0 ? i : undefined,
        sidebarVisible: this.sidebarVisible,
        sidebarWidth: this.sidebarWidth,
      });
    }, 300);
  }

  private restore(session: WorkspaceSession): void {
    this.sidebarVisible = session.sidebarVisible;
    if (session.sidebarWidth) this.sidebarWidth = Math.min(400, Math.max(180, session.sidebarWidth));
    for (const snap of session.tabs) this.open(snap.path, snap.pinned, snap.mode, snap.state, false);
    const active = session.activeIndex !== undefined ? this.tabs.find((t) => t.path === session.tabs[session.activeIndex!]?.path) : undefined;
    const first = active ?? this.tabs[0];
    if (first) this.activate(first);
    // Restored tabs whose file no longer exists are dropped.
    void Promise.all(this.tabs.map((t) => this.loading.get(t.id))).then(() => {
      for (const t of [...this.tabs]) if (t.deleted && !t.dirty) this.removeTab(t);
    });
  }
}
