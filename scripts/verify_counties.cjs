/* Exercise lazy loading, real parcel picking, source dates, view changes and retries. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const base = "http://127.0.0.1:8767";
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "8767", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const errors = [], requests = [], missing = [], checks = [];
const pending = new Set();
let browser;

async function makePage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  // Check the fine-layer interactions without terrain on a software GPU.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("t3d"); if (input) { input.checked = false; input.dispatchEvent(new Event("change")); }
  }));
  page.on("pageerror", (e) => { errors.push(e.message); console.error("Page error:", e.message); });
  page.on("console", (m) => { if (m.type() === "error") console.error("Browser error:", m.text()); });
  page.on("request", (r) => { requests.push(r.url()); pending.add(r.url()); });
  page.on("requestfinished", (r) => pending.delete(r.url()));
  page.on("requestfailed", (r) => pending.delete(r.url()));
  page.on("response", (r) => { if (r.status() >= 400) missing.push(r.url()); });
  return page;
}

async function ready(page, snap) {
  try {
    await page.waitForFunction((s) => state.snap === s && map.loaded() && !document.body.classList.contains("busy"), snap,
      { timeout: process.env.COUNTY_DEBUG ? 12000 : 90000 });
  } catch (e) {
    console.error(JSON.stringify(await page.evaluate(() => ({ snap: state.snap, loaded: map.loaded(), busy: document.body.className,
      loading: document.getElementById("loading").textContent, counties: document.getElementById("countyStatus").textContent,
      ticket: countyState.ticket, terrain: !!map.getTerrain(), moving: map.isMoving(), styleDirty: map._styleDirty,
      sourcesDirty: map._sourcesDirty, sources: Object.fromEntries(Object.entries(map.style.sourceCaches).map(([k, v]) =>
        [k, { loaded: v.loaded(), tiles: Object.values(v._tiles).map((t) => t.state) }])) })), null, 2));
    console.error("Pending", [...pending]);
    await page.screenshot({ path: path.join(output, "county-debug.png") });
    throw e;
  }
}

async function search(page, name, source) {
  console.log(`Checking ${name}`);
  await page.fill("#q", name);
  await page.locator("#results button").filter({ hasText: name }).first().click();
  await page.waitForFunction(({ n, ds }) => state.sel?.level === "county" && state.sel.county.properties.n === n &&
    state.sel.county.properties.ds === ds && !map.isMoving() && map.loaded() && countyState.rendered.size > 0 &&
    !document.getElementById("countyStatus").textContent.includes("正在"), { n: name, ds: source });
  const result = await page.evaluate(() => ({ name: state.sel.county.properties.n, id: state.sel.county.id,
    source: state.sel.county.properties.ds, tier: state.sel.county.properties.t, p: state.sel.admin,
    count: countyState.rendered.size, zoom: map.getZoom(), detail: document.getElementById("detail").innerText,
    consistent: [...countyState.rendered.values()].every((f) => f.properties.c === sdNow().country[f.properties.k] &&
      f.properties.b === sdNow().bloc[f.properties.k] && f.properties.col === sdNow().countries[f.properties.c][3]),
    rendered: map.queryRenderedFeatures({ layers: ["county-line"] }).length }));
  assert(result.count > 0 && result.consistent && result.zoom >= 6 && result.rendered > 0);
  assert(result.detail.includes("界线资料年份") && result.detail.includes("实际控制国"));
  checks.push(result);
}

(async () => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--disable-gpu-rasterization", "--disable-accelerated-2d-canvas"] });
  if (process.argv.includes("--terrain-only")) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 740 } });
    const page = await makePage(context);
    await page.goto(base + "/2026.html", { waitUntil: "domcontentloaded" });
    await ready(page, "2026");
    await search(page, "东城区", "china");
    await page.check("#t3d");
    await page.waitForFunction(() => !!map.getTerrain() && map.loaded() && !map.isMoving(), null, { timeout: 120000 });
    const point = await page.evaluate(() => {
      const r = map.getContainer().getBoundingClientRect();
      for (let y = 100; y < r.height - 60; y += 20) for (let x = 350; x < r.width - 360; x += 20) {
        const f = map.queryRenderedFeatures([x, y], { layers: ["county-fill"] })[0];
        if (f) return { x: x + r.left, y: y + r.top, id: f.id };
      }
    });
    assert(point, "Expected a clickable county over the 3D terrain");
    await page.evaluate(() => clearSelection());
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => state.sel?.level === "county" && state.sel.county.id === id, point.id);
    await page.screenshot({ path: path.join(output, "county-3d.png") });
    await page.uncheck("#t3d");
    let slowRequest = 0;
    await page.route(/data\/counties\/2026\//, async (route) => {
      slowRequest++; await new Promise((r) => setTimeout(r, 1200)); await route.continue();
    });
    await page.evaluate(() => { clearSelection(); countyState.chunks.clear(); });
    await page.fill("#q", "西城区");
    await page.locator("#results button").first().click();
    await page.click('#tabs [data-snap="1939-09-01"]');
    await ready(page, "1939-09-01");
    await page.waitForTimeout(1400);
    assert(slowRequest > 0, "The stale-result check must actually request a delayed outline");
    assert.equal(await page.evaluate(() => state.sel?.level === "county"), false);
    assert(await page.evaluate(() => [...countyState.rendered.values()].every((f) => f.properties.ds === "historical")));
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    await context.close();
    console.log("County terrain check passed: county selection and rendering with 3D enabled; delayed county result cannot cross years.");
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await makePage(context);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await ready(page, "1939-09-01");
  await page.waitForFunction(() => document.getElementById("countyStatus").textContent.includes("已收录"));
  assert.equal(requests.filter((u) => /counties\/(1939-09-01|2026)\//.test(u)).length, 0, "World overview should not request county outlines");
  await search(page, "Alameda", "historical");
  assert((await page.locator("#detail").innerText()).includes("1939-09-01"));
  await page.screenshot({ path: path.join(output, "county-1939.png") });
  await page.locator("#detail .crumbs button").nth(1).click();
  await page.waitForFunction(() => state.sel?.level === "province");
  // Click a real county interior using its point inside the loaded outline.
  const point = await page.evaluate(() => {
    for (const f of countyState.rendered.values()) {
      const xy = map.project(f.properties.xy), r = map.getContainer().getBoundingClientRect();
      if (xy.x > 380 && xy.x < r.width - 380 && xy.y > 80 && xy.y < r.height - 80 &&
          map.queryRenderedFeatures(xy, { layers: ["county-fill"] }).some((hit) => hit.id === f.id))
        return { x: xy.x + r.left, y: xy.y + r.top, id: f.id };
    }
  });
  assert(point, "Need a visible real county interior");
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => !document.getElementById("tip").hidden);
  assert((await page.locator("#tip").innerText()).includes("县级"));
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction((id) => state.sel?.level === "county" && state.sel.county.id === id, point.id);
  await page.click('#tabs [data-snap="2026"]');
  await ready(page, "2026");
  await search(page, "东城区", "china");
  const beijingParent = await page.evaluate(() => state.sel.admin);
  await page.screenshot({ path: path.join(output, "county-beijing.png") });
  for (const mode of ["nation", "control", "bloc"]) {
    await page.click(`[data-mode="${mode}"]`);
    await page.waitForFunction((m) => state.mode === m && state.sel?.level === "county" && map.loaded(), mode);
    assert.equal(await page.evaluate(() => state.sel.admin), beijingParent);
    assert((await page.locator("#detail").innerText()).includes("东城区"));
  }
  await page.uncheck("#tLabels");
  assert.equal(await page.evaluate(() => map.getLayoutProperty("county-lbl", "visibility")), "none");
  assert.equal(await page.evaluate(() => map.getLayoutProperty("county-selected-label", "visibility")), "none");
  await page.check("#tLabels");
  await page.uncheck("#tCounties");
  await page.waitForFunction(() => state.sel?.level === "province" && countyState.rendered.size === 0);
  assert.equal(await page.evaluate(() => map.getLayoutProperty("county-line", "visibility")), "none");
  await page.check("#tCounties");
  await search(page, "Los Angeles", "usa");
  await search(page, "Adilabad", "india");
  await search(page, "Fortaleza", "brazil");
  await page.screenshot({ path: path.join(output, "county-brazil.png") });
  // No detail source exists in this part of the map; provinces continue to work.
  await page.evaluate(() => { clearSelection(); map.jumpTo({ center: [139.7, 35.7], zoom: 8 }); });
  await page.waitForFunction(() => document.getElementById("countyStatus").textContent.includes("暂无细分"));
  assert.equal(await page.evaluate(() => countyState.rendered.size), 0);
  // A slow result from 2026 must not restore its county selection after changing year.
  await page.route(/data\/counties\/2026\//, async (route) => {
    await new Promise((r) => setTimeout(r, 700)); await route.continue();
  });
  await page.evaluate(() => countyState.chunks.clear());
  await page.fill("#q", "西城区");
  await page.locator("#results button").first().click();
  await page.click('#tabs [data-snap="1939-09-01"]');
  await ready(page, "1939-09-01");
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => state.sel?.level === "county"), false);
  assert(await page.evaluate(() => [...countyState.rendered.values()].every((f) => f.properties.ds === "historical")));
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await makePage(mobileContext);
  await mobile.goto(base + "/2026.html", { waitUntil: "domcontentloaded" });
  await ready(mobile, "2026");
  await mobile.tap("#toggleSheet");
  await search(mobile, "东城区", "china");
  await mobile.tap("#toggleSheet");
  await mobile.screenshot({ path: path.join(output, "county-mobile.png") });
  const control = mobile.locator(".maplibregl-ctrl-zoom-in");
  const center = await control.evaluate((b) => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  assert(await mobile.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".maplibregl-ctrl-zoom-in"), center));
  await mobileContext.close();

  // A failed outline request leaves the province map usable and offers a real retry.
  const retryContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const retry = await makePage(retryContext); let rejected = false;
  await retry.route(/data\/counties\/2026\//, async (route) => {
    if (!rejected) { rejected = true; await route.abort("failed"); } else await route.continue();
  });
  await retry.goto(base + "/2026.html", { waitUntil: "domcontentloaded" });
  await ready(retry, "2026");
  await retry.evaluate(() => map.jumpTo({ center: [116.4, 39.9], zoom: 9 }));
  await retry.waitForFunction(() => !document.getElementById("countyRetry").hidden);
  assert(await retry.evaluate(() => map.getSource("prov")._data.features.length === 3523));
  await retry.click("#countyRetry");
  await retry.waitForFunction(() => document.getElementById("countyRetry").hidden && countyState.rendered.size > 0);
  await retry.evaluate(() => map.jumpTo({ zoom: 3 }));
  await retry.waitForFunction(() => countyState.rendered.size === 0);
  await retryContext.close();
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  assert(requests.every((u) => !/^https?:/.test(u) || u.startsWith(base)), "Map stays self-contained");
  fs.writeFileSync(path.join(output, "county-checks.json"), JSON.stringify({ checks, errors, missing }, null, 2) + "\n");
  console.log("County checks passed: historical and modern parcels, search, picking, inherited control, mobile, date races and retry.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); server.kill();
});
