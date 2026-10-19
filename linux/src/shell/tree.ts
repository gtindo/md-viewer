// The sidebar's file tree: a virtualised outline (only visible rows are in the DOM),
// with keyboard navigation, type-to-filter and "recently changed" dots.

import { h, icons } from "./dom";
import { score } from "./fuzzy";
import type { TreeNode } from "../common/types";

const ROW = 24;
const RECENT_SECONDS = 300;

interface Row {
  node: TreeNode;
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

export interface TreeCallbacks {
  open(path: string, pinned: boolean): void;
  openDefault(path: string): void;
  contextMenu(node: TreeNode | null): void;
  expandedChanged(expanded: Set<string>): void;
}

/** Applies the type-to-filter query: matching names, their ancestors and (for folders) their contents. */
function filterTree(node: TreeNode, query: string): TreeNode {
  const q = query.trim();
  if (!q) return node;
  function children(n: TreeNode, ancestorMatched: boolean): TreeNode[] {
    const out: TreeNode[] = [];
    for (const c of n.children ?? []) {
      if (c.dir) {
        const selfMatched = score(q, c.name) !== null;
        const kids = children(c, ancestorMatched || selfMatched);
        if (kids.length === 0 && !selfMatched && !ancestorMatched) continue;
        out.push({ ...c, children: kids });
      } else {
        if (!ancestorMatched && score(q, c.name) === null) continue;
        out.push(c);
      }
    }
    return out;
  }
  return { ...node, children: children(node, false) };
}

export class TreeView {
  readonly el: HTMLElement;
  private readonly spacer: HTMLElement;
  private root: TreeNode | null = null;
  private filtered: TreeNode | null = null;
  private query = "";
  private rows: Row[] = [];
  private expanded: Set<string>;
  private selected: string | null = null;
  private rendered = new Map<number, HTMLElement>();
  private frame = 0;

  constructor(private readonly cb: TreeCallbacks, expanded: Iterable<string>) {
    this.expanded = new Set(expanded);
    this.spacer = h("div", { class: "tree-spacer" });
    this.el = h("div", { class: "tree", tabindex: "0", role: "tree", "aria-label": "Files" }, this.spacer);
    this.el.addEventListener("scroll", () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(this.el);
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const row = this.rowAt(e);
      if (row) this.select(row.node.path, false);
      this.cb.contextMenu(row?.node ?? null);
    });
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("focus", () => {
      if (!this.selected && this.rows.length) this.select(this.rows[0].node.path, false);
      this.el.classList.add("focused");
    });
    this.el.addEventListener("blur", () => this.el.classList.remove("focused"));
  }

  get hasData(): boolean {
    return this.root !== null;
  }

  setData(root: TreeNode | null): void {
    this.root = root;
    this.rebuild();
  }

  setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.rebuild();
    if (query.trim()) this.el.scrollTop = 0;
  }

  get expandedPaths(): Set<string> {
    return this.expanded;
  }

  private rebuild(): void {
    this.filtered = this.root ? filterTree(this.root, this.query) : null;
    this.flatten();
  }

  private flatten(): void {
    const rows: Row[] = [];
    const all = this.query.trim() !== "";
    const walk = (n: TreeNode, depth: number) => {
      for (const c of n.children ?? []) {
        const expandable = c.dir && (c.children?.length ?? 0) > 0;
        const expanded = expandable && (all || this.expanded.has(c.path));
        rows.push({ node: c, depth, expandable, expanded });
        if (expanded) walk(c, depth + 1);
      }
    };
    if (this.filtered) walk(this.filtered, 0);
    this.rows = rows;
    this.spacer.style.height = `${rows.length * ROW}px`;
    this.clearRendered();
    this.render();
  }

  private clearRendered(): void {
    for (const el of this.rendered.values()) el.remove();
    this.rendered.clear();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Re-renders visible rows (e.g. to update modification dots). */
  refresh(): void {
    this.clearRendered();
    this.render();
  }

  private render(): void {
    const top = this.el.scrollTop;
    const height = this.el.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / ROW) - 10);
    const last = Math.min(this.rows.length - 1, Math.ceil((top + height) / ROW) + 10);
    for (const [i, el] of this.rendered) {
      if (i < first || i > last) {
        el.remove();
        this.rendered.delete(i);
      }
    }
    const now = Date.now() / 1000;
    for (let i = first; i <= last; i++) {
      if (this.rendered.has(i)) continue;
      const r = this.rows[i];
      const n = r.node;
      const recent = !n.dir && n.mtime > 0 && now - n.mtime < RECENT_SECONDS;
      const el = h(
        "div",
        {
          class: `tree-row${n.path === this.selected ? " selected" : ""}${n.dir ? " dir" : n.md ? " md" : " other"}`,
          role: "treeitem",
          "aria-expanded": r.expandable ? String(r.expanded) : undefined,
          title: n.path,
          dataset: { index: String(i) },
          style: `top:${i * ROW}px;padding-left:${6 + r.depth * 14}px`,
        },
        h("span", { class: "twisty", html: r.expandable ? (r.expanded ? icons.chevronDown : icons.chevronRight) : "" }),
        h("span", { class: "icon", html: n.dir ? (r.expanded ? icons.folderOpen : icons.folder) : n.md ? icons.markdown : icons.file }),
        h("span", { class: "name" }, n.name),
        recent ? h("span", { class: "dot", title: "Modified in the last 5 minutes" }) : null,
      );
      this.spacer.append(el);
      this.rendered.set(i, el);
    }
  }

  private rowAt(e: Event): Row | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
    if (!el) return null;
    return this.rows[Number(el.dataset.index)] ?? null;
  }

  private onClick(e: MouseEvent): void {
    const row = this.rowAt(e);
    if (!row) return;
    this.select(row.node.path, false);
    if (row.node.dir) this.toggle(row);
    else if (row.node.md) this.cb.open(row.node.path, false);
  }

  private onDoubleClick(e: MouseEvent): void {
    const row = this.rowAt(e);
    if (!row || row.node.dir) return;
    if (row.node.md) this.cb.open(row.node.path, true);
    else this.cb.openDefault(row.node.path);
  }

  private toggle(row: Row, open?: boolean): void {
    if (!row.expandable || this.query.trim()) return;
    const want = open ?? !row.expanded;
    if (want === row.expanded) return;
    if (want) this.expanded.add(row.node.path);
    else this.expanded.delete(row.node.path);
    this.cb.expandedChanged(this.expanded);
    this.flatten();
  }

  private indexOf(path: string | null): number {
    return path === null ? -1 : this.rows.findIndex((r) => r.node.path === path);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const i = this.indexOf(this.selected);
    const row = i >= 0 ? this.rows[i] : null;
    const go = (j: number) => {
      if (this.rows.length === 0) return;
      const k = Math.max(0, Math.min(this.rows.length - 1, j));
      this.select(this.rows[k].node.path, false, true);
    };
    switch (e.key) {
      case "ArrowDown":
        go(i + 1);
        break;
      case "ArrowUp":
        go(i < 0 ? 0 : i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(this.rows.length - 1);
        break;
      case "PageDown":
        go(i + Math.floor(this.el.clientHeight / ROW));
        break;
      case "PageUp":
        go(i - Math.floor(this.el.clientHeight / ROW));
        break;
      case "ArrowRight":
        if (!row) return;
        if (row.expandable && !row.expanded) this.toggle(row, true);
        else if (row.expanded) go(i + 1);
        break;
      case "ArrowLeft": {
        if (!row) return;
        if (row.expanded) this.toggle(row, false);
        else {
          for (let j = i - 1; j >= 0; j--) if (this.rows[j].depth < row.depth) return void (go(j), e.preventDefault());
        }
        break;
      }
      case "Enter":
      case " ":
        if (!row) return;
        if (row.node.dir) this.toggle(row);
        else if (row.node.md) this.cb.open(row.node.path, e.key === "Enter");
        else if (e.key === "Enter") this.cb.openDefault(row.node.path);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Selects `path`; with `reveal`, expands its ancestors first. */
  select(path: string | null, reveal: boolean, scroll = reveal): void {
    if (reveal && path) {
      let changed = false;
      const parts = path.split("/");
      for (let k = 1; k < parts.length; k++) {
        const p = parts.slice(0, k).join("/");
        if (!this.expanded.has(p)) {
          this.expanded.add(p);
          changed = true;
        }
      }
      if (changed) {
        this.cb.expandedChanged(this.expanded);
        this.flatten();
      }
    }
    const i = this.indexOf(path);
    this.selected = i >= 0 ? path : reveal ? this.selected : null;
    for (const [k, el] of this.rendered) el.classList.toggle("selected", this.rows[k]?.node.path === this.selected);
    if (scroll && i >= 0) {
      const top = i * ROW;
      if (top < this.el.scrollTop) this.el.scrollTop = top;
      else if (top + ROW > this.el.scrollTop + this.el.clientHeight) this.el.scrollTop = top + ROW - this.el.clientHeight;
      this.render();
    }
  }

  focus(): void {
    this.el.focus();
  }
}
