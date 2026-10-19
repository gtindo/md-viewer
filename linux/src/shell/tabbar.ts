// The tab bar: preview tabs in italics, a dot for unsaved edits, drag to reorder,
// horizontal overflow with a menu listing all tabs.

import { h, icons } from "./dom";

export interface TabView {
  id: number;
  title: string;
  path: string;
  pinned: boolean;
  dirty: boolean;
  deleted: boolean;
}

export interface TabBarCallbacks {
  activate(id: number): void;
  pin(id: number): void;
  close(id: number): void;
  move(id: number, beforeId: number | null): void;
  contextMenu(id: number): void;
  overflowMenu(): void;
}

export class TabBar {
  readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly more: HTMLButtonElement;
  private dragging: number | null = null;
  private lastActive: number | null = null;
  /** Tab elements by id, reused across renders so a drag in progress survives reordering. */
  private elements = new Map<number, { el: HTMLElement; title: HTMLElement; key: string }>();

  constructor(private readonly cb: TabBarCallbacks) {
    this.strip = h("div", { class: "tab-strip", role: "tablist" });
    this.more = h("button", { class: "tab-more icon-button", title: "All tabs", html: icons.more });
    this.more.addEventListener("click", () => cb.overflowMenu());
    this.el = h("div", { class: "tabbar" }, this.strip, this.more);
    this.strip.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.strip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    new ResizeObserver(() => this.updateOverflow()).observe(this.strip);
  }

  render(tabs: TabView[], activeId: number | null): void {
    this.el.hidden = tabs.length === 0;
    const keep = new Set(tabs.map((t) => t.id));
    for (const [id, e] of this.elements) {
      if (!keep.has(id)) {
        e.el.remove();
        this.elements.delete(id);
      }
    }
    let prev: HTMLElement | null = null;
    for (const t of tabs) {
      let e = this.elements.get(t.id);
      if (!e) {
        e = this.tab(t);
        this.elements.set(t.id, e);
      }
      const active = t.id === activeId;
      const key = JSON.stringify([t.title, t.path, t.pinned, t.dirty, t.deleted, active]);
      if (key !== e.key) {
        e.key = key;
        e.el.className = `tab${active ? " active" : ""}${t.pinned ? "" : " preview"}${t.dirty ? " dirty" : ""}${t.deleted ? " deleted" : ""}${this.dragging === t.id ? " dragging" : ""}`;
        e.el.setAttribute("aria-selected", String(active));
        e.el.title = t.path;
        e.title.textContent = t.title;
      }
      const expected: Element | null = prev ? prev.nextElementSibling : this.strip.firstElementChild;
      if (expected !== e.el) {
        if (prev) prev.after(e.el);
        else this.strip.prepend(e.el);
      }
      prev = e.el;
    }
    this.updateOverflow();
    if (activeId !== null && activeId !== this.lastActive) {
      this.strip.querySelector<HTMLElement>(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    this.lastActive = activeId;
  }

  private updateOverflow(): void {
    this.more.hidden = this.strip.scrollWidth <= this.strip.clientWidth + 1;
  }

  private tab(t: TabView): { el: HTMLElement; title: HTMLElement; key: string } {
    const close = h("button", { class: "tab-close", title: "Close Tab", tabindex: "-1", html: icons.close });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cb.close(t.id);
    });
    const title = h("span", { class: "tab-title" }, t.title);
    const el = h(
      "div",
      { class: "tab", role: "tab", draggable: "true" },
      title,
      h("span", { class: "tab-status" }, h("span", { class: "tab-dot" }), close),
    );
    el.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.cb.activate(t.id);
    });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.cb.close(t.id);
      }
    });
    el.addEventListener("dblclick", () => this.cb.pin(t.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.cb.contextMenu(t.id);
    });
    el.addEventListener("dragstart", (e) => {
      this.dragging = t.id;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("application/x-mdview-tab", String(t.id));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      this.dragging = null;
      el.classList.remove("dragging");
    });
    el.addEventListener("dragover", (e) => {
      if (this.dragging === null || this.dragging === t.id) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      const r = el.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      const next = after ? (el.nextElementSibling as HTMLElement | null) : el;
      const beforeId = next ? this.idOf(next) : null;
      if (beforeId !== this.dragging) this.cb.move(this.dragging, beforeId);
    });
    el.addEventListener("drop", (e) => {
      if (this.dragging !== null) e.preventDefault();
    });
    el.dataset.id = String(t.id);
    return { el, title, key: "" };
  }

  private idOf(el: HTMLElement): number | null {
    const id = Number(el.dataset.id);
    return Number.isFinite(id) ? id : null;
  }
}
