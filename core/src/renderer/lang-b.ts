// Classical B (B-Method: Atelier B / ProB dialect) TextMate grammar, plus a
// detector for untagged fences, since B docs rarely tag their code blocks.

import type { LanguageRegistration } from "shiki/core";

const clauses = [
  "MACHINE", "REFINEMENT", "IMPLEMENTATION", "MODEL", "SYSTEM", "REFINES", "IMPORTS", "SEES",
  "INCLUDES", "EXTENDS", "PROMOTES", "USES", "CONSTRAINTS", "SETS", "CONSTANTS",
  "CONCRETE_CONSTANTS", "ABSTRACT_CONSTANTS", "VISIBLE_CONSTANTS", "HIDDEN_CONSTANTS", "PROPERTIES",
  "VALUES", "VARIABLES", "CONCRETE_VARIABLES", "ABSTRACT_VARIABLES", "VISIBLE_VARIABLES",
  "HIDDEN_VARIABLES", "INVARIANT", "ASSERTIONS", "INITIALISATION", "INITIALIZATION", "OPERATIONS",
  "LOCAL_OPERATIONS", "DEFINITIONS", "EVENTS", "THEOREMS", "FREETYPES", "REFERENCES", "VARIANT",
];

const substitutions = [
  "BEGIN", "END", "skip", "SKIP", "PRE", "THEN", "IF", "ELSIF", "ELSE", "CHOICE", "OR", "SELECT",
  "WHEN", "CASE", "OF", "EITHER", "ANY", "WHERE", "LET", "BE", "IN", "VAR", "WHILE", "DO", "ASSERT",
];

const builtinSets = [
  "NAT", "NAT1", "NATURAL", "NATURAL1", "INT", "INTEGER", "BOOL", "STRING", "REAL", "FLOAT",
  "MAXINT", "MININT",
];

const builtinFns = [
  "card", "dom", "ran", "min", "max", "union", "inter", "UNION", "INTER", "POW", "POW1", "FIN",
  "FIN1", "id", "prj1", "prj2", "closure", "closure1", "iterate", "fnc", "rel", "seq", "seq1",
  "iseq", "iseq1", "perm", "size", "first", "last", "front", "tail", "rev", "conc", "succ", "pred",
  "SIGMA", "PI", "struct", "rec", "mod", "floor", "ceiling", "real", "bool", "btrue", "bfalse",
  "not", "or", "max", "abs", "iterate",
];

const w = (words: string[]) => `\\b(?:${[...new Set(words)].join("|")})\\b`;

export const bGrammar: LanguageRegistration = {
  name: "b",
  scopeName: "source.b",
  displayName: "B-Method",
  aliases: ["bmethod", "b-method", "classicalb", "classical-b", "atelierb", "prob", "mch", "ref", "imp", "eventb", "event-b"],
  patterns: [
    { include: "#comment" },
    { include: "#string" },
    { include: "#machine-header" },
    { include: "#operation-header" },
    { include: "#definition" },
    { include: "#keywords" },
    { include: "#quantifier" },
    { include: "#constants" },
    { include: "#operators" },
    { include: "#numbers" },
    { include: "#call" },
  ],
  repository: {
    comment: {
      patterns: [
        { name: "comment.block.pragma.b", begin: "/\\*@", end: "\\*/" },
        { name: "comment.block.b", begin: "/\\*", end: "\\*/" },
        { name: "comment.line.double-slash.b", match: "//.*$" },
      ],
    },
    string: {
      patterns: [
        { name: "string.quoted.double.b", begin: '"', end: '"', patterns: [{ name: "constant.character.escape.b", match: "\\\\." }] },
        { name: "string.quoted.triple.b", begin: "'''", end: "'''" },
        { name: "string.template.b", begin: "`", end: "`" },
      ],
    },
    "machine-header": {
      match: `\\b(MACHINE|REFINEMENT|IMPLEMENTATION|MODEL|SYSTEM|REFINES|IMPORTS|SEES|INCLUDES|EXTENDS|PROMOTES|USES)\\b\\s+([A-Za-z_][\\w.]*)`,
      captures: {
        1: { name: "keyword.control.clause.b" },
        2: { name: "entity.name.type.machine.b" },
      },
    },
    "operation-header": {
      patterns: [
        {
          // out1, out2 <-- name(args) =
          match: "([A-Za-z_][\\w]*(?:\\s*,\\s*[A-Za-z_][\\w]*)*)\\s*(<--)\\s*([A-Za-z_][\\w.]*)",
          captures: {
            1: { name: "variable.parameter.output.b" },
            2: { name: "keyword.operator.output.b" },
            3: { name: "entity.name.function.operation.b" },
          },
        },
        {
          // name(args) =   or   name =   at the end of a line (operation definition)
          match: "^\\s*([a-z_][\\w]*)(?=\\s*(?:\\([^)]*\\))?\\s*=\\s*(?:$|/\\*|BEGIN|PRE|SELECT|IF|ANY|skip|VAR|LET|CHOICE))",
          captures: { 1: { name: "entity.name.function.operation.b" } },
        },
      ],
    },
    definition: {
      match: "^\\s*([A-Za-z_][\\w]*)(?=\\s*(?:\\([^)]*\\))?\\s*==)",
      captures: { 1: { name: "entity.name.function.definition.b" } },
    },
    keywords: {
      patterns: [
        { name: "keyword.control.clause.b", match: w(clauses) },
        { name: "keyword.control.b", match: w(substitutions) },
      ],
    },
    quantifier: {
      // !x.(  #(a,b).(  %x.(  and the unicode forms
      match: "([!#%∀∃λ])\\s*(\\(?[A-Za-z_][\\w]*(?:\\s*,\\s*[A-Za-z_][\\w]*)*\\)?)\\s*(\\.)",
      captures: {
        1: { name: "keyword.operator.quantifier.b" },
        2: { name: "variable.parameter.bound.b" },
        3: { name: "keyword.operator.quantifier.b" },
      },
    },
    constants: {
      patterns: [
        { name: "constant.language.boolean.b", match: "\\b(?:TRUE|FALSE)\\b" },
        { name: "support.type.builtin.b", match: w(builtinSets) },
        { name: "support.type.builtin.b", match: "ℕ1|ℤ1|[ℕℤℙℝ∅]|𝔽" },
        { name: "support.function.builtin.b", match: `${w(builtinFns)}(?=\\s*\\(|\\s*\\[|\\s*~)` },
        { name: "support.function.builtin.b", match: "\\b(?:card|dom|ran|POW|FIN|closure1?|id|bool|not)\\b" },
      ],
    },
    operators: {
      patterns: [
        { name: "keyword.operator.assignment.b", match: ":=|::|:\\(|≔|<--|←" },
        { name: "keyword.operator.function.b", match: ">->>|>\\+>>|-->>|\\+->>|>->|>\\+>|<<->>|<<->|<->>|-->|\\+->|<->|→|⇸|↣|↠|⤖|↔|⤀" },
        { name: "keyword.operator.maplet.b", match: "\\|->|↦" },
        { name: "keyword.operator.relation.b", match: "<<\\||\\|>>|<\\||\\|>|<\\+|\\+>|><|\\|\\||⩤|⩥|◁|▷|⊕|\\^|~|;" },
        { name: "keyword.operator.set.b", match: "\\\\/|/\\\\|/<<:|/<:|<<:|<:|/:|∪|∩|⊆|⊂|⊈|⊄|∈|∉|\\.\\." },
        { name: "keyword.operator.logical.b", match: "<=>|=>|&|⇒|⇔|∧|∨|¬" },
        { name: "keyword.operator.comparison.b", match: "/=|<=|>=|==|=|<|>|≠|≤|≥" },
        { name: "keyword.operator.membership.b", match: ":" },
        { name: "keyword.operator.arithmetic.b", match: "\\*\\*|\\+|-|\\*|/|\\$0|\\bmod\\b" },
      ],
    },
    numbers: {
      patterns: [
        { name: "constant.numeric.b", match: "\\b\\d+(?:\\.\\d+)?\\b" },
      ],
    },
    call: {
      match: "\\b([a-z_][\\w]*)(?=\\()",
      captures: { 1: { name: "entity.name.function.call.b" } },
    },
  },
};

