// Code highlighting with Shiki (JavaScript regex engine, precompiled bundled grammars).
// Grammars and themes are bundled as lazy chunks; the ones a document needs are
// loaded before it renders, so highlighting itself stays synchronous.

import { createHighlighterCore, type HighlighterCore, type ShikiTransformer } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { precompiledLangs } from "./langs.gen";
import { bundledThemes } from "shiki/themes";
import { bGrammar } from "./lang-b";

export interface CodeThemes {
  light: string;
  dark: string;
}

let highlighter: HighlighterCore | null = null;
let initPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>(["text", "plaintext", "txt", "plain"]);
const loadedThemes = new Set<string>();
const failedLangs = new Set<string>();

const bAliases = new Set(["b", ...(bGrammar.aliases ?? [])]);

/** Common aliases agents write that Shiki doesn't know under that exact name. */
const extraAliases: Record<string, string> = {
  sh: "shellscript",
  shell: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  console: "shellsession",
  "shell-session": "shellsession",
  objc: "objective-c",
  "obj-c": "objective-c",
  objectivec: "objective-c",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  dockerfile: "docker",
  tf: "terraform",
  hcl: "hcl",
  yml: "yaml",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  golang: "go",
  md: "markdown",
  gql: "graphql",
  patch: "diff",
  jsonc: "jsonc",
  json5: "json5",
  ps: "powershell",
  ps1: "powershell",
  htm: "html",
  xhtml: "html",
  svg: "xml",
  plist: "xml",
  proto: "protobuf",
};

const plainNames = new Set(["", "text", "txt", "plain", "plaintext", "none", "output", "log", "nohighlight"]);

/** Map an info-string language to a Shiki language id, or null when unknown. */
export function resolveLang(raw: string): string | null {
  const lang = raw.trim().toLowerCase();
  if (plainNames.has(lang)) return "text";
  if (bAliases.has(lang)) return "b";
  const alias = extraAliases[lang] ?? lang;
  return alias in precompiledLangs ? alias : null;
}

