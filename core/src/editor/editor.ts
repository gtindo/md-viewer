// The light markdown editor: CodeMirror 6 with fenced-code highlighting
// (including Mermaid and B), smart lists, search/replace and optional vim keys.

import { EditorState, Compartment, EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel, findNext, findPrevious } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, foldGutter,
} from "@codemirror/language";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { mermaidLanguageDescription } from "codemirror-lang-mermaid";
import { MergeView } from "@codemirror/merge";
import { tags as t } from "@lezer/highlight";
import { bStreamParser } from "./b-mode";

export interface EditorOptions {
  text: string;
  readOnly: boolean;
  lineNumbers: boolean;
  vim: boolean;
  onChange: (text: string) => void;
  onScroll: (topLine: number) => void;
  onCursor: (cursor: number, line: number) => void;
  onSave: () => void;
}

export interface EditorHandle {
  getText(): string;
  setText(text: string, opts?: { preserveCursor?: boolean }): void;
  setReadOnly(ro: boolean): void;
  setOptions(o: { lineNumbers?: boolean; vim?: boolean }): void;
  focus(): void;
  hasFocus(): boolean;
  gotoLine(line: number): void;
  scrollToLine(line: number): void;
  /** Fractional 0-based source line at the top of the editor viewport. */
  topLine(): number;
  cursor(): number;
  setCursor(pos: number): void;
  command(name: "bold" | "italic" | "link" | "find" | "findNext" | "findPrevious" | "replace"): void;
  showCompare(theirs: string): void;
  hideCompare(): void;
  markClean(): void;
}

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.25em", color: "var(--cm-heading)" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.15em", color: "var(--cm-heading)" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--cm-heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--cm-link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--cm-link)" },
  { tag: [t.processingInstruction, t.monospace], color: "var(--cm-code)" },
  { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
  { tag: [t.list, t.contentSeparator], color: "var(--cm-meta)" },
  { tag: t.meta, color: "var(--cm-meta)" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: "var(--cm-keyword)" },
  { tag: [t.operator, t.operatorKeyword], color: "var(--cm-operator)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cm-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--cm-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: "var(--cm-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: "var(--cm-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--cm-property)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--cm-tag)" },
  { tag: t.variableName, color: "var(--cm-variable)" },
  { tag: t.invalid, color: "var(--cm-invalid)" },
]);

const bDescription = LanguageDescription.of({
  name: "B",
  alias: ["b", "bmethod", "b-method", "classicalb", "mch", "ref", "imp", "prob"],
  extensions: ["mch", "ref", "imp", "prob"],
  support: new LanguageSupport(StreamLanguage.define(bStreamParser)),
});

function codeLanguages(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s/)[0]?.toLowerCase() ?? "";
  if (!name) return null;
  if (name === "mermaid" || name === "mmd") return mermaidLanguageDescription;
  if (bDescription.alias.includes(name)) return bDescription;
  return LanguageDescription.matchLanguageName(languages, name, true);
}

function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    // Toggle off when the selection is already wrapped.
    const outerFrom = range.from - before.length, outerTo = range.to + after.length;
    if (outerFrom >= 0 && view.state.sliceDoc(outerFrom, range.from) === before && view.state.sliceDoc(range.to, outerTo) === after) {
      return {
        changes: [{ from: outerFrom, to: range.from, insert: "" }, { from: range.to, to: outerTo, insert: "" }],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      };
    }
    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

