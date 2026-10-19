#!/usr/bin/env node
// Smoke test for a packaged build: runs the app's headless `--render-check` over the core
// fixtures and compares each file's diagram errors with its
// `<!-- expect-mermaid-errors: N -->` annotation (0 when absent).
//
//   node scripts/smoke-check.mjs build/MDView.app/Contents/MacOS/MDView
//   node scripts/smoke-check.mjs linux/release/MDView-1.0.0-linux-x64.AppImage --appimage-extract-and-run
//   node scripts/smoke-check.mjs <app> [extra args…] [--folder <dir>]

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fi = args.indexOf("--folder");
const folder = fi >= 0 ? path.resolve(args.splice(fi, 2)[1]) : path.join(root, "core/fixtures");
const [app, ...extra] = args;
if (!app) {
  console.error("usage: smoke-check.mjs <app binary> [extra args…] [--folder <dir>]");
  process.exit(2);
}

const child = spawn(app, [...extra, "--render-check", folder], { stdio: ["ignore", "pipe", "inherit"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
const timer = setTimeout(() => {
  console.error("smoke check: timed out after 180 s");
  child.kill("SIGKILL");
}, 180_000);
const code = await new Promise((r) => child.on("close", r));
clearTimeout(timer);

const lines = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const files = lines.filter((l) => !l.summary);
const summary = lines.find((l) => l.summary);
let ok = !!summary && files.length > 0;
if (!summary) console.error(`smoke check: no summary (exit code ${code})`);
for (const f of files) {
  const text = await readFile(path.join(folder, f.path), "utf8");
  const expected = Number(/<!--\s*expect-mermaid-errors:\s*(\d+)\s*-->/.exec(text)?.[1] ?? 0);
  const good = f.errors.length === expected;
  if (!good) ok = false;
  console.log(`${good ? "ok  " : "FAIL"} ${f.path}: ${f.diagrams} diagram(s), ${f.errors.length} error(s), expected ${expected}, ${f.ms} ms`);
  if (!good) for (const e of f.errors) console.log(`       ${String(e.message).split("\n")[0]}`);
}
if (summary) console.log(`${summary.files} files, ${summary.diagrams} diagrams in ${summary.ms} ms`);
if (summary && summary.diagrams === 0) {
  console.error("smoke check: no diagram was rendered");
  ok = false;
}
console.log(ok ? "smoke check passed" : "smoke check FAILED");
process.exit(ok ? 0 : 1);
