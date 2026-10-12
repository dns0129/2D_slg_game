/* Real-browser checks for the copied map's data, views, zoom, pan and panels. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "8766", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const base = "http://127.0.0.1:8766";
const errors = [], external = [], missing = [], checks = [];
const mobileOnly = process.argv.includes("--mobile-only");
let browser;

async function ready(page, scenario) {
  await page.waitForFunction((key) => typeof state !== "undefined" && state.snap === key &&
    typeof map !== "undefined" && map.loaded() && !document.body.classList.contains("busy"), scenario, { timeout: 90000 });
}

function watch(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("request", (req) => { if (/^https?:/.test(req.url()) && !req.url().startsWith(base)) external.push(req.url()); });
  page.on("response", (res) => { if (res.status() >= 400) missing.push(res.url()); });
}

async function inspect(page, key, pieces) {
  await ready(page, key);
  const result = await page.evaluate(() => ({
    scenario: state.snap,
    count: map.getSource("prov")._data.features.length,
    controllers: sdNow().countries.length,
    tabs: [...document.querySelectorAll("#tabs button")].map((b) => b.dataset.snap),
    modes: [...document.querySelectorAll("[data-mode]")].map((b) => b.dataset.mode),
    visible: map.queryRenderedFeatures({ layers: ["prov-fill"] }).length,
    loading: document.getElementById("loading").hidden,
    valid: map.getSource("prov")._data.features.every((f) => f.geometry.coordinates.length > 0)
  }));
  assert.equal(result.count, pieces);
  assert.deepEqual(result.tabs, ["1939-09-01", "2026"]);
  assert.deepEqual(result.modes, ["bloc", "nation", "control"]);
  assert(result.visible > 0 && result.valid && result.loading);
  checks.push(result);
  console.log(`Rendered ${key}: ${pieces} pieces`);
}

(async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  if (!mobileOnly) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    watch(page);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await inspect(page, "1939-09-01", 1350);
    await page.screenshot({ path: path.join(output, "1939.png") });
    // Boundary reading starts in 2D; terrain remains available as a separate style.
    assert.equal(await page.isChecked("#t3d"), false);
    await page.uncheck("#t3d");
    for (const mode of ["nation", "control", "bloc"]) {
      console.log(`Checking view ${mode}`);
      await page.click(`[data-mode="${mode}"]`);
      await page.waitForFunction((m) => state.mode === m && map.loaded(), mode);
      assert.equal(await page.getAttribute(`[data-mode="${mode}"]`, "aria-pressed"), "true");
    }
    console.log("Checking country / province clicks");
    // Choose a visible province by querying real map pixels, then click twice.
    const point = await page.evaluate(() => {
      for (let y = 160; y < 600; y += 30) for (let x = 450; x < 1050; x += 30) {
        if (map.queryRenderedFeatures([x, y], { layers: ["prov-fill"] }).length) {
          const r = map.getContainer().getBoundingClientRect(); return { x: r.left + x, y: r.top + y };
        }
      }
    });
    assert(point, "Expected a visible land parcel");
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => state.sel?.level === "country");
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => state.sel?.level === "province");
    assert(await page.locator("#detail").isVisible());
    await page.locator('#detail [aria-label="关闭"]').click();
    const beforeZoom = await page.evaluate(() => map.getZoom());
    console.log("Checking wheel zoom and drag");
    await page.mouse.move(820, 500);
    await page.mouse.wheel(0, -450);
    await page.waitForFunction((z) => map.getZoom() > z + 0.1 && !map.isMoving(), beforeZoom);
    const beforePan = await page.evaluate(() => map.getCenter().toArray());
    await page.mouse.move(840, 520);
    await page.mouse.down();
    await page.mouse.move(940, 580, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => !map.isMoving());
    const afterPan = await page.evaluate(() => map.getCenter().toArray());
    assert(Math.abs(afterPan[0] - beforePan[0]) > 0.1, "Dragging should pan the map");
    await page.click('#tabs [data-snap="2026"]');
    console.log("Checking 2026, search and white basemap");
    await inspect(page, "2026", 3523);
    await page.fill("#q", "北海道");
    await page.locator("#results button").first().click();
    await page.waitForFunction(() => state.sel?.level === "province" && !map.isMoving());
    assert((await page.locator("#detail").innerText()).includes("北海道"));
    await page.click('[data-mode="control"]');
    await page.click('[data-base="white"]');
    await page.waitForFunction(() => state.base === "white" && state.mode === "control" && map.loaded());
    assert.equal(await page.evaluate(() => map.getLayoutProperty("ctrl-line", "visibility")), "visible");
    assert.equal(await page.evaluate(() => map.getLayoutProperty("unit-line", "visibility")), "none");
    await page.screenshot({ path: path.join(output, "2026.png") });
    await page.click('#tabs [data-snap="1939-09-01"]');
    await inspect(page, "1939-09-01", 1350);
    assert.equal(await page.inputValue("#q"), "");
    // Independent entry page, unsupported old hash fallback, and mobile controls.
    await page.goto(`${base}/2026.html#1942-11-01/control`, { waitUntil: "domcontentloaded" });
    console.log("Checking direct entry and unsupported hash fallback");
    await inspect(page, "2026", 3523);
    assert.equal(await page.evaluate(() => state.mode), "control");
    await context.close();
  }
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  console.log("Checking mobile layout and touch controls");
  watch(mobile);
  await mobile.goto(`${base}/1939-09-01.html`, { waitUntil: "domcontentloaded" });
  await inspect(mobile, "1939-09-01", 1350);
  assert.equal(await mobile.getAttribute("#toggleSheet", "aria-expanded"), "false");
  await mobile.tap("#toggleSheet");
  await mobile.tap('[data-mode="control"]');
  // As on desktop, check 2D interactions without software-rendered terrain.
  await mobile.uncheck("#t3d");
  await mobile.tap("#toggleSheet");
  await mobile.tap('#tabs [data-snap="2026"]');
  await inspect(mobile, "2026", 3523);
  const mobileZoom = await mobile.evaluate(() => map.getZoom());
  await mobile.tap(".maplibregl-ctrl-zoom-in");
  await mobile.waitForFunction((z) => map.getZoom() > z && !map.isMoving(), mobileZoom);
  await mobile.tap("#toggleSheet");
  const expandedZoom = await mobile.evaluate(() => map.getZoom());
  await mobile.tap(".maplibregl-ctrl-zoom-in");
  await mobile.waitForFunction((z) => map.getZoom() > z && !map.isMoving(), expandedZoom);
  await mobile.tap("#toggleSheet");
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
  await mobile.screenshot({ path: path.join(output, "mobile.png") });
  assert.deepEqual(external, [], "Map should load without external services");
  assert.deepEqual(missing, [], "Every requested asset should exist");
  assert.deepEqual(errors, [], "No browser or map engine errors expected");
  fs.rmSync(path.join(output, "browser-failure.json"), { force: true });
  fs.writeFileSync(path.join(output, "browser-checks.json"), JSON.stringify({ scope: mobileOnly ? "mobile" : "desktop and mobile", checks, errors, external, missing }, null, 2));
  console.log(mobileOnly ? "Mobile checks passed: both years, panel states and touch zoom." :
    "Browser checks passed: both years, all views, parcel selection, wheel zoom, pan, search, direct pages and mobile.");
})().catch((e) => {
  fs.writeFileSync(path.join(output, "browser-failure.json"), JSON.stringify({ error: e.stack, errors, external, missing }, null, 2));
  console.error(e);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  server.kill();
});
