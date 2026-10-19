// MDView's diagram style: Mermaid's "base" theme with a soft, tinted palette, plus a
// post-processing pass that gives nodes, clusters and actors a hue by meaning.
//
// The CSS travels inside the SVG (Mermaid's themeCSS, scoped to the diagram id), so copied
// and exported diagrams look the same as in the viewer. Author styling still wins: `style`
// statements are inline styles and `classDef` rules are emitted with !important.

import type { Mermaid } from "mermaid";

type HueName = "blue" | "teal" | "violet" | "rose" | "cyan" | "orange" | "green" | "amber";

const HUES: Record<HueName, number> = {
  blue: 214,
  teal: 172,
  violet: 258,
  rose: 340,
  cyan: 192,
  orange: 24,
  green: 145,
  amber: 38,
};

/** Hues handed out in turn to classes, entities and actors. */
const CYCLE: HueName[] = ["blue", "teal", "violet", "rose", "cyan", "orange"];
/** Subgraphs skip blue, which stays the colour of nodes outside any subgraph. */
const CLUSTER_CYCLE: HueName[] = ["teal", "violet", "rose", "cyan", "orange", "blue"];

interface Tone {
  fill: string;
  stroke: string;
  text: string;
  clusterFill: string;
  clusterStroke: string;
  clusterText: string;
  rowOdd: string;
  rowEven: string;
}

function tone(h: number, dark: boolean): Tone {
  return dark
    ? {
        fill: `hsl(${h} 32% 21%)`,
        stroke: `hsl(${h} 42% 47%)`,
        text: `hsl(${h} 45% 90%)`,
        clusterFill: `hsl(${h} 13% 14.5%)`,
        clusterStroke: `hsl(${h} 20% 28%)`,
        clusterText: `hsl(${h} 50% 74%)`,
        rowOdd: `hsl(${h} 18% 16%)`,
        rowEven: `hsl(${h} 20% 18.5%)`,
      }
    : {
        fill: `hsl(${h} 88% 96%)`,
        stroke: `hsl(${h} 52% 72%)`,
        text: `hsl(${h} 45% 22%)`,
        clusterFill: `hsl(${h} 70% 98.4%)`,
        clusterStroke: `hsl(${h} 45% 85%)`,
        clusterText: `hsl(${h} 42% 36%)`,
        rowOdd: `hsl(${h} 60% 99.2%)`,
        rowEven: `hsl(${h} 70% 97.6%)`,
      };
}

interface Base {
  bg: string;
  text: string;
  muted: string;
  line: string;
  neutralFill: string;
  neutralStroke: string;
  labelBg: string;
}

function base(dark: boolean): Base {
  return dark
    ? { bg: "#1e1e20", text: "#d9dce1", muted: "#a3a9b4", line: "hsl(220 8% 52%)", neutralFill: "hsl(220 8% 19%)", neutralStroke: "hsl(220 8% 34%)", labelBg: "rgba(30, 30, 32, 0.78)" }
    : { bg: "#ffffff", text: "#2b303b", muted: "#5d6573", line: "hsl(220 12% 63%)", neutralFill: "hsl(220 20% 97%)", neutralStroke: "hsl(220 14% 84%)", labelBg: "rgba(255, 255, 255, 0.78)" };
}

export function mdviewThemeVariables(dark: boolean, fontFamily: string): Record<string, unknown> {
  const b = base(dark);
  const blue = tone(HUES.blue, dark);
  const teal = tone(HUES.teal, dark);
  const amber = tone(HUES.amber, dark);
  return {
    darkMode: dark,
    fontFamily,
    background: b.bg,
    textColor: b.text,
    titleColor: b.text,
    lineColor: b.line,
    primaryColor: blue.fill,
    primaryBorderColor: blue.stroke,
    primaryTextColor: blue.text,
    secondaryColor: teal.fill,
    secondaryBorderColor: teal.stroke,
    secondaryTextColor: teal.text,
    tertiaryColor: b.neutralFill,
    tertiaryBorderColor: b.neutralStroke,
    tertiaryTextColor: b.text,
    mainBkg: blue.fill,
    nodeBorder: blue.stroke,
    nodeTextColor: blue.text,
    clusterBkg: b.neutralFill,
    clusterBorder: b.neutralStroke,
    edgeLabelBackground: b.bg,
    // Sequence diagrams
    actorBkg: blue.fill,
    actorBorder: blue.stroke,
    actorTextColor: blue.text,
    actorLineColor: b.neutralStroke,
    signalColor: b.line,
    signalTextColor: b.text,
    labelBoxBkgColor: b.neutralFill,
    labelBoxBorderColor: b.neutralStroke,
    labelTextColor: b.muted,
    loopTextColor: b.muted,
    activationBkgColor: blue.fill,
    activationBorderColor: blue.stroke,
    sequenceNumberColor: b.bg,
    noteBkgColor: amber.fill,
    noteBorderColor: amber.stroke,
    noteTextColor: amber.text,
    // Class, state and ER diagrams
    classText: blue.text,
    labelColor: b.text,
    altBackground: b.neutralFill,
    attributeBackgroundColorOdd: blue.rowOdd,
    attributeBackgroundColorEven: blue.rowEven,
  };
}

