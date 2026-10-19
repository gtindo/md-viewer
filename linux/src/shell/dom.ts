// Small DOM helpers and the shell's inline icons.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  folder: svg('<path d="M1.75 4.25v8a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1H8L6.5 3.25H2.75a1 1 0 0 0-1 1z"/>'),
  folderOpen: svg('<path d="M1.75 12.25V4.25a1 1 0 0 1 1-1H6.5L8 4.75h5a1 1 0 0 1 1 1v1"/><path d="M1.75 12.25l1.6-4.8a1 1 0 0 1 .95-.7h10.2a.6.6 0 0 1 .57.79l-1.4 4.2a1 1 0 0 1-.95.71H2.75a1 1 0 0 1-1-1z"/>'),
  markdown: svg('<path d="M3.75 1.75h5.5l3 3v9.5h-8.5z"/><path d="M9.25 1.75v3h3"/><path d="M5.5 11.5v-3l1.25 1.5 1.25-1.5v3M10 8.5v3m-1-1 1 1 1-1"/>'),
  file: svg('<path d="M3.75 1.75h5.5l3 3v9.5h-8.5z"/><path d="M9.25 1.75v3h3"/>'),
  chevronRight: svg('<path d="M6 3.5 10.5 8 6 12.5"/>', 12),
  chevronDown: svg('<path d="M3.5 6 8 10.5 12.5 6"/>', 12),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 12),
  sidebar: svg('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M6 2.75v10.5"/>'),
  filter: svg('<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>', 14),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25 13.5 13.5"/>', 14),
  width: svg('<path d="M1.75 8h12.5M4 5.5 1.75 8 4 10.5M12 5.5 14.25 8 12 10.5"/>', 14),
  clear: svg('<circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" opacity=".45"/><path d="M5.75 5.75l4.5 4.5m0-4.5-4.5 4.5" stroke="var(--bg, #fff)"/>', 14),
  docSearch: svg('<path d="M3.75 1.75h5.5l3 3v3.5M3.75 1.75v12.5h5"/><path d="M9.25 1.75v3h3"/><circle cx="11.25" cy="11.25" r="2"/><path d="m12.7 12.7 1.55 1.55"/>', 44),
  more: svg('<path d="M3.5 6 8 10.5 12.5 6"/>', 12),
};
