// Sanitise rendered HTML (agents' markdown may contain raw HTML) and route
// local resources through the workspace scheme.

import DOMPurify from "dompurify";

export interface SanitizeContext {
  /** Document path relative to the workspace root ("docs/plan.md"). */
  path: string;
  allowRemoteImages: boolean;
  /** Set by the sanitiser when a remote image was blocked. */
  blockedRemote: number;
}

let current: SanitizeContext | null = null;

const WS = "mdview://ws/";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Resolve a relative reference against the document's folder, as a workspace-relative path. */
export function resolveRelative(docPath: string, ref: string): string | null {
  try {
    const base = new URL(WS + encodePath(docPath));
    const u = new URL(ref, base);
    if (u.protocol !== "mdview:" || u.host !== "ws") return null;
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

export function workspaceURL(relPath: string): string {
  return WS + encodePath(relPath);
}

function isRemote(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src);
}

function rewriteSrc(el: Element, attr: string): void {
  const src = el.getAttribute(attr);
  if (!src || !current) return;
  if (/^data:image\//i.test(src)) return;
  if (isRemote(src)) {
    if (!current.allowRemoteImages) {
      el.setAttribute("data-remote-src", src);
      el.removeAttribute(attr);
      el.classList.add("remote-blocked");
      current.blockedRemote++;
    }
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    el.removeAttribute(attr);
    return;
  }
  const rel = src.startsWith("/") ? src.slice(1) : resolveRelative(current.path, src);
  if (rel === null) {
    el.removeAttribute(attr);
    return;
  }
  el.setAttribute(attr, workspaceURL(rel.split(/[?#]/)[0]));
}

let hooked = false;

function installHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (!el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "source" || tag === "video" || tag === "audio") {
      rewriteSrc(el, "src");
      if (el.hasAttribute("srcset")) el.removeAttribute("srcset");
      if (tag === "img") {
        el.setAttribute("loading", "lazy");
        el.setAttribute("decoding", "async");
      }
    }
    if (tag === "a") {
      const href = el.getAttribute("href");
      if (href && /^(?:https?:|mailto:)/i.test(href)) el.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "input") {
      // Task list checkboxes are read-only in preview.
      el.setAttribute("disabled", "");
    }
  });
}

export function sanitize(html: string, ctx: SanitizeContext): string {
  installHooks();
  current = ctx;
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "link", "meta", "base", "frame", "frameset", "noscript", "template"],
      FORBID_ATTR: ["autofocus", "formaction"],
      ADD_ATTR: ["data-line", "data-key", "data-index", "data-hash", "data-lang", "aria-hidden", "open"],
      ALLOW_DATA_ATTR: true,
      RETURN_TRUSTED_TYPE: false,
    }) as string;
  } finally {
    current = null;
  }
}
