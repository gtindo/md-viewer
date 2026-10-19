// Expanded diagram viewer: fills the document area over a dimmed backdrop, with
// a minimap, find-in-diagram and navigation between the file's diagrams.

import { postToHost } from "../bridge";
import { icons } from "../ui/icons";
import { PanZoom } from "./panzoom";
import type { DiagramBlock, DiagramManager } from "./viewer";
import { exportDiagram } from "./export";

interface Expanded {
  overlay: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  minimap: HTMLElement;
  mmContent: HTMLElement;
  mmRect: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  title: HTMLElement;
  zoomLabel: HTMLElement;
  pz: PanZoom | null;
  block: DiagramBlock;
  manager: DiagramManager;
  hits: Element[];
  hit: number;
  mmScale: number;
  keyHandler: (e: KeyboardEvent) => void;
  resize: ResizeObserver;
  restoreFocus: HTMLElement | null;
}

let cur: Expanded | null = null;

export function isExpandedOpen(): boolean {
  return !!cur;
}

export function openExpanded(manager: DiagramManager, block: DiagramBlock): void {
  if (cur) {
    show(block);
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "mmd-overlay";
  overlay.innerHTML = `
    <div class="mmd-backdrop"></div>
    <div class="mmd-panel" role="dialog" aria-modal="true" aria-label="Expanded diagram">
      <div class="mmd-xbar">
        <div class="mmd-xnav">
          <button class="mmd-btn" data-act="prev" title="Previous diagram (⌘⌥←)">${icons.left}</button>
          <span class="mmd-xtitle"></span>
          <button class="mmd-btn" data-act="next" title="Next diagram (⌘⌥→)">${icons.right}</button>
        </div>
        <div class="mmd-xfind">
          ${icons.search}
          <input type="search" placeholder="Find in diagram" spellcheck="false" aria-label="Find in diagram">
          <span class="mmd-xcount"></span>
          <button class="mmd-btn" data-act="findPrev" title="Previous match (⇧↩)">${icons.up}</button>
          <button class="mmd-btn" data-act="findNext" title="Next match (↩)">${icons.down}</button>
        </div>
        <div class="mmd-xtools">
          <button class="mmd-btn" data-act="zoomOut" title="Zoom out (−)">${icons.minus}</button>
          <button class="mmd-btn mmd-zoom" data-act="fit" title="Fit (0)">100%</button>
          <button class="mmd-btn" data-act="zoomIn" title="Zoom in (+)">${icons.plus}</button>
          <button class="mmd-btn" data-act="actual" title="Actual size (1)">1:1</button>
          <button class="mmd-btn" data-act="minimap" title="Minimap (M)">${icons.map}</button>
          <button class="mmd-btn" data-act="export" title="Export SVG…">SVG</button>
          <button class="mmd-btn" data-act="fullscreen" title="Full screen (⌃⌘F)">${icons.fullscreen}</button>
          <button class="mmd-btn" data-act="close" title="Close (Esc)">${icons.close}</button>
        </div>
      </div>
      <div class="mmd-xviewport" tabindex="0"><div class="mmd-content"></div></div>
      <div class="mmd-minimap pz-ignore"><div class="mm-content"></div><div class="mm-rect"></div></div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("has-overlay");

  const q = <T extends HTMLElement>(s: string) => overlay.querySelector<T>(s)!;
  const st: Expanded = {
    overlay,
    viewport: q(".mmd-xviewport"),
    content: q(".mmd-xviewport .mmd-content"),
    minimap: q(".mmd-minimap"),
    mmContent: q(".mm-content"),
    mmRect: q(".mm-rect"),
    input: q<HTMLInputElement>(".mmd-xfind input"),
    count: q(".mmd-xcount"),
    title: q(".mmd-xtitle"),
    zoomLabel: q(".mmd-zoom"),
    pz: null,
    block,
    manager,
    hits: [],
    hit: -1,
    mmScale: 1,
    keyHandler: () => undefined,
    resize: new ResizeObserver(() => cur?.pz && updateMinimap()),
    restoreFocus: document.activeElement as HTMLElement | null,
  };
  cur = st;
  st.minimap.hidden = !manager.host.settings().showMinimap;

  overlay.querySelector(".mmd-backdrop")!.addEventListener("click", closeExpanded);
  overlay.querySelector(".mmd-xbar")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (b) action(b.dataset.act!);
  });
  st.input.addEventListener("input", () => runFind(st.input.value));
  st.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (st.input.value) {
        st.input.value = "";
        runFind("");
      } else st.viewport.focus();
    }
  });
  st.keyHandler = (e: KeyboardEvent) => {
    if (!cur) return;
    const inInput = (e.target as HTMLElement).closest?.("input");
    if (e.key === "Escape" && !inInput) {
      e.preventDefault();
      e.stopPropagation();
      closeExpanded();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      focusFind();
    } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      void navigate(e.key === "ArrowLeft" ? -1 : 1);
    } else if (!inInput && !e.metaKey && !e.ctrlKey && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      toggleMinimap();
    }
  };
  window.addEventListener("keydown", st.keyHandler, true);
  st.resize.observe(st.viewport);
  bindMinimap(st);
  show(block);
}

function show(block: DiagramBlock): void {
  const st = cur!;
  st.block = block;
  const last = block.lastGood;
  if (!last) return;
  st.content.innerHTML = last.svg;
  st.mmContent.innerHTML = last.svg;
  const all = st.manager.blocks;
  st.title.textContent = `Diagram ${all.indexOf(block) + 1} of ${all.length}`;
  st.pz?.destroy();
  st.pz = new PanZoom(st.viewport, st.content, { w: last.width, h: last.height }, {
    mode: "expanded",
    minZoom: 0.05,
    maxZoom: 8,
    onChange: (pz) => {
      st.zoomLabel.textContent = `${Math.round(pz.s * 100)}%`;
      updateMinimap();
    },
    onEscape: () => closeExpanded(),
  });
  requestAnimationFrame(() => {
    st.pz?.fit("contain", false, true);
    layoutMinimap();
    updateMinimap();
    if (st.input.value) runFind(st.input.value);
    st.viewport.focus({ preventScroll: true });
  });
}

/** A diagram re-rendered (live reload) while expanded. */
export function refreshExpanded(block: DiagramBlock): void {
  if (!cur || cur.block !== block || !block.lastGood) return;
  const pz = cur.pz;
  const prev = pz?.getState();
  cur.content.innerHTML = block.lastGood.svg;
  cur.mmContent.innerHTML = block.lastGood.svg;
  if (pz && prev) {
    pz.setNatural(block.lastGood.width, block.lastGood.height);
    pz.setState(prev);
  }
  layoutMinimap();
  if (cur.input.value) runFind(cur.input.value);
}

export function closeExpanded(): void {
  const st = cur;
  if (!st) return;
  window.removeEventListener("keydown", st.keyHandler, true);
  st.resize.disconnect();
  st.pz?.destroy();
  st.overlay.remove();
  document.body.classList.remove("has-overlay");
  cur = null;
  st.block.focus();
}

export async function navigate(dir: number): Promise<void> {
  const st = cur;
  if (!st) return;
  const blocks = st.manager.blocks;
  let i = blocks.indexOf(st.block);
  for (let n = 0; n < blocks.length; n++) {
    i = (i + dir + blocks.length) % blocks.length;
    const b = blocks[i];
    await b.render();
    if (b.lastGood) {
      b.el.scrollIntoView({ block: "center" });
      show(b);
      return;
    }
  }
}

export function focusFind(): void {
  if (!cur) return;
  cur.input.focus();
  cur.input.select();
}

function action(act: string): void {
  const st = cur!;
  const pz = st.pz;
  switch (act) {
    case "prev":
      void navigate(-1);
      break;
    case "next":
      void navigate(1);
      break;
    case "findNext":
      stepFind(1);
      break;
    case "findPrev":
      stepFind(-1);
      break;
    case "zoomIn":
      pz?.zoomBy(1.25, undefined, undefined, true);
      break;
    case "zoomOut":
      pz?.zoomBy(0.8, undefined, undefined, true);
      break;
    case "fit":
      pz?.fit("contain", true, true);
      break;
    case "actual":
      pz?.actualSize(true);
      break;
    case "minimap":
      toggleMinimap();
      break;
    case "export": {
      const svg = st.content.querySelector("svg");
      if (svg) exportDiagram(svg, "svg", `diagram-${st.manager.blocks.indexOf(st.block) + 1}`);
      break;
    }
    case "fullscreen":
      postToHost({ type: "requestFullScreen", on: true });
      break;
    case "close":
      closeExpanded();
      break;
  }
}

// ---------------------------------------------------------------------------
// Find in diagram

function labelGroup(el: Element): Element {
  return (
    el.closest("g.node, g.edgeLabel, g.cluster, g.actor, g.note, g.stateGroup, g.classGroup, g.er, g.mindmap-node, g.section, g.task") ??
    el.closest("g") ??
    el
  );
}

function runFind(query: string): void {
  const st = cur!;
  st.content.querySelectorAll(".mmd-find-hit, .mmd-find-current").forEach((n) => n.classList.remove("mmd-find-hit", "mmd-find-current"));
  st.hits = [];
  st.hit = -1;
  const q = query.trim().toLowerCase();
  if (!q) {
    st.count.textContent = "";
    return;
  }
  const svg = st.content.querySelector("svg");
  if (!svg) return;
  const seen = new Set<Element>();
  for (const c of svg.querySelectorAll("foreignObject, text")) {
    if (c.tagName.toLowerCase() === "text" && c.closest("foreignObject")) continue;
    if (!(c.textContent ?? "").toLowerCase().includes(q)) continue;
    const g = labelGroup(c);
    if (seen.has(g)) continue;
    seen.add(g);
    g.classList.add("mmd-find-hit");
    st.hits.push(g);
  }
  // Reading order: top to bottom, then left to right.
  const pos = new Map(st.hits.map((h) => [h, h.getBoundingClientRect()]));
  st.hits.sort((a, b) => pos.get(a)!.top - pos.get(b)!.top || pos.get(a)!.left - pos.get(b)!.left);
  st.count.textContent = st.hits.length ? `0/${st.hits.length}` : "No matches";
  if (st.hits.length) stepFind(1);
}

function stepFind(dir: number): void {
  const st = cur!;
  if (!st.hits.length || !st.pz) return;
  st.hits[st.hit]?.classList.remove("mmd-find-current");
  st.hit = (st.hit + dir + st.hits.length) % st.hits.length;
  const h = st.hits[st.hit];
  h.classList.add("mmd-find-current");
  st.count.textContent = `${st.hit + 1}/${st.hits.length}`;
  const r = h.getBoundingClientRect();
  const c = st.content.getBoundingClientRect();
  const s = st.pz.s;
  const x = (r.left + r.width / 2 - c.left) / s;
  const y = (r.top + r.height / 2 - c.top) / s;
  st.pz.centreOn(x, y, true, s < 0.7 ? 1 : undefined);
}

// ---------------------------------------------------------------------------
// Minimap

function toggleMinimap(): void {
  if (!cur) return;
  cur.minimap.hidden = !cur.minimap.hidden;
  layoutMinimap();
  updateMinimap();
}

function layoutMinimap(): void {
  const st = cur;
  if (!st || !st.block.lastGood) return;
  const { width, height } = st.block.lastGood;
  const m = Math.min(220 / width, 160 / height);
  st.mmScale = m;
  st.minimap.style.width = `${Math.round(width * m)}px`;
  st.minimap.style.height = `${Math.round(height * m)}px`;
  st.mmContent.style.transform = `scale(${m})`;
}

function updateMinimap(): void {
  const st = cur;
  if (!st || !st.pz || st.minimap.hidden) return;
  const pz = st.pz;
  const m = st.mmScale;
  const x = (-pz.tx / pz.s) * m, y = (-pz.ty / pz.s) * m;
  const w = (pz.vw / pz.s) * m, h = (pz.vh / pz.s) * m;
  const W = pz.w * m, H = pz.h * m;
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
  Object.assign(st.mmRect.style, {
    left: `${x0}px`,
    top: `${y0}px`,
    width: `${Math.max(4, x1 - x0)}px`,
    height: `${Math.max(4, y1 - y0)}px`,
  });
  // Hide the minimap when everything is visible anyway.
  st.minimap.classList.toggle("all-visible", x <= 0 && y <= 0 && x + w >= W && y + h >= H);
}

function bindMinimap(st: Expanded): void {
  let dragging = false;
  const move = (e: PointerEvent) => {
    const r = st.minimap.getBoundingClientRect();
    const x = (e.clientX - r.left) / st.mmScale, y = (e.clientY - r.top) / st.mmScale;
    st.pz?.centreOn(x, y, false);
  };
  st.minimap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    st.minimap.setPointerCapture(e.pointerId);
    move(e);
  });
  st.minimap.addEventListener("pointermove", (e) => dragging && move(e));
  st.minimap.addEventListener("pointerup", () => (dragging = false));
  st.minimap.addEventListener("pointercancel", () => (dragging = false));
}
