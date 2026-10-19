// The empty-state window: Open Folder, Open File and recent workspaces.

import type { InitInfo } from "../common/types";
import { basename, h, icons } from "./dom";
import { acceptFileDrops, host } from "./host";

export function mountWelcome(info: InitInfo): void {
  const recentList = h("div", { class: "recent-list" });
  const renderRecents = (recents: string[]) => {
    recentList.replaceChildren(
      ...(recents.length
        ? recents.map((p) => {
            const b = h(
              "button",
              { class: "recent-row", title: p },
              h("span", { class: "icon", html: icons.folder }),
              h("span", { class: "recent-text" }, h("span", { class: "recent-name" }, basename(p) || p), h("span", { class: "recent-path" }, p)),
            );
            b.addEventListener("click", () => void host.openPaths([p]));
            return b;
          })
        : [h("div", { class: "recent-empty" }, "No recent workspaces")]),
    );
  };
  renderRecents(info.recents);
  host.onRecents(renderRecents);

  const openFolder = h("button", { class: "button big primary" }, h("span", { class: "icon", html: icons.folder }), "Open Folder…");
  const openFile = h("button", { class: "button big" }, h("span", { class: "icon", html: icons.markdown }), "Open File…");
  openFolder.addEventListener("click", () => void host.openFolderDialog());
  openFile.addEventListener("click", () => void host.openFileDialog());

  document.body.append(
    h(
      "div",
      { class: "welcome" },
      h(
        "section",
        { class: "welcome-main" },
        h("img", { class: "welcome-icon", src: "../icon.png", alt: "" }),
        h("h1", {}, "MDView"),
        h("p", { class: "welcome-tagline" }, "Markdown and Mermaid, readable at any size"),
        h("div", { class: "welcome-actions" }, openFolder, openFile),
        h("p", { class: "welcome-hint" }, "Or drop a folder here"),
        h("p", { class: "welcome-version" }, `Version ${info.version}`),
      ),
      h("section", { class: "welcome-recent" }, h("h2", {}, "Recent"), recentList),
    ),
  );
  acceptFileDrops(document.body);
  openFolder.focus();
}
