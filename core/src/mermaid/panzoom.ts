// Pan/zoom controller built on CSS transforms. The content keeps its natural
// (vector) size; we only translate and scale it. While a gesture is running the
// content is promoted to its own layer for 60 fps, and dropped back afterwards so
// WebKit re-rasterises the SVG crisply at the final zoom.

export type PanZoomMode = "inline" | "expanded";

export interface PanZoomOptions {
  mode: PanZoomMode;
  minZoom?: number;
  maxZoom?: number;
  onChange?: (pz: PanZoom, interactive: boolean) => void;
  onEngageChange?: (engaged: boolean) => void;
  onExpand?: () => void;
  onEscape?: () => void;
}

export interface ViewState {
  zoom: number;
  cx: number;
  cy: number;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface GestureLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export class PanZoom {
  s = 1;
  tx = 0;
  ty = 0;
  w = 1;
  h = 1;
  engaged = false;
  readonly min: number;
  readonly max: number;
  private anim = 0;
  private idleTimer = 0;
  private gestureStart: { s: number; x: number; y: number } | null = null;
  private drag: { id: number; x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private spaceDown = false;
  private disposers: (() => void)[] = [];

  constructor(
    readonly viewport: HTMLElement,
    readonly content: HTMLElement,
    natural: { w: number; h: number },
    readonly opts: PanZoomOptions,
  ) {
    this.min = opts.minZoom ?? 0.1;
    this.max = opts.maxZoom ?? 8;
    this.setNatural(natural.w, natural.h);
    content.style.transformOrigin = "0 0";
    content.style.position = "absolute";
    content.style.left = "0";
    content.style.top = "0";
    this.bind();
  }

  setNatural(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  get vw(): number {
    return this.viewport.clientWidth;
  }
  get vh(): number {
    return this.viewport.clientHeight;
  }

  // -------------------------------------------------------------------------
  // Geometry

  fitScale(kind: "contain" | "width" = "contain"): number {
    const sx = this.vw / this.w;
    const sy = this.vh / this.h;
    return this.clampScale(kind === "width" ? sx : Math.min(sx, sy));
  }

  /** Fit the whole diagram (contain) or its width, never upscaling unless allowed. */
  fit(kind: "contain" | "width" = "contain", animate = false, allowUpscale = false): void {
    let s = this.fitScale(kind);
    if (!allowUpscale) s = Math.min(s, 1);
    const tx = (this.vw - this.w * s) / 2;
    const ty = kind === "width" && this.h * s > this.vh ? 0 : (this.vh - this.h * s) / 2;
    this.to(s, tx, ty, animate);
  }

  actualSize(animate = false): void {
    // 100%, keeping the current centre.
    const c = this.centre();
    this.zoomToAround(1, this.vw / 2, this.vh / 2, animate, c);
  }

  centre(): { x: number; y: number } {
    return { x: (this.vw / 2 - this.tx) / this.s, y: (this.vh / 2 - this.ty) / this.s };
  }

  getState(): ViewState {
    const c = this.centre();
    return { zoom: round(this.s, 4), cx: round(c.x, 1), cy: round(c.y, 1) };
  }

  setState(st: ViewState): void {
    const s = this.clampScale(st.zoom);
    this.to(s, this.vw / 2 - st.cx * s, this.vh / 2 - st.cy * s, false);
  }

  /** Keep zoom, re-centre on the diagram's middle (used when the diagram's source changed). */
  recentre(zoom: number): void {
    const s = this.clampScale(zoom);
    const ty = this.h * s > this.vh ? 0 : (this.vh - this.h * s) / 2;
    this.to(s, (this.vw - this.w * s) / 2, ty, false);
  }

  centreOn(x: number, y: number, animate = true, zoom?: number): void {
    const s = zoom ? this.clampScale(zoom) : this.s;
    this.to(s, this.vw / 2 - x * s, this.vh / 2 - y * s, animate);
  }

  zoomBy(factor: number, px = this.vw / 2, py = this.vh / 2, animate = false): void {
    this.zoomToAround(this.s * factor, px, py, animate);
  }

  zoomToAround(target: number, px: number, py: number, animate: boolean, keep?: { x: number; y: number }): void {
    const s = this.clampScale(target);
    let tx: number, ty: number;
    if (keep) {
      tx = px - keep.x * s;
      ty = py - keep.y * s;
    } else {
      // Keep the point under (px, py) fixed.
      const baseS = this.anim ? this.targetS : this.s;
      const baseTx = this.anim ? this.targetTx : this.tx;
      const baseTy = this.anim ? this.targetTy : this.ty;
      tx = px - ((px - baseTx) * s) / baseS;
      ty = py - ((py - baseTy) * s) / baseS;
    }
    this.to(s, tx, ty, animate);
  }

  panBy(dx: number, dy: number): void {
    this.to(this.s, this.tx + dx, this.ty + dy, false);
  }

  private clampScale(s: number): number {
    return Math.min(this.max, Math.max(this.min, s));
  }

  private clampPan(s: number, tx: number, ty: number): [number, number] {
    const cw = this.w * s, ch = this.h * s;
    const slackX = this.vw * 0.4, slackY = this.vh * 0.4;
    const minX = Math.min(0, this.vw - cw) - slackX, maxX = Math.max(0, this.vw - cw) + slackX;
    const minY = Math.min(0, this.vh - ch) - slackY, maxY = Math.max(0, this.vh - ch) + slackY;
    return [Math.min(maxX, Math.max(minX, tx)), Math.min(maxY, Math.max(minY, ty))];
  }

  private targetS = 1;
  private targetTx = 0;
  private targetTy = 0;

  to(s: number, tx: number, ty: number, animate: boolean): void {
    [tx, ty] = this.clampPan(s, tx, ty);
    cancelAnimationFrame(this.anim);
    this.anim = 0;
    if (!animate) {
      this.s = s;
      this.tx = tx;
      this.ty = ty;
      this.apply(true);
      return;
    }
    this.targetS = s;
    this.targetTx = tx;
    this.targetTy = ty;
    const from = { s: this.s, tx: this.tx, ty: this.ty };
    const t0 = performance.now();
    const dur = 120;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = easeOut(t);
      this.s = from.s + (s - from.s) * k;
      this.tx = from.tx + (tx - from.tx) * k;
      this.ty = from.ty + (ty - from.ty) * k;
      this.apply(true);
      if (t < 1) this.anim = requestAnimationFrame(step);
      else this.anim = 0;
    };
    this.anim = requestAnimationFrame(step);
  }

  private apply(interactive: boolean): void {
    const c = this.content;
    c.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    if (interactive) {
      c.style.willChange = "transform";
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        c.style.willChange = "auto";
        this.opts.onChange?.(this, false);
      }, 180);
    }
    this.opts.onChange?.(this, interactive);
  }

