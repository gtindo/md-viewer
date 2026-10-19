// Bundles the core into dist/: renderer.js (entry, ES modules with lazy chunks
// for Shiki grammars, Mermaid diagrams and the editor), app.css and index.html.
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const harness = process.argv.includes("--harness");
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
  entryPoints: { renderer: "src/app.ts", app: "src/styles/app.css" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  target: ["safari17", "chrome120"],
  chunkNames: "chunks/[name]-[hash]",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

await cp("src/index.html", `${outdir}/index.html`);
if (harness) await cp("harness", `${outdir}/harness`, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const total = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`dist: ${Object.keys(result.metafile.outputs).length} files, ${(total / 1e6).toFixed(1)} MB`);
}
