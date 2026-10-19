// Markdown → HTML with GitHub-flavoured parity: tables, task lists, footnotes,
// alerts, heading anchors, front matter, and source line attributes for scroll sync.

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import footnote from "markdown-it-footnote";
import { load as loadYaml } from "js-yaml";
import { escapeHtml, resolveLang, langLabel, highlight, highlightDiff, diffContent, type CodeThemes } from "./highlight";
import { looksLikeB, maybeB } from "./lang-b";

export interface FenceInfo {
  index: number;
  raw: string;
  /** Resolved Shiki language for highlighting, or null for plain. */
  lang: string | null;
  /** For diff blocks: the language of the code inside. */
  innerLang: string | null;
  isMermaid: boolean;
  content: string;
  line: number;
}

export interface MermaidSource {
  key: string;
  index: number;
  source: string;
  /** 0-based source line of the opening fence. */
  line: number;
}

export interface RenderContext {
  themes: CodeThemes;
  /** Filled while rendering. */
  mermaid: MermaidSource[];
  fences: FenceInfo[];
  /** Whether this document is about B; decided before rendering. */
  bDocument: boolean;
}

export function hashString(s: string): string {
  // FNV-1a 32-bit, hex. Good enough for cache keys.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const ALERTS: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

const ALERT_ICONS: Record<string, string> = {
  NOTE: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  IMPORTANT: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  WARNING: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  CAUTION: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
const WRAP_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1.75 3h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm0 4h10.5a2.75 2.75 0 0 1 0 5.5H9.56l.72.72a.75.75 0 1 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 1 1 1.06 1.06l-.72.72h2.69a1.25 1.25 0 0 0 0-2.5H1.75a.75.75 0 0 1 0-1.5Zm0 4h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z"/></svg>';

// ---------------------------------------------------------------------------
// Plugins

function frontMatterPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    "table",
    "front_matter",
    (state, startLine, endLine, silent) => {
      if (startLine !== 0 || state.blkIndent !== 0) return false;
      const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
      if (lineText(0) !== "---") return false;
      let end = -1;
      for (let n = 1; n < endLine; n++) {
        const t = lineText(n);
        if (t === "---" || t === "...") {
          end = n;
          break;
        }
      }
      if (end < 0) return false;
      if (silent) return true;
      const body = state.src.slice(state.bMarks[1], state.bMarks[end]);
      const token = state.push("front_matter", "", 0);
      token.content = body;
      token.map = [0, end + 1];
      token.block = true;
      state.line = end + 1;
      return true;
    },
    { alt: [] },
  );
  md.renderer.rules.front_matter = (tokens, idx) => renderFrontMatter(tokens[idx].content);
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => `<code>${escapeHtml(typeof x === "object" ? JSON.stringify(x) : String(x))}</code>`).join(" ");
  if (v instanceof Date) return escapeHtml(v.toISOString().slice(0, 10));
  if (typeof v === "object") return `<code>${escapeHtml(JSON.stringify(v))}</code>`;
  return escapeHtml(String(v));
}

