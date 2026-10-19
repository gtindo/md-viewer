// Preload for every frame of an MDView window (nodeIntegrationInSubFrames). It exposes:
//  - in core frames (mdview://app/core/…): `mdviewHost`, the HostBridge the core posts to.
//    Inside a workspace window the core runs in an iframe and its messages go to the shell
//    frame with postMessage; a top-level core page (verification modes) talks to the main process.
//  - in shell frames (mdview://app/shell/…): `mdviewShell`, a narrow IPC surface.

import { contextBridge, ipcRenderer, webUtils } from "electron";

const isCore = location.protocol === "mdview:" && location.host === "app" && location.pathname.startsWith("/core/");
const isShell = location.protocol === "mdview:" && location.host === "app" && location.pathname.startsWith("/shell/");

if (isCore) {
  const topLevel = window.parent === window;
  contextBridge.exposeInMainWorld("mdviewHost", {
    postMessage(msg: unknown): void {
      if (topLevel) ipcRenderer.send("core:message", msg);
      else window.parent.postMessage({ mdviewCore: msg }, location.origin);
    },
  });
} else if (isShell) {
  const invokeChannels = new Set([
    "init", "tree:get", "tree:rescan", "file:read", "file:write", "file:saveAs", "file:exists", "file:op", "file:uniqueName",
    "link:resolve", "ws:setPrefs", "ws:session", "ws:dirty", "ws:menuState", "clipboard:write", "export",
    "window:fullScreen", "window:title", "menu:tree", "menu:tab", "menu:tabs", "dialog:confirmClose",
    "dialog:error", "open:folderDialog", "open:fileDialog", "open:paths", "recents:clear",
    "settings:set", "settings:open", "external:open", "app:beep", "ws:saveAllResult", "debug:log",
  ]);
  const eventChannels = new Set([
    "tree:changed", "fs:changed", "menu:command", "settings:changed", "open:file", "window:saveAll",
    "window:fullScreenChanged", "recents:changed", "window:blur",
  ]);
  contextBridge.exposeInMainWorld("mdviewShell", {
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      if (!invokeChannels.has(channel)) return Promise.reject(new Error(`unknown channel ${channel}`));
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel: string, cb: (...args: unknown[]) => void): void {
      if (!eventChannels.has(channel)) throw new Error(`unknown channel ${channel}`);
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    },
    pathForFile(file: File): string {
      return webUtils.getPathForFile(file);
    },
  });
}
