// The rendered document: patching with morphdom, code block tools, links,
// images, scroll position reporting, and find-in-document.

import morphdom from "morphdom";
import type MarkdownIt from "markdown-it";
import { postToHost, type Settings, type TabState } from "../bridge";
import { createMarkdown, analyzeFences, renderMarkdown, type RenderContext, type MermaidSource } from "./markdown";
import { initHighlighter, ensureLangs } from "./highlight";
import { sanitize } from "./sanitize";
import { DiagramManager } from "../mermaid/viewer";
import { configKey, type MermaidOptions } from "../mermaid/engine";
import { PanZoom } from "../mermaid/panzoom";
import { icons } from "../ui/icons";

export interface RenderOptions {
  path: string;
  text: string;
  allowRemoteImages: boolean;
}

export class DocumentView {
  readonly md: MarkdownIt = createMarkdown();
  readonly diagrams: DiagramManager;
  path = "";
  text = "";
  private renderSeq = 0;
  private scrollTimer = 0;
  private status: HTMLElement;
  private restoring: TabState | null = null;
  private lastWidth = 0;
  onBlockedRemote: (n: number) => void = () => undefined;

  constructor(
    readonly scroller: HTMLElement,
    readonly root: HTMLElement,
    private getSettings: () => Settings,
    private getMermaidOptions: () => MermaidOptions,
  ) {
    this.diagrams = new DiagramManager({
      settings: getSettings,
      mermaidOptions: getMermaidOptions,
      scrollContainer: () => this.scroller,
      docPath: () => this.path,
    });
    this.diagrams.setConfigKey(configKey(getMermaidOptions()));
    this.status = document.createElement("div");
    this.status.className = "link-status";
    this.status.hidden = true;
    document.body.appendChild(this.status);
    this.bindEvents();
  }

