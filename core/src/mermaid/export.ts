// Diagram export: standalone SVG serialisation; PNG rasterisation is done by the host.

import { postToHost } from "../bridge";

/** Serialise a rendered diagram as a standalone SVG document with a solid background. */
export function standaloneSvg(svg: SVGSVGElement): { svg: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.querySelectorAll(".mmd-find-hit, .mmd-find-current").forEach((n) => n.classList.remove("mmd-find-hit", "mmd-find-current"));
  const width = parseFloat(svg.getAttribute("width") ?? "") || svg.viewBox.baseVal.width || 800;
  const height = parseFloat(svg.getAttribute("height") ?? "") || svg.viewBox.baseVal.height || 600;
  const bg = getComputedStyle(document.body).getPropertyValue("--diagram-bg").trim() || getComputedStyle(document.body).backgroundColor;
  clone.style.backgroundColor = bg;
  const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  return { svg: text, width, height };
}

export function copyDiagram(svg: SVGSVGElement, format: "svg" | "png"): void {
  const s = standaloneSvg(svg);
  if (format === "svg") postToHost({ type: "copy", svg: s.svg, text: s.svg });
  else postToHost({ type: "copy", svg: s.svg, asPng: true, width: s.width, height: s.height });
}

export function exportDiagram(svg: SVGSVGElement, format: "svg" | "png", name: string): void {
  const s = standaloneSvg(svg);
  postToHost({ type: "export", format, svg: s.svg, suggestedName: `${name}.${format}`, width: s.width, height: s.height });
}
