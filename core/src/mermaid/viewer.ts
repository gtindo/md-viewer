// Inline Mermaid viewports: lazy rendering, the gesture model, toolbar, resize
// handle, error cards, and state that survives live reloads.

import type { DiagramState, Settings } from "../bridge";
import { postToHost } from "../bridge";
import { escapeHtml } from "../renderer/highlight";
import type { MermaidSource } from "../renderer/markdown";
import { renderMermaid, cachedResult, type DiagramResult, type MermaidOptions } from "./engine";
import { PanZoom } from "./panzoom";
import { icons } from "../ui/icons";
import { openExpanded, isExpandedOpen, refreshExpanded } from "./expanded";
import { exportDiagram, copyDiagram } from "./export";

export interface DiagramHost {
  settings(): Settings;
  mermaidOptions(): MermaidOptions;
  scrollContainer(): HTMLElement;
  docPath(): string;
}

export class DiagramBlock {
  source: string;
  key: string;
  index: number;
  line: number;
  pz: PanZoom | null = null;
  result: DiagramResult | null = null;
  lastGood: { svg: string; width: number; height: number } | null = null;
  rendering: Promise<DiagramResult> | null = null;
  touched = false;
  height?: number;
  private viewport!: HTMLElement;
  private content!: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private hint!: HTMLElement;
  private errorBox!: HTMLElement;
  private sourceBox!: HTMLElement;
  private menu: HTMLElement | null = null;
  private stateTimer = 0;
  private renderedConfig = "";

  constructor(
    readonly el: HTMLElement,
    src: MermaidSource,
    readonly manager: DiagramManager,
    initial?: DiagramState,
  ) {
    this.source = src.source;
    this.key = src.key;
    this.index = src.index;
    this.line = src.line;
    if (initial) {
      this.touched = !!initial.touched;
      this.height = initial.height;
    }
    this.pendingState = initial ?? null;
    this.build();
  }

  pendingState: DiagramState | null;

