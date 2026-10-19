// Headless verification modes, as in the macOS VerificationRunner:
//   mdview --render-check <folder>     render every markdown file and all its diagrams; JSON lines on stdout
//   mdview --screenshot <file.md> <out.png> [--width 1400] [--height 900] [--dark] [--root <dir>] [--scroll <y>]
// The core runs as a top-level page in an offscreen window; messages travel over IPC.

import { BrowserWindow, ipcMain, nativeTheme, session } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as files from "./fileservice";
import { installProtocol } from "./protocol";
import { scan } from "./scanner";

export type VerificationJob =
  | { kind: "renderCheck"; folder: string }
  | { kind: "screenshot"; file: string; out: string; width: number; height: number; dark: boolean; root?: string; scroll?: number };

export function parseVerification(args: string[]): VerificationJob | { error: string } | null {
  const value = (flag: string) => {
    const j = args.indexOf(flag);
    return j >= 0 && j + 1 < args.length ? args[j + 1] : undefined;
  };
  const i = args.indexOf("--render-check");
  if (i >= 0) {
    if (i + 1 >= args.length) return { error: "usage: mdview --render-check <folder>" };
    return { kind: "renderCheck", folder: path.resolve(args[i + 1]) };
  }
  const s = args.indexOf("--screenshot");
  if (s < 0) return null;
  if (s + 2 >= args.length) {
    return { error: "usage: mdview --screenshot <file.md> <out.png> [--width 1400] [--height 900] [--dark] [--root <dir>] [--scroll <y>]" };
  }
  const num = (flag: string, d: number) => {
    const v = Number(value(flag));
    return Number.isFinite(v) && value(flag) !== undefined ? v : d;
  };
  return {
    kind: "screenshot",
    file: path.resolve(args[s + 1]),
    out: path.resolve(args[s + 2]),
    width: num("--width", 1400),
    height: num("--height", 900),
    dark: args.includes("--dark"),
    root: value("--root") ? path.resolve(value("--root")!) : undefined,
    scroll: value("--scroll") !== undefined ? num("--scroll", 0) : undefined,
  };
}

function emit(fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(fields) + "\n");
}

function fail(message: string): number {
  process.stderr.write(`MDView: ${message}\n`);
  return 2;
}

class TimeoutError extends Error {}

function withTimeout<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`timeout after ${ms / 1000} s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

let partitionCounter = 0;

/** A core page in an offscreen window. */
class CorePage {
  readonly win: BrowserWindow;
  private ready: Promise<boolean>;

  constructor(root: string, width: number, height: number, preload: string) {
    const partition = `mdview-verify-${++partitionCounter}`;
    installProtocol(session.fromPartition(partition), root);
    this.win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        partition,
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.webContents.setFrameRate(30);
    this.ready = new Promise<boolean>((resolve) => {
      const onMessage = (e: Electron.IpcMainEvent, msg: { type?: string }) => {
        if (e.sender !== this.win.webContents) return;
        if (msg?.type === "ready") {
          ipcMain.off("core:message", onMessage);
          resolve(true);
        }
      };
      ipcMain.on("core:message", onMessage);
      this.win.webContents.once("did-fail-load", () => resolve(false));
    });
    void this.win.loadURL("mdview://app/core/index.html");
  }

  waitReady(ms = 20000): Promise<boolean> {
    return withTimeout(ms, this.ready).catch(() => false);
  }

  send<T = unknown>(msg: unknown): Promise<T> {
    return this.win.webContents.executeJavaScript(`window.mdview.receive(${JSON.stringify(msg)})`, true) as Promise<T>;
  }

  async render(rel: string, file: { text: string; isUTF8: boolean }): Promise<{ count: number; errors: unknown[] }> {
    await this.send({ type: "setSettings", settings: {} });
    await this.send({ type: "render", payload: { path: rel, text: file.text, editable: file.isUTF8, reason: "open" } });
    const r = await this.send<{ count: number; errors: unknown[] } | null>({ type: "renderAllDiagrams" });
    if (!r) throw new Error("renderAllDiagrams returned no result");
    return { count: r.count ?? 0, errors: r.errors ?? [] };
  }

  close(): void {
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}

export async function runVerification(job: VerificationJob, preload: string): Promise<number> {
  if (job.kind === "renderCheck") return renderCheck(job.folder, preload);
  return screenshot(job, preload);
}

async function renderCheck(folder: string, preload: string): Promise<number> {
  let root: string;
  try {
    root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
  } catch {
    return fail(`not a folder: ${folder}`);
  }
  const result = await scan(root, { respectGitignore: true, extraGlobs: [] });
  let page = new CorePage(root, 1400, 900, preload);
  if (!(await page.waitReady())) return fail("the core did not become ready");
  const start = performance.now();
  let totalDiagrams = 0, totalErrors = 0, failedFiles = 0;
  for (const rel of result.markdownPaths) {
    const t0 = performance.now();
    let diagrams = 0;
    let errors: unknown[] = [];
    const read = await files.read(path.join(root, rel));
    if (!read.ok) {
      errors = [{ key: "", message: "could not read file" }];
    } else {
      try {
        const stats = await withTimeout(30000, page.render(rel, read.file));
        diagrams = stats.count;
        errors = stats.errors;
      } catch (e) {
        errors = [{ key: "", message: e instanceof Error ? e.message : String(e) }];
        if (e instanceof TimeoutError) {
          page.close();
          page = new CorePage(root, 1400, 900, preload);
          await page.waitReady();
        }
      }
    }
    totalDiagrams += diagrams;
    totalErrors += errors.length;
    if (errors.length) failedFiles++;
    emit({ path: rel, diagrams, errors, ms: Math.round(performance.now() - t0) });
  }
  emit({
    summary: true,
    files: result.markdownPaths.length,
    diagrams: totalDiagrams,
    errors: totalErrors,
    failedFiles,
    ms: Math.round(performance.now() - start),
  });
  page.close();
  return totalErrors > 0 ? 1 : 0;
}

async function screenshot(job: Extract<VerificationJob, { kind: "screenshot" }>, preload: string): Promise<number> {
  const file = await files.canonical(job.file);
  const root = await files.canonical(job.root ?? path.dirname(file));
  if (!file.startsWith(root + path.sep)) return fail(`${job.file} is not inside ${root}`);
  const read = await files.read(file);
  if (!read.ok) return fail(`cannot read ${job.file}`);
  const rel = file.slice(root.length + 1).split(path.sep).join("/");
  nativeTheme.themeSource = job.dark ? "dark" : "light";
  const page = new CorePage(root, job.width, job.height, preload);
  if (!(await page.waitReady())) return fail("the core did not become ready");
  try {
    const stats = await withTimeout(30000, page.render(rel, read.file));
    if (stats.errors.length) process.stderr.write(`MDView: ${stats.errors.length} diagram error(s)\n`);
  } catch (e) {
    return fail(`render failed: ${e}`);
  }
  if (job.scroll !== undefined) await page.send({ type: "restoreState", state: { scrollY: job.scroll } });
  await page.win.webContents.executeJavaScript(
    "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(1), 150))))",
  );
  const image = await page.win.webContents.capturePage();
  try {
    await fs.writeFile(job.out, image.toPNG());
  } catch (e) {
    return fail(`cannot write ${job.out}: ${(e as Error).message}`);
  }
  process.stdout.write(job.out + "\n");
  page.close();
  return 0;
}