function renderFrontMatter(src: string): string {
  let data: unknown;
  try {
    data = loadYaml(src);
  } catch {
    data = undefined;
  }
  let inner: string;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${renderValue(v)}</td></tr>`)
      .join("");
    inner = `<table>${rows}</table>`;
  } else {
    inner = `<pre><code>${escapeHtml(src)}</code></pre>`;
  }
  return `<details class="front-matter" data-line="0"><summary>Metadata</summary>${inner}</details>\n`;
}

function alertsPlugin(md: MarkdownIt): void {
  md.core.ruler.after("block", "github_alerts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      const p = tokens[i + 1];
      const inline = tokens[i + 2];
      if (p?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toUpperCase();
      tokens[i].attrJoin("class", `markdown-alert markdown-alert-${kind.toLowerCase()}`);
      const rest = inline.content.slice(m[0].length);
      const title = new state.Token("html_block", "", 0);
      title.content = `<p class="markdown-alert-title">${ALERT_ICONS[kind]}${ALERTS[kind]}</p>\n`;
      if (rest.trim() === "") {
        // The marker was the whole paragraph: replace the paragraph with the title.
        tokens.splice(i + 1, 3, title);
      } else {
        inline.content = rest;
        tokens.splice(i + 1, 0, title);
      }
    }
  });
}

function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
      const first = t.children?.[0];
      if (!first || first.type !== "text") continue;
      const m = /^\[([ xX])\](?=\s|$)\s?/.exec(first.content);
      if (!m) continue;
      first.content = first.content.slice(m[0].length);
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${m[1] !== " " ? " checked" : ""}> `;
      t.children!.unshift(box);
      tokens[i - 2].attrJoin("class", "task-list-item");
      // Mark the enclosing list.
      for (let j = i - 3; j >= 0; j--) {
        const o = tokens[j];
        if ((o.type === "bullet_list_open" || o.type === "ordered_list_open") && o.level === tokens[i - 2].level - 1) {
          o.attrJoin("class", "contains-task-list");
          break;
        }
      }
    }
  });
}

function headingAnchorsPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "heading_anchors", (state) => {
    const seen = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== "heading_open") continue;
      const inline = tokens[i + 1];
      const text = (inline.children ?? [])
        .filter((c) => c.type === "text" || c.type === "code_inline")
        .map((c) => c.content)
        .join("");
      let slug = githubSlug(text) || "section";
      const n = seen.get(slug) ?? 0;
      seen.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      t.attrSet("id", slug);
      const link = new state.Token("html_inline", "", 0);
      link.content = `<a class="anchor" href="#${escapeHtml(slug)}" aria-label="Link to this section" tabindex="-1"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg></a>`;
      inline.children = [link, ...(inline.children ?? [])];
    }
  });
}

/** Source line attributes on block tokens, so the editor and preview can be kept in sync. */
function sourceLinesPlugin(md: MarkdownIt): void {
  const blockTypes = new Set([
    "paragraph_open", "heading_open", "bullet_list_open", "ordered_list_open", "list_item_open",
    "blockquote_open", "table_open", "tr_open", "hr", "dl_open", "footnote_open",
  ]);
  md.core.ruler.push("source_lines", (state) => {
    for (const t of state.tokens) {
      if (t.map && blockTypes.has(t.type) && t.level <= 3) {
        t.attrSet("data-line", String(t.map[0]));
      }
    }
  });
}

/** A paragraph that holds only images is a wide "media" element. */
function mediaParagraphPlugin(md: MarkdownIt): void {
  md.core.ruler.push("media_paragraphs", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i].type !== "paragraph_open" || tokens[i + 1].type !== "inline") continue;
      const kids = tokens[i + 1].children ?? [];
      const meaningful = kids.filter((k) => !(k.type === "softbreak" || (k.type === "text" && k.content.trim() === "")));
      if (meaningful.length && meaningful.every((k) => k.type === "image")) tokens[i].attrJoin("class", "media");
    }
  });
}

// ---------------------------------------------------------------------------

