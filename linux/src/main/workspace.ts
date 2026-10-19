// One open folder in the main process: the scanned tree, the recursive watcher, file
// reads and writes, link resolution and the tree's file operations. The shell window
// owns tabs and asks for everything else through IPC.

import { clipboard, shell } from "electron";
import { promises as fs, watch as fsWatch, constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as files from "./fileservice";
import { displayTree, scan, type ScanResult } from "./scanner";
import type { FileOp, FileOpResult, FilterMode, FsChange, LinkAction, LoadedFile, TreeSnapshot, WriteResult } from "../common/types";
import type { Preferences } from "../common/types";
import { ignoreGlobList } from "./store";

export function debugLog(message: string): void {
  if (process.env.MDVIEW_DEBUG) process.stderr.write(`[mdview] ${message}\n`);
}

type Unsubscribe = () => Promise<void> | void;

interface WatchEvent {
  path: string;
  type: "create" | "update" | "delete";
}

/** One recursive watcher per workspace (@parcel/watcher: inotify), coalesced over 100 ms. */
async function watchTree(root: string, onEvents: (events: WatchEvent[]) => void): Promise<Unsubscribe> {
  let pending: WatchEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  const push = (events: WatchEvent[]) => {
    pending.push(...events);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = pending;
      pending = [];
      onEvents(batch);
    }, 100);
  };
  try {
    // Loaded lazily: the native module is unpacked next to the asar archive.
    const watcher: typeof import("@parcel/watcher") = require("@parcel/watcher");
    const sub = await watcher.subscribe(
      root,
      (err, events) => {
        if (err) debugLog(`watcher error: ${err.message}`);
        if (events.length) push(events.map((e) => ({ path: e.path, type: e.type })));
      },
      { ignore: ["node_modules", "**/node_modules", ".git"] },
    );
    return () => sub.unsubscribe();
  } catch (e) {
    debugLog(`@parcel/watcher unavailable (${(e as Error).message}); using fs.watch`);
    const w = fsWatch(root, { recursive: true }, (type, name) => {
      if (!name) return push([{ path: root, type: "update" }]);
      const p = path.join(root, name.toString());
      push([{ path: p, type: type === "rename" ? "create" : "update" }]);
    });
    return () => w.close();
  }
}

export class Workspace {
  private result: ScanResult | null = null;
  private scanning = false;
  private rescanPending = false;
  private unwatch: Unsubscribe | null = null;
  private closed = false;

  constructor(
    readonly root: string,
    private readonly prefs: () => Preferences,
    private readonly onTreeChanged: () => void,
    private readonly onFsChanged: (change: FsChange) => void,
    private readonly openOutside: (absPath: string) => void,
  ) {}

  get name(): string {
    return path.basename(this.root) || this.root;
  }

  async start(): Promise<void> {
    this.rescan();
    try {
      const unwatch = await watchTree(this.root, (events) => this.handle(events));
      if (this.closed) void unwatch();
      else this.unwatch = unwatch;
    } catch (e) {
      debugLog(`cannot watch ${this.root}: ${(e as Error).message}`);
    }
  }

  close(): void {
    this.closed = true;
    void this.unwatch?.();
    this.unwatch = null;
  }

  abs(rel: string): string {
    return rel === "" ? this.root : path.join(this.root, ...rel.split("/"));
  }

  /** Workspace-relative path (with "/") of an absolute path, or null when outside. */
  relative(abs: string): string | null {
    const p = path.resolve(abs);
    if (p === this.root) return "";
    if (!p.startsWith(this.root + path.sep)) return null;
    return p.slice(this.root.length + 1).split(path.sep).join("/");
  }

  // MARK: Scanning and watching

  rescan(): void {
    if (this.closed) return;
    if (this.scanning) {
      this.rescanPending = true;
      return;
    }
    this.scanning = true;
    const p = this.prefs();
    scan(this.root, { respectGitignore: p.respectGitignore, extraGlobs: ignoreGlobList(p) })
      .then((r) => {
        debugLog(`scanned ${r.fileCount} files in ${Math.round(r.ms)} ms`);
        this.result = r;
      })
      .catch((e) => debugLog(`scan failed: ${e}`))
      .finally(() => {
        this.scanning = false;
        if (this.closed) return;
        this.onTreeChanged();
        if (this.rescanPending) {
          this.rescanPending = false;
          this.rescan();
        }
      });
  }

  tree(mode: FilterMode): TreeSnapshot {
    const r = this.result;
    return {
      root: r ? displayTree(r.root, mode) : null,
      markdownPaths: r ? r.markdownPaths : [],
      scanning: this.scanning,
    };
  }

  private handle(events: WatchEvent[]): void {
    if (this.closed) return;
    const changed = new Set<string>();
    let structural = false;
    let relevant = false;
    for (const e of events) {
      const rel = this.relative(e.path);
      if (rel === null || rel === "") {
        relevant = true;
        structural = true;
        continue;
      }
      const parts = rel.split("/");
      if (parts.includes("node_modules")) continue;
      if (parts[0] === ".git") {
        if (rel === ".git/info/exclude") relevant = true;
        continue;
      }
      relevant = true;
      changed.add(rel);
      if (e.type !== "update") structural = true;
    }
    if (!relevant) return;
    this.rescan();
    this.onFsChanged({ paths: [...changed], structural });
  }

  // MARK: Files

