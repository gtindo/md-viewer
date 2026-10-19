// End-to-end checks of the Linux shell, driving the real Electron app with Playwright:
// tree, tabs, editing and saving, live reload, conflicts, links and history, session
// restore, settings and the clipboard. Menu shortcuts are sent as the menu would send them.
//
//   node test/e2e.mjs            (run `npm run build` first; on a headless Linux box use xvfb-run)

import { _electron as electron } from "playwright";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const fixtures = path.resolve(here, "../../core/fixtures");

const tmp = await mkdtemp(path.join(os.tmpdir(), "mdview-e2e-"));
const ws = path.join(tmp, "workspace");
const config = path.join(tmp, "config");
await mkdir(path.join(ws, "docs/nested"), { recursive: true });
await mkdir(path.join(ws, "src"), { recursive: true });
await mkdir(path.join(ws, "ignored"), { recursive: true });
for (const f of ["showcase.md", "large-flowchart.md", "b-method.md"]) await cp(path.join(fixtures, f), path.join(ws, f));
await writeFile(path.join(ws, ".gitignore"), "ignored/\n");
await writeFile(path.join(ws, "ignored/hidden.md"), "# hidden\n");
await writeFile(path.join(ws, "src/main.rs"), "fn main() {}\n");
await writeFile(path.join(ws, "docs/notes.md"), "# Notes\r\n\r\nFirst line.\r\n");
await writeFile(
  path.join(ws, "docs/nested/plan.md"),
  "# Plan\n\nSee [the notes](../notes.md) and [showcase](../../showcase.md).\n\n```mermaid\nflowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[(DB)]\n```\n",
);