// ---------------------------------------------------------------------------
// Detection

const strongSignals: RegExp[] = [
  new RegExp(`^\\s*(?:${clauses.join("|")})\\b`, "m"),
  /:=/,
  /<--/,
  /\|->/,
  /[!#%]\s*\(?[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\)?\s*\.\s*\(/,
  /\bPRE\b[\s\S]*\bTHEN\b/,
  /\b(?:ANY|SELECT|LET)\b[\s\S]*\b(?:WHERE|THEN|BE)\b/,
  /\b[a-z_]\w*(?:\([^)]*\))?\s*:\s*(?:[A-Z][A-Z0-9_]*\b|NAT1?\b|INTEGER\b|BOOL\b|POW\(|\d+\s*\.\.)/,
  /\\\/|\/\\|<<:|\/<:|<:|\/:/,
  /<\+|<<\||\|>>/,
  /\+->|>->|-->>|<->/,
  /\bscope_[A-Z]/,
  /∀|∃|∈|∉|⊆|↦|⇒|ℕ/,
];

const weakSignals: RegExp[] = [
  /\.\./,
  /=>|<=>/,
  /\s&\s/,
  /\b(?:card|dom|ran|bool|min|max|closure1?)\(/,
  /\b(?:TRUE|FALSE)\b/,
  /\b(?:NAT1?|INTEGER|BOOL|MAXINT)\b/,
  /-->/,
  /\|\|\s*$/m,
  /\/\*[\s\S]*\*\//,
  /\b(?:IF|THEN|ELSE|END)\b/,
];

/** Lines that strongly suggest some other language or plain prose/terminal output. */
const negativeSignals: RegExp[] = [
  /^\s*(?:\$|>)\s+\S/m,
  /^\s*(?:cargo|npm|npx|pnpm|yarn|git|cd|ls|make|docker|kubectl|curl|brew|pip|python3?|go|\.\/\w+)\s/m,
  /^\s*[{[]\s*"/,
  /^\s*(?:fn|let mut|impl|pub|use|import|from|def|class|function|const|package|func)\s/m,
  /[├└│┌┐┘┬┴┼]/,
];

export interface BScore {
  strong: number;
  weak: number;
  negative: number;
}

export function scoreB(code: string): BScore {
  let strong = 0, weak = 0, negative = 0;
  for (const r of strongSignals) if (r.test(code)) strong++;
  for (const r of weakSignals) if (r.test(code)) weak++;
  for (const r of negativeSignals) if (r.test(code)) negative++;
  return { strong, weak, negative };
}

/** Whether an untagged block is confidently B on its own. */
export function looksLikeB(code: string): boolean {
  const s = scoreB(code);
  if (s.negative > 0 && s.strong < 3) return false;
  return s.strong >= 2 || (s.strong >= 1 && s.weak >= 1);
}

/** Looser test used once the document is known to be about B. */
export function maybeB(code: string): boolean {
  const s = scoreB(code);
  if (s.negative > 0 && s.strong < 2) return false;
  return s.strong + s.weak >= 1;
}