  private build(): void {
    const el = this.el;
    el.innerHTML = "";
    el.classList.add("mmd");
    el.innerHTML = `
      <div class="mmd-viewport" tabindex="0" aria-label="Mermaid diagram">
        <div class="mmd-content"></div>
        <div class="mmd-placeholder"><span class="spinner"></span>Rendering diagram…</div>
      </div>
      <div class="mmd-toolbar pz-ignore" role="toolbar">
        <button class="mmd-btn" data-act="zoomOut" title="Zoom out (−)">${icons.minus}</button>
        <button class="mmd-btn mmd-zoom" data-act="reset" title="Reset zoom">100%</button>
        <button class="mmd-btn" data-act="zoomIn" title="Zoom in (+)">${icons.plus}</button>
        <button class="mmd-btn" data-act="fit" title="Fit (0)">${icons.fit}</button>
        <button class="mmd-btn" data-act="expand" title="Expand (⌘↩)">${icons.expand}</button>
        <button class="mmd-btn" data-act="more" title="More">${icons.more}</button>
      </div>
      <div class="mmd-hint pz-ignore" hidden>Tall diagram · drag or ⌥-scroll to pan, pinch to zoom, <a href="#" data-act="expand">expand</a></div>
      <div class="mmd-error" hidden></div>
      <pre class="mmd-source" hidden></pre>
      <div class="mmd-resize pz-ignore" title="Drag to resize"></div>`;
    this.viewport = el.querySelector(".mmd-viewport")!;
    this.content = el.querySelector(".mmd-content")!;
    this.zoomLabel = el.querySelector(".mmd-zoom")!;
    this.hint = el.querySelector(".mmd-hint")!;
    this.errorBox = el.querySelector(".mmd-error")!;
    this.sourceBox = el.querySelector(".mmd-source")!;
    this.viewport.style.height = `${this.estimateHeight()}px`;

    el.querySelector(".mmd-toolbar")!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!btn) return;
      e.preventDefault();
      this.action(btn.dataset.act!, btn);
    });
    this.hint.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-act=expand]")) {
        e.preventDefault();
        this.expand();
      }
    });
    this.viewport.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.expand();
      }
    });
    this.bindResize();
  }

  private estimateHeight(): number {
    if (this.height) return this.height;
    const lines = this.source.split("\n").length;
    return Math.min(this.maxHeight(), Math.max(160, 60 + lines * 22));
  }

  maxHeight(): number {
    return Math.max(200, (window.innerHeight * this.manager.host.settings().diagramMaxHeight) / 100);
  }

  /** Called when the source of this block changed on a live reload. */
  update(src: MermaidSource): void {
    const changed = src.source !== this.source;
    this.key = src.key;
    this.index = src.index;
    this.line = src.line;
    if (!changed) return;
    this.source = src.source;
    this.result = null;
    if (this.sourceBox.hidden === false) this.sourceBox.textContent = this.source;
    void this.render();
  }

  isRendered(): boolean {
    return !!this.result && this.renderedConfig === this.manager.configKey();
  }

  render(): Promise<DiagramResult> {
    const cfgKey = this.manager.configKey();
    if (this.result && this.renderedConfig === cfgKey) return Promise.resolve(this.result);
    if (this.rendering) return this.rendering;
    const source = this.source;
    const p = renderMermaid(source, this.manager.host.mermaidOptions()).then((res) => {
      this.rendering = null;
      if (source !== this.source) return this.render();
      this.renderedConfig = cfgKey;
      this.show(res);
      return res;
    });
    this.rendering = p;
    return p;
  }

  private show(res: DiagramResult): void {
    const firstRender = !this.pz;
    const prevZoom = this.pz?.s;
    this.result = res;
    this.el.querySelector(".mmd-placeholder")?.remove();
    if (res.ok) {
      const sameSize = this.lastGood && this.lastGood.width === res.width && this.lastGood.height === res.height;
      this.lastGood = { svg: res.svg, width: res.width, height: res.height };
      this.content.innerHTML = res.svg;
      this.content.classList.remove("stale");
      this.errorBox.hidden = true;
      this.el.classList.remove("has-error");
      this.layout(firstRender ? "initial" : sameSize ? "keep" : "recentre", prevZoom);
    } else {
      this.el.classList.add("has-error");
      if (this.lastGood) {
        // Keep the last good render visible, greyed, above the error.
        if (!this.content.innerHTML) this.content.innerHTML = this.lastGood.svg;
        this.content.classList.add("stale");
        if (!this.pz) this.layout("initial");
      } else {
        this.content.innerHTML = "";
        this.viewport.style.height = "0px";
        this.viewport.hidden = true;
      }
      this.showError(res.message, res.line);
    }
    this.manager.onRendered(this);
  }

  private showError(message: string, line?: number): void {
    const lines = this.source.replace(/\n$/, "").split("\n");
    const src = lines
      .map((l, i) => `<span class="src-line${line === i + 1 ? " err" : ""}"><span class="ln">${i + 1}</span>${escapeHtml(l) || " "}</span>`)
      .join("");
    this.errorBox.innerHTML = `
      <div class="mmd-error-head">${icons.warning}<strong>Mermaid syntax error</strong>${line ? `<span class="mmd-error-line">line ${line}</span>` : ""}
        <button class="mmd-error-open">Open in editor${line ? ` at line ${line}` : ""}</button></div>
      <pre class="mmd-error-msg">${escapeHtml(message)}</pre>
      <pre class="mmd-error-src">${src}</pre>`;
    this.errorBox.hidden = false;
    this.errorBox.querySelector(".mmd-error-open")!.addEventListener("click", () => {
      // 1-based editor line: fence line (0-based) + 1 is the fence, +1 more per content line.
      postToHost({ type: "requestMode", mode: "split", line: this.line + 1 + (line ?? 1) });
    });
    postToHost({ type: "renderError", message, line, diagram: this.key });
  }

  /** Size the viewport and place the diagram. */
  layout(how: "initial" | "keep" | "recentre" | "refit", prevZoom?: number): void {
    const last = this.lastGood;
    if (!last) return;
    this.viewport.hidden = false;
    const settings = this.manager.host.settings();
    const vw = this.viewport.clientWidth || this.el.clientWidth || 800;
    const allowUp = settings.diagramSmallZoom === "fit";
    let fitW = vw / last.width;
    if (!allowUp) fitW = Math.min(1, fitW);
    const natural = last.height * fitW + 16;
    const maxH = this.maxHeight();
    const tall = natural > maxH;
    const h = this.height ?? Math.min(natural, maxH);
    this.viewport.style.height = `${Math.round(Math.max(80, h))}px`;
    this.hint.hidden = !tall || !!this.height;

    if (!this.pz) {
      this.pz = new PanZoom(this.viewport, this.content, { w: last.width, h: last.height }, {
        mode: "inline",
        onChange: (pz, interactive) => this.onViewChange(pz, interactive),
        onExpand: () => this.expand(),
        onEscape: () => this.viewport.blur(),
      });
    } else {
      this.pz.setNatural(last.width, last.height);
    }
    const pz = this.pz;
    if (how === "initial" && this.pendingState && this.pendingState.touched) {
      pz.setState(this.pendingState);
      this.touched = true;
    } else if (how === "keep" && this.touched) {
      // Same diagram geometry: leave zoom and pan as they are.
      pz.to(pz.s, pz.tx, pz.ty, false);
    } else if (how === "recentre" && this.touched && prevZoom) {
      pz.recentre(prevZoom);
    } else {
      this.defaultView();
    }
    this.pendingState = null;
  }

  defaultView(animate = false): void {
    const pz = this.pz;
    if (!pz) return;
    const allowUp = this.manager.host.settings().diagramSmallZoom === "fit";
    pz.fit("width", animate, allowUp);
    this.touched = false;
  }

  private onViewChange(pz: PanZoom, interactive: boolean): void {
    this.zoomLabel.textContent = `${Math.round(pz.s * 100)}%`;
    if (interactive) {
      this.touched = true;
      return;
    }
    clearTimeout(this.stateTimer);
    this.stateTimer = window.setTimeout(() => this.manager.reportState(this), 250);
  }

  state(): DiagramState {
    const st = this.pz?.getState() ?? { zoom: 1, cx: 0, cy: 0 };
    return { ...st, touched: this.touched, height: this.height };
  }

  private action(act: string, btn: HTMLElement): void {
    const pz = this.pz;
    switch (act) {
      case "zoomIn":
        pz?.zoomBy(1.25, undefined, undefined, true);
        break;
      case "zoomOut":
        pz?.zoomBy(0.8, undefined, undefined, true);
        break;
      case "reset":
        this.defaultView(true);
        this.manager.reportState(this);
        break;
      case "fit":
        pz?.fit("contain", true, this.manager.host.settings().diagramSmallZoom === "fit");
        break;
      case "expand":
        this.expand();
        break;
      case "more":
        this.toggleMenu(btn);
        break;
    }
  }

  private toggleMenu(anchor: HTMLElement): void {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    const m = document.createElement("div");
    m.className = "mmd-menu pz-ignore";
    const items: [string, string][] = [
      ["copySvg", "Copy SVG"],
      ["copyPng", "Copy PNG"],
      ["-", ""],
      ["exportSvg", "Export SVG…"],
      ["exportPng", "Export PNG…"],
      ["-", ""],
      ["copySource", "Copy Source"],
      ["viewSource", this.sourceBox.hidden ? "View Source" : "Hide Source"],
    ];
    m.innerHTML = items.map(([id, label]) => (id === "-" ? `<hr>` : `<button data-item="${id}">${label}</button>`)).join("");
    m.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
      if (!b) return;
      this.closeMenu();
      this.menuAction(b.dataset.item!);
    });
    anchor.parentElement!.appendChild(m);
    this.menu = m;
    const off = (e: Event) => {
      if (!m.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
        this.closeMenu();
        document.removeEventListener("pointerdown", off, true);
      }
    };
    document.addEventListener("pointerdown", off, true);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  svgElement(): SVGSVGElement | null {
    return this.content.querySelector("svg");
  }

  private menuAction(id: string): void {
    const svg = this.svgElement();
    const name = `${this.manager.host.docPath().split("/").pop()?.replace(/\.\w+$/, "") ?? "diagram"}-${this.index + 1}`;
    switch (id) {
      case "copySvg":
        if (svg) copyDiagram(svg, "svg");
        break;
      case "copyPng":
        if (svg) copyDiagram(svg, "png");
        break;
      case "exportSvg":
        if (svg) exportDiagram(svg, "svg", name);
        break;
      case "exportPng":
        if (svg) exportDiagram(svg, "png", name);
        break;
      case "copySource":
        postToHost({ type: "copy", text: this.source });
        break;
      case "viewSource":
        this.sourceBox.hidden = !this.sourceBox.hidden;
        this.sourceBox.textContent = this.source;
        break;
    }
  }

  expand(): void {
    if (!this.lastGood) return;
    openExpanded(this.manager, this);
  }

  focus(): void {
    this.viewport.focus({ preventScroll: true });
  }

  private bindResize(): void {
    const handle = this.el.querySelector<HTMLElement>(".mmd-resize")!;
    let start: { y: number; h: number } | null = null;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      start = { y: e.clientY, h: this.viewport.clientHeight };
      this.el.classList.add("resizing");
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start) return;
      const h = Math.max(120, start.h + e.clientY - start.y);
      this.viewport.style.height = `${h}px`;
      this.height = h;
      this.hint.hidden = true;
    });
    const end = () => {
      if (!start) return;
      start = null;
      this.el.classList.remove("resizing");
      this.manager.reportState(this);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => {
      this.height = undefined;
      this.layout("keep");
      this.manager.reportState(this);
    });
  }

  destroy(): void {
    this.pz?.destroy();
    this.closeMenu();
  }
}