let passed = 0, failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function until(fn, msg, timeout = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${msg} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

/** Same rule as the AppImage launcher: Chromium's sandbox needs unprivileged user namespaces. */
async function sandboxArgs() {
  if (process.platform !== "linux") return [];
  const read = (f) => readFile(f, "utf8").then((s) => s.trim(), () => "");
  if (process.getuid?.() === 0) return ["--no-sandbox"];
  if ((await read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")) === "1") return ["--no-sandbox"];
  if ((await read("/proc/sys/kernel/unprivileged_userns_clone")) === "0") return ["--no-sandbox"];
  return [];
}

async function launch(args = [ws]) {
  const app = await electron.launch({
    args: [appDir, ...args, ...(await sandboxArgs())],
    cwd: appDir,
    env: { ...process.env, MDVIEW_CONFIG_DIR: config },
  });
  if (process.env.E2E_LOG) app.process().stderr.on("data", (d) => process.stderr.write(d));
  const win = await app.firstWindow();
  win.on("pageerror", (e) => console.log("    pageerror:", e.message));
  await win.waitForFunction(() => !!window.__mdviewWorkspace || document.documentElement.dataset.kind);
  return { app, win };
}

const command = (app, cmd, arg) =>
  app.evaluate(({ BrowserWindow }, [c, a]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible()) ?? BrowserWindow.getAllWindows()[0];
    w.webContents.send("menu:command", c, a);
  }, [cmd, arg]);

const tabs = (win) =>
  win.$$eval(".tab", (els) => els.map((e) => ({ title: e.querySelector(".tab-title").textContent, cls: e.className })));
const doc = (win) => win.frameLocator("iframe.doc-frame.active");
const docText = (win, sel) => doc(win).locator(sel).first().textContent({ timeout: 8000 });
const treeNames = (win) => win.$$eval(".tree-row .name", (els) => els.map((e) => e.textContent));

console.log(`MDView e2e (${process.platform}/${process.arch}), workspace ${ws}`);
let { app, win } = await launch();

await check("window opens the workspace", async () => {
  const title = await until(() => win.title().then((t) => t.includes("workspace") && t), "title");
  assert(title.endsWith("MDView"), `title ${title}`);
});

await check("tree shows markdown only, respects .gitignore", async () => {
  const names = await until(async () => {
    const n = await treeNames(win);
    return n.includes("showcase.md") && n;
  }, "tree did not load");
  assert(names.includes("docs"), "docs folder missing");
  assert(!names.includes("ignored"), "ignored folder shown");
  assert(!names.includes("src"), "markdown-free folder shown");
});

await check("All Files mode shows other files", async () => {
  await win.selectOption(".filter-mode", "allFiles");
  await until(async () => (await treeNames(win)).includes("src"), "src not shown");
  await win.selectOption(".filter-mode", "markdown");
  await until(async () => !(await treeNames(win)).includes("src"), "src still shown");
});

await check("type-to-filter expands matching folders", async () => {
  await win.fill(".filter-input", "plan");
  const names = await until(async () => {
    const n = await treeNames(win);
    return n.includes("plan.md") && n;
  }, "plan.md not found");
  assert(!names.includes("showcase.md"), "non-matching file shown");
  await win.fill(".filter-input", "");
});

await check("single click opens a preview tab, the next click replaces it", async () => {
  await win.click(".tree-row:has-text('showcase.md')");
  await until(async () => (await docText(win, "h1"))?.includes("Showcase"), "showcase not rendered");
  await win.click(".tree-row:has-text('b-method.md')");
  await until(async () => (await tabs(win)).some((t) => t.title === "b-method.md"), "tab not replaced");
  const t = await tabs(win);
  assert(t.length === 1, `expected 1 tab, got ${t.length}`);
  assert(t[0].cls.includes("preview"), "tab is not a preview tab");
});

await check("double click pins; a new click opens a second tab", async () => {
  await win.dblclick(".tree-row:has-text('b-method.md')");
  await until(async () => !(await tabs(win))[0].cls.includes("preview"), "not pinned");
  await win.click(".tree-row:has-text('large-flowchart.md')");
  await until(async () => (await tabs(win)).length === 2, "second tab missing");
});

await check("Mermaid renders inside the document", async () => {
  await win.click(".tree-row:has-text('showcase.md')");
  await until(async () => (await docText(win, "h1"))?.includes("Showcase"), "showcase not rendered");
  const block = doc(win).locator(".mmd").first();
  await block.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await until(async () => (await doc(win).locator(".mmd-content svg").count()) > 0, "no diagram svg", 15000);
});

await check("tab switching and Ctrl+number commands", async () => {
  await command(app, "selectTab", 1);
  await until(async () => (await tabs(win))[0].cls.includes("active"), "first tab not active");
  await command(app, "nextTab");
  await until(async () => (await tabs(win))[1].cls.includes("active"), "next tab not active");
});

await check("quick open finds and opens a file", async () => {
  await command(app, "quickOpen");
  await win.waitForSelector(".quick-input");
  await win.keyboard.type("notes");
  await until(async () => (await win.textContent(".quick-row.selected"))?.includes("notes.md"), "notes not ranked first");
  await win.keyboard.press("Enter");
  await until(async () => (await docText(win, "h1"))?.includes("Notes"), "notes not opened");
});

await check("edit, dirty dot, save keeps CRLF line endings", async () => {
  await command(app, "setMode", "edit");
  const content = doc(win).locator(".cm-content");
  await content.waitFor({ timeout: 8000 });
  await content.click();
  await win.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await win.keyboard.type("Added line.");
  await until(async () => (await tabs(win)).some((t) => t.title === "notes.md" && t.cls.includes("dirty")), "tab not dirty");
  const dirtyTitle = await win.title();
  assert(dirtyTitle.startsWith("●"), `title has no dirty marker: ${dirtyTitle}`);
  await command(app, "save");
  await until(async () => !(await tabs(win)).some((t) => t.cls.includes("dirty")), "still dirty after save");
  const disk = await readFile(path.join(ws, "docs/notes.md"), "utf8");
  assert(disk.includes("Added line."), "text not saved");
  assert(disk.includes("\r\n") && !/[^\r]\n/.test(disk), "CRLF not preserved");
  await command(app, "setMode", "preview");
});

await check("live reload when an agent rewrites the open file", async () => {
  await writeFile(path.join(ws, "docs/notes.md"), "# Notes rewritten\n\nBy an agent.\n");
  await until(async () => (await docText(win, "h1"))?.includes("rewritten"), "preview did not reload", 10000);
});

await check("conflict banner when the file changes under unsaved edits", async () => {
  await command(app, "setMode", "split");
  const content = doc(win).locator(".cm-content");
  await content.waitFor({ timeout: 8000 });
  await content.click();
  await win.keyboard.type("Mine ");
  await until(async () => (await tabs(win)).some((t) => t.cls.includes("dirty")), "not dirty");
  await writeFile(path.join(ws, "docs/notes.md"), "# Notes theirs\n");
  await until(async () => (await doc(win).locator("#banner").textContent())?.includes("changed on disk"), "no conflict banner", 10000);
  await doc(win).locator("#banner button:has-text('Load Theirs')").click();
  await until(async () => !(await tabs(win)).some((t) => t.cls.includes("dirty")), "still dirty after Load Theirs");
  await until(async () => (await docText(win, "h1"))?.includes("theirs"), "theirs not shown");
  await command(app, "setMode", "preview");
});

await check("relative links open files; Back returns", async () => {
  await command(app, "quickOpen");
  await win.keyboard.type("plan");
  await win.keyboard.press("Enter");
  await until(async () => (await docText(win, "h1"))?.includes("Plan"), "plan not opened");
  const before = (await tabs(win)).length;
  await doc(win).locator("a:has-text('the notes')").click();
  await until(async () => (await win.$eval(".tab.active .tab-title", (e) => e.textContent)) === "notes.md", "link not followed");
  assert((await tabs(win)).length === before, "link opened an extra tab although notes.md was open");
  await command(app, "goBack");
});

await check("deleted file: struck-through tab and banner", async () => {
  await writeFile(path.join(ws, "gone.md"), "# Gone soon\n");
  await until(async () => (await treeNames(win)).includes("gone.md"), "new file not in tree", 10000);
  await win.dblclick(".tree-row:has-text('gone.md')");
  await until(async () => (await docText(win, "h1"))?.includes("Gone"), "gone.md not opened");
  await rm(path.join(ws, "gone.md"));
  await until(async () => (await tabs(win)).some((t) => t.title === "gone.md" && t.cls.includes("deleted")), "tab not marked deleted", 10000);
  await until(async () => (await doc(win).locator("#banner").textContent())?.includes("deleted"), "no deleted banner");
  await command(app, "closeTab");
  await until(async () => !(await tabs(win)).some((t) => t.title === "gone.md"), "tab not closed");
});

await check("reopen closed tab", async () => {
  await command(app, "reopenClosedTab");
  await until(async () => (await tabs(win)).length >= 3, "nothing reopened");
});

await check("file operations create files that appear in the tree", async () => {
  const r = await win.evaluate(() => window.mdviewShell.invoke("file:op", "newFile", "docs", "created"));
  assert(r.ok && r.path === "docs/created.md", JSON.stringify(r));
  await win.fill(".filter-input", "created");
  await until(async () => (await treeNames(win)).includes("created.md"), "created.md not in tree", 10000);
  await win.fill(".filter-input", "");
  const r2 = await win.evaluate(() => window.mdviewShell.invoke("file:op", "rename", "docs/created.md", "renamed.md"));
  assert(r2.ok && r2.path === "docs/renamed.md", JSON.stringify(r2));
});

await check("settings reach the core (content width)", async () => {
  await win.selectOption(".width-select", "full");
  await until(async () => (await doc(win).locator("html").getAttribute("data-width")) === "full", "width not applied");
  await win.selectOption(".width-select", "readable");
});

await check("copy code block puts text on the clipboard", async () => {
  await command(app, "quickOpen");
  await win.keyboard.type("showcase");
  await win.keyboard.press("Enter");
  await until(async () => (await docText(win, "h1"))?.includes("Showcase"), "showcase not opened");
  await app.evaluate(({ clipboard }) => clipboard.writeText("sentinel"));
  const btn = doc(win).locator(".code-copy").first();
  const code = (await btn.evaluate((b) => b.closest(".code-block")?.querySelector("code")?.textContent ?? "")).replace(/\n$/, "");
  await btn.evaluate((b) => b.click());
  const text = await until(async () => {
    const t = await app.evaluate(({ clipboard }) => clipboard.readText());
    return t !== "sentinel" && t;
  }, "clipboard unchanged");
  assert(text === code, `clipboard ${JSON.stringify(text.slice(0, 40))}, expected ${JSON.stringify(code.slice(0, 40))}`);
});

await check("diagram PNG copy rasterises through the host", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>';
  await win.evaluate((s) => window.mdviewShell.invoke("clipboard:write", { svg: s, asPng: true, width: 40, height: 30 }), svg);
  const has = await until(() => app.evaluate(({ clipboard }) => clipboard.has("image/png")), "no PNG on clipboard");
  assert(has, "no PNG");
});

await check("sidebar toggle", async () => {
  await command(app, "toggleSidebar");
  await until(() => win.$eval(".workspace", (e) => e.classList.contains("sidebar-hidden")), "sidebar still shown");
  await command(app, "toggleSidebar");
  await until(() => win.$eval(".workspace", (e) => !e.classList.contains("sidebar-hidden")), "sidebar still hidden");
});

const before = await tabs(win);
const activeBefore = await win.$eval(".tab.active .tab-title", (e) => e.textContent);
await new Promise((r) => setTimeout(r, 1500)); // let the debounced session save run
await app.close();

await check("session restore reopens tabs and the active tab", async () => {
  ({ app, win } = await launch([]));
  await until(async () => (await tabs(win)).length === before.length, `expected ${before.length} tabs, got ${(await tabs(win)).length}`);
  const active = await win.$eval(".tab.active .tab-title", (e) => e.textContent);
  assert(active === activeBefore, `active ${active}, expected ${activeBefore}`);
});

await app.close().catch(() => {});
await rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
