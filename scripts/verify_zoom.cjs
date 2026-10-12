/* Real browser checks for cached zooms, atomic county labels and terrain hover. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
const base = "http://127.0.0.1:8770";
const server = spawn("python3", ["-m", "http.server", "8770", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const errors = [], missing = [], checks = [];
let browser;

async function settle(page, snap = "2026") {
  await page.waitForFunction((s) => state.snap === s && map.loaded() && !map.isMoving() &&
    !document.body.classList.contains("busy") && !document.getElementById("countyStatus").textContent.includes("正在"), snap);
}

async function pointInside(page) {
  return page.evaluate(() => {
    const r = map.getContainer().getBoundingClientRect();
    for (let y = 100; y < r.height - 100; y += 10) for (let x = 355; x < r.width - 365; x += 10) {
      const hits = map.queryRenderedFeatures([x, y], { layers: ["county-fill", "city"] });
      const f = hits.find((h) => h.layer.id === "county-fill");
      if (!f || hits.some((h) => h.layer.id === "city")) continue;
      if (Array.from({ length: 11 }, (_, dx) => dx).every((dx) => {
        const more = map.queryRenderedFeatures([x + dx, y], { layers: ["county-fill", "city"] });
        return !more.some((h) => h.layer.id === "city") && more.find((h) => h.layer.id === "county-fill")?.id === f.id;
      })) return { id: f.id, x: x + r.left, y: y + r.top };
    }
  });
}

async function measureReset(page) {
  await page.evaluate(() => { zoomChecks.data = 0; zoomChecks.state = 0; zoomChecks.redraw = 0; zoomChecks.rtt = 0; });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--disable-gpu-rasterization", "--disable-accelerated-2d-canvas"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) missing.push(r.url()); });
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { document.getElementById("t3d").checked = false; }));
  await page.goto(base + "/2026.html", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.click("#countyExplore");
  await page.waitForFunction(() => countyState.displaySnap === "2026" && countyState.rendered.size > 0 && state.sel?.level === "county");
  await settle(page);
  await page.evaluate(() => {
    clearSelection();
    window.zoomChecks = { data: 0, state: 0, redraw: 0, rtt: 0 };
    for (const name of ["counties", "county-selected-label"]) {
      const source = map.getSource(name), original = source.setData;
      source.setData = function(...args) { zoomChecks.data++; return original.apply(this, args); };
    }
    const original = map.setFeatureState;
    map.setFeatureState = function(...args) { zoomChecks.state++; return original.apply(this, args); };
    const redraw = redrawDraped;
    redrawDraped = function(...args) { zoomChecks.redraw++; return redraw(...args); };
  });
  await settle(page);
  await measureReset(page);
  const initialZoom = await page.evaluate(() => map.getZoom());
  const zoomDurations = [];
  console.log("Checking repeated small zooms");
  for (const offset of [.1, 0, .1, 0]) {
    const began = Date.now();
    await page.evaluate((z) => { map.easeTo({ zoom: z, duration: 200 }); }, initialZoom + offset);
    await settle(page);
    zoomDurations.push(Date.now() - began);
  }
  const repeated = await page.evaluate(() => ({ ...zoomChecks }));
  assert.equal(repeated.data, 0, "Small zooms must not resend the same county geometry or label data");
  assert.equal(repeated.state, 0, "Small zooms must not rewrite all parcel states");
  checks.push({ check: "small zooms", repeated, zoomDurations });

  console.log("Checking county display threshold and real wheel zoom");
  await page.evaluate(() => { map.jumpTo({ center: [116.4, 39.9], zoom: 4.7 }); });
  await settle(page);
  await measureReset(page);
  for (const zoom of [4.3, 4.7, 4.3, 4.7]) {
    await page.evaluate((z) => { map.easeTo({ zoom: z, duration: 160 }); }, zoom);
    await settle(page);
    assert(await page.evaluate(() => countyState.rendered.size > 0));
  }
  assert.equal(await page.evaluate(() => zoomChecks.data), 0, "Crossing 4.5 must retain the ready source");
  await page.mouse.move(720, 540);
  const wheelBefore = await page.evaluate(() => map.getZoom());
  for (const delta of [-90, -90]) await page.mouse.wheel(0, delta);
  await settle(page);
  assert(await page.evaluate((z) => map.getZoom() > z, wheelBefore));
  assert(await page.evaluate(() => map.queryRenderedFeatures({ layers: ["county-line"] }).length > 0));
  for (const delta of [90, 90]) await page.mouse.wheel(0, delta);
  await settle(page);
  const labels = await page.evaluate(() => ({
    sameSource: map.getLayer("county-lbl").source === map.getLayer("county-line").source,
    points: map.getSource("counties")._data.features.filter((f) => f.geometry.type === "Point").length,
    polygons: countyState.rendered.size
  }));
  assert(labels.sameSource && labels.points > 0 && labels.polygons > 0);
  checks.push({ check: "threshold and wheel", labels });

  await page.click("#countyExplore");
  await settle(page);
  console.log("Checking consistent terrain hover and clear");
  await page.check("#t3d");
  await settle(page);
  assert(await page.evaluate(() => !!map.getTerrain()));
  await page.evaluate(() => {
    clearSelection();
    const cache = map.terrain.sourceCache, original = cache.freeRtt;
    cache.freeRtt = function(...args) { zoomChecks.rtt++; return original.apply(this, args); };
  });
  await settle(page);
  await measureReset(page);
  const point = await pointInside(page);
  assert(point, "Need a real county interior in the terrain view");
  for (let dx = 0; dx <= 10; dx++) await page.mouse.move(point.x + dx, point.y);
  await page.waitForFunction((id) => countyState.hover === id && !document.getElementById("tip").hidden, point.id);
  await page.waitForTimeout(200);
  const hover = await page.evaluate(() => ({ ...zoomChecks }));
  assert.equal(hover.state, 1, "Moving within the same county changes hover state once");
  assert.equal(hover.rtt, 1, "Moving within the same county redraws terrain once");
  await page.mouse.move(3, 3);
  await page.waitForFunction((id) => countyState.hover === null && !map.getFeatureState({ source: "counties", id }).hov &&
    zoomChecks.rtt > 1 && document.getElementById("tip").hidden, point.id);
  checks.push({ check: "terrain hover", hover });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction((id) => state.sel?.level === "county" && state.sel.county.id === id, point.id);
  const before = await page.evaluate(() => state.sel.county.properties.g);
  await page.evaluate(() => { map.easeTo({ zoom: map.getZoom() - .1, duration: 200 }); });
  await settle(page);
  assert.equal(await page.evaluate(() => state.sel.county.properties.g), before);
  assert(await page.evaluate(() => [...countyState.painted.keys()].some((id) => map.getFeatureState({ source: "counties", id }).sel)));
  await page.screenshot({ path: path.join(output, "zoom-terrain.png") });

  console.log("Checking shared raster cache survives worker transfers");
  const cached = await page.evaluate(async () => {
    const url = "relief://d/6/52/30";
    reliefTiles.delete(url); reliefTileBytes = [...reliefTiles.values()].reduce((n, e) => n + e.bytes, 0);
    let encodes = 0;
    const original = encodeReliefTile;
    encodeReliefTile = (...args) => { encodes++; return original(...args); };
    try {
      const [a, b] = await Promise.all([reliefTile(url), reliefTile(url)]);
      const size = a.byteLength, sig = Array.from(new Uint8Array(b).slice(0, 8));
      structuredClone(a, { transfer: [a] });
      const c = await reliefTile(url);
      return { encodes, size, detached: a.byteLength, retained: c.byteLength,
        identical: sig.join() === Array.from(new Uint8Array(c).slice(0, 8)).join(),
        bytes: reliefTileBytes, entries: reliefTiles.size };
    } finally { encodeReliefTile = original; }
  });
  assert(cached.encodes === 1 && cached.size > 0 && cached.detached === 0 && cached.retained === cached.size && cached.identical);
  assert(cached.bytes <= 12 * 1024 * 1024 && cached.entries <= 128);
  checks.push({ check: "shared raster cache", cached });

  console.log("Checking year transition hides old geometry");
  await page.uncheck("#t3d");
  await settle(page);
  await page.evaluate(() => {
    window.transitionProblems = [];
    const check = () => {
      const visible = map.getLayoutProperty("county-fill", "visibility") === "visible";
      if (visible && countyState.displaySnap !== state.snap) transitionProblems.push("old year visible");
    };
    map.on("render", check);
    // Delay a real worker update: its old tiles are still present while the
    // selected year changes. Old feature IDs must not select new-year rows.
    window.slowProvinceLoads = 0;
    const actor = map.getSource("prov").actor, original = actor.sendAsync;
    window.restoreProvinceActor = () => { actor.sendAsync = original; };
    actor.sendAsync = async function(message, ...args) {
      if (message.type === "LD" && message.data.source === "prov") {
        slowProvinceLoads++; await new Promise((r) => setTimeout(r, 1800));
      }
      return original.call(this, message, ...args);
    };
  });
  const oldPoint = await pointInside(page);
  assert(oldPoint);
  await page.click('#tabs [data-snap="1939-09-01"]');
  await page.waitForFunction(() => state.snap === "1939-09-01" && slowProvinceLoads > 0 && !map.isSourceLoaded("prov"));
  const oldProvince = await page.evaluate(({ x, y }) => {
    const r = map.getContainer().getBoundingClientRect();
    return map.queryRenderedFeatures([x - r.left, y - r.top], { layers: ["prov-fill"] })[0]?.properties.s;
  }, oldPoint);
  assert.equal(oldProvince, "2026", "The stale click test needs an actual previous-year tile");
  await page.mouse.move(oldPoint.x, oldPoint.y);
  await page.mouse.click(oldPoint.x, oldPoint.y);
  assert(await page.evaluate(() => state.sel === null), "A stale province tile cannot select rows of the new year");
  assert(await page.locator("#tip").isHidden());
  await settle(page, "1939-09-01");
  await page.evaluate(() => { restoreProvinceActor(); });
  await page.click("#countyExplore");
  await page.waitForFunction(() => state.sel?.level === "county" && state.sel.county.properties.n === "Alameda" &&
    countyState.displaySnap === "1939-09-01");
  await settle(page, "1939-09-01");
  assert.equal(await page.evaluate(() => state.sel.county.properties.n), "Alameda");
  assert(await page.evaluate(() => countyState.displaySnap === state.snap &&
    [...countyState.rendered.values()].every((f) => f.properties.ds === "historical")));
  await page.click('#tabs [data-snap="2026"]');
  await settle(page);
  assert.deepEqual(await page.evaluate(() => transitionProblems), []);
  checks.push({ check: "year transition", consistent: true });
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  fs.writeFileSync(path.join(output, "zoom-checks.json"), JSON.stringify({ checks, errors, missing }, null, 2) + "\n");
  console.log("Zoom checks passed: cached geometry, wheel zoom, synchronized labels, terrain hover, tile reuse and year transitions.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); server.kill();
});
