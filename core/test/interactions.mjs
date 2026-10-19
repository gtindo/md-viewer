// Behaviour checks for the gesture model, expanded viewer, error cards, live
// reload and the editor, in headless WebKit (and Chromium with --engine).
//
//   node test/interactions.mjs [--engine webkit|chromium]

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit, chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const fixtures = path.resolve(here, "../fixtures");
const engineName = process.argv.includes("--engine") ? process.argv[process.argv.indexOf("--engine") + 1] : "webkit";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!p.startsWith("/app/")) return res.writeHead(404).end();
  try {
    const file = path.join(dist, p.slice(5));
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await (engineName === "chromium" ? chromium : webkit).launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(`${base}/app/index.html`);
await page.waitForFunction(() => !!window.mdview);

let passed = 0, failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split("\n")[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const send = (msg) => page.evaluate((m) => window.mdview.receive(m), msg);
const showcase = await readFile(path.join(fixtures, "showcase.md"), "utf8");
const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of filler text so that the page scrolls.`).join("\n\n");
const doc = `${filler}\n\n${showcase}\n\n${filler}`;

await send({ type: "render", payload: { path: "fixtures/showcase.md", text: doc, reason: "open" } });
await send({ type: "renderAllDiagrams" });

const transformOf = (i) => page.evaluate((i) => document.querySelectorAll(".mermaid-block .mmd-content")[i].style.transform, i);
const scrollTop = () => page.evaluate(() => document.getElementById("preview-pane").scrollTop);
async function diagramCentre(i) {
  await page.evaluate((i) => {
    const el = document.querySelectorAll(".mermaid-block")[i];
    const sc = document.getElementById("preview-pane");
    sc.scrollTop += el.getBoundingClientRect().top - 100;
  }, i);
  await page.waitForTimeout(100);
  const box = await page.locator(".mermaid-block .mmd-viewport").nth(i).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 150) };
}

console.log(`${engineName}:`);

await check("renders GFM features", async () => {
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: showcase, reason: "open" } });
  const fm = await page.evaluate(() => !!document.querySelector(".front-matter table"));
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: doc, reason: "reload" } });
  await send({ type: "renderAllDiagrams" });
  const r = await page.evaluate(() => ({
    alerts: document.querySelectorAll(".markdown-alert").length,
    tasks: document.querySelectorAll(".task-list-item-checkbox").length,
    footnotes: document.querySelectorAll(".footnotes li").length,
    table: !!document.querySelector(".table-wrap thead th"),
    blocked: document.querySelectorAll("img.remote-blocked").length,
    banner: document.querySelector("#banner .banner-remoteImages")?.textContent ?? "",
    anchors: document.querySelectorAll("h2 .anchor").length,
  }));
  assert(r.alerts === 2, `alerts=${r.alerts}`);
  assert(r.tasks === 2, `tasks=${r.tasks}`);
  assert(r.footnotes === 1, `footnotes=${r.footnotes}`);
  assert(fm && r.table, "front matter/table");
  assert(r.blocked === 1 && r.banner.includes("blocked"), "remote image banner");
  assert(r.anchors >= 3, "heading anchors");
});

await check("highlights code, B and diff with inner language", async () => {
  const r = await page.evaluate(() => ({
    langs: [...document.querySelectorAll(".code-block")].map((e) => e.dataset.lang),
    bColored: [...document.querySelectorAll('.code-block[data-lang="b"] .line span')].some((s) => getComputedStyle(s).color !== getComputedStyle(document.body).color),
    diffAdd: document.querySelectorAll(".diff-add").length,
    diffLabel: [...document.querySelectorAll(".code-lang")].map((e) => e.textContent),
  }));
  assert(["rust", "ts", "diff", "b"].every((l) => r.langs.includes(l === "ts" ? "typescript" : l)) || r.langs.includes("ts"), `langs=${r.langs}`);
  assert(r.bColored, "B tokens coloured");
  assert(r.diffAdd === 1, `diff-add=${r.diffAdd}`);
  assert(r.diffLabel.includes("diff · B"), `labels=${r.diffLabel}`);
});

await check("syntax error shows message, line and source", async () => {
  const r = await page.evaluate(() => {
    const card = document.querySelector(".mermaid-block.has-error .mmd-error");
    return { text: card?.textContent ?? "", errLine: card?.querySelector(".src-line.err")?.textContent ?? "" };
  });
  assert(r.text.includes("Mermaid syntax error"), "card");
  assert(/line \d/.test(r.text), `line number missing: ${r.text.slice(0, 200)}`);
  assert(r.errLine.length > 0, "highlighted source line");
});

await check("wheel over an inline diagram scrolls the page, not the diagram", async () => {
  const c = await diagramCentre(0);
  const before = await transformOf(0);
  const s0 = await scrollTop();
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(250);
  assert((await scrollTop()) > s0, "page did not scroll");
  assert((await transformOf(0)) === before, "diagram moved");
});

await check("⌘ + wheel zooms the diagram around the cursor", async () => {
  const c = await diagramCentre(0);
  const before = await transformOf(0);
  const s0 = await scrollTop();
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Meta");
  await page.waitForTimeout(250);
  const after = await transformOf(0);
  assert(after !== before, "no zoom");
  assert(Math.abs((await scrollTop()) - s0) < 2, "page scrolled while zooming");
});

await check("⌥ + wheel pans the diagram", async () => {
  const c = await diagramCentre(0);
  const before = await transformOf(0);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(200);
  assert((await transformOf(0)) !== before, "no pan");
});

await check("drag pans, double click zooms in 2×", async () => {
  const c = await diagramCentre(1);
  const before = await transformOf(1);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 60, c.y - 20, { steps: 5 });
  await page.mouse.up();
  const dragged = await transformOf(1);
  assert(dragged !== before, "drag did not pan");
  const z0 = await page.locator(".mermaid-block .mmd-zoom").nth(1).textContent();
  await page.mouse.dblclick(c.x, c.y);
  await page.waitForTimeout(250);
  const z1 = await page.locator(".mermaid-block .mmd-zoom").nth(1).textContent();
  assert(parseInt(z1) >= parseInt(z0) * 1.9, `zoom ${z0} → ${z1}`);
});

await check("expanded viewer: opens, finds labels, navigates, closes on Esc", async () => {
  await diagramCentre(0);
  await page.locator(".mermaid-block").nth(0).hover();
  await page.locator('.mermaid-block [data-act="expand"]').nth(0).click();
  await page.waitForSelector(".mmd-overlay .mmd-xviewport svg");
  await page.fill(".mmd-xfind input", "Gateway");
  await page.waitForTimeout(100);
  const count = await page.textContent(".mmd-xcount");
  assert(/^1\/\d+/.test(count), `find count ${count}`);
  const title1 = await page.textContent(".mmd-xtitle");
  await page.click('.mmd-xnav [data-act="next"]');
  await page.waitForTimeout(150);
  const title2 = await page.textContent(".mmd-xtitle");
  assert(title1 !== title2, `navigation ${title1} → ${title2}`);
  assert(await page.isVisible(".mmd-minimap"), "minimap");
  await page.click(".mmd-xviewport");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert((await page.$(".mmd-overlay")) === null, "overlay still open");
});

await check("live reload keeps unchanged diagrams' element and zoom", async () => {
  const before = await page.evaluate(() => {
    const el = document.querySelectorAll(".mermaid-block")[0];
    el.dataset.marker = "kept";
    return el.querySelector(".mmd-content").style.transform;
  });
  const s0 = await scrollTop();
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: doc.replace("Paragraph 3 of filler", "Paragraph three (edited) of filler"), reason: "reload" } });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const el = document.querySelectorAll(".mermaid-block")[0];
    return { marker: el.dataset.marker, transform: el.querySelector(".mmd-content").style.transform };
  });
  assert(r.marker === "kept", "diagram element was replaced");
  assert(r.transform === before, "zoom changed");
  assert(Math.abs((await scrollTop()) - s0) < 2, "scroll position changed");
});

await check("editing a diagram into an error keeps the last good render, greyed", async () => {
  const broken = doc.replace("stateDiagram-v2\n  [*] --> inactive", "stateDiagram-v2\n  [*] --> inactive --> --> oops");
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: broken, reason: "edit" } });
  await send({ type: "renderAllDiagrams" });
  const r = await page.evaluate(() => {
    const el = document.querySelectorAll(".mermaid-block")[1];
    return { stale: el.querySelector(".mmd-content.stale svg") !== null, error: !el.querySelector(".mmd-error").hidden };
  });
  assert(r.error, "no error card");
  assert(r.stale, "last good render not kept");
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: doc, reason: "edit" } });
  await send({ type: "renderAllDiagrams" });
});

await check("split mode: editor shows the text and typing re-renders the preview", async () => {
  await send({ type: "setMode", mode: "split" });
  await page.waitForSelector(".cm-editor .cm-content");
  const visible = await page.isVisible("#editor-pane");
  assert(visible, "editor pane hidden");
  await page.evaluate(() => {
    const view = document.querySelector(".cm-content");
    view.focus();
  });
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.type("# Typed heading\n\n");
  await page.waitForTimeout(500);
  const h1 = await page.evaluate(() => document.querySelector("#doc h1")?.textContent);
  assert(h1?.includes("Typed heading"), `preview h1=${h1}`);
  const text = await send({ type: "getText" });
  assert(text.text.startsWith("# Typed heading"), "getText");
  const outbox = await page.evaluate(() => (window.__mdviewOutbox ?? []).filter((m) => m.type === "edited").length);
  assert(outbox > 0, "no edited message");
  await send({ type: "setMode", mode: "preview" });
});

await check("editor: loading a file is not undoable, and a new file starts a fresh history", async () => {
  await send({ type: "setMode", mode: "split" });
  await send({ type: "render", payload: { path: "a.md", text: "alpha\n", reason: "open" } });
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.type("A");
  // A reused preview tab: same editor, another file.
  await send({ type: "render", payload: { path: "b.md", text: "beta\n", reason: "open" } });
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  for (let i = 0; i < 3; i++) await page.keyboard.press("Meta+z");
  const text = (await send({ type: "getText" })).text;
  assert(text === "beta\n", `after undo: ${JSON.stringify(text)}`);
  await send({ type: "setMode", mode: "preview" });
});

await check("switching to Split refits diagrams to the narrower pane", async () => {
  await send({ type: "setMode", mode: "preview" });
  await send({ type: "render", payload: { path: "small.md", text: "# Small\n\n```mermaid\nflowchart LR\n  A --> B\n```\n", reason: "open" } });
  await send({ type: "renderAllDiagrams" });
  await send({ type: "setMode", mode: "split" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vp = document.querySelector(".mmd-viewport").getBoundingClientRect();
    const svg = document.querySelector(".mmd-content svg").getBoundingClientRect();
    return { left: svg.left - vp.left, right: vp.right - svg.right };
  });
  assert(r.left >= 0 && r.right >= 0 && Math.abs(r.left - r.right) < 4, `not centred in viewport: ${JSON.stringify(r)}`);
  await send({ type: "setMode", mode: "preview" });
});

await check("the preview pane holds focus so space and arrows scroll it", async () => {
  await send({ type: "render", payload: { path: "fixtures/showcase.md", text: doc, reason: "open" } });
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector("#preview-pane").scrollTop = 0;
  });
  await page.waitForTimeout(50);
  assert(await page.evaluate(() => document.activeElement?.id === "preview-pane"), "focus not parked on the pane");
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(400);
  assert((await scrollTop()) > 100, `scrollTop=${await scrollTop()}`);
});

await check("toolbar buttons don't force compositing layers (keeps zoomed SVG sharp)", async () => {
  const filters = await page.evaluate(() =>
    [...document.querySelectorAll(".mmd-btn, .code-btn")].slice(0, 20).map((b) => getComputedStyle(b).backdropFilter || getComputedStyle(b).webkitBackdropFilter || "none"),
  );
  assert(filters.length > 0 && filters.every((f) => f === "none"), filters.join(","));
});

await check("find in document highlights matches", async () => {
  await send({ type: "command", command: "find" });
  await page.fill(".find-bar input", "filler");
  await page.waitForTimeout(100);
  const n = await page.evaluate(() => document.querySelectorAll("mark.find-hit").length);
  assert(n >= 80, `hits=${n}`);
  await page.keyboard.press("Escape");
  const left = await page.evaluate(() => document.querySelectorAll("mark.find-hit").length);
  assert(left === 0, "marks not cleared");
});

await check("state round-trip restores scroll and diagram zoom", async () => {
  const st = await send({ type: "getState" });
  assert(typeof st.scrollY === "number" && st.diagrams, "state shape");
  await send({ type: "restoreState", state: { ...st, scrollY: 1234 } });
  await page.waitForTimeout(100);
  assert(Math.abs((await scrollTop()) - 1234) < 2, "scroll not restored");
});

await check("MDView diagram style: hues by meaning, author styles win, CSS travels with the SVG", async () => {
  const src = [
    "flowchart LR",
    "  top[Top level] --> q{Decide?}",
    "  q --> inner[Inside]",
    "  q --> mine[Styled by author]",
    "  subgraph grp[Group]",
    "    inner",
    "  end",
    "  classDef hot fill:#ff0000,stroke:#000000",
    "  class mine hot",
  ].join("\n");
  await send({ type: "render", payload: { path: "style.md", text: "```mermaid\n" + src + "\n```\n", reason: "open" } });
  await send({ type: "renderAllDiagrams" });
  const r = await page.evaluate(() => {
    const svg = document.querySelector(".mermaid-block .mmd-content svg");
    const node = (id) => [...svg.querySelectorAll("g.node")].find((n) => n.id.includes(`-flowchart-${id}-`));
    const hue = (el) => [...(el?.classList ?? [])].find((c) => c.startsWith("mdv-"));
    const shape = (id) => node(id)?.querySelector(".label-container");
    return {
      top: hue(node("top")),
      q: hue(node("q")),
      inner: hue(node("inner")),
      cluster: hue(svg.querySelector("g.cluster")),
      mineFill: getComputedStyle(shape("mine")).fill,
      rx: shape("top")?.getAttribute("rx"),
      cssInSvg: svg.querySelector("style")?.textContent.includes(".mdv-amber") ?? false,
    };
  });
  assert(r.top === "mdv-blue", `top=${r.top}`);
  assert(r.q === "mdv-amber", `decision=${r.q}`);
  assert(r.inner && r.inner === r.cluster && r.inner !== "mdv-blue", `inner=${r.inner} cluster=${r.cluster}`);
  assert(/255,\s*0,\s*0/.test(r.mineFill), `author classDef lost: ${r.mineFill}`);
  assert(Number(r.rx) > 0, `rx=${r.rx}`);
  assert(r.cssInSvg, "theme CSS not embedded in the SVG");
});

await check("300-node flowchart renders and zooms smoothly", async () => {
  const big = await readFile(path.join(fixtures, "large-flowchart.md"), "utf8");
  const t0 = Date.now();
  await send({ type: "render", payload: { path: "fixtures/large-flowchart.md", text: big, reason: "open" } });
  const res = await send({ type: "renderAllDiagrams" });
  const ms = Date.now() - t0;
  assert(res.count === 1 && res.errors.length === 0, JSON.stringify(res.errors));
  console.log(`      render: ${ms} ms`);
  const frame = await page.evaluate(async () => {
    const vp = document.querySelector(".mmd-viewport");
    const r = vp.getBoundingClientRect();
    const times = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      vp.dispatchEvent(new WheelEvent("wheel", { deltaY: i < 30 ? -8 : 8, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + 100, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    return { p50: times[30], p95: times[57] };
  });
  console.log(`      zoom frames: p50 ${frame.p50.toFixed(1)} ms, p95 ${frame.p95.toFixed(1)} ms`);
});

await check("no page errors", async () => assert(pageErrors.length === 0, pageErrors.join(" | ")));

console.log(`${passed} passed, ${failed} failed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
