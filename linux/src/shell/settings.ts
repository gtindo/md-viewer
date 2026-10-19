// The Settings window (Ctrl+,): General, Appearance and Diagrams, as on macOS.

import { CODE_THEMES, FONT_SIZE_RANGE, type InitInfo, type Preferences } from "../common/types";
import { h } from "./dom";
import { host } from "./host";

type Path = string[];

export function mountSettings(info: InitInfo): void {
  let prefs = info.prefs;
  const bindings: (() => void)[] = [];

  const get = (path: Path): unknown => path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], prefs);
  const set = (path: Path, value: unknown) => {
    const next = structuredClone(prefs) as unknown as Record<string, unknown>;
    let o = next;
    for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[path[path.length - 1]] = value;
    prefs = next as unknown as Preferences;
    void host.setPrefs(prefs);
  };

  let ids = 0;
  const row = (label: string, control: HTMLElement, help?: string) => {
    const id = `c${++ids}`;
    control.id = id;
    return h(
      "div",
      { class: "setting" },
      h("label", { for: id, class: "setting-label" }, label),
      h("div", { class: "setting-control" }, control, help ? h("div", { class: "setting-help" }, help) : null),
    );
  };
  const toggle = (label: string, path: Path) => {
    const input = h("input", { type: "checkbox" });
    bindings.push(() => (input.checked = !!get(path)));
    input.addEventListener("change", () => set(path, input.checked));
    const id = `c${++ids}`;
    input.id = id;
    return h("div", { class: "setting check" }, input, h("label", { for: id }, label));
  };
  const select = (label: string, path: Path, options: [string, string][]) => {
    const el = h("select", {}, ...options.map(([v, l]) => (v === "-" ? h("hr") : h("option", { value: v }, l))));
    bindings.push(() => (el.value = String(get(path))));
    el.addEventListener("change", () => set(path, el.value));
    return row(label, el);
  };
  const section = (title: string, ...rows: HTMLElement[]) => h("fieldset", { class: "settings-section" }, h("legend", {}, title), ...rows);

  // General
  const globs = h("textarea", { rows: "4", spellcheck: "false", placeholder: "dist/\n**/*.generated.md" });
  bindings.push(() => {
    if (document.activeElement !== globs) globs.value = prefs.extraIgnoreGlobs;
  });
  let globTimer = 0;
  globs.addEventListener("input", () => {
    clearTimeout(globTimer);
    globTimer = window.setTimeout(() => set(["extraIgnoreGlobs"], globs.value), 500);
  });
  const general = h(
    "div",
    { class: "pane" },
    section(
      "Workspaces",
      toggle("Reopen last workspaces on launch", ["reopenWorkspaces"]),
      select("Default mode for opened files", ["defaultMode"], [["preview", "Preview"], ["split", "Split"], ["edit", "Edit"]]),
      select("Autosave", ["autosave"], [["off", "Off"], ["onFocusLoss", "On focus loss"], ["afterIdle", "After 2 seconds idle"]]),
    ),
    section(
      "File tree",
      toggle("Respect .gitignore", ["respectGitignore"]),
      row("Extra ignore globs", globs, "One gitignore-style pattern per line, e.g. dist/ or **/*.generated.md. .git, node_modules and .DS_Store are always hidden."),
    ),
  );

  // Appearance
  const size = h("input", { type: "number", min: String(FONT_SIZE_RANGE[0]), max: String(FONT_SIZE_RANGE[1]), step: "1" });
  bindings.push(() => (size.value = String(prefs.core.fontSize)));
  size.addEventListener("change", () => {
    const v = Math.round(Number(size.value));
    if (Number.isFinite(v)) set(["core", "fontSize"], Math.min(FONT_SIZE_RANGE[1], Math.max(FONT_SIZE_RANGE[0], v)));
  });
  const themes = CODE_THEMES.map((t) => [t, t] as [string, string]);
  const appearance = h(
    "div",
    { class: "pane" },
    section(
      "Document",
      select("Content width", ["core", "width"], [["readable", "Readable"], ["wide", "Wide"], ["full", "Full"]]),
      row("Base font size (px)", size),
      select("Prose font", ["core", "proseFont"], [["system", "System"], ["serif", "Serif"]]),
    ),
    section(
      "Code",
      select("Light theme", ["core", "codeThemeLight"], themes),
      select("Dark theme", ["core", "codeThemeDark"], themes),
      toggle("Line numbers in code blocks", ["core", "codeLineNumbers"]),
    ),
    section(
      "Editor",
      toggle("Line numbers", ["core", "editorLineNumbers"]),
      toggle("Vim keybindings", ["core", "vim"]),
      toggle("Scroll sync in Split mode", ["core", "scrollSync"]),
    ),
  );

  // Diagrams
  const height = h("input", { type: "range", min: "30", max: "100", step: "5" });
  const heightLabel = h("span", { class: "range-value" });
  bindings.push(() => {
    height.value = String(prefs.core.diagramMaxHeight);
    heightLabel.textContent = `${prefs.core.diagramMaxHeight}% of window`;
  });
  height.addEventListener("input", () => {
    heightLabel.textContent = `${height.value}% of window`;
  });
  height.addEventListener("change", () => set(["core", "diagramMaxHeight"], Number(height.value)));
  const heightRow = row("Inline max height", h("div", { class: "range" }, height, heightLabel));
  const diagrams = h(
    "div",
    { class: "pane" },
    section(
      "Diagrams",
      heightRow,
      select("Small diagrams", ["core", "diagramSmallZoom"], [["actual", "Actual size (100%)"], ["fit", "Fit to width"]]),
      toggle("Show minimap by default", ["core", "showMinimap"]),
      select("Diagram style", ["core", "mermaidTheme"], [
        ["auto", "MDView (follows appearance)"],
        ["-", ""],
        ["default", "Mermaid Default"],
        ["dark", "Mermaid Dark"],
        ["neutral", "Mermaid Neutral"],
        ["forest", "Mermaid Forest"],
        ["base", "Mermaid Base"],
      ]),
    ),
  );

  const panes: [string, HTMLElement][] = [["General", general], ["Appearance", appearance], ["Diagrams", diagrams]];
  const tabs = h("nav", { class: "settings-tabs", role: "tablist" });
  const show = (i: number) => {
    panes.forEach(([, p], k) => (p.hidden = k !== i));
    tabs.querySelectorAll("button").forEach((b, k) => {
      b.classList.toggle("selected", k === i);
      b.setAttribute("aria-selected", String(k === i));
    });
  };
  panes.forEach(([label], i) => {
    const b = h("button", { class: "settings-tab", role: "tab" }, label);
    b.addEventListener("click", () => show(i));
    tabs.append(b);
  });
  document.body.append(h("div", { class: "settings" }, tabs, ...panes.map(([, p]) => p)));
  show(0);

  const refresh = () => bindings.forEach((b) => b());
  refresh();
  host.onSettings((p) => {
    prefs = p;
    refresh();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
}
