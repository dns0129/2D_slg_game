/* Check the actual visible space, reachable controls and reversible map styles. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "test-results");
const base = "http://127.0.0.1:8771";
const server = spawn("python3", ["-m", "http.server", "8771", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const errors = [], checks = [];
let browser;

async function settle(page) {
  await page.waitForFunction(() => typeof state !== "undefined" && state.snap === "2026" && map.loaded() &&
    !map.isMoving() && !document.body.classList.contains("busy") &&
    !document.getElementById("countyStatus").textContent.includes("正在"));
}

async function selectedFits(page) {
  const result = await page.evaluate(() => {
    const p = readingPadding(), r = map.getContainer().getBoundingClientRect();
    const bounds = geoBounds(state.sel.county.geometry.coordinates);
    const points = [map.project(bounds[0]), map.project(bounds[1])];
    return { padding: p, width: r.width, height: r.height,
      fits: points.every((v) => v.x >= p.left - 3 && v.x <= r.width - p.right + 3 &&
        v.y >= p.top - 3 && v.y <= r.height - p.bottom + 3) };
  });
  assert(result.fits, `Selected county should fit outside panels: ${JSON.stringify(result)}`);
  return result;
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
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await desktop.newPage(); page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + "/2026.html", { waitUntil: "domcontentloaded" }); await settle(page);
  assert.equal(await page.isChecked("#t3d"), false);
  assert.equal(await page.evaluate(() => map.getPitch()), 0);
  await page.click("#countyExplore");
  await page.waitForFunction(() => state.sel?.level === "county" && countyState.displaySnap === state.snap);
  await settle(page);
  assert.equal(await page.evaluate(() => state.sel?.county.properties.n), "东城区");
  checks.push({ check: "desktop fit", ...await selectedFits(page) });
  await page.screenshot({ path: path.join(output, "presentation-desktop.png") });
  const selected = await page.evaluate(() => state.sel.county.properties.g);
  await page.click("#focusMap");
  assert.equal(await page.locator("#controls").isVisible(), false);
  assert.equal(await page.locator("#detail").isVisible(), false);
  await page.click("#locateSelection"); await settle(page);
  checks.push({ check: "focus fit", ...await selectedFits(page) });
  await page.click("#focusMap");
  assert.equal(await page.locator("#detail").isVisible(), true);
  assert.equal(await page.evaluate(() => state.sel.county.properties.g), selected);
  await page.click('[data-base="relief"]'); await settle(page);
  assert(await page.evaluate(() => !!map.getTerrain() && map.getPitch() > 0));
  assert.equal(await page.evaluate(() => map.getLayoutProperty("hillshade", "visibility")), "visible");
  await page.click('[data-base="white"]'); await settle(page);
  await page.waitForFunction(() => !map.getTerrain());
  const planar = await page.evaluate(() => ({ terrain: !!map.getTerrain(), pitch: map.getPitch(), moving: map.isMoving() }));
  assert(!planar.terrain && Math.abs(planar.pitch) < .01, JSON.stringify(planar));
  assert.equal(await page.evaluate(() => state.sel.county.properties.g), selected);
  // Switching style while a camera animation runs must wait for terrain cleanup
  // and leave the map capable of another movement.
  await page.click('[data-base="relief"]'); await settle(page);
  await page.evaluate(() => {
    map.easeTo({ zoom: map.getZoom() - .2, duration: 350 }); setMapStyle("white");
  });
  await page.waitForFunction(() => !map.getTerrain() && !map.isMoving() && map.loaded());
  const beforeMove = await page.evaluate(() => map.getCenter().lng);
  await page.evaluate(() => { const c = map.getCenter(); map.easeTo({ center: [c.lng + .02, c.lat], duration: 150 }); });
  await settle(page);
  assert(await page.evaluate((lng) => map.getCenter().lng > lng + .01, beforeMove));
  assert.equal(await page.evaluate(() => state.sel.county.properties.g), selected);
  await page.click('#tabs [data-snap="1939-09-01"]');
  await page.waitForFunction(() => state.snap === "1939-09-01" && map.loaded() && !document.body.classList.contains("busy"));
  await page.click("#countyExplore");
  await page.waitForFunction(() => state.sel?.level === "county" && !map.isMoving() && map.loaded());
  await selectedFits(page);
  await page.click("#worldView");
  await page.waitForFunction(() => !state.sel && !map.isMoving() && map.loaded());
  assert.equal(await page.locator("#detail").isVisible(), false);
  assert.equal(await page.locator("#locateSelection").isDisabled(), true);
  await page.screenshot({ path: path.join(output, "presentation-world.png") });
  checks.push({ check: "both years, focus restore, terrain and home", passed: true });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    reducedMotion: "reduce" });
  const phone = await mobile.newPage(); phone.setDefaultTimeout(120000);
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/2026.html", { waitUntil: "domcontentloaded" }); await settle(phone);
  await phone.tap("#countyExplore");
  await phone.waitForFunction(() => state.sel?.level === "county" && countyState.displaySnap === state.snap);
  await settle(phone);
  checks.push({ check: "mobile fit", ...await selectedFits(phone) });
  assert.equal(await phone.locator("#detail").evaluate((e) => e.getBoundingClientRect().height < 180), true);
  const toggle = phone.locator(".detail-toggle");
  await toggle.tap(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await toggle.tap(); assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await phone.screenshot({ path: path.join(output, "presentation-mobile.png") });
  for (const selector of ["#worldView", "#locateSelection", "#focusMap", "#toggleSheet", ".maplibregl-ctrl-zoom-in", '#detail [aria-label="关闭"]']) {
    const reachable = await phone.locator(selector).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert(reachable, `Mobile control must be reachable: ${selector}`);
  }
  await phone.tap("#toggleSheet");
  await phone.fill("#q", "no-such-county-12345");
  await phone.locator("#searchStatus").waitFor({ state: "visible" });
  await phone.fill("#q", "东城区");
  await phone.locator("#results button").first().waitFor();
  await phone.press("#q", "ArrowDown");
  assert.equal(await phone.locator("#results button").first().evaluate((e) => e === document.activeElement), true);
  await phone.keyboard.press("Enter"); await settle(phone);
  assert.equal(await phone.getAttribute("#toggleSheet", "aria-expanded"), "false");
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.tap("#locateSelection"); await settle(phone);
  await selectedFits(phone);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 844);
  checks.push({ check: "mobile cards, touch, keyboard search, reduced motion and landscape", passed: true });
  assert.deepEqual(errors, []);
  fs.rmSync(path.join(output, "presentation-failure.json"), { force: true });
  fs.writeFileSync(path.join(output, "presentation-checks.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log("Presentation checks passed: real county fits, mobile controls, focus, styles, both years and search.");
})().catch((e) => {
  fs.writeFileSync(path.join(output, "presentation-failure.json"), JSON.stringify({ error: e.stack, checks, errors }, null, 2));
  console.error(e); process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); server.kill(); });
