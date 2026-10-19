// Reading and writing documents: UTF-8 detection, line-ending and BOM preservation,
// atomic writes (temporary file + rename) through symlinks to the real file.

import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LoadedFile, ReadResult } from "../common/types";

const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const lenientDecoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

export function emptyFile(): LoadedFile {
  return { text: "", usesCRLF: false, hasTrailingNewline: true, hasBOM: false, isUTF8: true };
}

export function decode(data: Uint8Array): LoadedFile {
  let bytes = data;
  let hasBOM = false;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    hasBOM = true;
    bytes = bytes.subarray(3);
  }
  let raw: string;
  let isUTF8 = true;
  try {
    raw = strictDecoder.decode(bytes);
  } catch {
    raw = lenientDecoder.decode(bytes);
    isUTF8 = false;
  }
  const usesCRLF = raw.includes("\r\n");
  const text = usesCRLF ? raw.replace(/\r\n/g, "\n") : raw;
  return { text, usesCRLF, hasTrailingNewline: text.endsWith("\n"), hasBOM, isUTF8 };
}

/** Normalises editor text the way `decode` does, for comparisons with disk contents. */
export function normalize(text: string): string {
  return text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
}

/** Encodes `text` using the original file's line endings, trailing-newline state and BOM. */
export function encode(text: string, like: LoadedFile): { data: Buffer; normalized: string } {
  let t = normalize(text);
  if (like.hasTrailingNewline && t.length > 0 && !t.endsWith("\n")) t += "\n";
  if (!like.hasTrailingNewline && t.endsWith("\n")) t = t.slice(0, -1);
  const out = like.usesCRLF ? t.replace(/\n/g, "\r\n") : t;
  const body = Buffer.from(out, "utf8");
  const data = like.hasBOM ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
  return { data, normalized: t };
}

export async function read(file: string): Promise<ReadResult> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return { ok: false, error: "unreadable" };
  } catch {
    return { ok: false, error: "missing" };
  }
  try {
    return { ok: true, file: decode(await fs.readFile(file)) };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

/** The real path of `p`, resolving symlinks; missing trailing components are appended unresolved. */
export async function canonical(p: string): Promise<string> {
  const abs = path.resolve(p);
  try {
    return await fs.realpath(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(await canonical(parent), path.basename(abs));
  }
}

/** Atomic write, keeping the target's permissions. Returns the file as it now is on disk. */
export async function write(text: string, file: string, like: LoadedFile): Promise<LoadedFile> {
  const { data, normalized } = encode(text, like);
  const target = await canonical(file);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await fs.stat(target)).mode & 0o7777;
  } catch {
    mode = undefined;
  }
  const tmp = path.join(dir, `.${path.basename(target)}.mdview-${crypto.randomBytes(4).toString("hex")}.tmp`);
  const handle = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, mode ?? 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return {
    ...like,
    text: normalized,
    hasTrailingNewline: normalized.endsWith("\n") || (normalized.length === 0 && like.hasTrailingNewline),
    isUTF8: true,
  };
}

export const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

export function isMarkdown(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