  async render(opts: RenderOptions): Promise<number> {
    const seq = ++this.renderSeq;
    const t0 = performance.now();
    const settings = this.getSettings();
    const themes = { light: settings.codeThemeLight, dark: settings.codeThemeDark };
    if (opts.text.length > LARGE_DOC && opts.path !== this.path) {
      // Large file just opened: paint the first screens right away (code plain
      // if its grammar isn't loaded yet), and the whole document on the next task.
      const head = safePrefix(opts.text, PREFIX_CHARS);
      this.paint({ ...opts, text: head }, analyzeFences(this.md, head), themes);
      await new Promise((r) => setTimeout(r, 0));
      if (seq !== this.renderSeq) return -1;
    }
    const analysis = analyzeFences(this.md, opts.text);
    // Don't wait long for grammars: code shows plain first and is patched in
    // place (morphdom) once its grammar has loaded.
    const ready = initHighlighter(themes).then(() => ensureLangs(analysis.langs));
    const loaded = await Promise.race([ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 60))]);
    if (seq !== this.renderSeq) return -1; // superseded by a newer render

    this.paint(opts, analysis, themes);
    if (!loaded) {
      void ready.then(() => {
        if (seq === this.renderSeq) this.paint(opts, analysis, themes);
      });
    }
    const ms = Math.round(performance.now() - t0);
    postToHost({ type: "rendered", path: opts.path, ms, diagrams: this.diagrams.blocks.length });
    if (this.restoring) {
      const st = this.restoring;
      this.restoring = null;
      this.applyScroll(st);
    }
    return ms;
  }

  private paint(opts: RenderOptions, analysis: ReturnType<typeof analyzeFences>, themes: { light: string; dark: string }): void {
    const t = [performance.now()];
    const ctx: RenderContext = { themes, mermaid: [], fences: analysis.fences, bDocument: analysis.bDocument };
    const html = renderMarkdown(this.md, opts.text, ctx);
    t.push(performance.now());
    const sctx = { path: opts.path, allowRemoteImages: opts.allowRemoteImages, blockedRemote: 0 };
    const clean = sanitize(html, sctx);
    t.push(performance.now());
    const samePath = opts.path === this.path;
    this.path = opts.path;
    this.text = opts.text;
    this.patch(clean, ctx.mermaid, samePath);
    t.push(performance.now());
    if ((window as { __mdviewProfile?: boolean }).__mdviewProfile) {
      console.log(`[mdview] markdown ${(t[1] - t[0]).toFixed(0)} ms · sanitize ${(t[2] - t[1]).toFixed(0)} ms · patch ${(t[3] - t[2]).toFixed(0)} ms`);
    }
    this.onBlockedRemote(sctx.blockedRemote);
    if (this.findQuery) this.runFind(this.findQuery, false);
  }

  private patch(html: string, mermaid: MermaidSource[], samePath: boolean): void {
    const next = document.createElement("article");
    next.id = this.root.id;
    next.className = this.root.className;
    next.innerHTML = html;
    if (!samePath) {
      this.diagrams.dispose();
      this.root.innerHTML = "";
    }
    // Unchanged diagrams keep their element (and SVG, zoom) wherever they move; an
    // edited diagram takes over the element at its old position so its last good
    // render and zoom level carry over.
    const oldEls = Array.from(this.root.querySelectorAll<HTMLElement>(".mermaid-block"));
    const newEls = Array.from(next.querySelectorAll<HTMLElement>(".mermaid-block"));
    const oldKeys = new Set(oldEls.map((e) => e.dataset.key));
    const newKeys = new Set(newEls.map((e) => e.dataset.key));
    newEls.forEach((el, i) => {
      const old = oldEls[i];
      el.dataset.morphKey = oldKeys.has(el.dataset.key) || !old || newKeys.has(old.dataset.key) ? el.dataset.key : old.dataset.key;
    });
    morphdom(this.root, next, {
      childrenOnly: true,
      getNodeKey: (node) => {
        const el = node as HTMLElement;
        if (el.nodeType !== 1) return undefined;
        if (el.classList.contains("mermaid-block")) return `mmd-${el.dataset.morphKey ?? el.dataset.key}`;
        return el.id || undefined;
      },
      onBeforeElUpdated: (from, to) => {
        if (from.classList.contains("mermaid-block")) {
          // The diagram manager owns the inside of each viewport.
          (from as HTMLElement).dataset.line = (to as HTMLElement).dataset.line;
          return false;
        }
        if (from.classList.contains("code-block") && (from as HTMLElement).dataset.hash === (to as HTMLElement).dataset.hash) {
          (from as HTMLElement).dataset.line = (to as HTMLElement).dataset.line;
          return false;
        }
        if (from.tagName === "DETAILS" && from.hasAttribute("open")) to.setAttribute("open", "");
        return !from.isEqualNode(to);
      },
    });
    this.diagrams.sync(this.root, mermaid);
  }

  /** Apply saved scroll/diagram state; deferred until the next render if none happened yet. */
  restore(state: TabState): void {
    if (state.diagrams) Object.assign(this.diagrams.states, state.diagrams);
    if (!this.path) {
      this.restoring = state;
      return;
    }
    for (const b of this.diagrams.blocks) {
      const st = state.diagrams?.[b.key];
      if (st && b.pz && st.touched) {
        b.pz.setState(st);
        b.touched = true;
      }
    }
    this.applyScroll(state);
  }

  private applyScroll(state: TabState): void {
    const go = () => {
      if (state.topLine !== undefined && state.topLine > 0 && state.scrollY === undefined) this.scrollToLine(state.topLine + 1, false);
      else if (state.scrollY !== undefined) this.scroller.scrollTop = state.scrollY;
    };
    go();
    // Images and diagrams near the top may still change the layout; re-apply once.
    requestAnimationFrame(go);
  }

  state(): TabState {
    return { scrollY: Math.round(this.scroller.scrollTop), topLine: this.topLine(), diagrams: { ...this.diagrams.states } };
  }

  // -------------------------------------------------------------------------
  // Source line mapping

  private lineElements(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>("[data-line]"));
  }

  topLine(): number {
    const top = this.scroller.getBoundingClientRect().top;
    let best = 0;
    for (const el of this.lineElements()) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 1) {
        best = Number(el.dataset.line) || 0;
        break;
      }
    }
    return best;
  }

  /** Scroll so the block for this 1-based source line is at the top. */
  scrollToLine(line: number, smooth = true): void {
    const target = line - 1;
    const els = this.lineElements();
    let el: HTMLElement | null = null;
    for (const e of els) {
      const l = Number(e.dataset.line);
      if (l <= target) el = e;
      else break;
    }
    if (!el) {
      this.scroller.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      return;
    }
    const top = el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop - 12;
    this.scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }

  /** Map a fractional source line to a scroll offset (used by editor-driven scroll sync). */
  scrollToFractionalLine(line: number): void {
    const els = this.lineElements();
    if (!els.length) return;
    const base = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    let prev: { line: number; top: number } | null = null;
    for (const e of els) {
      const l = Number(e.dataset.line);
      const top = e.getBoundingClientRect().top - base;
      if (l > line) {
        if (!prev) {
          this.scroller.scrollTop = 0;
          return;
        }
        const k = (line - prev.line) / Math.max(1, l - prev.line);
        this.scroller.scrollTop = prev.top + (top - prev.top) * k - 12;
        return;
      }
      prev = { line: l, top };
    }
    if (prev) this.scroller.scrollTop = prev.top - 12 + (line - prev.line) * 20;
  }

  scrollToAnchor(anchor: string, smooth = true): boolean {
    const id = decodeURIComponent(anchor.replace(/^#/, ""));
    const el = document.getElementById(id) ?? document.getElementById(id.toLowerCase()) ?? this.root.querySelector(`[name="${CSS.escape(id)}"]`);
    if (!el) return false;
    const top = el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop - 12;
    this.scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    el.classList.add("anchor-flash");
    setTimeout(() => el.classList.remove("anchor-flash"), 1200);
    return true;
  }

  // -------------------------------------------------------------------------
  // Events

  private bindEvents(): void {
    this.scroller.addEventListener(
      "scroll",
      () => {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = window.setTimeout(() => {
          postToHost({ type: "scrollChanged", scrollY: Math.round(this.scroller.scrollTop), topLine: this.topLine() });
        }, 150);
      },
      { passive: true },
    );

    this.root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const copy = t.closest<HTMLElement>(".code-copy");
      if (copy) return this.copyCode(copy);
      const wrap = t.closest<HTMLElement>(".code-wrap");
      if (wrap) {
        wrap.closest(".code-block")!.classList.toggle("wrapped");
        return;
      }
      const img = t.closest<HTMLImageElement>("img");
      if (img && !t.closest("a") && img.src) {
        e.preventDefault();
        openLightbox(img);
        return;
      }
      const a = t.closest<HTMLAnchorElement>("a[href]");
      if (a) {
        e.preventDefault();
        this.followLink(a, e);
      }
    });

    this.root.addEventListener("mouseover", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.classList.contains("anchor")) return;
      this.status.textContent = a.getAttribute("href");
      this.status.hidden = false;
      postToHost({ type: "hoverLink", href: a.getAttribute("href") });
    });
    this.root.addEventListener("mouseout", (e) => {
      const a = (e.target as HTMLElement).closest("a[href]");
      if (!a) return;
      const to = (e as MouseEvent).relatedTarget as Node | null;
      if (to && a.contains(to)) return;
      this.status.hidden = true;
      postToHost({ type: "hoverLink", href: null });
    });

    window.addEventListener("resize", () => {
      const w = this.root.clientWidth;
      if (w === this.lastWidth) return;
      this.lastWidth = w;
      this.diagrams.relayout();
    });
  }

  private followLink(a: HTMLAnchorElement, e: MouseEvent): void {
    const href = a.getAttribute("href") ?? "";
    const modifier = e.metaKey || e.ctrlKey;
    if (href.startsWith("#")) {
      postToHost({ type: "linkClicked", href, anchor: href.slice(1) });
      this.scrollToAnchor(href);
      return;
    }
    const external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("mdview:");
    const [pathPart, anchor] = href.split("#");
    postToHost({ type: "linkClicked", href, external, modifier, anchor: anchor ? decodeURIComponent(anchor) : undefined, resolvedPath: external ? undefined : pathPart });
  }

  private copyCode(btn: HTMLElement): void {
    const code = btn.closest(".code-block")?.querySelector("pre code");
    if (!code) return;
    postToHost({ type: "copy", text: (code.textContent ?? "").replace(/\n$/, "") });
    btn.classList.add("copied");
    const label = btn.querySelector("span");
    if (label) label.textContent = "Copied";
    setTimeout(() => {
      btn.classList.remove("copied");
      if (label) label.textContent = "Copy";
    }, 1200);
  }

  // -------------------------------------------------------------------------
  // Find in document

  private findQuery = "";
  private findHits: HTMLElement[] = [];
  private findIndex = -1;
  private findBar: HTMLElement | null = null;

  openFind(): void {
    if (!this.findBar) {
      const bar = document.createElement("div");
      bar.className = "find-bar";
      bar.innerHTML = `${icons.search}<input type="search" placeholder="Find in document" spellcheck="false" aria-label="Find in document"><span class="find-count"></span>
        <button class="mmd-btn" data-act="prev" title="Previous (⇧⌘G)">${icons.up}</button>
        <button class="mmd-btn" data-act="next" title="Next (⌘G)">${icons.down}</button>
        <button class="mmd-btn" data-act="close" title="Close (Esc)">${icons.close}</button>`;
      document.body.appendChild(bar);
      const input = bar.querySelector("input")!;
      input.addEventListener("input", () => this.runFind(input.value, true));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.findStep(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.closeFind();
        }
      });
      bar.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
        if (!b) return;
        if (b.dataset.act === "close") this.closeFind();
        else this.findStep(b.dataset.act === "prev" ? -1 : 1);
      });
      this.findBar = bar;
    }
    this.findBar.hidden = false;
    const input = this.findBar.querySelector("input")!;
    const sel = window.getSelection()?.toString();
    if (sel && sel.length < 200 && !sel.includes("\n")) {
      input.value = sel;
      this.runFind(sel, true);
    }
    input.focus();
    input.select();
  }

  closeFind(): void {
    this.clearFind();
    this.findQuery = "";
    if (this.findBar) this.findBar.hidden = true;
  }

  findStep(dir: number): void {
    if (!this.findHits.length) {
      if (!this.findBar || this.findBar.hidden) this.openFind();
      return;
    }
    this.findHits[this.findIndex]?.classList.remove("current");
    this.findIndex = (this.findIndex + dir + this.findHits.length) % this.findHits.length;
    const hit = this.findHits[this.findIndex];
    hit.classList.add("current");
    hit.scrollIntoView({ block: "center", behavior: "smooth" });
    this.updateFindCount();
  }

  private updateFindCount(): void {
    const c = this.findBar?.querySelector(".find-count");
    if (c) c.textContent = this.findQuery ? (this.findHits.length ? `${this.findIndex + 1}/${this.findHits.length}` : "No results") : "";
  }

  private clearFind(): void {
    for (const m of this.root.querySelectorAll("mark.find-hit")) {
      const parent = m.parentNode!;
      parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
      parent.normalize();
    }
    this.findHits = [];
    this.findIndex = -1;
  }

  runFind(query: string, jump: boolean): void {
    this.clearFind();
    this.findQuery = query;
    const q = query.toLowerCase();
    if (!q) {
      this.updateFindCount();
      return;
    }
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest("svg, .mmd-toolbar, .code-toolbar, .anchor, script, style")) return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.toLowerCase().includes(q) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      let text = node;
      let idx: number;
      while ((idx = text.nodeValue!.toLowerCase().indexOf(q)) >= 0) {
        const match = text.splitText(idx);
        text = match.splitText(q.length);
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        match.parentNode!.replaceChild(mark, match);
        mark.appendChild(match);
        this.findHits.push(mark);
      }
    }
    // Start at the first hit below the current scroll position.
    const top = this.scroller.getBoundingClientRect().top;
    const first = this.findHits.findIndex((h) => h.getBoundingClientRect().top >= top);
    this.findIndex = (first < 0 ? 0 : first) - 1;
    if (jump && this.findHits.length) this.findStep(1);
    else this.updateFindCount();
  }
}