  setEngaged(on: boolean): void {
    if (this.engaged === on) return;
    this.engaged = on;
    this.viewport.classList.toggle("engaged", on);
    this.opts.onEngageChange?.(on);
  }

  // -------------------------------------------------------------------------
  // Input

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.viewport.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private bind(): void {
    const vp = this.viewport;
    const inline = this.opts.mode === "inline";

    this.listen(vp, "wheel", (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // Pinch (Chromium: ctrl+wheel) or ⌘ + wheel: zoom around the cursor.
        if (this.gestureStart) return;
        e.preventDefault();
        const [px, py] = this.local(e);
        const k = e.ctrlKey && !e.metaKey && Math.abs(dy) < 50 ? 0.01 : 0.002;
        this.zoomBy(Math.exp(-dy * k), px, py);
        if (inline && e.ctrlKey) this.setEngaged(true);
        return;
      }
      if (!inline || e.altKey || this.engaged) {
        e.preventDefault();
        // ⌥ + vertical mouse wheel pans vertically; shift swaps axes as usual.
        this.panBy(-dx, -dy);
      }
      // Otherwise the page scrolls.
    }, { passive: false });

    // WebKit trackpad pinch.
    this.listen(vp, "gesturestart", (e: GestureLike) => {
      e.preventDefault();
      const [x, y] = this.local(e);
      this.gestureStart = { s: this.s, x, y };
      if (inline) this.setEngaged(true);
    }, { passive: false });
    this.listen(vp, "gesturechange", (e: GestureLike) => {
      e.preventDefault();
      if (!this.gestureStart) return;
      const [x, y] = this.local(e);
      // Zoom around where the pinch started, following the fingers' drift.
      this.zoomToAround(this.gestureStart.s * e.scale, x, y, false);
    }, { passive: false });
    this.listen(vp, "gestureend", (e: GestureLike) => {
      e.preventDefault();
      this.gestureStart = null;
    }, { passive: false });

    this.listen(vp, "pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".pz-ignore")) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
    });
    this.listen(window, "pointermove", (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const mx = e.clientX - d.x, my = e.clientY - d.y;
      if (!d.moved && Math.hypot(mx, my) < 3) return;
      if (!d.moved) {
        d.moved = true;
        try {
          vp.setPointerCapture(e.pointerId);
        } catch {
          /* pointer may be gone */
        }
        vp.classList.add("dragging");
        window.getSelection()?.removeAllRanges();
      }
      this.to(this.s, d.tx + mx, d.ty + my, false);
    });
    const endDrag = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      vp.classList.remove("dragging");
      if (d.moved) {
        // Swallow the click that follows a drag.
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    this.listen(window, "pointerup", endDrag);
    this.listen(window, "pointercancel", endDrag);

    this.listen(vp, "dblclick", (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".pz-ignore")) return;
      e.preventDefault();
      if (e.shiftKey && this.opts.onExpand) return this.opts.onExpand();
      if (e.altKey) return this.fit("contain", true);
      const [px, py] = this.local(e);
      this.zoomBy(2, px, py, true);
    });

    this.listen(vp, "pointerleave", () => {
      if (inline && !this.drag) this.setEngaged(false);
    });

    this.listen(vp, "keydown", (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.metaKey || e.ctrlKey) return;
      const step = 60;
      let handled = true;
      switch (e.key) {
        case "+":
        case "=":
          this.zoomBy(1.25, undefined, undefined, true);
          break;
        case "-":
        case "_":
          this.zoomBy(0.8, undefined, undefined, true);
          break;
        case "0":
          this.fit("contain", true);
          break;
        case "1":
          this.actualSize(true);
          break;
        case "ArrowLeft":
          this.to(this.s, this.tx + step, this.ty, true);
          break;
        case "ArrowRight":
          this.to(this.s, this.tx - step, this.ty, true);
          break;
        case "ArrowUp":
          this.to(this.s, this.tx, this.ty + step, true);
          break;
        case "ArrowDown":
          this.to(this.s, this.tx, this.ty - step, true);
          break;
        case " ":
          this.spaceDown = true;
          vp.classList.add("space-pan");
          break;
        case "Escape":
          this.setEngaged(false);
          this.opts.onEscape?.();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.listen(vp, "keyup", (e: KeyboardEvent) => {
      if (e.key === " " && this.spaceDown) {
        this.spaceDown = false;
        vp.classList.remove("space-pan");
      }
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.anim);
    clearTimeout(this.idleTimer);
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

function round(n: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}
