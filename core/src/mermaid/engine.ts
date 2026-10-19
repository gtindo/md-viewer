// Mermaid rendering: lazy-loaded library, a serial render queue (mermaid is not
// re-entrant), and an SVG cache keyed by source + theme + config.

import type { Mermaid, MermaidConfig } from "mermaid";
import { hashString } from "../renderer/markdown";

export interface RenderedDiagram {
  ok: true;
  svg: string;
  width: number;
  height: number;
}

export interface FailedDiagram {
  ok: false;
  message: string;
  /** 1-based line within the diagram source, when Mermaid reports one. */
  line?: number;
}

export type DiagramResult = RenderedDiagram | FailedDiagram;

let mermaidPromise: Promise<Mermaid> | null = null;
let currentConfigKey = "";
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
const cache = new Map<string, DiagramResult>();
const CACHE_LIMIT = 400;

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Ubuntu, Cantarell, sans-serif';

export interface MermaidOptions {
  theme: "default" | "dark" | "neutral" | "forest" | "base";
}

function buildConfig(opts: MermaidOptions): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: opts.theme,
    fontFamily: FONT_STACK,
    suppressErrorRendering: true,
    maxTextSize: 5_000_000,
    maxEdges: 20_000,
    themeVariables: { fontFamily: FONT_STACK },
    flowchart: { htmlLabels: true, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    pie: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    timeline: { useMaxWidth: false },
    c4: { useMaxWidth: false },
    requirement: { useMaxWidth: false },
    sankey: { useMaxWidth: false },
    xyChart: { useMaxWidth: false },
    block: { useMaxWidth: false },
    quadrantChart: { useMaxWidth: false },
    architecture: { useMaxWidth: false },
  } as MermaidConfig;
}

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

export function configKey(opts: MermaidOptions): string {
  return hashString(JSON.stringify(buildConfig(opts)));
}

/** Extract the 1-based line number from Mermaid's various error shapes. */
export function errorLine(err: unknown): number | undefined {
  const e = err as { hash?: { loc?: { last_line?: number }; line?: number }; message?: string; str?: string };
  // The line in the message is where the parser stopped, which is what the reader needs.
  const msg = String(e?.message ?? e?.str ?? err);
  const m = /\bline[:\s]+(\d+)/i.exec(msg) ?? /\bLn\s*(\d+)/.exec(msg) ?? /at (\d+):\d+/.exec(msg);
  if (m) return Number(m[1]);
  if (typeof e?.hash?.line === "number") return e.hash.line + 1;
  return e?.hash?.loc?.last_line;
}

function cleanMessage(err: unknown): string {
  const e = err as { message?: string; str?: string };
  let msg = String(e?.message ?? e?.str ?? err ?? "Unknown error");
  msg = msg.replace(/^Error:\s*/, "").trim();
  return msg.length > 2000 ? msg.slice(0, 2000) + "…" : msg;
}

function measure(svg: string): { width: number; height: number; svg: string } {
  // Parse as HTML: label markup inside foreignObject is not always well-formed XML.
  const tpl = document.createElement("template");
  tpl.innerHTML = svg;
  const el = tpl.content.querySelector("svg");
  if (!el) return { width: 800, height: 600, svg };
  const vb = el.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  let width = 0, height = 0;
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
    width = vb[2];
    height = vb[3];
  }
  if (!width || !height) {
    width = parseFloat(el.getAttribute("width") ?? "") || 800;
    height = parseFloat(el.getAttribute("height") ?? "") || 600;
  }
  // Give the SVG its natural size; zoom is done with transforms.
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  el.style.removeProperty("max-width");
  el.style.removeProperty("width");
  el.style.removeProperty("height");
  return { width, height, svg: el.outerHTML };
}

export function cachedResult(source: string, opts: MermaidOptions): DiagramResult | undefined {
  return cache.get(hashString(source) + ":" + configKey(opts));
}

export function renderMermaid(source: string, opts: MermaidOptions): Promise<DiagramResult> {
  const key = hashString(source) + ":" + configKey(opts);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  const job = queue.then(async (): Promise<DiagramResult> => {
    const mermaid = await loadMermaid();
    const ck = configKey(opts);
    if (ck !== currentConfigKey) {
      mermaid.initialize(buildConfig(opts));
      currentConfigKey = ck;
    }
    const id = `mmd-${++counter}`;
    let result: DiagramResult;
    try {
      const { svg } = await mermaid.render(id, source);
      result = { ok: true, ...measure(svg) };
    } catch (err) {
      result = { ok: false, message: cleanMessage(err), line: errorLine(err) };
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById("d" + id)?.remove();
      document.getElementById("i" + id)?.remove();
    }
    cache.set(key, result);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    // Yield so scrolling and input stay responsive between diagrams.
    await new Promise((r) => setTimeout(r, 0));
    return result;
  });
  queue = job.catch(() => undefined);
  return job;
}