const LARGE_DOC = 150_000;
const PREFIX_CHARS = 40_000;

/** Cut markdown at a blank line outside any fenced block, near `limit` characters. */
export function safePrefix(text: string, limit: number): string {
  let inFence: string | null = null;
  let pos = 0;
  let lastSafe = 0;
  for (const line of text.split("\n")) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!inFence) inFence = m[1][0];
      else if (m[1][0] === inFence) inFence = null;
    }
    pos += line.length + 1;
    if (!inFence && line.trim() === "") {
      lastSafe = pos;
      if (pos >= limit) break;
    }
  }
  return text.slice(0, lastSafe || limit);
}

// ---------------------------------------------------------------------------
// Image lightbox, using the same pan/zoom controller as diagrams.

function openLightbox(img: HTMLImageElement): void {
  const overlay = document.createElement("div");
  overlay.className = "mmd-overlay lightbox";
  overlay.innerHTML = `<div class="mmd-backdrop"></div><div class="mmd-panel"><div class="mmd-xbar"><span class="mmd-xtitle"></span><div class="mmd-xtools">
    <button class="mmd-btn" data-act="fit" title="Fit">${icons.fit}</button><button class="mmd-btn" data-act="close" title="Close (Esc)">${icons.close}</button></div></div>
    <div class="mmd-xviewport" tabindex="0"><div class="mmd-content"></div></div></div>`;
  overlay.querySelector(".mmd-xtitle")!.textContent = img.alt || img.src.split("/").pop() || "";
  const clone = img.cloneNode() as HTMLImageElement;
  clone.removeAttribute("loading");
  overlay.querySelector(".mmd-content")!.appendChild(clone);
  document.body.appendChild(overlay);
  const vp = overlay.querySelector<HTMLElement>(".mmd-xviewport")!;
  const content = overlay.querySelector<HTMLElement>(".mmd-content")!;
  let pz: PanZoom | null = null;
  const close = () => {
    pz?.destroy();
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  overlay.querySelector(".mmd-backdrop")!.addEventListener("click", close);
  overlay.querySelector(".mmd-xbar")!.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "close") close();
    if (act === "fit") pz?.fit("contain", true, false);
  });
  const start = () => {
    const w = clone.naturalWidth || img.width, h = clone.naturalHeight || img.height;
    clone.style.width = `${w}px`;
    clone.style.height = `${h}px`;
    pz = new PanZoom(vp, content, { w, h }, { mode: "expanded", onEscape: close });
    pz.fit("contain", false, false);
    vp.focus();
  };
  if (clone.complete && clone.naturalWidth) start();
  else clone.addEventListener("load", start, { once: true });
}
