// Case-insensitive subsequence matching with a simple score (port of FuzzyMatch.swift).

import { basename } from "./dom";

const SEPARATORS = "/-_. ";
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();

export function score(query: string, candidate: string): number | null {
  const q = Array.from(query.toLowerCase()).filter((c) => !/\s/.test(c));
  if (q.length === 0) return 0;
  const orig = Array.from(candidate);
  const c = orig.map((ch) => ch.toLowerCase());
  let total = 0, qi = 0, last = -2, streak = 0;
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] !== q[qi]) continue;
    let s = 1;
    if (i === last + 1) {
      streak++;
      s += 4 * streak;
    } else {
      streak = 0;
    }
    if (i === 0) s += 8;
    else {
      const prev = orig[i - 1];
      if (SEPARATORS.includes(prev)) s += 6;
      else if (isUpper(orig[i]) && isLower(prev)) s += 4;
    }
    if (last >= 0) s -= Math.min(i - last - 1, 3);
    total += s;
    last = i;
    qi++;
  }
  if (qi !== q.length) return null;
  return total - Math.floor(c.length / 8);
}

/** Ranks workspace-relative paths, favouring matches in the file name. */
export function rank(query: string, paths: string[], limit = 60): string[] {
  const trimmed = query.trim();
  if (!trimmed) return paths.slice(0, limit);
  const scored: [string, number][] = [];
  for (const p of paths) {
    const n = score(trimmed, basename(p));
    if (n !== null) scored.push([p, n * 2 + 20]);
    else {
      const s = score(trimmed, p);
      if (s !== null) scored.push([p, s]);
    }
  }
  scored.sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].length - b[0].length));
  return scored.slice(0, limit).map((x) => x[0]);
}
