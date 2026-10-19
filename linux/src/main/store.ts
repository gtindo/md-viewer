// Preferences (settings.json) and session state (session.json) under ~/.config/MDView,
// written atomically. Unknown or missing keys fall back to defaults so stored files
// survive new fields being added.

import { app } from "electron";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { defaultSettings } from "../../../core/src/bridge";
import { FONT_SIZE_RANGE, type Preferences, type WorkspacePrefs, type WorkspaceSession } from "../common/types";

export function defaultPreferences(): Preferences {
  return {
    core: { ...defaultSettings },
    reopenWorkspaces: true,
    defaultMode: "preview",
    autosave: "off",
    respectGitignore: true,
    extraIgnoreGlobs: "",
  };
}

function pick<T>(value: unknown, fallback: T, valid?: (v: unknown) => boolean): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== typeof fallback) return fallback;
  if (valid && !valid(value)) return fallback;
  return value as T;
}

const oneOf = (...xs: string[]) => (v: unknown) => xs.includes(v as string);

export function sanitizePreferences(raw: unknown): Preferences {
  const d = defaultPreferences();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const c = (r.core && typeof r.core === "object" ? r.core : {}) as Record<string, unknown>;
  const dc = d.core;
  const core = {
    width: pick(c.width, dc.width, oneOf("readable", "wide", "full")),
    fontSize: Math.min(Math.max(pick(c.fontSize, dc.fontSize), FONT_SIZE_RANGE[0]), FONT_SIZE_RANGE[1]),
    proseFont: pick(c.proseFont, dc.proseFont, oneOf("system", "serif")),
    codeThemeLight: pick(c.codeThemeLight, dc.codeThemeLight),
    codeThemeDark: pick(c.codeThemeDark, dc.codeThemeDark),
    codeLineNumbers: pick(c.codeLineNumbers, dc.codeLineNumbers),
    diagramMaxHeight: pick(c.diagramMaxHeight, dc.diagramMaxHeight),
    diagramSmallZoom: pick(c.diagramSmallZoom, dc.diagramSmallZoom, oneOf("actual", "fit")),
    showMinimap: pick(c.showMinimap, dc.showMinimap),
    mermaidTheme: pick(c.mermaidTheme, dc.mermaidTheme, oneOf("auto", "default", "dark", "neutral", "forest", "base")),
    editorLineNumbers: pick(c.editorLineNumbers, dc.editorLineNumbers),
    vim: pick(c.vim, dc.vim),
    scrollSync: pick(c.scrollSync, dc.scrollSync),
  };
  return {
    core,
    reopenWorkspaces: pick(r.reopenWorkspaces, d.reopenWorkspaces),
    defaultMode: pick(r.defaultMode, d.defaultMode, oneOf("preview", "split", "edit")),
    autosave: pick(r.autosave, d.autosave, oneOf("off", "onFocusLoss", "afterIdle")),
    respectGitignore: pick(r.respectGitignore, d.respectGitignore),
    extraIgnoreGlobs: pick(r.extraIgnoreGlobs, d.extraIgnoreGlobs),
  };
}

export function ignoreGlobList(p: Preferences): string[] {
  return p.extraIgnoreGlobs
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SessionFile {
  version: number;
  workspaces: WorkspaceSession[];
  recent: string[];
  workspacePrefs: Record<string, WorkspacePrefs>;
}

const MAX_RECENTS = 10;

function configDir(): string {
  return process.env.MDVIEW_CONFIG_DIR || app.getPath("userData");
}

function readJSON(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJSON(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(tmp, file);
}

/** Serialises writes per file so a slow write never lands after a newer one. */
class JSONFile {
  private chain: Promise<void> = Promise.resolve();
  constructor(readonly file: string) {}
  save(value: unknown): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(value));
    this.chain = this.chain.then(() => writeJSON(this.file, snapshot)).catch((e) => console.error("save failed", this.file, e));
    return this.chain;
  }
}

export class Store {
  prefs: Preferences;
  session: SessionFile;
  private prefsFile: JSONFile;
  private sessionFile: JSONFile;
  private saveTimer: NodeJS.Timeout | null = null;
  /** Supplies the live workspace sessions (set by the window manager). */
  collectWorkspaces: (() => WorkspaceSession[]) | null = null;
  /** While false (during launch restore or quitting), the open-workspace list is not rewritten. */
  tracksOpenWorkspaces = true;

  constructor() {
    const dir = configDir();
    this.prefsFile = new JSONFile(path.join(dir, "settings.json"));
    this.sessionFile = new JSONFile(path.join(dir, "session.json"));
    this.prefs = sanitizePreferences(readJSON(this.prefsFile.file));
    const s = (readJSON(this.sessionFile.file) ?? {}) as Partial<SessionFile>;
    this.session = {
      version: 1,
      workspaces: Array.isArray(s.workspaces) ? s.workspaces.filter((w) => w && typeof w.root === "string") : [],
      recent: Array.isArray(s.recent) ? s.recent.filter((x) => typeof x === "string") : [],
      workspacePrefs: s.workspacePrefs && typeof s.workspacePrefs === "object" ? s.workspacePrefs : {},
    };
  }

  setPrefs(next: Preferences): void {
    this.prefs = sanitizePreferences(next);
    void this.prefsFile.save(this.prefs);
  }

  workspacePrefs(root: string): WorkspacePrefs | undefined {
    return this.session.workspacePrefs[root];
  }

  setWorkspacePrefs(root: string, prefs: WorkspacePrefs): void {
    this.session.workspacePrefs[root] = prefs;
    this.scheduleSave();
  }

  noteRecent(root: string): void {
    this.session.recent = [root, ...this.session.recent.filter((r) => r !== root)].slice(0, MAX_RECENTS);
    app.addRecentDocument(root);
    this.scheduleSave();
  }

  clearRecents(): void {
    this.session.recent = [];
    app.clearRecentDocuments();
    this.scheduleSave();
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 1000);
  }

  saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.tracksOpenWorkspaces && this.collectWorkspaces) this.session.workspaces = this.collectWorkspaces();
    return this.sessionFile.save(this.session);
  }
}