export class DiagramManager {
  blocks: DiagramBlock[] = [];
  states: Record<string, DiagramState> = {};
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver;
  private heights = new WeakMap<Element, number>();
  private renderedListeners: ((b: DiagramBlock) => void)[] = [];
  private cfgKey = "";

  constructor(readonly host: DiagramHost) {
    this.ro = new ResizeObserver((entries) => this.onResize(entries));
  }

  configKey(): string {
    return this.cfgKey;
  }

  setConfigKey(k: string): void {
    this.cfgKey = k;
  }

  onRenderedBlock(fn: (b: DiagramBlock) => void): void {
    this.renderedListeners.push(fn);
  }

  onRendered(b: DiagramBlock): void {
    for (const fn of this.renderedListeners) fn(b);
    if (isExpandedOpen()) refreshExpanded(b);
  }

  private observer(): IntersectionObserver {
    if (!this.io) {
      this.io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const b = this.blocks.find((x) => x.el === e.target);
            if (b && !b.isRendered()) void b.render();
          }
        },
        { root: this.host.scrollContainer(), rootMargin: "100% 0px 100% 0px" },
      );
    }
    return this.io;
  }

  /**
   * Reconcile blocks with the freshly rendered document. Elements whose key is
   * unchanged were kept by morphdom and keep their SVG and zoom.
   */
  sync(root: HTMLElement, sources: MermaidSource[]): void {
    const els = Array.from(root.querySelectorAll<HTMLElement>(".mermaid-block"));
    const next: DiagramBlock[] = [];
    els.forEach((el, i) => {
      const src = sources[i];
      if (!src) return;
      let block = this.blocks.find((b) => b.el === el);
      if (block) {
        block.update(src);
      } else {
        block = new DiagramBlock(el, src, this, this.states[src.key]);
        // Instant render from cache keeps reloads flicker-free.
        const hit = cachedResult(src.source, this.host.mermaidOptions());
        if (hit) void block.render();
        this.ro.observe(el);
        this.observer().observe(el);
      }
      el.dataset.key = src.key;
      next.push(block);
    });
    for (const b of this.blocks) {
      if (!next.includes(b)) {
        b.destroy();
        this.ro.unobserve(b.el);
        this.io?.unobserve(b.el);
      }
    }
    this.blocks = next;
  }

  /** Theme or config changed: re-render, visible diagrams first. */
  rerenderAll(): void {
    const container = this.host.scrollContainer().getBoundingClientRect();
    const visible = (b: DiagramBlock) => {
      const r = b.el.getBoundingClientRect();
      return r.bottom > container.top - container.height && r.top < container.bottom + container.height;
    };
    const io = this.observer();
    for (const b of this.blocks) {
      b.result = null;
      if (visible(b)) void b.render();
      else {
        // Re-observing fires a fresh callback, so off-screen blocks re-render lazily.
        io.unobserve(b.el);
        io.observe(b.el);
      }
    }
  }

  async renderAll(): Promise<{ count: number; errors: { key: string; message: string; line?: number }[] }> {
    const errors: { key: string; message: string; line?: number }[] = [];
    for (const b of this.blocks) {
      const res = await b.render();
      if (!res.ok) errors.push({ key: b.key, message: res.message, line: res.line });
    }
    return { count: this.blocks.length, errors };
  }

  reportState(b: DiagramBlock): void {
    const st = b.state();
    this.states[b.key] = st;
    postToHost({ type: "diagramStateChanged", key: b.key, state: st });
  }

  relayout(): void {
    for (const b of this.blocks) if (b.lastGood) b.layout(b.touched ? "keep" : "refit");
  }

  focused(): DiagramBlock | null {
    const a = document.activeElement;
    return this.blocks.find((b) => b.el.contains(a)) ?? null;
  }

  /** Keep the reading position stable when a diagram above the viewport changes height. */
  private onResize(entries: ResizeObserverEntry[]): void {
    const sc = this.host.scrollContainer();
    const top = sc.getBoundingClientRect().top;
    let delta = 0;
    for (const e of entries) {
      const h = (e.target as HTMLElement).offsetHeight;
      const prev = this.heights.get(e.target);
      this.heights.set(e.target, h);
      if (prev === undefined) continue;
      const r = e.target.getBoundingClientRect();
      if (r.bottom <= top + 1) delta += h - prev;
    }
    if (delta) sc.scrollTop += delta;
  }

  dispose(): void {
    this.io?.disconnect();
    this.ro.disconnect();
    for (const b of this.blocks) b.destroy();
    this.blocks = [];
  }
}
