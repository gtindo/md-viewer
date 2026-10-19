// Builds the Linux shell into dist/:
//   main.js, preload.js        Electron main process and preload (CommonJS)
//   shell/                     the window UI (tree, tabs, toolbar), fonts and the core's Linux stylesheet
//   core/                      the shared core, copied from ../core/dist (built first when missing)
//   icon.png                   window icon
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const out = path.join(here, "dist");
const coreDir = path.resolve(here, "../core");

const exists = (p) => stat(p).then(() => true, () => false);

if (process.argv.includes("--core") || !(await exists(path.join(coreDir, "dist/index.html")))) {
  console.log("==> Building core");
  execFileSync("npm", ["--prefix", coreDir, "run", "build"], { stdio: "inherit" });
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "shell/fonts"), { recursive: true });

await cp(path.join(coreDir, "dist"), path.join(out, "core"), { recursive: true });
for (const f of ["index.html", "shell.css", "core-linux.css"]) await cp(path.join(here, "src/shell", f), path.join(out, "shell", f));
const fonts = path.join(here, "node_modules/@fontsource/jetbrains-mono/files");
for (const f of [
  "jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-latin-400-italic.woff2",
  "jetbrains-mono-latin-700-normal.woff2",
  "jetbrains-mono-latin-ext-400-normal.woff2",
]) {
  await cp(path.join(fonts, f), path.join(out, "shell/fonts", f));
}
await cp(path.join(here, "resources/icons/512x512.png"), path.join(out, "icon.png"));

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: { main: "src/main/main.ts" },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "@parcel/watcher"],
  },
  {
    ...common,
    entryPoints: { preload: "src/preload/preload.ts" },
    outdir: out,
    platform: "browser",
    format: "cjs",
    target: "chrome140",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: { shell: "src/shell/main.ts" },
    outdir: path.join(out, "shell"),
    platform: "browser",
    format: "esm",
    target: "chrome140",
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log(`dist: ${out}`);
}
