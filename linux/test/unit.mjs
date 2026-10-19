// Unit checks for the main process's pure parts: gitignore matching, the tree scanner
// and the file service's encoding round trip.   node test/unit.mjs

import * as esbuild from "esbuild";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = await mkdtemp(path.join(os.tmpdir(), "mdview-unit-"));
await esbuild.build({
  stdin: {
    contents: 'export * from "./src/main/gitignore"; export * from "./src/main/fileservice"; export { scan, displayTree } from "./src/main/scanner";',
    resolveDir: path.resolve(here, ".."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(tmp, "units.cjs"),
  logLevel: "error",
});
const m = createRequire(import.meta.url)(path.join(tmp, "units.cjs"));

let passed = 0, failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => (passed++, console.log(`  ✓ ${name}`)))
    .catch((e) => (failed++, console.log(`  ✗ ${name}\n      ${e.message}`)));
}
function eq(a, b, msg = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

await check("globs", () => {
  const cases = [
    ["*.log", "debug.log", true], ["*.log", "a/debug.log", false], ["build*", "build-out", true],
    ["a/**/b", "a/b", true], ["a/**/b", "a/x/y/b", true], ["**/foo", "x/foo", true], ["foo/**", "foo/a/b", true],
    ["[abc].md", "b.md", true], ["[!abc].md", "b.md", false], ["?.md", "ab.md", false], ["doc\\*", "doc*", true],
  ];
  for (const [g, s, want] of cases) eq(new m.Glob(g).matches(s), want, `${g} vs ${s}:`);
});

await check("gitignore rules: anchoring, dir-only, negation", () => {
  const gi = new m.GitIgnore("", "# comment\n*.tmp\n/build\nlogs/\n!keep.tmp\ndocs/**/draft.md\n");
  eq(gi.decision("x/a.tmp", "a.tmp", false), true);
  eq(gi.decision("keep.tmp", "keep.tmp", false), false);
  eq(gi.decision("build", "build", true), true);
  eq(gi.decision("src/build", "build", true), undefined);
  eq(gi.decision("logs", "logs", false), undefined);
  eq(gi.decision("a/logs", "logs", true), true);
  eq(gi.decision("docs/a/b/draft.md", "draft.md", false), true);
});

await check("decode / encode round trip keeps CRLF, BOM and trailing newline", () => {
  const raw = Buffer.from("﻿a\r\nb\r\n", "utf8");
  const f = m.decode(raw);
  eq([f.text, f.usesCRLF, f.hasBOM, f.hasTrailingNewline, f.isUTF8], ["a\nb\n", true, true, true, true]);
  eq(m.encode("a\nb\nc", f).data.equals(Buffer.from("﻿a\r\nb\r\nc\r\n", "utf8")), true);
  const g = m.decode(Buffer.from("no newline"));
  eq(m.encode("x\n", g).normalized, "x");
  eq(m.decode(Buffer.from([0x66, 0xff, 0x6f])).isUTF8, false);
});

await check("atomic write keeps permissions and resolves symlinks", async () => {
  const dir = path.join(tmp, "w");
  await mkdir(dir);
  const target = path.join(dir, "t.md");
  await writeFile(target, "old\n", { mode: 0o640 });
  const { symlink, stat, readFile, readdir } = await import("node:fs/promises");
  await symlink(target, path.join(dir, "link.md"));
  await m.write("new", path.join(dir, "link.md"), m.decode(Buffer.from("old\n")));
  eq(await readFile(target, "utf8"), "new\n");
  eq((await stat(target)).mode & 0o777, 0o640);
  eq((await readdir(dir)).sort(), ["link.md", "t.md"]);
});

await check("scanner: gitignore, always-hidden, markdown containment, natural sort", async () => {
  const root = path.join(tmp, "scan");
  for (const d of ["docs/step-10", "docs/step-2", "node_modules/x", "out", "code", ".git"]) await mkdir(path.join(root, d), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "out/\n");
  await writeFile(path.join(root, "docs/step-10/a.md"), "");
  await writeFile(path.join(root, "docs/step-2/b.MD"), "");
  await writeFile(path.join(root, "node_modules/x/c.md"), "");
  await writeFile(path.join(root, "out/d.md"), "");
  await writeFile(path.join(root, "code/main.rs"), "");
  const r = await m.scan(root, { respectGitignore: true, extraGlobs: ["*.rs"] });
  eq(r.markdownPaths, ["docs/step-2/b.MD", "docs/step-10/a.md"]);
  const md = m.displayTree(r.root, "markdown");
  eq(md.children.map((c) => c.name), ["docs"]);
  eq(md.children[0].children.map((c) => c.name), ["step-2", "step-10"]);
  const all = m.displayTree(r.root, "markdownAndFolders");
  eq(all.children.map((c) => c.name), ["code", "docs"]);
});

await rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