function fenceLang(info: string): { raw: string; attrs: string } {
  const trimmed = info.trim();
  const m = /^([^\s{]+)?\s*(.*)$/.exec(trimmed)!;
  return { raw: (m[1] ?? "").replace(/^\{|\}$/g, ""), attrs: m[2] ?? "" };
}

/** Classify fences before rendering so grammars can be loaded and B detected document-wide. */
export function analyzeFences(md: MarkdownIt, src: string): { fences: FenceInfo[]; bDocument: boolean; langs: Set<string> } {
  const tokens = md.parse(src, {});
  const fences: FenceInfo[] = [];
  let index = 0;
  for (const t of tokens) {
    if (t.type !== "fence" && t.type !== "code_block") continue;
    const { raw } = t.type === "fence" ? fenceLang(t.info) : { raw: "" };
    const lower = raw.toLowerCase();
    const isMermaid = lower === "mermaid" || lower === "mmd";
    fences.push({
      index: index++,
      raw,
      lang: isMermaid ? null : resolveLang(raw),
      innerLang: null,
      isMermaid,
      content: t.content,
      line: t.map?.[0] ?? 0,
    });
  }
  const explicitB = fences.some((f) => f.lang === "b");
  const untagged = fences.filter((f) => !f.isMermaid && f.raw === "");
  const bDocument = explicitB || untagged.some((f) => looksLikeB(f.content));

  const langs = new Set<string>();
  for (const f of fences) {
    if (f.isMermaid) continue;
    if (f.raw === "") {
      f.lang = (bDocument ? maybeB(f.content) : looksLikeB(f.content)) ? "b" : "text";
    }
    const lower = f.raw.toLowerCase();
    if (f.lang === "diff" || lower.startsWith("diff-") || lower.startsWith("diff+")) {
      const named = lower.match(/^diff[-+](.+)$/)?.[1];
      const inner = named ? resolveLang(named) : null;
      f.innerLang = inner ?? (bDocument && maybeB(diffContent(f.content)) ? "b" : looksLikeB(diffContent(f.content)) ? "b" : null);
      f.lang = "diff";
      if (f.innerLang) langs.add(f.innerLang);
    }
    if (f.lang) langs.add(f.lang);
  }
  return { fences, bDocument, langs };
}

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
  md.use(frontMatterPlugin);
  md.use(footnote);
  md.use(alertsPlugin);
  md.use(taskListPlugin);
  md.use(headingAnchorsPlugin);
  md.use(mediaParagraphPlugin);
  md.use(sourceLinesPlugin);

  // Tables scroll inside their own box.
  md.renderer.rules.table_open = (tokens, idx, options, _env, self) =>
    `<div class="table-wrap" data-line="${tokens[idx].map?.[0] ?? ""}">` + self.renderToken(tokens, idx, options);
  md.renderer.rules.table_close = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options) + "</div>\n";

  const renderFence = (tokens: Token[], idx: number, env: RenderContext): string => {
    const t = tokens[idx];
    const f = env.fences.find((x) => x.line === (t.map?.[0] ?? -1) && x.content === t.content);
    const line = t.map?.[0] ?? 0;
    if (f?.isMermaid) {
      const h = hashString(t.content);
      const occurrence = env.mermaid.filter((m) => m.key.startsWith(h)).length;
      const key = `${h}-${occurrence}`;
      const index = env.mermaid.length;
      env.mermaid.push({ key, index, source: t.content, line });
      return `<div class="mermaid-block wide" data-line="${line}" data-key="${key}" data-index="${index}"></div>\n`;
    }
    const raw = f?.raw ?? "";
    const lang = f?.lang ?? null;
    const html = lang === "diff" ? highlightDiff(t.content, f?.innerLang ?? null, env.themes) : highlight(t.content, lang, env.themes);
    const label = lang === "diff" && f?.innerLang ? `diff · ${langLabel("", f.innerLang)}` : langLabel(raw, lang);
    return (
      `<div class="code-block wide" data-line="${line}" data-hash="${hashString(raw + "\u0000" + t.content)}"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}>` +
      `<div class="code-toolbar"><span class="code-lang">${escapeHtml(label)}</span>` +
      `<button class="code-btn code-wrap" title="Toggle soft wrap" aria-label="Toggle soft wrap">${WRAP_ICON}</button>` +
      `<button class="code-btn code-copy" title="Copy" aria-label="Copy">${COPY_ICON}<span>Copy</span></button></div>` +
      html +
      `</div>\n`
    );
  };
  md.renderer.rules.fence = (tokens, idx, _o, env) => renderFence(tokens, idx, env as RenderContext);
  md.renderer.rules.code_block = (tokens, idx, _o, env) => renderFence(tokens, idx, env as RenderContext);
  return md;
}

export function renderMarkdown(md: MarkdownIt, src: string, ctx: RenderContext): string {
  return md.render(src, ctx);
}
