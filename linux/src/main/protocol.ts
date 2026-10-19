// The mdview:// scheme (same URLs and rules as the macOS SchemeHandler):
//   mdview://app/core/…   the shared core (core/dist)
//   mdview://app/shell/…  the Linux shell UI
//   mdview://ws/…         files of the window's workspace, never outside it
// Each workspace window has its own session, so `ws` resolves against that window's root.

import { app, protocol, type Session } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export const SCHEME = "mdview";

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    },
  ]);
}

export function distDir(): string {
  return path.join(app.getAppPath(), "dist");
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  markdown: "text/plain; charset=utf-8",
  mdx: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export function mimeType(file: string): string {
  return MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
}

export function contentSecurityPolicy(remoteImages: boolean): string {
  const img = remoteImages ? "img-src mdview: data: blob: https: http:" : "img-src mdview: data: blob:";
  return `default-src mdview:; script-src mdview:; style-src mdview: 'unsafe-inline'; ${img}; font-src mdview: data:; connect-src mdview:; frame-src mdview:; object-src 'none'; base-uri 'none'`;
}

function respond(status: number): Response {
  return new Response(null, { status, headers: { "content-type": "text/plain", "access-control-allow-origin": "*" } });
}

function inside(file: string, root: string): boolean {
  return file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

async function serveFile(file: string, extra: Record<string, string> = {}, transform?: (s: string) => string): Promise<Response> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return respond(404);
    const data = await fs.readFile(file);
    const body: Uint8Array | string = transform ? transform(data.toString("utf8")) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Response(body as BodyInit, {
      status: 200,
      headers: { "content-type": mimeType(file), "access-control-allow-origin": "*", ...extra },
    });
  } catch {
    return respond(404);
  }
}

/** The core's page, with the Linux font stylesheet added (the core itself stays unchanged). */
function linuxCoreHTML(html: string): string {
  return html.replace("</head>", '  <link rel="stylesheet" href="../shell/core-linux.css">\n</head>');
}

async function serveApp(url: URL): Promise<Response> {
  const dist = distDir();
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "") rel = "shell/index.html";
  const file = path.normalize(path.join(dist, rel));
  if (!inside(file, dist)) return respond(403);
  if (rel.endsWith(".html")) {
    const remote = url.searchParams.get("remote") === "1";
    const headers = { "content-security-policy": contentSecurityPolicy(remote), "cache-control": "no-store" };
    return serveFile(file, headers, rel === "core/index.html" ? linuxCoreHTML : undefined);
  }
  return serveFile(file);
}

async function serveWorkspace(url: URL, root: string | null): Promise<Response> {
  if (!root) return respond(404);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = path.normalize(path.join(root, rel));
  if (!inside(file, root)) return respond(403);
  try {
    file = await fs.realpath(file);
  } catch {
    return respond(404);
  }
  if (!inside(file, root)) return respond(403);
  return serveFile(file);
}

/** Installs the scheme on a session. `root` is the canonical workspace root, if any. */
export function installProtocol(ses: Session, root: string | null): void {
  ses.protocol.handle(SCHEME, (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return respond(400);
    }
    if (url.host === "app") return serveApp(url);
    if (url.host === "ws") return serveWorkspace(url, root);
    return respond(404);
  });
  // No permission is ever needed by the core or the shell (clipboard writes go through the host).
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}
