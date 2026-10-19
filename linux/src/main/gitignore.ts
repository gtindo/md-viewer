// Gitignore-style globs and rule files (port of macos/.../FileTree/GitIgnore.swift).

type Token =
  | { t: "lit"; c: string }
  | { t: "any" } // ?
  | { t: "star" } // * (no slash)
  | { t: "globstar" } // ** (anything, including slashes)
  | { t: "globstarSlash" } // **/ (zero or more whole directories)
  | { t: "set"; ranges: [string, string][]; negated: boolean };

type Fast = { k: "exact"; s: string } | { k: "suffix"; s: string } | { k: "prefix"; s: string } | { k: "general" };

export class Glob {
  readonly tokens: Token[];
  private readonly fast: Fast;

  constructor(pattern: string) {
    const p = pattern;
    const t: Token[] = [];
    let i = 0;
    while (i < p.length) {
      const c = p[i];
      if (c === "\\" && i + 1 < p.length) {
        t.push({ t: "lit", c: p[i + 1] });
        i += 2;
        continue;
      }
      if (c === "?") {
        t.push({ t: "any" });
      } else if (c === "*") {
        if (p[i + 1] === "*") {
          const atSegmentStart = i === 0 || p[i - 1] === "/";
          if (atSegmentStart && p[i + 2] === "/") {
            t.push({ t: "globstarSlash" });
            i += 3;
            continue;
          }
          t.push({ t: "globstar" });
          i += 2;
          while (p[i] === "*") i++;
          continue;
        }
        t.push({ t: "star" });
      } else if (c === "[") {
        const set = Glob.parseSet(p, i);
        if (set) {
          t.push(set[0]);
          i = set[1];
          continue;
        }
        t.push({ t: "lit", c });
      } else {
        t.push({ t: "lit", c });
      }
      i++;
    }
    this.tokens = t;

    const literals = (ts: Token[]) => {
      let out = "";
      for (const tok of ts) {
        if (tok.t !== "lit") return null;
        out += tok.c;
      }
      return out;
    };
    const all = literals(t);
    const tail = t[0]?.t === "star" ? literals(t.slice(1)) : null;
    const head = t[t.length - 1]?.t === "star" ? literals(t.slice(0, -1)) : null;
    if (all !== null) this.fast = { k: "exact", s: all };
    else if (tail !== null && !tail.includes("/")) this.fast = { k: "suffix", s: tail };
    else if (head !== null && !head.includes("/")) this.fast = { k: "prefix", s: head };
    else this.fast = { k: "general" };
  }

  private static parseSet(p: string, start: number): [Token, number] | null {
    let i = start + 1;
    let negated = false;
    if (p[i] === "!" || p[i] === "^") {
      negated = true;
      i++;
    }
    const ranges: [string, string][] = [];
    let first = true;
    while (i < p.length) {
      const c = p[i];
      if (c === "]" && !first) return [{ t: "set", ranges, negated }, i + 1];
      first = false;
      if (i + 2 < p.length && p[i + 1] === "-" && p[i + 2] !== "]") {
        const a = c, b = p[i + 2];
        ranges.push(a <= b ? [a, b] : [b, a]);
        i += 3;
      } else {
        ranges.push([c, c]);
        i++;
      }
    }
    return null;
  }

  matches(s: string): boolean {
    const f = this.fast;
    switch (f.k) {
      case "exact":
        return s === f.s;
      case "suffix":
        return s.length >= f.s.length && !s.includes("/") && s.endsWith(f.s);
      case "prefix":
        return s.length >= f.s.length && !s.slice(f.s.length).includes("/") && s.startsWith(f.s);
      case "general":
        return Glob.match(this.tokens, 0, s, 0);
    }
  }

  private static match(t: Token[], ti: number, s: string, si: number): boolean {
    while (ti < t.length) {
      const tok = t[ti];
      switch (tok.t) {
        case "lit":
          if (s[si] !== tok.c) return false;
          ti++;
          si++;
          break;
        case "any":
          if (si >= s.length || s[si] === "/") return false;
          ti++;
          si++;
          break;
        case "set": {
          if (si >= s.length || s[si] === "/") return false;
          const c = s[si];
          const inSet = tok.ranges.some(([lo, hi]) => c >= lo && c <= hi);
          if (inSet === tok.negated) return false;
          ti++;
          si++;
          break;
        }
        case "star": {
          for (let j = si; ; j++) {
            if (Glob.match(t, ti + 1, s, j)) return true;
            if (j >= s.length || s[j] === "/") return false;
          }
        }
        case "globstar": {
          if (ti + 1 === t.length) return true;
          for (let j = si; ; j++) {
            if (Glob.match(t, ti + 1, s, j)) return true;
            if (j >= s.length) return false;
          }
        }
        case "globstarSlash": {
          if (Glob.match(t, ti + 1, s, si)) return true;
          for (let j = si; j < s.length; j++) {
            if (s[j] === "/" && Glob.match(t, ti + 1, s, j + 1)) return true;
          }
          return false;
        }
      }
    }
    return si === s.length;
  }
}

interface Rule {
  glob: Glob;
  negated: boolean;
  dirOnly: boolean;
  /** Unanchored rules (no slash) match the basename at any depth. */
  anchored: boolean;
}

/** Rules from one .gitignore file (or the settings' extra globs), relative to `base`. */
export class GitIgnore {
  readonly rules: Rule[] = [];

  /** `base`: workspace-relative directory containing the rules ("" for the root). */
  constructor(readonly base: string, text: string) {
    for (const raw of text.split(/\r\n|\n|\r/)) {
      let line = raw;
      if (line === "" || line.startsWith("#")) continue;
      // Trailing spaces are ignored unless escaped.
      while (line.endsWith(" ") && !line.endsWith("\\ ")) line = line.slice(0, -1);
      if (line === "") continue;
      let negated = false;
      if (line.startsWith("!")) {
        negated = true;
        line = line.slice(1);
      } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
        line = line.slice(1);
      }
      let dirOnly = false;
      if (line.endsWith("/")) {
        dirOnly = true;
        while (line.endsWith("/")) line = line.slice(0, -1);
      }
      if (line === "") continue;
      let anchored = line.includes("/");
      if (line.startsWith("/")) line = line.slice(1);
      if (line.startsWith("**/")) anchored = true;
      this.rules.push({ glob: new Glob(line), negated, dirOnly, anchored });
    }
  }

  static fromGlobs(base: string, globs: string[]): GitIgnore {
    return new GitIgnore(base, globs.join("\n"));
  }

  get isEmpty(): boolean {
    return this.rules.length === 0;
  }

  /** undefined = no rule matched; true = ignored; false = explicitly re-included. */
  decision(relativePath: string, name: string, isDir: boolean): boolean | undefined {
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule.dirOnly && !isDir) continue;
      if (rule.glob.matches(rule.anchored ? relativePath : name)) return !rule.negated;
    }
    return undefined;
  }
}
