// Modal overlays inside a workspace window: Ctrl+P quick open and the name prompt used
// by the tree's New File / New Folder / Rename.

import { basename, dirname, h, icons } from "./dom";
import { rank } from "./fuzzy";

let current: { close(): void } | null = null;

export function overlayOpen(): boolean {
  return current !== null;
}

export function closeOverlay(): void {
  current?.close();
}

function mount(panel: HTMLElement, onClose: () => void): () => void {
  current?.close();
  const backdrop = h("div", { class: "overlay" }, panel);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (current === handle) current = null;
    onClose();
    if (previous && document.contains(previous)) previous.focus();
  }
  const handle = { close };
  current = handle;
  return close;
}

/** Fuzzy search over the workspace's markdown files. */
export function showQuickOpen(paths: () => string[], open: (path: string) => void, beep: () => void): void {
  let selection = 0;
  let results: string[] = [];
  const input = h("input", { class: "quick-input", type: "text", placeholder: "Open file by name", spellcheck: "false" });
  const list = h("div", { class: "quick-list", role: "listbox" });
  const empty = h("div", { class: "quick-empty" });
  const panel = h("div", { class: "quick-open", role: "dialog", "aria-label": "Quick Open" },
    h("div", { class: "quick-field", html: icons.search }, input), list, empty);
  const close = mount(panel, () => {});

  const update = () => {
    const all = paths();
    results = rank(input.value, all, 50);
    selection = Math.min(selection, Math.max(0, results.length - 1));
    list.replaceChildren(
      ...results.map((p, i) => {
        const row = h("div", { class: `quick-row${i === selection ? " selected" : ""}`, role: "option" },
          h("span", { class: "icon", html: icons.markdown }),
          h("span", { class: "quick-name" }, basename(p)),
          h("span", { class: "quick-dir" }, dirname(p)));
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selection = i;
          submit();
        });
        return row;
      }),
    );
    empty.hidden = results.length > 0;
    empty.textContent = all.length === 0 ? "No markdown files" : "No matches";
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };
  const submit = () => {
    const p = results[selection];
    if (p === undefined) return beep();
    close();
    open(p);
  };
  input.addEventListener("input", () => {
    selection = 0;
    update();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) selection = (selection + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      update();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  update();
  input.focus();
}

/** Asks for a file or folder name. Resolves null when cancelled. */
export function promptName(title: string, value: string, button: string, selectStem: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h("input", { class: "prompt-input", type: "text", value, spellcheck: "false" });
    const ok = h("button", { class: "button primary", type: "submit" }, button);
    const cancel = h("button", { class: "button", type: "button" }, "Cancel");
    const form = h("form", { class: "prompt", role: "dialog", "aria-label": title },
      h("div", { class: "prompt-title" }, title), input, h("div", { class: "prompt-buttons" }, cancel, ok));
    const close = mount(form, () => resolve(result));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name || name.includes("/") || name === "." || name === "..") return;
      result = name;
      close();
    });
    cancel.addEventListener("click", () => close());
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    input.focus();
    const dot = value.lastIndexOf(".");
    if (selectStem && dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  });
}