export async function initHighlighter(themes: CodeThemes): Promise<HighlighterCore> {
  if (!initPromise) {
    initPromise = createHighlighterCore({
      themes: [],
      langs: [bGrammar],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).then((h) => {
      highlighter = h;
      loadedLangs.add("b");
      return h;
    });
  }
  const h = await initPromise;
  await ensureThemes(themes);
  return h;
}

async function ensureThemes(themes: CodeThemes): Promise<void> {
  const h = highlighter!;
  for (const name of [themes.light, themes.dark]) {
    if (loadedThemes.has(name)) continue;
    const loader = (bundledThemes as Record<string, () => Promise<{ default: unknown }>>)[name];
    if (!loader) continue;
    const mod = await loader();
    await h.loadTheme(mod.default as never);
    loadedThemes.add(name);
  }
}

/** Load the grammars for these languages (ids returned by resolveLang). */
export async function ensureLangs(langs: Iterable<string>): Promise<void> {
  const h = highlighter;
  if (!h) return;
  const pending: Promise<void>[] = [];
  for (const lang of langs) {
    if (loadedLangs.has(lang) || failedLangs.has(lang)) continue;
    // Precompiled grammars skip the costly Oniguruma → JS regex translation at first use.
    const loader = precompiledLangs[lang];
    if (!loader) {
      failedLangs.add(lang);
      continue;
    }
    pending.push(
      loader()
        .then((mod) => h.loadLanguage(mod.default as never))
        .then(() => {
          loadedLangs.add(lang);
        })
        .catch((e) => {
          console.warn("mdview: failed to load grammar", lang, e);
          failedLangs.add(lang);
        }),
    );
  }
  await Promise.all(pending);
}

export function availableThemes(): string[] {
  return Object.keys(bundledThemes);
}

export function isLangReady(lang: string): boolean {
  return loadedLangs.has(lang) && !!highlighter;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function plainHtml(code: string, lineClass?: (i: number) => string, prefix?: (i: number) => string): string {
  const lines = code.split("\n");
  const body = lines
    .map((l, i) => `<span class="line${lineClass ? " " + lineClass(i) : ""}">${prefix ? prefix(i) : ""}${escapeHtml(l)}</span>`)
    .join("\n");
  return `<pre class="shiki plain" tabindex="0"><code>${body}</code></pre>`;
}

/** Highlight a block. The language must have been loaded with ensureLangs. */
export function highlight(code: string, lang: string | null, themes: CodeThemes): string {
  code = code.replace(/\n$/, "");
  if (!highlighter || !lang || lang === "text" || !loadedLangs.has(lang)) return plainHtml(code);
  try {
    return highlighter.codeToHtml(code, {
      lang,
      themes: { light: pickTheme(themes.light, "github-light"), dark: pickTheme(themes.dark, "github-dark") },
      defaultColor: false,
    });
  } catch (e) {
    console.warn("mdview: highlight failed", lang, e);
    return plainHtml(code);
  }
}

function pickTheme(name: string, fallback: string): string {
  return loadedThemes.has(name) ? name : loadedThemes.has(fallback) ? fallback : [...loadedThemes][0] ?? "none";
}

type DiffKind = "add" | "del" | "ctx" | "hunk" | "meta";

function diffKind(line: string): DiffKind {
  if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

/** Strip the +/- markers so the inner language can be detected or highlighted. */
export function diffContent(code: string): string {
  return code
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => {
      const k = diffKind(l);
      return k === "add" || k === "del" || (k === "ctx" && l.startsWith(" ")) ? l.slice(1) : k === "ctx" ? l : "";
    })
    .join("\n");
}

/**
 * Highlight a diff block: added and removed lines get coloured backgrounds,
 * and the code itself is highlighted in `innerLang` when one is known.
 */
export function highlightDiff(code: string, innerLang: string | null, themes: CodeThemes): string {
  code = code.replace(/\n$/, "");
  const raw = code.split("\n");
  const kinds = raw.map(diffKind);
  const sign = (i: number) => {
    const k = kinds[i];
    const ch = k === "add" ? "+" : k === "del" ? "-" : k === "ctx" && raw[i].startsWith(" ") ? " " : "";
    return ch ? `<span class="diff-sign">${ch}</span>` : "";
  };
  const lineClass = (i: number) => `diff-${kinds[i]}`;

  if (!highlighter || !innerLang || innerLang === "text" || !loadedLangs.has(innerLang)) {
    const lang = loadedLangs.has("diff") ? "diff" : null;
    if (!lang) return plainHtml(code, lineClass).replace('class="shiki plain"', 'class="shiki plain diff"');
    // Shiki's own diff grammar colours the markers; we still add line backgrounds.
    const t: ShikiTransformer = {
      line(node, line) {
        this.addClassToHast(node, lineClass(line - 1));
      },
      pre(node) {
        this.addClassToHast(node, "diff");
      },
    };
    return safeHtml(code, lang, themes, [t], () => plainHtml(code, lineClass));
  }

  const content = raw
    .map((l, i) => {
      const k = kinds[i];
      if (k === "add" || k === "del") return l.slice(1);
      if (k === "ctx" && l.startsWith(" ")) return l.slice(1);
      return l;
    })
    .join("\n");
  const t: ShikiTransformer = {
    line(node, line) {
      const i = line - 1;
      this.addClassToHast(node, lineClass(i));
      const k = kinds[i];
      const ch = k === "add" ? "+" : k === "del" ? "-" : k === "ctx" && raw[i].startsWith(" ") ? " " : "";
      if (ch) node.children.unshift({ type: "element", tagName: "span", properties: { class: "diff-sign" }, children: [{ type: "text", value: ch }] });
    },
    pre(node) {
      this.addClassToHast(node, "diff");
    },
  };
  return safeHtml(content, innerLang, themes, [t], () => plainHtml(content, lineClass, sign));
}

function safeHtml(code: string, lang: string, themes: CodeThemes, transformers: ShikiTransformer[], fallback: () => string): string {
  try {
    return highlighter!.codeToHtml(code, {
      lang,
      themes: { light: pickTheme(themes.light, "github-light"), dark: pickTheme(themes.dark, "github-dark") },
      defaultColor: false,
      transformers,
    });
  } catch (e) {
    console.warn("mdview: highlight failed", lang, e);
    return fallback();
  }
}

/** Human label for a language id. */
export function langLabel(raw: string, resolved: string | null): string {
  if (resolved === "b") return "B";
  if (!raw) return resolved && resolved !== "text" ? resolved : "";
  return raw;
}
