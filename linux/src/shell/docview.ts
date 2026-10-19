// One live document view: the shared core running in an iframe of this window's renderer,
// and the ordered message channel to it (the Linux counterpart of DocumentController.swift).
// Tabs are views inside the one renderer, not a web contents each.

import type { CoreToHost, HostToCore } from "../../../core/src/bridge";

interface CoreWindow extends Window {
  mdview?: { receive(msg: unknown): Promise<unknown> };
}

export class DocView {
  readonly iframe: HTMLIFrameElement;
  isReady = false;
  remoteImages = false;
  lastUsed = Date.now();
  onMessage: ((msg: CoreToHost) => void) | null = null;
  /** Called when the core page reloaded on its own (it lost its document). */
  onReloaded: (() => void) | null = null;
  private readyWaiters: ((ok: boolean) => void)[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private loads = 0;
  private torn = false;

  constructor(container: HTMLElement) {
    this.iframe = document.createElement("iframe");
    this.iframe.className = "doc-frame";
    this.iframe.setAttribute("title", "Document");
    container.append(this.iframe);
  }

  get window(): CoreWindow | null {
    return this.iframe.contentWindow as CoreWindow | null;
  }

  load(remoteImages = false): void {
    this.remoteImages = remoteImages;
    this.isReady = false;
    this.loads++;
    this.iframe.src = `mdview://app/core/index.html${remoteImages ? "?remote=1" : ""}`;
  }

  /** A message posted by this view's core. */
  receive(msg: CoreToHost): void {
    if (this.torn) return;
    if (msg.type === "ready") {
      const reloaded = this.isReady;
      this.isReady = true;
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      waiters.forEach((w) => w(true));
      if (reloaded) this.onReloaded?.();
    }
    this.onMessage?.(msg);
  }

  waitReady(): Promise<boolean> {
    if (this.isReady) return Promise.resolve(true);
    if (this.torn) return Promise.resolve(false);
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** Queues a message; messages are delivered strictly in order, after `ready`. */
  enqueue<T = unknown>(message: HostToCore): Promise<T | null> {
    const load = this.loads;
    const task = this.tail.then(async () => {
      if (!(await this.waitReady()) || this.torn) return null;
      // A message queued for a page that was since reloaded still goes to the new page,
      // as on macOS; callers re-send the open sequence after a reload.
      void load;
      return this.deliver(message) as Promise<T | null>;
    });
    this.tail = task.catch(() => null);
    return task;
  }

  send<T = unknown>(message: HostToCore): Promise<T | null> {
    return this.enqueue<T>(message);
  }

  private async deliver(message: HostToCore): Promise<unknown> {
    const w = this.window;
    if (!w?.mdview) return null;
    try {
      // Build the message in the core's own realm so it sees plain local objects.
      const local = (w as unknown as { JSON: JSON }).JSON.parse(JSON.stringify(message));
      const result = await w.mdview.receive(local);
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    } catch (e) {
      console.warn(`${message.type} failed`, e);
      return null;
    }
  }

  hasFocus(): boolean {
    return document.activeElement === this.iframe;
  }

  focus(): void {
    this.iframe.focus();
    this.window?.focus();
  }

  teardown(): void {
    this.torn = true;
    this.onMessage = null;
    this.onReloaded = null;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    waiters.forEach((w) => w(false));
    this.iframe.remove();
  }
}

/** Keeps at most `capacity` document views alive in the window (LRU). Evicted tabs save their state first. */
export class DocPool {
  readonly capacity = 8;
  private views = new Map<number, DocView>();

  constructor(
    private readonly container: HTMLElement,
    private readonly attach: (tabId: number, view: DocView) => void,
    private readonly saveState: (tabId: number, state: unknown) => void,
    private readonly activeId: () => number | null,
  ) {
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin) return;
      const data = e.data as { mdviewCore?: CoreToHost } | null;
      if (!data || typeof data !== "object" || !data.mdviewCore) return;
      for (const v of this.views.values()) {
        if (v.window === e.source) {
          v.receive(data.mdviewCore);
          return;
        }
      }
    });
  }

  live(tabId: number): DocView | undefined {
    return this.views.get(tabId);
  }

  all(): DocView[] {
    return [...this.views.values()];
  }

  broadcast(message: HostToCore): void {
    for (const v of this.views.values()) void v.enqueue(message);
  }

  /** Returns the tab's live view, creating (and opening) it when needed. */
  view(tabId: number): DocView {
    let v = this.views.get(tabId);
    if (v) {
      v.lastUsed = Date.now();
      return v;
    }
    v = new DocView(this.container);
    this.views.set(tabId, v);
    this.attach(tabId, v);
    this.evict(tabId);
    return v;
  }

  private evict(keep: number): void {
    if (this.views.size <= this.capacity) return;
    const active = this.activeId();
    const candidates = [...this.views.entries()]
      .filter(([id]) => id !== keep && id !== active)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of candidates.slice(0, this.views.size - this.capacity)) void this.discard(id);
  }

  /** Saves state through `getState`, then destroys the view. */
  async discard(tabId: number): Promise<void> {
    const v = this.views.get(tabId);
    if (!v) return;
    if (v.isReady) {
      const state = await v.send({ type: "getState" });
      if (state) this.saveState(tabId, state);
    }
    // A tab that became active again while we were saving stays alive.
    if (this.views.get(tabId) !== v || tabId === this.activeId()) return;
    this.views.delete(tabId);
    v.teardown();
  }

  discardNow(tabId: number): void {
    const v = this.views.get(tabId);
    if (!v) return;
    this.views.delete(tabId);
    v.teardown();
  }
}