/** Per-hue rules, keyed by the classes `decorate` adds. Scoped to the diagram by Mermaid. */
export function mdviewThemeCSS(dark: boolean): string {
  const b = base(dark);
  const rules: string[] = [];
  for (const [name, h] of Object.entries(HUES)) {
    const t = tone(h, dark);
    const n = `.mdv-${name}`;
    const shapes = [
      `${n} > rect.label-container`,
      `${n} > polygon.label-container`,
      `${n} > circle.label-container`,
      `${n} > path.label-container`,
      `${n} > rect.actor`,
    ].join(",");
    rules.push(
      `${shapes}{fill:${t.fill};stroke:${t.stroke};}`,
      `${n} .outer-path path:not([fill="none"]){fill:${t.fill};}`,
      `${n} .outer-path path[fill="none"],${n} .divider path,${n} .row-rect-odd path[fill="none"],${n} .row-rect-even path[fill="none"]{stroke:${t.stroke};}`,
      `${n} .nodeLabel,${n} .label,${n} span,${n} p{color:${t.text};}`,
      `${n} text,${n} text > tspan{fill:${t.text};}`,
      `${n} .row-rect-odd path:not([fill="none"]){fill:${t.rowOdd};}`,
      `${n} .row-rect-even path:not([fill="none"]){fill:${t.rowEven};}`,
      `.cluster${n} > rect{fill:${t.clusterFill};stroke:${t.clusterStroke};}`,
      `.cluster${n} .nodeLabel,.cluster${n} .cluster-label span,.cluster${n} .cluster-label p{color:${t.clusterText};}`,
      `.cluster${n} .cluster-label text,.cluster${n} .cluster-label tspan{fill:${t.clusterText};}`,
      `line.actor-line${n}{stroke:${t.stroke};}`,
    );
  }
  rules.push(
    // Quieter connectors and labels.
    `.flowchart-link,.relation,.transition,.relationshipLine{stroke-width:1.3px;}`,
    `.edgeLabel,.edgeLabel p,.edgeLabel span{color:${b.muted};}`,
    // Labels sit on a translucent, rounded chip so tinted subgraphs show through.
    `.edgeLabel rect{fill:${b.labelBg};rx:4px;ry:4px;}`,
    `span.edgeLabel,.edgeLabel p{background-color:transparent;}`,
    `.labelBkg{background-color:${b.labelBg};border-radius:4px;}`,
    `line.actor-line{stroke-dasharray:4 4;stroke-width:1px;}`,
    `.messageText{fill:${b.text};}`,
    `.loopLine{stroke:${b.neutralStroke};stroke-width:1px;}`,
  );
  return rules.join("\n");
}

export interface FlowInfo {
  shapes: Map<string, string>;
  /** Subgraph id → member ids (nodes and nested subgraphs). */
  subgraphs: { id: string; nodes: string[] }[];
}

/** Node shapes and subgraph membership from Mermaid's parser (flowcharts only). */
export async function flowInfo(mermaid: Mermaid, source: string): Promise<FlowInfo | undefined> {
  try {
    const d = (await mermaid.mermaidAPI.getDiagramFromText(source)) as unknown as {
      type: string;
      db: { getVertices(): Map<string, { id: string; type?: string }> | Record<string, { id: string; type?: string }>; getSubGraphs(): { id: string; nodes: string[] }[] };
    };
    if (!d.type.startsWith("flowchart")) return undefined;
    const v = d.db.getVertices();
    const shapes = new Map<string, string>();
    for (const x of v instanceof Map ? v.values() : Object.values(v)) shapes.set(x.id, x.type ?? "square");
    return { shapes, subgraphs: d.db.getSubGraphs().map((s) => ({ id: s.id, nodes: [...s.nodes] })) };
  } catch {
    return undefined;
  }
}

