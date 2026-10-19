// Rasterises an SVG (which may contain foreignObject HTML labels) by rendering it in an
// offscreen window and capturing the page, as the macOS SVGRasterizer does with WebKit.

import { BrowserWindow } from "electron";

export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Buffer | null> {
  const w = Math.max(1, width), h = Math.max(1, height);
  // Keep the bitmap within sane limits for huge diagrams.
  const maxSide = 16384, maxArea = 80_000_000;
  const s = Math.min(scale, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)));
  const pw = Math.round(w * s), ph = Math.round(h * s);

  const win = new BrowserWindow({
    show: false,
    width: pw,
    height: ph,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      javascript: true,
      backgroundThrottling: false,
      partition: "mdview-raster",
    },
  });
  try {
    win.webContents.setFrameRate(1);
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` +
      `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%}` +
      `body{zoom:${s}}body>svg{display:block;width:${w}px!important;height:${h}px!important;max-width:none!important;max-height:none!important}</style>` +
      `</head><body>${svg}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Give layout (fonts, foreignObject) a frame to settle.
    await win.webContents.executeJavaScript(
      "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(1), 50))))",
    );
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: pw, height: ph });
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const out = size.width === pw && size.height === ph ? image : image.resize({ width: pw, height: ph, quality: "best" });
    return out.toPNG();
  } catch {
    return null;
  } finally {
    win.destroy();
  }
}
