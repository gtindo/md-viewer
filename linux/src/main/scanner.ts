// Workspace enumeration (port of macos/.../FileTree/TreeScanner.swift): ignored directories
// are pruned as they are entered; .gitignore files apply to their own subtree.

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { GitIgnore } from "./gitignore";
import { isMarkdown } from "./fileservice";
import type { FilterMode, TreeNode } from "../common/types";

export interface ScanNode {
  name: string;
  isDir: boolean;
  mtime: number;
  children: ScanNode[];
  /** For directories: contains a markdown file at any depth. For files: is markdown. */
  containsMarkdown: boolean;
}

export interface ScanOptions {
  respectGitignore: boolean;
  extraGlobs: string[];
}

export interface ScanResult {
  root: ScanNode;
  /** Workspace-relative paths of every markdown file, for quick open. */
  markdownPaths: string[];
  fileCount: number;
  ms: number;
}

export const ALWAYS_HIDDEN = new Set([".git", "node_modules", ".DS_Store"]);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

function sortOrder(a: ScanNode, b: ScanNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return naturalCompare(a.name, b.name);
}

/** Limits concurrent file system calls so huge trees do not exhaust descriptors. */
class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export async function scan(root: string, options: ScanOptions): Promise<ScanResult> {
  const start = performance.now();
  const limiter = new Limiter(64);
  const extra = GitIgnore.fromGlobs("", options.extraGlobs);
  const base: GitIgnore[] = [];
  if (options.respectGitignore) {
    const exclude = await fs.readFile(path.join(root, ".git/info/exclude"), "utf8").catch(() => null);
    if (exclude) base.push(new GitIgnore("", exclude));
  }
  const markdownPaths: string[] = [];
  let fileCount = 0;

  function isIgnored(rel: string, name: string, isDir: boolean, matchers: GitIgnore[]): boolean {
    if (ALWAYS_HIDDEN.has(name)) return true;
    if (!extra.isEmpty) {
      const d = extra.decision(rel, name, isDir);
      if (d !== undefined) return d;
    }
    if (!options.respectGitignore) return false;
    for (let i = matchers.length - 1; i >= 0; i--) {
      const m = matchers[i];
      let sub = rel;
      if (m.base !== "") {
        const prefix = m.base.length + 1;
        if (rel.length <= prefix) continue;
        sub = rel.slice(prefix);
      }
      const d = m.decision(sub, name, isDir);
      if (d !== undefined) return d;
    }
    return false;
  }

  async function walk(abs: string, rel: string, node: ScanNode, inherited: GitIgnore[]): Promise<void> {
    let matchers = inherited;
    if (options.respectGitignore) {
      const text = await limiter.run(() => fs.readFile(path.join(abs, ".gitignore"), "utf8").catch(() => null));
      if (text) {
        const gi = new GitIgnore(rel, text);
        if (!gi.isEmpty) matchers = [...inherited, gi];
      }
    }
    let entries: Dirent[];
    try {
      entries = await limiter.run(() => fs.readdir(abs, { withFileTypes: true }));
    } catch {
      return; // unreadable directory
    }
    const subdirs: Promise<void>[] = [];
    const files: Promise<void>[] = [];
    for (const ent of entries) {
      const name = ent.name;
      const childRel = rel === "" ? name : `${rel}/${name}`;
      const childAbs = path.join(abs, name);
      if (ent.isDirectory()) {
        if (isIgnored(childRel, name, true, matchers)) continue;
        const child: ScanNode = { name, isDir: true, mtime: 0, children: [], containsMarkdown: false };
        node.children.push(child);
        subdirs.push(walk(childAbs, childRel, child, matchers));
      } else {
        files.push(
          (async () => {
            let isDir = false;
            let mtime = 0;
            try {
              const st = await limiter.run(() => (ent.isSymbolicLink() ? fs.stat(childAbs) : fs.lstat(childAbs)));
              isDir = ent.isSymbolicLink() && st.isDirectory();
              mtime = st.mtimeMs / 1000;
            } catch {
              // dangling symlink: keep it as a file entry
            }
            if (isIgnored(childRel, name, isDir, matchers)) return;
            const md = !isDir && isMarkdown(name);
            if (md) markdownPaths.push(childRel);
            fileCount++;
            node.children.push({ name, isDir, mtime, children: [], containsMarkdown: md });
          })(),
        );
      }
    }
    await Promise.all(files);
    await Promise.all(subdirs);
    node.children.sort(sortOrder);
    node.containsMarkdown = node.children.some((c) => c.containsMarkdown);
  }

  const rootNode: ScanNode = { name: path.basename(root), isDir: true, mtime: 0, children: [], containsMarkdown: false };
  await walk(root, "", rootNode, base);
  markdownPaths.sort(naturalCompare);
  return { root: rootNode, markdownPaths, fileCount, ms: performance.now() - start };
}

/** The tree the sidebar shows in `mode` (the type-to-filter query is applied by the shell). */
export function displayTree(scan: ScanNode, mode: FilterMode): TreeNode {
  function children(node: ScanNode, parent: string): TreeNode[] {
    const out: TreeNode[] = [];
    for (const c of node.children) {
      const p = parent === "" ? c.name : `${parent}/${c.name}`;
      if (c.isDir) {
        if (mode === "markdown" && !c.containsMarkdown) continue;
        out.push({ name: c.name, path: p, dir: true, mtime: c.mtime, md: false, children: children(c, p) });
      } else {
        if (mode !== "allFiles" && !c.containsMarkdown) continue;
        out.push({ name: c.name, path: p, dir: false, mtime: c.mtime, md: c.containsMarkdown });
      }
    }
    return out;
  }
  return { name: scan.name, path: "", dir: true, mtime: 0, md: false, children: children(scan, "") };
}