const SHAPE_HUE: Record<string, HueName> = {
  diamond: "amber",
  stadium: "green",
  circle: "green",
  doublecircle: "green",
  ellipse: "green",
  cylinder: "violet",
  hexagon: "rose",
  lean_right: "cyan",
  lean_left: "cyan",
  trapezoid: "cyan",
  inv_trapezoid: "cyan",
};

function setHue(el: Element | null | undefined, hue: HueName): void {
  if (!el) return;
  for (const c of [...el.classList]) if (c.startsWith("mdv-")) el.classList.remove(c);
  el.classList.add(`mdv-${hue}`);
}

function roundRect(r: Element, radius: number): void {
  if (!r.hasAttribute("rx") || r.getAttribute("rx") === "0") {
    r.setAttribute("rx", String(radius));
    r.setAttribute("ry", String(radius));
  }
}

/** Tag nodes, clusters and actors with hue classes and soften corners. */
export function decorate(svg: SVGSVGElement | Element, info?: FlowInfo): void {
  const id = svg.getAttribute("id") ?? "";
  const role = svg.getAttribute("aria-roledescription") ?? "";

  // Subgraphs / composite states: pale tints in turn. Nodes inside take the tint of their
  // innermost subgraph so the groups read at a glance.
  const clusterHue = new Map<string, HueName>();
  svg.querySelectorAll("g.cluster").forEach((c, i) => {
    const hue = CLUSTER_CYCLE[i % CLUSTER_CYCLE.length];
    setHue(c, hue);
    const sg = c.id.startsWith(id + "-") ? c.id.slice(id.length + 1) : c.id;
    clusterHue.set(sg, hue);
    c.querySelectorAll(":scope > rect").forEach((r) => roundRect(r, 10));
  });

  if (role.startsWith("flowchart")) {
    const innermost = new Map<string, string>();
    if (info) {
      // Smallest subgraph first, so a node keeps its innermost group.
      const sgs = [...info.subgraphs].sort((a, b) => a.nodes.length - b.nodes.length);
      for (const sg of sgs) for (const n of sg.nodes) if (!innermost.has(n)) innermost.set(n, sg.id);
    }
    const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-flowchart-(.+)-\\d+$`);
    svg.querySelectorAll("g.node").forEach((node) => {
      const m = re.exec(node.id);
      const nodeId = m?.[1] ?? "";
      const shape = info?.shapes.get(nodeId);
      const sg = innermost.get(nodeId);
      const hue = (shape && SHAPE_HUE[shape]) || (sg && clusterHue.get(sg)) || "blue";
      setHue(node, hue);
    });
  } else if (role === "class" || role === "classDiagram" || role === "er" || role === "erDiagram") {
    svg.querySelectorAll("g.nodes > g.node, g.node").forEach((node, i) => setHue(node, CYCLE[i % CYCLE.length]));
  } else if (role.startsWith("stateDiagram") || role === "state") {
    svg.querySelectorAll("g.node.statediagram-state").forEach((node) => setHue(node, "blue"));
  } else if (role === "sequence") {
    const order = [...svg.querySelectorAll("rect.actor-top[name]")].sort(
      (a, b) => Number(a.getAttribute("x")) - Number(b.getAttribute("x")),
    );
    const hueOf = new Map<string, HueName>();
    order.forEach((r, i) => hueOf.set(r.getAttribute("name")!, CYCLE[i % CYCLE.length]));
    svg.querySelectorAll("rect.actor[name]").forEach((r) => {
      const hue = hueOf.get(r.getAttribute("name")!);
      if (hue) setHue(r.parentElement, hue);
    });
    svg.querySelectorAll("line.actor-line[name]").forEach((l) => {
      const hue = hueOf.get(l.getAttribute("name")!);
      if (hue) setHue(l, hue);
    });
    svg.querySelectorAll("rect.note").forEach((r) => roundRect(r, 6));
    svg.querySelectorAll("rect.actor").forEach((r) => roundRect(r, 8));
  }

  svg.querySelectorAll("rect.label-container").forEach((r) => roundRect(r, 6));
}
