// Entry point of the shell page: one of a workspace window, the welcome window or Settings.

import { host } from "./host";
import { mountSettings } from "./settings";
import { mountWelcome } from "./welcome";
import { WorkspaceWindow } from "./workspace";

declare global {
  interface Window {
    /** Exposed for tests and debugging. */
    __mdviewWorkspace?: WorkspaceWindow;
  }
}

const info = await host.init();
document.documentElement.dataset.kind = info.kind;
switch (info.kind) {
  case "workspace":
    window.__mdviewWorkspace = new WorkspaceWindow(info);
    break;
  case "welcome":
    document.title = "Welcome to MDView";
    mountWelcome(info);
    break;
  case "settings":
    document.title = "Settings";
    mountSettings(info);
    break;
}