  read(rel: string) {
    return files.read(this.abs(rel));
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async write(rel: string, text: string, like: LoadedFile): Promise<WriteResult> {
    try {
      const file = await files.write(text, this.abs(rel), like);
      return { ok: true, file };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Writes to an absolute path chosen in a save dialog. Inside the workspace, returns its relative path. */
  async writeTo(abs: string, text: string, like: LoadedFile): Promise<WriteResult> {
    try {
      const file = await files.write(text, abs, like);
      const rel = this.relative(await files.canonical(abs));
      return rel === null ? { ok: true, file } : { ok: true, file, path: rel };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // MARK: Links

  /** Resolves a link clicked in `from` (the core reports the raw href). */
  async resolveLink(from: string, href: string, anchor: string | undefined, external: boolean): Promise<LinkAction> {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
    if (scheme && scheme !== "mdview" && scheme !== "file") {
      if (["http", "https", "mailto"].includes(scheme)) void shell.openExternal(href);
      return { kind: "handled" };
    }
    if (external && scheme !== "file" && scheme !== "mdview") {
      void shell.openExternal(href);
      return { kind: "handled" };
    }
    let pathPart = href;
    let fragment = anchor;
    const hash = pathPart.indexOf("#");
    if (hash >= 0) {
      if (fragment === undefined) fragment = pathPart.slice(hash + 1);
      pathPart = pathPart.slice(0, hash);
    }
    const q = pathPart.indexOf("?");
    if (q >= 0) pathPart = pathPart.slice(0, q);
    if (fragment !== undefined) fragment = fragment === "" ? undefined : safeDecode(fragment);

    let target: string;
    if (pathPart.startsWith("file://")) {
      try {
        target = fileURLToPath(pathPart);
      } catch {
        return { kind: "none" };
      }
    } else if (pathPart.startsWith("mdview://ws/")) {
      target = path.join(this.root, safeDecode(pathPart.slice("mdview://ws/".length)));
    } else {
      const decoded = safeDecode(pathPart);
      target = decoded.startsWith("/")
        ? path.join(this.root, decoded.slice(1))
        : path.join(path.dirname(this.abs(from)), decoded);
    }
    target = path.normalize(target);

    const exists = await fs.access(target).then(() => true, () => false);
    const markdown = files.isMarkdown(path.basename(target));
    const rel = this.relative(target);
    if (rel === null) {
      if (markdown && exists) this.openOutside(target);
      else if (exists) void shell.openPath(target);
      else shell.beep();
      return { kind: "handled" };
    }
    if (!markdown) {
      if (exists) void shell.openPath(target);
      else shell.beep();
      return { kind: "handled" };
    }
    if (rel === from) return fragment ? { kind: "anchor", anchor: fragment } : { kind: "none" };
    if (!exists) {
      shell.beep();
      return { kind: "handled" };
    }
    return { kind: "tab", path: rel, anchor: fragment };
  }

  // MARK: File operations (tree context menu)

  async uniqueName(dir: string, base: string): Promise<string> {
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let candidate = base;
    for (let n = 2; await this.exists(join(dir, candidate)); n++) candidate = `${stem} ${n}${ext}`;
    return candidate;
  }

  async fileOp(op: FileOp, rel: string, name?: string): Promise<FileOpResult> {
    const abs = this.abs(rel);
    const validName = (n: string | undefined): n is string =>
      !!n && n.trim() !== "" && !n.includes("/") && n !== "." && n !== "..";
    try {
      switch (op) {
        case "newFile": {
          if (!validName(name)) return { ok: false };
          let n = name.trim();
          if (path.extname(n) === "") n += ".md";
          const created = join(rel, n);
          const handle = await fs.open(this.abs(created), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o644);
          await handle.close();
          this.rescan();
          return { ok: true, path: created };
        }
        case "newFolder": {
          if (!validName(name)) return { ok: false };
          const created = join(rel, name.trim());
          await fs.mkdir(this.abs(created));
          this.rescan();
          return { ok: true, path: created };
        }
        case "rename": {
          if (rel === "" || !validName(name)) return { ok: false };
          const renamed = join(parentOf(rel), name.trim());
          if (await this.exists(renamed)) return { ok: false, error: `“${name}” already exists.` };
          await fs.rename(abs, this.abs(renamed));
          this.rescan();
          return { ok: true, path: renamed };
        }
        case "duplicate": {
          if (rel === "") return { ok: false };
          const st = await fs.stat(abs);
          const base = path.basename(rel);
          const ext = path.extname(base);
          const copyName = st.isDirectory() || !ext ? `${base} copy` : `${base.slice(0, -ext.length)} copy${ext}`;
          const dup = join(parentOf(rel), await this.uniqueName(parentOf(rel), copyName));
          await fs.cp(abs, this.abs(dup), { recursive: true, errorOnExist: true, force: false });
          this.rescan();
          return { ok: true, path: dup };
        }
        case "trash":
          if (rel === "") return { ok: false };
          await shell.trashItem(abs);
          this.rescan();
          return { ok: true };
        case "reveal":
          shell.showItemInFolder(abs);
          return { ok: true };
        case "copyPath":
          await clipboard.writeText(abs);
          return { ok: true };
        case "copyRelativePath":
          await clipboard.writeText(rel === "" ? "." : rel);
          return { ok: true };
        case "openDefault": {
          const error = await shell.openPath(abs);
          return error ? { ok: false, error } : { ok: true };
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

function join(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

function parentOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
