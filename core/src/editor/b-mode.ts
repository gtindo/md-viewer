// A CodeMirror stream mode for classical B, used for B fences in the editor.

import type { StreamParser } from "@codemirror/language";

const clauses = new Set(
  ("MACHINE REFINEMENT IMPLEMENTATION MODEL SYSTEM REFINES IMPORTS SEES INCLUDES EXTENDS PROMOTES USES CONSTRAINTS SETS " +
    "CONSTANTS CONCRETE_CONSTANTS ABSTRACT_CONSTANTS VISIBLE_CONSTANTS HIDDEN_CONSTANTS PROPERTIES VALUES VARIABLES " +
    "CONCRETE_VARIABLES ABSTRACT_VARIABLES VISIBLE_VARIABLES HIDDEN_VARIABLES INVARIANT ASSERTIONS INITIALISATION " +
    "INITIALIZATION OPERATIONS LOCAL_OPERATIONS DEFINITIONS EVENTS THEOREMS FREETYPES REFERENCES VARIANT").split(" "),
);
const keywords = new Set(
  "BEGIN END skip SKIP PRE THEN IF ELSIF ELSE CHOICE OR SELECT WHEN CASE OF EITHER ANY WHERE LET BE IN VAR WHILE DO ASSERT not or".split(" "),
);
const types = new Set("NAT NAT1 NATURAL NATURAL1 INT INTEGER BOOL STRING REAL FLOAT MAXINT MININT".split(" "));
const builtins = new Set(
  ("card dom ran min max union inter UNION INTER POW POW1 FIN FIN1 id prj1 prj2 closure closure1 iterate fnc rel seq seq1 " +
    "iseq iseq1 perm size first last front tail rev conc succ pred SIGMA PI struct rec mod bool").split(" "),
);

interface BState {
  inComment: boolean;
}

export const bStreamParser: StreamParser<BState> = {
  name: "b",
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.match(/^.*?\*\//)) state.inComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("/*")) {
      state.inComment = true;
      if (stream.match(/^.*?\*\//)) state.inComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^(?:<--|:=|\|->|-->>|-->|\+->>|\+->|>->>|>->|>\+>|<<->>|<<->|<->>|<->|<<\||\|>>|<\||\|>|<\+|\\\/|\/\\|<<:|<:|\/<<:|\/<:|\/:|<=>|=>|\/=|<=|>=|==|\.\.|\|\||[&:=<>+\-*/^~;!#%|])/)) return "operator";
    const word = stream.match(/^[A-Za-z_][\w]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (clauses.has(w)) return "keyword";
      if (keywords.has(w)) return "keyword";
      if (w === "TRUE" || w === "FALSE") return "bool";
      if (types.has(w)) return "typeName";
      if (builtins.has(w)) return "variableName.standard";
      if (stream.peek() === "(") return "variableName.function";
      return "variableName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { block: { open: "/*", close: "*/" }, line: "//" } },
};