function insertLink(view: EditorView): boolean {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const isUrl = /^https?:\/\//.test(text);
    const insert = isUrl ? `[](${text})` : `[${text}](url)`;
    const selFrom = isUrl ? range.from + 1 : range.from + text.length + 3;
    const selTo = isUrl ? selFrom : selFrom + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(selFrom, selTo) };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
  const gutter = new Compartment();
  const readOnly = new Compartment();
  const vimMode = new Compartment();
  let suppress = false;

  const wrapper = document.createElement("div");
  wrapper.className = "editor-wrap";
  parent.appendChild(wrapper);

  const gutterExt = (on: boolean): Extension => (on ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []);

  const extensions: Extension[] = [
    vimMode.of([]),
    gutter.of(gutterExt(opts.lineNumbers)),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey),
    indentOnInput(),
    syntaxHighlighting(highlightStyle),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: false }),
    readOnly.of(EditorState.readOnly.of(opts.readOnly)),
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "off" }),
    keymap.of([
      ...markdownKeymap,
      ...closeBracketsKeymap,
      { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
      { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-s", run: () => (opts.onSave(), true), preventDefault: true },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !suppress) opts.onChange(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head;
        opts.onCursor(head, u.state.doc.lineAt(head).number);
      }
    }),
  ];

  const view = new EditorView({
    parent: wrapper,
    state: EditorState.create({ doc: opts.text, extensions }),
  });

  view.scrollDOM.addEventListener(
    "scroll",
    () => {
      if (!suppressScroll) opts.onScroll(topLine());
    },
    { passive: true },
  );
  let suppressScroll = false;

  function topLine(): number {
    const top = view.scrollDOM.getBoundingClientRect().top;
    const block = view.lineBlockAtHeight(top - view.documentTop);
    const line = view.state.doc.lineAt(block.from).number - 1;
    const frac = block.height > 0 ? (top - view.documentTop - block.top) / block.height : 0;
    return line + Math.max(0, Math.min(1, frac));
  }

  let vimLoaded: Extension | null = null;
  async function setVim(on: boolean): Promise<void> {
    if (on && !vimLoaded) {
      const { vim } = await import("@replit/codemirror-vim");
      vimLoaded = vim();
    }
    view.dispatch({ effects: vimMode.reconfigure(on && vimLoaded ? vimLoaded : []) });
  }
  if (opts.vim) void setVim(true);

  let merge: MergeView | null = null;
  let mergeEl: HTMLElement | null = null;

  const handle: EditorHandle = {
    getText: () => view.state.doc.toString(),
    setText(text, o) {
      const cur = view.state.selection.main.head;
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: o?.preserveCursor ? { anchor: Math.min(cur, text.length) } : { anchor: 0 },
      });
      suppress = false;
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(ro)) });
    },
    setOptions(o) {
      if (o.lineNumbers !== undefined) view.dispatch({ effects: gutter.reconfigure(gutterExt(o.lineNumbers)) });
      if (o.vim !== undefined) void setVim(o.vim);
    },
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    gotoLine(line) {
      const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line)));
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 40 }) });
      view.focus();
    },
    scrollToLine(line) {
      const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line)));
      suppressScroll = true;
      view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: "start" }) });
      requestAnimationFrame(() => (suppressScroll = false));
    },
    topLine,
    cursor: () => view.state.selection.main.head,
    setCursor(pos) {
      view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
    },
    command(name) {
      switch (name) {
        case "bold":
          wrapSelection(view, "**");
          break;
        case "italic":
          wrapSelection(view, "*");
          break;
        case "link":
          insertLink(view);
          break;
        case "find":
          openSearchPanel(view);
          break;
        case "findNext":
          findNext(view);
          break;
        case "findPrevious":
          findPrevious(view);
          break;
        case "replace":
          openSearchPanel(view);
          requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus());
          break;
      }
    },
    showCompare(theirs) {
      handle.hideCompare();
      mergeEl = document.createElement("div");
      mergeEl.className = "compare";
      mergeEl.innerHTML = `<div class="compare-head"><span>Your version</span><span>On disk</span></div>`;
      const host = document.createElement("div");
      host.className = "compare-body";
      mergeEl.appendChild(host);
      parent.appendChild(mergeEl);
      parent.classList.add("comparing");
      merge = new MergeView({
        a: { doc: view.state.doc.toString(), extensions: [EditorView.lineWrapping, EditorState.readOnly.of(true), markdown({ base: markdownLanguage }), syntaxHighlighting(highlightStyle)] },
        b: { doc: theirs, extensions: [EditorView.lineWrapping, EditorState.readOnly.of(true), markdown({ base: markdownLanguage }), syntaxHighlighting(highlightStyle)] },
        parent: host,
        collapseUnchanged: { margin: 3, minSize: 6 },
        gutter: true,
      });
    },
    hideCompare() {
      merge?.destroy();
      merge = null;
      mergeEl?.remove();
      mergeEl = null;
      parent.classList.remove("comparing");
    },
    markClean() {
      /* Dirty state is tracked by the host. */
    },
  };
  return handle;
}
