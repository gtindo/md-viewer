// Renders every markdown file under a folder in headless WebKit and/or Chromium
// and reports Mermaid errors, page errors and timings. Optional screenshots.
//
//   node test/corpus.mjs --root ../../observy-rs [--engine webkit,chromium] [--shots out/] [--only name] [--dark]

import http from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit, chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const root = path.resolve(opt("root", path.resolve(here, "../fixtures")));
const engines = opt("engine", "webkit").split(",");
const shots = opt("shots", null);
const only = opt("only", null);
const dark = args.includes("--dark");
const width = Number(opt("width", 1400));
const height = Number(opt("height", 900));
const diagramIndex = opt("diagram", null);

const skip = new Set([".git", "node_modules", "target", "dist", "build", ".next", "vendor", ".venv"]);
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(md|markdown|mdx)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let file;
  if (url.pathname.startsWith("/app/")) file = path.join(dist, decodeURIComponent(url.pathname.slice(5)));
  else if (url.pathname.startsWith("/ws/")) file = path.join(root, decodeURIComponent(url.pathname.slice(4)));
  else return res.writeHead(404).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let files = await walk(root);
if (only) files = files.filter((f) => f.includes(only));
files.sort();
if (shots) await mkdir(shots, { recursive: true });

let failed = 0;
const summary = {};
for (const engineName of engines) {
  const engine = engineName === "chromium" ? chromium : webkit;
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  await page.goto(`${base}/app/index.html`);
  await page.waitForFunction(() => !!window.mdview);
  let diagrams = 0, errors = 0, totalMs = 0;
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    const text = await readFile(f, "utf8");
    pageErrors.length = 0;
    const t0 = Date.now();
    const result = await page.evaluate(async ({ rel, text }) => {
      await window.mdview.receive({ type: "render", payload: { path: rel, text, reason: "open" } });
      const d = await window.mdview.receive({ type: "renderAllDiagrams" });
      return d;
    }, { rel, text });
    const ms = Date.now() - t0;
    totalMs += ms;
    diagrams += result.count;
    errors += result.errors.length;
    const line = { engine: engineName, path: rel, diagrams: result.count, errors: result.errors, pageErrors: [...pageErrors], ms };
    if (result.errors.length || pageErrors.length) failed++;
    console.log(JSON.stringify(line));
    if (shots && diagramIndex !== null) {
      await page.evaluate((i) => {
        const el = document.querySelectorAll(".mermaid-block")[Number(i)];
        el?.scrollIntoView({ block: "start" });
        document.getElementById("preview-pane").scrollTop -= 20;
      }, diagramIndex);
      await page.waitForTimeout(300);
    }
    if (shots) {
      const name = `${engineName}-${dark ? "dark-" : ""}${rel.replace(/[\/]/g, "__")}.png`;
      await page.screenshot({ path: path.join(shots, name), fullPage: false });
    }
  }
  summary[engineName] = { files: files.length, diagrams, diagramErrors: errors, ms: totalMs };
  await browser.close();
}
server.close();
console.log("SUMMARY " + JSON.stringify(summary));
process.exit(failed ? 1 : 0);
