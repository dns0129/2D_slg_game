const SCENARIOS = ["1939-09-01", "2026"];
const DEFAULT_SNAPSHOT = document.documentElement.dataset.scenario || SCENARIOS[0];
const MODES = ["bloc", "nation", "control"];
const BLOCS = ["allied", "axis", "neutral", "contested"];
const BLOC_ZH = { allied: "同盟国一方", axis: "轴心国一方", neutral: "中立 / 维希", contested: "前线争夺" };
const BLOC_COLOR = { allied: "#2a78d6", axis: "#eb6834", neutral: "#b8b5a8", contested: "#1baf7a" };
const STATUS_ZH = { independent: "独立国", colony: "殖民地", protectorate: "保护国", mandate: "委任统治地", occupied: "被占领地区",
  dependency: "属地", disputed: "地位有争议", part: "特别行政区", "N/A": "—" };
const TYPE_ZH = {
  independent: "本国统治", colony: "殖民统治", protectorate: "保护国", mandate: "委任统治", occupied: "军事占领",
  military_occupation: "军事占领", annexation: "吞并", partition: "瓜分", client_state: "傀儡 / 附庸政权",
  collaborationist_state: "合作政权（维希）", allied_occupation: "盟军占领", front_line: "前线争夺", besieged: "被围",
  resistance_base: "抗日根据地", leased_territory: "租借地", surrendering_forces: "待受降", defense_agreement: "按防务协定驻军",
  free_french: "自由法国", satellite_state: "卫星国", liberated: "已解放", military_intervention: "军事干预",
  dependency: "属地", control: "实际控制", de_facto_state: "自立政权 / 未获普遍承认的政权", contested: "交战区",
  international_administration: "国际管理", civil_war: "内战一方控制区", autonomy: "事实自治", "N/A": "—"
};
const TIER = { 3: ["省级", "#3f9a83"], 4: ["大区级（无省级资料）", "#a9d2bd"], 5: ["整个国家 / 殖民地（无下级资料）", "#d8cfbd"], 6: ["岛屿属地", "#e2b65b"] };
const BASIS_ZH = {
  historical_dated: "历史界线（按施行日期）", ohm_dated: "历史界线（OpenHistoricalMap，按施行日期）",
  historical_1930: "历史界线（1930）", historical_1931: "历史界线（1931）", historical_1935: "历史界线（1935）",
  historical_1939: "历史界线（1939）", historical_1940: "历史界线（1940）", historical_1941: "历史界线（1941）",
  historical_1928_1945: "历史界线（1928–1945）", reconstructed_1914_1926: "据 1914–26 年地点资料重建",
  historical_1897: "1897 年人口普查的省界（据约 1914 年的地图描绘，沿用至 1918 年）",
  present_day_outline_same_unit: "当时的单位，轮廓取自今日数据（界线基本未变）", historical_unit: "当日的国家 / 殖民地轮廓",
  merged_subunits: "由当时的下级区划合并而成（外界即这些区划的历史界线）",
  present_day_admin1: "当今一级行政区（Natural Earth 1:1000 万，约 2020 年前后的划分）",
  reconstructed_from_1928_outlines: "据 1928–45 年省界复原（合并或拆分为当时的省份）",
  historical_1941_outline: "1941 年的界线，按 1930 年代的归属分组",
  reconstructed_from_present_day_counties: "由今日的县拼合复原（界线随今日县界，属近似）",
  present_day_outline_merged: "当时的单位，轮廓为其后来分出的今日各单位之和",
  present_day_outline_less_later: "当时的单位，轮廓为今日单位减去后来并入的县区（分界近似）"
};
// The map keeps its own palette in either page theme: a pale physical map, or a white one.
const BASE = {
  relief: { sea: "#d4e4ee", lake: "#b2d3ea", river: "#2b7cc4", riverInk: "#1d5f9c", shade: 0.55, sky: "#b9d0e2", horizon: "#e4edf1",
    relief: { "raster-saturation": 0, "raster-contrast": 0, "raster-brightness-min": 0, "raster-brightness-max": 1 },
    fill: { bloc: 0.52, nation: 0.6, control: 0.66 } },
  white: { sea: "#fdfdfc", lake: "#d3e5f1", river: "#3a89cc", riverInk: "#225e94", shade: 0.3, sky: "#e8eef2", horizon: "#fbfbfa",
    relief: { "raster-saturation": -1, "raster-contrast": -0.5, "raster-brightness-min": 0.86, "raster-brightness-max": 1 },
    fill: { bloc: 0.42, nation: 0.5, control: 0.56 } },
};
const INK = "#1b2220", INK2 = "#4f5955", HALO = "rgba(250,251,248,0.92)";
const LABEL_PX = 12;
const blocName = (sd, b) => (sd.bloc_names || BLOC_ZH)[b];
const isModern = (sd) => sd.snapshot === "2026";        // country names: the small serif lettering, the same at every zoom

// outlines arrive per snapshot (data/geo-<date>.bin) and are kept by their global index: pieces cut from a
// province (geo), province outlines (adminGeo), CShapes units (units); a snapshot's control areas stay on it (ctrlGeo)
const state = { snap: null, mode: "bloc", base: "relief", data: {}, geo: [], adminGeo: [], units: [], loading: 0, userPitch: false, pitchEasing: false, seenPitch: null, selPainted: new Map(), selLines: {}, dropTerrain: false,
  admin: null, hydro: null, hydroDetail: null, sel: null, hover: null };
const geoOf = (f) => state.geo[f] || state.adminGeo[state.admin.feature_admin[f]];  // a whole province is drawn with its outline
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + " 亿" : n >= 1e4 ? (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + " 万" : String(Math.round(n));
const km2 = (a) => Math.round(a).toLocaleString() + " km²";
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

function decodeGeo(buf) {
  const b = new Uint8Array(buf); let i = 0; const out = [];
  const v = () => { let r = 0, s = 0, c; do { c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; };
  const z = () => { const n = v(); return (n % 2) ? -(n + 1) / 2 : n / 2; };
  while (i < b.length) {
    const np = v(); const polys = []; let px = 0, py = 0;
    for (let p = 0; p < np; p++) {
      const nr = v(); const rings = [];
      for (let r = 0; r < nr; r++) {
        const n = v(); const ring = new Array(n + 1);
        for (let k = 0; k < n; k++) { px += z(); py += z(); ring[k] = [px / 1000, py / 1000]; }
        ring[n] = ring[0]; rings.push(ring);
      }
      polys.push(rings);
    }
    out.push(polys);
  }
  return out;
}

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }
async function getBin(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(u + " " + r.status);
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return b[0] === 0x1f && b[1] === 0x8b ? inflate(buf) : buf;
}
async function inflate(buf) {
  if (typeof DecompressionStream === "undefined") {  // older browsers: the bundled pako, loaded only then
    if (!window.pako) await new Promise((ok, no) => { const sc = document.createElement("script");
      sc.src = "vendor/pako.min.js"; sc.onload = ok; sc.onerror = no; document.head.append(sc); });
    return window.pako.ungzip(new Uint8Array(buf)).buffer;
  }
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
async function getPacked(u) { return JSON.parse(new TextDecoder().decode(await getBin(u))); }

// ------------------------------------------------------------------ relief tiles and glyphs
// The relief ships as 2048-pixel WebP sheets per zoom level; tiles are cut from them here. The elevation
// sheets (d…) are decoded without colour conversion, since their pixels are numbers (Terrarium encoding).
const sheets = new Map();
function sheet(name) {
  if (sheets.has(name)) { const p = sheets.get(name); sheets.delete(name); sheets.set(name, p); return p; }
  const p = fetch(`data/relief/${name}.webp`).then((r) => { if (!r.ok) throw new Error(name); return r.blob(); })
    .then((b) => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
  p.catch(() => sheets.delete(name));
  sheets.set(name, p);
  while (sheets.size > 24) sheets.delete(sheets.keys().next().value);
  return p;
}
const canvas256 = () => typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
const toPng = async (c) => (c.convertToBlob ? await c.convertToBlob({ type: "image/png" }) : await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer();
let flatDem = null;  // open sea has no elevation sheet: 0 m everywhere
function flatTile() {
  if (!flatDem) { const c = canvas256(); const g = c.getContext("2d"); g.fillStyle = "rgb(128,0,0)"; g.fillRect(0, 0, 256, 256); flatDem = toPng(c); }
  return flatDem;
}
// The DEM and hillshade sources ask for the same tiles. Share PNG work, and retain
// a bounded copy for zooming back; a returned buffer may be transferred to a worker.
const reliefTiles = new Map();
let reliefTileBytes = 0;
function trimReliefTiles() {
  while (reliefTiles.size > 128 || reliefTileBytes > 12 * 1024 * 1024) {
    const key = reliefTiles.keys().next().value;
    reliefTileBytes -= reliefTiles.get(key).bytes; reliefTiles.delete(key);
  }
}
async function encodeReliefTile(url) {
  const [, set, z, x, y] = /^relief:\/\/(\w)\/(\d+)\/(\d+)\/(\d+)/.exec(url).map((v, i) => i > 1 ? +v : v);
  const per = 8, i = Math.floor(x / per), j = Math.floor(y / per);
  let bmp;
  try { bmp = await sheet(`${set}${z}_${i}_${j}`); } catch (e) { if (set === "d") return flatTile(); throw e; }
  const c = canvas256(), g = c.getContext("2d"); g.imageSmoothingEnabled = false;
  g.drawImage(bmp, (x - i * per) * 256, (y - j * per) * 256, 256, 256, 0, 0, 256, 256);
  return toPng(c);
}
async function reliefTile(url) {
  let entry = reliefTiles.get(url);
  if (entry) { reliefTiles.delete(url); reliefTiles.set(url, entry); }
  else {
    entry = { bytes: 0, promise: null };
    entry.promise = encodeReliefTile(url).then((data) => {
      if (reliefTiles.get(url) === entry) { entry.bytes = data.byteLength; reliefTileBytes += entry.bytes; trimReliefTiles(); }
      return data;
    }, (error) => {
      if (reliefTiles.get(url) === entry) reliefTiles.delete(url);
      throw error;
    });
    reliefTiles.set(url, entry); trimReliefTiles();
  }
  return (await entry.promise).slice(0);
}
function registerProtocols() {
  maplibregl.addProtocol("relief", async (params, controller) => {
    if (controller?.signal.aborted) throw new DOMException("Tile request aborted", "AbortError");
    const data = await reliefTile(params.url);
    if (controller?.signal.aborted) throw new DOMException("Tile request aborted", "AbortError");
    return { data };
  });
  // Chinese characters are drawn by the browser itself (localIdeographFontFamily); Latin and
  // Cyrillic province names use the few glyph ranges shipped in data/glyphs/sans
  maplibregl.addProtocol("glyph", async (params) => {
    const range = /\/(\d+-\d+)$/.exec(params.url)[1];
    try { return { data: await getBin(`data/glyphs/sans/${range}.pbf`) }; } catch (e) { return { data: new ArrayBuffer(0) }; }
  });
}

function col(name, ai) { const c = state.admin.cols[name]; return c.lut[c.idx[ai]]; }
function adminName(ai) { return col("name_zh", ai) || col("name", ai); }
function kindLabel(ai) {
  const k = col("kind", ai); if (!k) return null;
  const m = /^admin_level (\d)$/.exec(k); return m ? `第 ${m[1]} 级行政区（OpenHistoricalMap 分级）` : k;
}
const sdNow = () => state.data[state.snap];
const L = (sd, c, k) => sd.luts[c][sd.rows[c][k]];
const country = (sd, ci) => { const c = sd.countries[ci]; return { key: c[0], zh: c[1], en: c[2], color: c[3], bloc: c[4], pop: c[5], area: c[6], nprov: c[7], geo: c[8], comp: c[9] }; };
// the "country" of a piece in the current view: the controlling country, or the political unit
function unitKey(sd, k) { return sd.unit[k] >= 0 ? sd.unit[k] : 100000 + sd.rows.unit_name_zh[k]; }
function countryOf(sd, k, mode = state.mode) { return mode === "control" ? sd.country[k] : unitKey(sd, k); }
const countryProp = (mode = state.mode) => mode === "control" ? "c" : "u";

function buildFeatures(sd) {
  const feats = new Array(sd.feature.length);
  for (let k = 0; k < sd.feature.length; k++) {
    const f = sd.feature[k]; const ai = state.admin.feature_admin[f]; const ci = sd.country[k];
    const contested = sd.countries[ci][0] === "-20";
    feats[k] = { type: "Feature", id: k, geometry: { type: "MultiPolygon", coordinates: geoOf(f) },
      properties: { s: sd.snapshot, b: sd.bloc[k], a: sd.conf[k], t: state.admin.tier[ai], p: ai, c: ci, u: unitKey(sd, k),
        h: contested ? 2 : sd.conf[k], col: sd.countries[ci][3], nc: sd.nations[sd.nation[k]][3] } };
  }
  return { type: "FeatureCollection", features: feats };
}
const fc = (features) => ({ type: "FeatureCollection", features });
const adminFeatures = (sd) => fc(sd.admin_active.map((a) => ({ type: "Feature", id: a,
  geometry: { type: "MultiPolygon", coordinates: state.adminGeo[a] }, properties: { t: state.admin.tier[a] } })));
const unitFeatures = (sd) => fc(sd.units_active.map((u) => ({ type: "Feature", id: u,
  geometry: { type: "MultiPolygon", coordinates: state.units[u] }, properties: {} })));
const ctrlFeatures = (sd) => fc(sd.countries.map((c, ci) => ({ type: "Feature", id: ci,
  geometry: { type: "MultiPolygon", coordinates: sd.ctrlGeo[c[8]] }, properties: { k: c[0] } })));

// ------------------------------------------------------------------ labels, drawn by the map itself
// Country names sit at a fixed point deep inside each territory and are shown only at zooms
// where the whole name fits inside the land there.
const shortName = (n) => (n || "").split(/[（(]/)[0].replace(/[^\p{Ideo}]/gu, "");
const textWidth = (s) => [...s].reduce((w, ch) => w + (/\p{Ideo}/u.test(ch) ? 1.04 : 0.6), 0) * LABEL_PX;
function countryLabelFeatures(sd) {
  const items = state.mode === "control"
    ? sd.country_labels.filter((l) => sd.countries[l[0]][0] !== "-20").map(([ci, x, y, w, h, a]) => [sd.countries[ci][1], x, y, w, h, a])
    : sd.unit_labels.map(([, n, x, y, w, h, a]) => [n, x, y, w, h, a]);
  const feats = [];
  for (const [full, x, y, w, h, area] of items) {
    const n = shortName(full); if (!n) continue;
    const need = textWidth(n) + 4; const p = { n, s: -area };
    for (let z = 0; z <= 11; z++) { const sc = 512 * 2 ** z; p["v" + z] = w * sc >= need && h * sc >= LABEL_PX * 1.3 ? 1 : 0; }
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [x, y] }, properties: p });
  }
  return fc(feats);
}
const fitsFilter = () => { const e = ["step", ["zoom"], ["==", ["get", "v0"], 1]]; for (let z = 1; z <= 11; z++) e.push(z, ["==", ["get", "v" + z], 1]); return e; };
// full-width ASCII forms (－ ／ ・) are drawn with their plain counterparts, which the bundled glyphs cover
const halfwidth = (s) => s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const provLabelName = (ai) => {
  const zh = col("name_zh", ai); if (zh) return halfwidth(zh.split(/[（(]/)[0]);
  const ok = (s) => s && /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\s.,'’\-–()/·]+$/u.test(s);
  return ok(col("name", ai)) ? col("name", ai) : ok(col("name_en", ai)) ? col("name_en", ai) : null;
};
const provLabelFeatures = (sd) => fc(sd.admin_active.filter((a) => state.admin.tier[a] < 5).map((a) => ({ name: provLabelName(a), a }))
  .filter((p) => p.name).map(({ name, a }) => ({ type: "Feature", geometry: { type: "Point", coordinates: state.admin.label[a] },
    properties: { n: name, a: state.admin.area[a] } })));

// ------------------------------------------------------------------ paint
function fillColor() {
  if (state.mode === "bloc") return ["match", ["get", "b"], 0, BLOC_COLOR.allied, 1, BLOC_COLOR.axis, 3, BLOC_COLOR.contested, BLOC_COLOR.neutral];
  if (state.mode === "nation") return ["get", "nc"];
  if (state.mode === "control") return ["get", "col"];
  return ["get", "col"];
}
// The selection is shown through feature state (paintSelection), not through the paint expressions or filters:
// changing those makes MapLibre cut the whole source into tiles again, which on the larger dates (and on the
// 3D terrain) held up the map for seconds after each click. "sel" of a piece: 2 the selected province,
// 1 in the selected country, 0 dimmed, none as usual.
function fillOpacity() {
  const base = BASE[state.base].fill[state.mode];
  return ["match", ["coalesce", ["feature-state", "sel"], -1], 2, Math.min(0.97, base + 0.25), 1, Math.min(0.95, base + 0.12),
    0, base * 0.35, base];
}
const SEL_LINES = { "ctrl-sel": "ctrl", "unit-sel": "units", "prov-sel": "admin" };
// On the 3D terrain the map is drawn into images laid over the terrain, which a feature-state change does not
// redraw by itself (MapLibre 4.7): drop them, so that the next frame draws them again.
let drapedRedrawFrame = 0;
function redrawDraped() {
  if (!map.terrain || drapedRedrawFrame) return;
  drapedRedrawFrame = requestAnimationFrame(() => {
    drapedRedrawFrame = 0;
    if (map.terrain) { map.terrain.sourceCache.freeRtt(); map.triggerRepaint(); }
  });
}
function paintSelection() {
  const s = state.sel, sd = sdNow(), ctl = state.mode === "control";
  if (!sd) return;
  let changed = false;
  for (let k = 0; k < sd.feature.length; k++) {
    let v;
    if (s) {
      const inC = countryOf(sd, k) === s.country;
      v = s.level !== "country" ? (state.admin.feature_admin[sd.feature[k]] === s.admin ? 2 : inC ? 3 : 0) : inC ? 1 : 0;
    }
    if (state.selPainted.get(k) === v) continue;
    changed = true;
    if (v === undefined) { map.removeFeatureState({ source: "prov", id: k }, "sel"); state.selPainted.delete(k); }
    else { map.setFeatureState({ source: "prov", id: k }, { sel: v }); state.selPainted.set(k, v); }
  }
  // the outline of the selected country (control view) or political unit, and of the selected province
  const want = { "ctrl-sel": s && ctl ? s.country : null, "unit-sel": s && !ctl && s.country < 100000 ? s.country : null,
    "prov-sel": s && s.level !== "country" ? s.admin : null };
  for (const [layer, source] of Object.entries(SEL_LINES)) {
    const was = state.selLines[layer];
    if (was === want[layer]) continue;
    changed = true;
    if (was != null) map.setFeatureState({ source, id: was }, { sel: false });
    if (want[layer] != null) map.setFeatureState({ source, id: want[layer] }, { sel: true });
    state.selLines[layer] = want[layer];
  }
  if (changed) redrawDraped();
}
function hatchFilter() {
  const none = ["==", ["get", "a"], -1];
  if (!$("tApprox").checked) return none;
  if (state.mode === "bloc") return ["==", ["get", "a"], 1];
  if (state.mode === "control") return [">=", ["get", "h"], 1];
  return none;
}
function applyPaint() {
  map.setPaintProperty("prov-fill", "fill-color", fillColor());
  map.setPaintProperty("prov-fill", "fill-opacity", fillOpacity());
  map.setFilter("prov-approx", hatchFilter());
  const ctl = state.mode === "control", on = $("tBorders").checked;
  map.setLayoutProperty("ctrl-line", "visibility", ctl && on ? "visible" : "none");
  map.setLayoutProperty("unit-line", "visibility", !ctl && on ? "visible" : "none");
  paintSelection();
  countyPaint();
}
function applyBase() {
  const b = BASE[state.base];
  map.setPaintProperty("bg", "background-color", b.sea);
  for (const [k, v] of Object.entries(b.relief)) map.setPaintProperty("relief", k, v);
  // the pre-drawn shading gives way to the live hillshade between zoom 5 and 6.3
  map.setPaintProperty("shade", "raster-opacity", ["interpolate", ["linear"], ["zoom"], 5, b.shade, 6.3, 0]);
  map.setPaintProperty("hillshade", "hillshade-shadow-color", ["interpolate", ["linear"], ["zoom"], 5, "rgba(28,34,32,0)", 6.3, `rgba(28,34,32,${(b.shade * 1.05).toFixed(2)})`]);
  map.setPaintProperty("hillshade", "hillshade-highlight-color", ["interpolate", ["linear"], ["zoom"], 5, "rgba(255,255,255,0)", 6.3, `rgba(255,255,255,${(b.shade * 0.5).toFixed(2)})`]);
  map.setSky({ "sky-color": b.sky, "horizon-color": b.horizon, "fog-color": b.horizon, "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7, "fog-ground-blend": 0.25, "atmosphere-blend": 0 });
  for (const l of ["hydro-fill", "hydro2-fill"]) if (map.getLayer(l)) map.setPaintProperty(l, "fill-color", b.lake);
  for (const l of ["hydro-line", "hydro2-line"]) if (map.getLayer(l)) map.setPaintProperty(l, "line-color", b.river);
  for (const l of riverLabelLayers()) map.setPaintProperty(l, "text-color", b.riverInk);
  $("map").style.background = b.sea;
  for (const x of document.querySelectorAll("[data-base]")) x.setAttribute("aria-pressed", String(x.dataset.base === state.base));
  applyPaint();
}
const riverLabelLayers = () => ["river-lbl-a", "river-lbl-b", "river-lbl-c", "river-lbl-d"].filter((l) => map.getLayer(l));
function setLabels() {
  const sd = sdNow(); if (!sd) return;
  map.getSource("lbl-country").setData(countryLabelFeatures(sd));
  map.getSource("lbl-prov").setData(provLabelFeatures(sd));
  const on = $("tLabels").checked ? "visible" : "none", rivers = $("tLabels").checked && $("tHydro").checked ? "visible" : "none";
  map.setLayoutProperty("country-lbl", "visibility", on); map.setLayoutProperty("prov-lbl", "visibility", on);
  for (const l of riverLabelLayers()) map.setLayoutProperty(l, "visibility", rivers);
  countyPaint();
}

// ------------------------------------------------------------------ cities
// capitals (stars), seats of colonial or provisional governments (ringed dots), ports (anchors),
// industrial cities (gears), other major cities (dots); drawn as small map icons
function cityIcon(kind) {
  const r = 2, S = 16 * r; const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d"); g.scale(r, r);
  g.lineJoin = "round";
  if (kind === "cap") {
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? 2.9 : 7; g.lineTo(8 + d * Math.cos(a), 8.4 + d * Math.sin(a)); }
    g.closePath(); g.fillStyle = "#b3261e"; g.strokeStyle = "#fff"; g.lineWidth = 1.4; g.stroke(); g.fill();
  } else if (kind === "seat") {
    g.beginPath(); g.arc(8, 8, 5, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill(); g.strokeStyle = "#b3261e"; g.lineWidth = 1.8; g.stroke();
    g.beginPath(); g.arc(8, 8, 2.1, 0, 2 * Math.PI); g.fillStyle = "#b3261e"; g.fill();
  } else if (kind === "port") {
    g.beginPath(); g.arc(8, 8, 6.8, 0, 2 * Math.PI); g.fillStyle = "#1f5f99"; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.1; g.stroke();
    g.strokeStyle = "#fff"; g.lineWidth = 1.3; g.lineCap = "round"; g.beginPath(); g.moveTo(8, 5); g.lineTo(8, 12); g.moveTo(5.6, 6.6); g.lineTo(10.4, 6.6);
    g.moveTo(4.6, 9.2); g.quadraticCurveTo(5.2, 12.2, 8, 12.2); g.quadraticCurveTo(10.8, 12.2, 11.4, 9.2); g.stroke();
    g.beginPath(); g.arc(8, 4.1, 1.1, 0, 2 * Math.PI); g.stroke();
  } else if (kind === "ind") {
    g.fillStyle = "#4b4f54"; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, d = i % 2 ? 4.9 : 6.9; g.lineTo(8 + d * Math.cos(a - Math.PI / 16), 8 + d * Math.sin(a - Math.PI / 16)); g.lineTo(8 + d * Math.cos(a + Math.PI / 16), 8 + d * Math.sin(a + Math.PI / 16)); }
    g.closePath(); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 0.9; g.stroke();
    g.beginPath(); g.arc(8, 8, 2.1, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill();
  } else {
    g.beginPath(); g.arc(8, 8, 3.2, 0, 2 * Math.PI); g.fillStyle = "#1b2220"; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.stroke();
  }
  return { data: g.getImageData(0, 0, S, S), url: c.toDataURL() };
}
const CITY_ICONS = { cap: "首都", seat: "首府 / 政府驻地", port: "港口", ind: "工业城市", city: "其他重要城市" };
const cityIconOf = (f) => f & 1 ? "ic-cap" : f & 2 ? "ic-seat" : f & 8 ? "ic-port" : f & 4 ? "ic-ind" : "ic-city";
const cityFeatures = (sd) => fc((sd.cities || []).map(([n, x, y, f, r], i) => ({ type: "Feature", id: i,
  geometry: { type: "Point", coordinates: [x, y] }, properties: { s: sd.snapshot, n: halfwidth(n), f, r, i, ic: cityIconOf(f), k: r * 10 - (f & 1 ? 5 : f & 2 ? 3 : 0) } })));
function showCityTip(e, i) {
  const [n, , , f, , role, note, pop] = sdNow().cities[i]; const tip = $("tip"); tip.replaceChildren();
  tip.append(el("b", null, n));
  const kinds = [f & 4 ? "工业城市" : null, f & 8 ? "港口" : null, f & 16 && !(f & 12) ? "重要城市" : null].filter(Boolean).join(" · ");
  if (role) tip.append(el("div", null, role));
  if (kinds) tip.append(el("div", null, kinds));
  if (note) tip.append(el("div", null, note));
  if (pop) tip.append(el("span", "num", `城市人口约 ${fmt(pop)}（Natural Earth）`));
  moveTip(e);
}

// ------------------------------------------------------------------ legend
function legend() {
  const sd = sdNow(); const Lg = $("legend"); Lg.replaceChildren(); const sp = $("split"); sp.replaceChildren(); sp.hidden = true;
  const row = (color, label, val, onclick, hatch) => {
    const r = el(onclick ? "button" : "div", "row"); if (onclick) { r.type = "button"; r.onclick = onclick; }
    const s = el("span", "sw"); s.style.background = hatch ? `repeating-linear-gradient(135deg, ${color} 0 3px, rgb(0 0 0 / 0.35) 3px 4px)` : color;
    r.append(s, el("span", null, label), el("span", "num", val ?? "")); Lg.append(r);
  };
  const note = $("legendNote"); note.hidden = false;
  if (state.mode === "bloc") {
    $("legendTitle").textContent = sd.notes?.bloc_title || (isModern(sd) ? "军事同盟 · 人口" : "实际控制阵营 · 人口");
    const total = Object.values(sd.bloc_pop).reduce((a, b) => a + b, 0);
    for (const k of ["allied", "axis", "contested", "neutral"]) {
      const p = sd.bloc_pop[k] || 0; row(BLOC_COLOR[k], blocName(sd, k), `${fmt(p)} · ${(100 * p / total).toFixed(1)}%`);
      const seg = el("span"); seg.style.background = BLOC_COLOR[k]; seg.style.width = (100 * p / total) + "%"; sp.append(seg);
    }
    sp.hidden = false;
    note.textContent = sd.notes?.bloc || (isModern(sd)
      ? "按实际控制者所属的同盟着色：北约 32 国，集体安全条约组织 6 国（亚美尼亚 2024 年起冻结参与）。斜线 = 按整州近似的控制范围。"
      : "粗线为当日的国界 / 殖民地界（法理）。斜线 = 近似界定（按整区分配，或沿用临近年份的占领范围）。");
  } else if (state.mode === "nation") {
    $("legendTitle").textContent = "各国的法理领土 · 人口";
    for (const [i, nt] of sd.nations.slice(0, 16).entries()) {
      const k = sd.nation.indexOf(i);
      row(nt[3], nt[1].split(/[（(]/)[0] + (nt[4] !== "independent" ? `（${STATUS_ZH[nt[4]] || nt[4]}）` : ""), fmt(nt[6]), k >= 0 ? () => selectCountry(unitKey(sd, k), true, k) : null);
    }
    note.textContent = isModern(sd)
      ? `按国际普遍承认的领土着色：克里米亚属乌克兰，戈兰高地属叙利亚，北塞浦路斯属塞浦路斯，索马里兰属索马里；台湾、科索沃、西撒哈拉、巴勒斯坦按 Natural Earth 单列。属地用宗主国颜色的浅色。共 ${sd.nations.length} 个单元。`
      : `每个国家按法理领土着色，不计占领；殖民地、保护国、委任统治地用宗主国颜色的浅色。共 ${sd.nations.length} 个政治单元。`;
  } else if (state.mode === "control") {
    $("legendTitle").textContent = "各国实际控制区 · 人口";
    const shown = sd.countries.map((c, ci) => ci).filter((ci) => sd.countries[ci][0] !== "-20").slice(0, 16);
    for (const ci of shown) { const c = country(sd, ci); row(c.color, c.zh, fmt(c.pop), () => selectCountry(ci, true)); }
    const ci20 = sd.countries.findIndex((c) => c[0] === "-20");
    if (ci20 >= 0) { const c = country(sd, ci20); row(c.color, c.zh, fmt(c.pop), () => selectCountry(ci20, true), true); }
    const rest = sd.countries.length - shown.length - (ci20 >= 0 ? 1 : 0);
    note.textContent = (sd.notes?.control || (isModern(sd)
      ? "克里米亚、塞瓦斯托波尔、卢甘斯克由俄罗斯控制，顿涅茨克、扎波罗热、赫尔松为交战前线（均按整州近似）；德涅斯特河沿岸、阿布哈兹、南奥塞梯、北塞浦路斯、索马里兰为未获普遍承认的政权。一国内部的内战（苏丹、缅甸、也门等）未分区表示。"
      : "占领区算作占领国，傀儡政权单列。")) + `${rest > 0 ? `另有 ${rest} 个国家未列出，` : ""}点击图例或地图选中国家。`;
  }
}

// ------------------------------------------------------------------ hover and detail
let map;
let hoverFrame = 0, hoverEvent = null;
function moveTip(e) {
  const tip = $("tip"), r = map.getContainer().getBoundingClientRect(); tip.hidden = false;
  tip.style.left = Math.max(4, Math.min(e.point.x + 14, r.width - 270)) + "px";
  tip.style.top = Math.max(4, Math.min(e.point.y + 14, r.height - tip.offsetHeight - 4)) + "px";
}

function clearMapHover() {
  if (hoverFrame) cancelAnimationFrame(hoverFrame);
  hoverFrame = 0; hoverEvent = null;
  let changed = false;
  if (state.hover !== null) {
    map.removeFeatureState({ source: "prov", id: state.hover }, "hov"); state.hover = null; changed = true;
  }
  if (countyState.hover !== null) {
    map.removeFeatureState({ source: "counties", id: countyState.hover }, "hov"); countyState.hover = null; changed = true;
  }
  state.tipKey = null; $("tip").hidden = true; map.getCanvas().style.cursor = "";
  if (changed) redrawDraped();
}

function paintMapHover(e) {
  if (!state.snap || !map.getLayer("county-fill")) return;
  const hits = map.queryRenderedFeatures(e.point, { layers: ["city", "county-fill", "prov-fill"] });
  const city = hits.find((f) => f.layer.id === "city" && f.properties.s === state.snap);
  const county = !city && $("tCounties").checked && map.getZoom() >= COUNTY_ZOOM ?
    countyRenderedHit(hits.find((f) => f.layer.id === "county-fill")) : null;
  const province = !city && !county && hits.find((f) => f.layer.id === "prov-fill" && f.properties.s === state.snap);
  const provinceId = province ? province.id : null, countyId = county ? county.id : null;
  let changed = false;
  if (state.hover !== provinceId) {
    if (state.hover !== null) map.removeFeatureState({ source: "prov", id: state.hover }, "hov");
    if (provinceId !== null) map.setFeatureState({ source: "prov", id: provinceId }, { hov: true });
    state.hover = provinceId; changed = true;
  }
  if (countyState.hover !== countyId) {
    if (countyState.hover !== null) map.removeFeatureState({ source: "counties", id: countyState.hover }, "hov");
    if (countyId !== null) map.setFeatureState({ source: "counties", id: countyId }, { hov: true });
    countyState.hover = countyId; changed = true;
  }
  const key = city ? `city:${city.properties.i}` : county ? `county:${countyId}` : province ? `province:${provinceId}` : null;
  if (key) {
    map.getCanvas().style.cursor = "pointer";
    if (state.tipKey === key) moveTip(e);
    else {
      state.tipKey = key;
      if (city) showCityTip(e, city.properties.i);
      else if (county) countyTip(e, county);
      else showTip(e, provinceId);
    }
  } else { state.tipKey = null; $("tip").hidden = true; map.getCanvas().style.cursor = ""; }
  if (changed) redrawDraped();
}

function queueMapHover(e) {
  if (map.isMoving()) return;
  hoverEvent = e;
  if (!hoverFrame) hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const event = hoverEvent; hoverEvent = null;
    if (event && !map.isMoving()) paintMapHover(event);
  });
}

function showTip(e, k) {
  const sd = sdNow(); const ai = state.admin.feature_admin[sd.feature[k]]; const tip = $("tip"); tip.replaceChildren();
  tip.append(el("b", null, adminName(ai)));
  const local = col("name", ai); if (local && local !== adminName(ai)) tip.append(" · " + local);
  const ctrl = L(sd, "controller_name_zh", k) || L(sd, "controller_name_en", k);
  const top = state.mode === "control" ? country(sd, sd.country[k]).zh : (L(sd, "unit_name_zh", k) || L(sd, "unit_name_en", k));
  tip.append(el("div", null, `${TIER[state.admin.tier[ai]][0].replace(/（.*）/, "")} · ${top}`));
  if (state.mode !== "control" || ctrl !== top) tip.append(el("div", null, `实际控制：${ctrl}`));
  if (sd.split[k]) tip.append(el("div", null, "边界穿过此省，此处为其中一块"));
  tip.append(el("span", "num", `人口约 ${fmt(sd.pop[k])}`));
  moveTip(e);
}

function panel() {
  const D = $("detail"); D.replaceChildren(); D.hidden = false;
  const close = el("button", "close", "×"); close.type = "button"; close.setAttribute("aria-label", "关闭");
  close.onclick = () => clearSelection(); D.append(close); return D;
}
const kvList = () => { const dl = el("dl", "kv"); const add = (t, v) => { if (v == null || v === "") return; dl.append(el("dt", null, t), el("dd", null, v)); }; return [dl, add]; };
function chips(list) { const c = el("div"); c.style.cssText = "display:flex;flex-wrap:wrap;gap:6px"; for (const [t, cls] of list) c.append(el("span", "chip " + (cls || ""), t)); return c; }

// pieces of the current snapshot in a country of the current view
function piecesOf(cid) { const sd = sdNow(); const out = []; for (let k = 0; k < sd.feature.length; k++) if (countryOf(sd, k) === cid) out.push(k); return out; }
function countryName(sd, cid, k) {
  if (state.mode === "control") return country(sd, cid).zh;
  return L(sd, "unit_name_zh", k) || L(sd, "unit_name_en", k);
}

function provinceList(sd, ks, title) {
  const byA = new Map(); for (const k of ks) { const ai = state.admin.feature_admin[sd.feature[k]]; byA.set(ai, (byA.get(ai) || 0) + sd.pop[k]); }
  const top = [...byA.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const box = el("div", "stack"); box.append(el("h3", null, title));
  const ul = el("ul", "list");
  for (const [ai, p] of top) { const li = el("li"); const b = el("button"); b.type = "button";
    b.append(el("span", null, adminName(ai)), el("span", "num", fmt(p))); b.onclick = () => { const k = ks.find((k) => state.admin.feature_admin[sd.feature[k]] === ai); selectProvince(k, true); };
    li.append(b); ul.append(li); }
  box.append(ul); return box;
}

function showCountry(cid, kAny) {
  const sd = sdNow(); const ks = piecesOf(cid); const D = panel();
  const pop = ks.reduce((a, k) => a + sd.pop[k], 0), area = ks.reduce((a, k) => a + sd.area[k], 0);
  const nprov = new Set(ks.map((k) => state.admin.feature_admin[sd.feature[k]])).size;
  const head = el("div", "title"); const sw = el("span", "sw");
  const crumbs = el("div", "crumbs"); crumbs.append(el("span", "here", state.mode === "control" ? "国家（实际控制区）" : "国家 / 政治单元（法理）"));
  const [dl, add] = kvList();
  if (state.mode === "control") {
    const c = country(sd, cid); sw.style.background = c.color; head.append(sw, el("h2", null, c.zh));
    D.append(crumbs, head, chips([[blocName(sd, BLOCS[c.bloc])], [c.en]]));
    add("人口（估计）", fmt(pop)); add("面积", km2(area)); add("省级单位", `${nprov} 个（含被边界切开的部分）`);
    D.append(dl);
    const comp = el("div", "stack"); comp.append(el("h3", null, "控制的地区（按法理归属）")); const ul = el("ul", "list");
    for (const [n, p, a] of c.comp) { const li = el("li"); const b = el("div"); b.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:3px 6px;font-size:13px";
      b.append(el("span", null, n), el("span", "num", `${fmt(p)} · ${km2(a)}`)); li.append(b); ul.append(li); }
    comp.append(ul); D.append(comp);
  } else {
    const name = countryName(sd, cid, kAny); sw.style.background = sd.nations[sd.nation[kAny]][3]; head.append(sw, el("h2", null, name));
    D.append(crumbs, head, chips([[STATUS_ZH[L(sd, "unit_status", kAny)] || L(sd, "unit_status", kAny)]]));
    add("法理宗主", L(sd, "sovereign_name_zh", kAny)); add("人口（估计）", fmt(pop)); add("面积", km2(area)); add("省级单位", `${nprov} 个`);
    D.append(dl);
    const byC = new Map(); for (const k of ks) { const n = country(sd, sd.country[k]).zh; byC.set(n, (byC.get(n) || 0) + sd.pop[k]); }
    const box = el("div", "stack"); box.append(el("h3", null, "当日实际控制者（按人口）")); const ul = el("ul", "list");
    for (const [n, p] of [...byC.entries()].sort((a, b) => b[1] - a[1])) { const li = el("li"); const r = el("div");
      r.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:3px 6px;font-size:13px";
      r.append(el("span", null, n), el("span", "num", `${fmt(p)} · ${(100 * p / Math.max(pop, 1)).toFixed(0)}%`)); li.append(r); ul.append(li); }
    box.append(ul); D.append(box);
  }
  D.append(provinceList(sd, ks, "人口最多的省份"));
  D.append(el("p", "foot", "在该国范围内再点一次地图，进入省级。"));
}

function showProvince(k) {
  const sd = sdNow(); const ai = state.admin.feature_admin[sd.feature[k]]; const cid = countryOf(sd, k); const D = panel();
  const crumbs = el("div", "crumbs"); const up = el("button", null, countryName(sd, cid, k)); up.type = "button";
  up.onclick = () => selectCountry(cid, false, k); crumbs.append(up, el("span", null, "›"), el("span", "here", "省"));
  const name = adminName(ai); const local = col("name", ai); const tier = state.admin.tier[ai];
  const head = el("div", "title"); head.append(el("h2", null, name));
  // every piece of this province on this date: a border or front line may run through it
  const parts = []; for (let j = 0; j < sd.feature.length; j++) if (state.admin.feature_admin[sd.feature[j]] === ai) parts.push(j);
  const cl = [[TIER[tier][0].replace(/（.*）/, ""), "hist"], [blocName(sd, BLOCS[sd.bloc[k]])]];
  if (sd.conf[k] === 1) cl.push(["控制范围为近似", "approx"]);
  if (parts.length > 1) cl.push([`边界穿过此省 · 分为 ${parts.length} 块`, "approx"]);
  D.append(crumbs, head, chips(cl));
  const [dl, add] = kvList();
  add("原名", local !== name ? local : null);
  add("英文名", col("name_en", ai) && col("name_en", ai) !== local ? col("name_en", ai) : null);
  if (tier < 5) add("类别", kindLabel(ai));
  add("上级区划", col("parent_zh", ai) || col("parent", ai));
  const s0 = col("start", ai), e0 = col("end", ai);
  if (tier < 5 && (s0 || e0)) add("施行期间", `${s0 || "?"} – ${e0 || "此后"}`);
  if (state.admin.merged[ai]) add("合并", `由当时的 ${state.admin.merged[ai]} 个县级 / 地区级区划合并`);
  if (state.admin.partial[ai]) add("说明", "此单位的一部分当日划在相邻单位中");
  add("界线依据", BASIS_ZH[col("basis", ai)] || col("basis", ai));
  add("备注", col("note", ai));
  add("政治单元", `${L(sd, "unit_name_zh", k) || L(sd, "unit_name_en", k)}（${STATUS_ZH[L(sd, "unit_status", k)] || L(sd, "unit_status", k)}）`);
  add("法理宗主", L(sd, "sovereign_name_zh", k));
  const pop = parts.reduce((a, j) => a + sd.pop[j], 0), area = parts.reduce((a, j) => a + sd.area[j], 0);
  add("人口（估计）", `${fmt(pop)}　密度 ${Math.round(pop / Math.max(area, 1))} 人/km²`);
  add("面积", km2(area));
  D.append(dl);
  countyProvinceControls(D, ai);
  const box = el("div", "stack"); box.append(el("h3", null, parts.length > 1 ? "各块的实际控制" : "实际控制"));
  const ul = el("ul", "list");
  for (const j of parts.sort((a, b) => sd.area[b] - sd.area[a])) {
    const li = el("li"); const b = el("button"); b.type = "button"; if (j === k) b.classList.add("cur");
    const who = el("span", "who"); const sw = el("span", "sw"); sw.style.background = sd.countries[sd.country[j]][3];
    const ctrl = L(sd, "controller_name_zh", j) || L(sd, "controller_name_en", j);
    const det = L(sd, "controller_detail_zh", j); const typ = TYPE_ZH[L(sd, "control_type", j)] || L(sd, "control_type", j);
    who.append(sw, el("span", null, `${country(sd, sd.country[j]).zh}${ctrl !== country(sd, sd.country[j]).zh ? "（" + ctrl + "）" : ""} · ${typ}`));
    b.title = [det, `${L(sd, "unit_name_zh", j) || ""}`].filter(Boolean).join(" · ");
    b.append(who, el("span", "num", `${fmt(sd.pop[j])} · ${km2(sd.area[j])}`));
    b.onclick = () => selectProvince(j, false); li.append(b); ul.append(li);
  }
  box.append(ul); D.append(box);
  const [dl2, add2] = kvList();
  const det = L(sd, "controller_detail_zh", k); if (det && det !== L(sd, "controller_name_zh", k)) add2("控制细节", det);
  const src = L(sd, "control_source", k) || "";
  add2("判定依据", src.startsWith("ww1_rule:") ? `一战整理规则 第 ${src.slice(9)} 行` : src.startsWith("baseline:") ? "1914 年断面的既有控制规则" : src.startsWith("rule:") ? `人工整理规则 第 ${src.slice(5)} 行` : src.startsWith("event:") ? `控制事件 ${src.slice(6)}` : src.startsWith("overlay:") ? `历史占领图层 ${src.slice(8)}` : "CShapes 2.0 国界");
  add2("局部控制事件", L(sd, "partial_control_events", k));
  D.append(dl2, el("p", "foot", "来源：" + col("source", ai)));
}

function clearSelection() { countyState.selectionTicket++; state.sel = null; $("detail").hidden = true; applyPaint(); }
function selectCountry(cid, fly, kAny) {
  countyState.selectionTicket++;
  const sd = sdNow(); if (kAny == null) kAny = piecesOf(cid)[0];
  if (kAny == null) return;
  state.sel = { level: "country", country: cid, admin: -1, piece: kAny }; applyPaint(); showCountry(cid, kAny);
  if (fly) { const bb = state.mode === "control" ? geoBounds(sd.ctrlGeo[sd.countries[cid][8]]) : piecesBounds(piecesOf(cid));
    if (bb) map.fitBounds(bb, { padding: 60, maxZoom: 6, duration: 700 }); }
}
function selectProvince(k, fly) {
  countyState.selectionTicket++;
  const sd = sdNow(); const ai = state.admin.feature_admin[sd.feature[k]];
  state.sel = { level: "province", country: countryOf(sd, k), admin: ai, piece: k }; applyPaint(); showProvince(k);
  if (fly) { const [x, y] = state.admin.label[ai]; map.flyTo({ center: [x, y], zoom: Math.max(map.getZoom(), state.admin.area[ai] > 2e5 ? 4.5 : 5.5) }); }
}
function geoBounds(polys) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90; let best = 0, bb = null;
  // fit to the largest part, so empires spread over oceans do not zoom out to the whole world
  for (const p of polys) { let a0 = 180, b0 = 90, a1 = -180, b1 = -90; for (const [x, y] of p[0]) { a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, y); b1 = Math.max(b1, y); }
    const s = (a1 - a0) * (b1 - b0); if (s > best) { best = s; bb = [[a0, b0], [a1, b1]]; } x0 = Math.min(x0, a0); x1 = Math.max(x1, a1); y0 = Math.min(y0, b0); y1 = Math.max(y1, b1); }
  return (x1 - x0) > 200 ? bb : [[x0, y0], [x1, y1]];
}
function piecesBounds(ks) { const sd = sdNow(); const polys = []; for (const k of ks) polys.push(...geoOf(sd.feature[k])); return polys.length ? geoBounds(polys) : null; }

function onClick(k) {
  const sd = sdNow(); const cid = countryOf(sd, k); const s = state.sel;
  if (s && s.country === cid) selectProvince(k, false); else selectCountry(cid, false, k);
}

// ------------------------------------------------------------------ snapshots, views
function setHash() { try { history.replaceState(null, "", "#" + state.snap + (state.mode !== "bloc" ? "/" + state.mode : "")); } catch (e) {} }

async function fetchSnap(snap) {
  // the snapshot's rows and its outlines, in the order ww2_webmap.py wrote them
  const [sd, buf] = await Promise.all([getJSON(`data/snap-${snap}.json`), getBin(`data/geo-${snap}.bin`)]);
  const recs = decodeGeo(buf); let i = 0;
  for (const a of sd.admin_active) state.adminGeo[a] = recs[i++];
  for (const f of sd.geo_feature) state.geo[f] = recs[i++];
  for (const u of sd.units_active) state.units[u] = recs[i++];
  sd.ctrlGeo = recs.slice(i);
  return sd;
}

// state.data[snap] holds the snapshot, or the promise of it while it loads (also when fetched ahead)
function fetchOnce(snap) {
  if (!state.data[snap]) {
    const p = fetchSnap(snap).then((sd) => (state.data[snap] = sd), (e) => { delete state.data[snap]; throw e; });
    p.catch(() => {});  // a failed prefetch is retried when the tab is chosen
    state.data[snap] = p;
  }
  return state.data[snap];
}
function prefetchNear(snap) {
  // the neighbouring tabs, fetched quietly once the map is drawn, so that stepping through the dates is quick
  const order = [...document.querySelectorAll("#tabs button")].map((b) => b.dataset.snap); const i = order.indexOf(snap);
  setTimeout(() => { for (const s of [order[i + 1], order[i - 1]]) if (s) fetchOnce(s); }, 800);
}

async function loadSnap(snap) {
  if (!SCENARIOS.includes(snap)) throw new Error("未知地图：" + snap);
  const ticket = ++state.loading;
  if (!state.data[snap] || state.data[snap] instanceof Promise) {
    document.body.classList.add("busy");
    try { await fetchOnce(snap); } catch (e) { document.body.classList.remove("busy"); throw e; }
  }
  if (ticket !== state.loading) return;  // another tab was clicked while this one loaded
  const prev = state.sel && state.data[state.snap] ? { admin: state.sel.admin, level: state.sel.level } : null;
  clearMapHover();
  state.snap = snap; const sd = sdNow();
  countyReset();
  $("loading").hidden = true;
  $("q").value = ""; $("results").replaceChildren();
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.snap === snap));
    if (b.dataset.snap === snap) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  $("snapTitle").textContent = isModern(sd) ? sd.title_zh : `${snap.replace(/-/g, ".")}　${sd.title_zh}`;
  const n = sd.admin_active.length; const split = new Set(sd.feature.filter((f, k) => sd.split[k]).map((f) => state.admin.feature_admin[f])).size;
  const top = sd.countries.filter((c) => c[0] !== "-20").slice(0, 3).map((c) => `${c[1]} ${fmt(c[5])}`).join("、");
  $("snapLede").textContent = isModern(sd)
    ? `当今的一级行政区 ${n.toLocaleString()} 个，其中 ${split} 个被实际控制线切开。人口最多的国家：${top}。`
    : `当日施行的省级区划 ${n.toLocaleString()} 个，其中 ${split} 个被国界或战线切开。人口最多的实际控制者：${top}。`;
  state.hover = null; state.sel = null; $("detail").hidden = true; $("tip").hidden = true;
  for (const source of ["prov", ...Object.values(SEL_LINES)]) map.removeFeatureState({ source });
  state.selPainted = new Map(); state.selLines = {};
  document.body.classList.add("busy");
  map.getSource("prov").setData(buildFeatures(sd));
  map.getSource("admin").setData(adminFeatures(sd));
  map.getSource("units").setData(unitFeatures(sd));
  map.getSource("ctrl").setData(ctrlFeatures(sd));
  map.getSource("cities").setData(cityFeatures(sd));
  map.once("idle", () => { document.body.classList.remove("busy"); prefetchNear(snap); });
  applyPaint(); legend(); setLabels(); setHash();
  refreshCounties();
  if (prev && prev.level === "province") { const k = sd.feature.findIndex((f) => state.admin.feature_admin[f] === prev.admin); if (k >= 0) selectProvince(k, false); }
}

function setMode(mode) {
  countyState.selectionTicket++;
  clearMapHover();
  const s = state.sel; state.mode = mode;
  for (const x of document.querySelectorAll("[data-mode]")) x.setAttribute("aria-pressed", String(x.dataset.mode === mode));
  state.sel = null; $("detail").hidden = true;
  applyPaint(); legend(); setLabels(); setHash();
  if (s && s.level === "province") selectProvince(s.piece, false);
  if (s && s.level === "county") selectCounty(s.county);
}

function addPattern() {
  const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d");
  g.strokeStyle = "rgba(20,25,24,0.45)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
  map.addImage("hatch", g.getImageData(0, 0, 8, 8));
}

async function boot() {
  registerProtocols();
  const fonts = Promise.all(["600 12px 'Noto Serif SC'", "400 12px 'Noto Serif SC'"].map((f) => document.fonts.load(f, "中国")));
  // only what the first view needs: the outlines of the other snapshots load when their tab is chosen,
  // the rivers once the map is drawn
  const [index, admin] = await Promise.all([getJSON("data/index.json"), getPacked("data/admin.bin")]);
  await Promise.race([fonts.catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
  state.admin = admin;
  const saved = store.get("2d-slg-map-base"); if (saved && BASE[saved]) state.base = saved;
  const tabs = $("tabs");
  index.snapshots = index.snapshots.filter((s) => SCENARIOS.includes(s.snapshot));
  for (const s of index.snapshots) {
    const b = el("button"); b.type = "button"; b.role = "tab"; b.dataset.snap = s.snapshot;
    b.append(el("span", "d", s.snapshot.replace(/-/g, ".")), el("span", "t", s.title_zh));
    b.onclick = () => loadSnap(s.snapshot).catch(fail); tabs.append(b);
  }
  map = new maplibregl.Map({ container: "map", center: [60, 30], zoom: 1.6, minZoom: 1, maxZoom: 15, attributionControl: false,
    renderWorldCopies: false, localIdeographFontFamily: "'Noto Serif SC', 'Songti SC', 'SimSun', serif", maxPitch: 65, transformCameraUpdate: cameraUpdate,
    style: { version: 8, glyphs: "glyph://{fontstack}/{range}", sources: {},
      layers: [{ id: "bg", type: "background", paint: { "background-color": BASE[state.base].sea } }] } });
  map.touchZoomRotate.disableRotation();
  if (window.innerWidth > 760) map.setPadding({ left: 320, top: 0, right: 0, bottom: 0 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.on("load", () => onLoad(index).catch(fail));
  wire(admin);
}

const R = (lo, mid, hi, rest) => ["case", ["<=", ["get", "r"], 3], lo, ["<=", ["get", "r"], 6], mid, ["<=", ["get", "r"], 8], hi, rest];
function riverPaint() {
  return { "line-color": BASE[state.base].river,
    "line-width": ["interpolate", ["linear"], ["zoom"], 1, R(1.0, 0.55, 0.3, 0.2), 4, R(2.2, 1.4, 0.9, 0.6), 8, R(4.2, 3.0, 2.0, 1.4)],
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, R(0.95, 0.6, 0, 0), 3, R(1, 0.9, 0.55, 0), 4.5, R(1, 1, 0.9, 0.65), 6, 1] };
}
const RIVER_FILTER = ["all", ["==", ["get", "k"], "r"], ["!=", ["get", "c"], 1]];
function riverLabel(id, source, minzoom, lo, hi) {
  // names follow joined, smoothed copies of the rivers (k = "n"), which are long enough to letter along
  return { id, type: "symbol", source, minzoom, filter: ["all", ["==", ["get", "k"], "n"], [">=", ["get", "r"], lo], ["<=", ["get", "r"], hi]],
    layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": ["sans"], "text-size": 11.5, "text-letter-spacing": 0.3,
      "symbol-spacing": 380, "text-max-angle": 45, "text-keep-upright": true, "symbol-sort-key": ["get", "r"] },
    paint: { "text-color": BASE[state.base].riverInk, "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.4 } };
}

// ------------------------------------------------------------------ 3D terrain
// Zoomed in past continent scale the mountains rise and the camera tilts, more the closer one looks.
// Mountains are a few kilometres high on a map tens of kilometres per pixel, so the relief is exaggerated,
// less as one zooms in (the Alps stand about the same height on the screen at every zoom).
// Tilt and height follow the zoom frame by frame (transformCameraUpdate), so a wheel turn, a pinch or a
// flight tilts the map as it goes rather than after it stops; both ease in from flat at T3D.from.
const T3D = { from: 3.2, full: 6.5, pitch: 52, rise: 1.2 };
const smooth = (a, b, z) => { const t = Math.max(0, Math.min(1, (z - a) / (b - a))); return t * t * (3 - 2 * t); };
const exaggerationAt = (z) => Math.max(1.4, Math.min(28, 28 * Math.pow(0.55, z - 4))) * smooth(T3D.from, T3D.from + T3D.rise, z);
const autoPitchAt = (z) => $("t3d").checked ? T3D.pitch * smooth(T3D.from, T3D.full, z) : 0;
// the camera for every frame: the auto tilt, unless the pitch is being changed by hand (right-drag,
// two-finger drag, the compass) or eased to a new auto tilt. Then the pitch requested is passed on as a
// change from the last frame, since what MapLibre requests still holds the tilt from before the move began.
function cameraUpdate(next) {
  if (!map) return {};
  if (map.terrain) { const ex = exaggerationAt(next.zoom); map.terrain.exaggeration = ex; map.terrain.options.exaggeration = ex; }
  const seen = state.seenPitch; state.seenPitch = next.pitch;  // null: a move begins, from the camera as it is
  if (state.userPitch || state.pitchEasing) return { pitch: seen == null ? next.pitch : Math.max(0, Math.min(65, map.getPitch() + next.pitch - seen)) };
  return { pitch: autoPitchAt(next.zoom) };
}
// terrain on above T3D.from (where its height is still zero, so it rises from flat), off a little below.
// It is taken off only once the map stands still: MapLibre 4.7 ends a drag or a flight on the terrain with
// transform.recalculateZoom(map.terrain), which throws when the terrain has gone in the meantime, and the
// exception leaves its render queue marked as running, so that the map draws and moves no more. Below
// T3D.from its height is zero, so keeping it until then changes nothing on the screen.
function update3D() {
  const z = map.getZoom(), want = $("t3d").checked && z >= T3D.from - (map.terrain ? 0.3 : 0);
  if (want && !map.terrain) map.setTerrain({ source: "dem", exaggeration: exaggerationAt(z) });
  else if (!want && map.terrain) {
    if (map.isMoving() || map._elevationFreeze) { state.dropTerrain = true; return; }
    state.dropTerrain = false;
    map.setTerrain(null);
  }
}
// back to the auto tilt, eased: after the 3D switch, or once zoomed out of 3D after tilting by hand
function easeToAutoPitch() {
  state.userPitch = false;
  const pitch = autoPitchAt(map.getZoom());
  if (Math.abs(map.getPitch() - pitch) < 0.5) return;
  state.pitchEasing = true;
  map.once("moveend", () => { state.pitchEasing = false; });
  map.easeTo({ pitch, duration: 700 });
}

async function onLoad(index) {
  addPattern();
  const key = $("cityKey"); key.replaceChildren();
  for (const [k, label] of Object.entries(CITY_ICONS)) {
    const ic = cityIcon(k); map.addImage("ic-" + k, ic.data, { pixelRatio: 2 });
    const sp = el("span"); const img = el("img"); img.src = ic.url; img.alt = ""; sp.append(img, label); key.append(sp);
  }
  const empty = fc([]);
  map.addSource("relief", { type: "raster", tiles: ["relief://r/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
  map.addSource("shade", { type: "raster", tiles: ["relief://s/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
  // These outlines are generalized to ~100 m. Reuse their tiles at street zoom
  // instead of slicing the same world geometry for every closer zoom level.
  map.addSource("prov", { type: "geojson", data: empty, tolerance: 0.1, maxzoom: 12 });
  map.addSource("admin", { type: "geojson", data: empty, tolerance: 0.25, maxzoom: 12 });
  map.addSource("units", { type: "geojson", data: empty, tolerance: 0.3, maxzoom: 12 });
  map.addSource("ctrl", { type: "geojson", data: empty, tolerance: 0.3, maxzoom: 12 });
  map.addSource("hydro", { type: "geojson", data: empty });
  map.addSource("lbl-country", { type: "geojson", data: empty });
  map.addSource("lbl-prov", { type: "geojson", data: empty });
  map.addSource("cities", { type: "geojson", data: empty });
  map.addLayer({ id: "relief", type: "raster", source: "relief", paint: { "raster-resampling": "linear", "raster-fade-duration": 0 } });
  map.addLayer({ id: "prov-fill", type: "fill", source: "prov", paint: { "fill-color": fillColor(), "fill-opacity": 0.6 } });
  map.addLayer({ id: "prov-approx", type: "fill", source: "prov", filter: ["==", ["get", "a"], 1], paint: { "fill-pattern": "hatch", "fill-opacity": 0.6 } });
  map.addLayer({ id: "shade", type: "raster", source: "shade", paint: { "raster-resampling": "linear", "raster-fade-duration": 0 } });
  // elevation: one source for the 3D terrain, one for the hillshade drawn from it once zoomed in past the
  // pre-drawn shading (zoom 5), which is sharper there; open sea is flat
  const dem = { type: "raster-dem", tiles: ["relief://d/{z}/{x}/{y}"], tileSize: 256, encoding: "terrarium", minzoom: 0, maxzoom: 6 };
  map.addSource("dem", dem); map.addSource("dem-shade", { ...dem });
  map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-shade", minzoom: 4.8,
    paint: { "hillshade-illumination-direction": 315, "hillshade-illumination-anchor": "map", "hillshade-exaggeration": 0.6,
      "hillshade-accent-color": "rgba(0,0,0,0)" } });
  map.addLayer({ id: "hydro-fill", type: "fill", source: "hydro", filter: ["==", ["get", "k"], "l"], paint: { "fill-color": BASE[state.base].lake } });
  map.addLayer({ id: "hydro-line", type: "line", source: "hydro", filter: RIVER_FILTER, layout: { "line-cap": "round", "line-join": "round" }, paint: riverPaint() });
  map.addLayer({ id: "prov-line", type: "line", source: "admin", paint: { "line-color": INK2,
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 1.5, 0.12, 3, 0.3, 6, 0.5],
    "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 7, 1.0] } });
  map.addLayer({ id: "unit-line", type: "line", source: "units", paint: { "line-color": INK, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1.4], "line-opacity": 0.75 } });
  map.addLayer({ id: "ctrl-line", type: "line", source: "ctrl", layout: { "line-join": "round" }, paint: { "line-color": "#1f2326", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 4, 1.3, 7, 2.2], "line-opacity": 0.8 } });
  map.addLayer({ id: "ctrl-sel", type: "line", source: "ctrl", paint: { "line-color": INK, "line-width": 2.6,
    "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 1, 0] } });
  map.addLayer({ id: "unit-sel", type: "line", source: "units", paint: { "line-color": INK, "line-width": 2.6,
    "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 1, 0] } });
  map.addLayer({ id: "prov-sel", type: "line", source: "admin", paint: { "line-color": INK, "line-width": 2.4,
    "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 1, 0] } });
  map.addLayer({ id: "prov-hover", type: "line", source: "prov", paint: { "line-color": INK, "line-width": ["case", ["boolean", ["feature-state", "hov"], false], 1.4, 0] } });
  map.addLayer(riverLabel("river-lbl-a", "hydro", 3, 0, 4));
  map.addLayer(riverLabel("river-lbl-b", "hydro", 4.5, 5, 6));
  map.addLayer(riverLabel("river-lbl-c", "hydro", 5.5, 7, 8));
  map.addLayer(riverLabel("river-lbl-d", "hydro", 6.5, 9, 99));
  map.addLayer({ id: "prov-lbl", type: "symbol", source: "lbl-prov",
    filter: ["step", ["zoom"], false, 4, [">=", ["get", "a"], 30000], 5, [">=", ["get", "a"], 6000], 6, [">=", ["get", "a"], 1000], 7, true],
    layout: { "text-field": ["get", "n"], "text-font": ["sans"], "text-size": 11, "text-max-width": 8, "symbol-sort-key": ["-", 0, ["get", "a"]], "text-padding": 3 },
    paint: { "text-color": "#39423f", "text-halo-color": HALO, "text-halo-width": 1.3 } });
  setupCounties();
  map.addLayer({ id: "city", type: "symbol", source: "cities",
    filter: ["step", ["zoom"], ["<=", ["get", "r"], 0], 2.6, ["<=", ["get", "r"], 1], 3.8, true],
    layout: { "icon-image": ["get", "ic"], "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 6, 1],
      "text-field": ["get", "n"], "text-font": ["sans"], "text-size": 11.5, "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.8, "text-justify": "auto", "text-optional": true, "symbol-sort-key": ["get", "k"], "text-padding": 2 },
    paint: { "text-color": INK, "text-halo-color": HALO, "text-halo-width": 1.4 } });
  map.addLayer({ id: "country-lbl", type: "symbol", source: "lbl-country", filter: fitsFilter(),
    layout: { "text-field": ["get", "n"], "text-font": ["sans Medium"], "text-size": LABEL_PX, "text-letter-spacing": 0.04,
      "text-max-width": 30, "symbol-sort-key": ["get", "s"], "text-padding": 4 },
    paint: { "text-color": INK, "text-halo-color": HALO, "text-halo-width": 1.5 } });
  const [start, view] = (location.hash || "").slice(1).split("/");
  if (MODES.includes(view)) { state.mode = view; for (const x of document.querySelectorAll("[data-mode]")) x.setAttribute("aria-pressed", String(x.dataset.mode === view)); }
  applyBase();
  await loadSnap(index.snapshots.some((s) => s.snapshot === start) ? start : DEFAULT_SNAPSHOT);
  await new Promise((r) => map.once("idle", r));
  $("loading").hidden = true;
  getPacked("data/hydro.bin").then((h) => { state.hydro = h; map.getSource("hydro").setData(h); }).catch((e) => console.warn(e));
  map.on("zoomend", loadDetailHydro); loadDetailHydro();
  map.on("zoom", update3D);
  map.on("pitchstart", (e) => { if (e.originalEvent && !state.pitchEasing) state.userPitch = true; });  // tilted by hand: leave it
  // after the gesture has quite finished (its moveend comes before MapLibre's own end-of-drag work)
  map.on("moveend", () => { if (state.dropTerrain) setTimeout(update3D, 0); });
  map.on("moveend", () => { state.seenPitch = null; if (state.userPitch && !state.pitchEasing && map.getZoom() < T3D.from) easeToAutoPitch(); });
  $("t3d").onchange = () => { update3D(); easeToAutoPitch(); };
  update3D();
}

async function loadDetailHydro() {
  if (state.hydroDetail || state.hydroLoading || map.getZoom() < 4.3) return;
  state.hydroLoading = true;
  try {
    state.hydroDetail = await getPacked("data/hydro-detail.bin");
    map.addSource("hydro2", { type: "geojson", data: state.hydroDetail });
    const vis = $("tHydro").checked ? "visible" : "none";
    map.addLayer({ id: "hydro2-fill", type: "fill", source: "hydro2", minzoom: 4.3, filter: ["==", ["get", "k"], "l"], layout: { visibility: vis }, paint: { "fill-color": BASE[state.base].lake } }, "prov-line");
    map.addLayer({ id: "hydro2-line", type: "line", source: "hydro2", minzoom: 4.3, filter: RIVER_FILTER,
      layout: { "line-cap": "round", "line-join": "round", visibility: vis }, paint: riverPaint() }, "prov-line");
    setLabels();
  } catch (e) { console.warn(e); }
}

function wire(admin) {
  map.on("mousemove", queueMapHover);
  map.on("mouseout", clearMapHover);
  map.on("movestart", clearMapHover);
  map.on("click", (e) => {
    const county = countyHit(e);
    if (county) { selectCounty(county); return; }
    const f = map.queryRenderedFeatures(e.point, { layers: ["prov-fill"] })[0];
    if (f?.properties.s === state.snap) onClick(f.id); else if (!f && state.sel) clearSelection();
  });

  for (const b of document.querySelectorAll("[data-mode]")) b.onclick = () => setMode(b.dataset.mode);
  for (const b of document.querySelectorAll("[data-base]")) b.onclick = () => { state.base = b.dataset.base; store.set("2d-slg-map-base", state.base); applyBase(); };
  const vis = (id, layers) => $(id).onchange = () => layers.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", $(id).checked ? "visible" : "none"));
  vis("tProv", ["prov-line"]); vis("tTerrain", ["shade", "hillshade"]); vis("tCities", ["city"]);
  $("tHydro").onchange = () => { for (const l of ["hydro-fill", "hydro-line", "hydro2-fill", "hydro2-line"]) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", $("tHydro").checked ? "visible" : "none"); setLabels(); };
  $("tBorders").onchange = applyPaint; $("tApprox").onchange = applyPaint; $("tLabels").onchange = setLabels;
  if (window.innerWidth <= 760) { $("controls").classList.add("collapsed"); $("toggleSheet").textContent = "展开"; $("toggleSheet").setAttribute("aria-expanded", "false"); }
  $("toggleSheet").onclick = () => { const c = $("controls"); const cl = c.classList.toggle("collapsed"); $("toggleSheet").textContent = cl ? "展开" : "收起"; $("toggleSheet").setAttribute("aria-expanded", String(!cl)); };

  const names = admin.admin_id.map((_, ai) => [ai, col("name_zh", ai) || "", (col("name", ai) || "").toLowerCase(), (col("name_en", ai) || "").toLowerCase()]);
  $("q").oninput = async () => {
    const q = $("q").value.trim().toLowerCase(); const Rs = $("results"); Rs.replaceChildren(); if (q.length < 1) return;
    const snap = state.snap;
    const qs = [...new Set([q, q.replace(/台/g, "臺"), q.replace(/臺/g, "台")])];
    const rank = (t) => { let r = 9; if (!t) return r; for (const v of qs) r = Math.min(r, t === v ? 0 : t.startsWith(v) ? 1 : t.includes(v) ? 2 : 9); return r; };
    const sd = sdNow(); const live = new Set(sd.admin_active); const hits = [];
    for (const [ai, zh, nm, en] of names) {
      if (!live.has(ai)) continue;
      const r = Math.min(rank(zh), rank(nm), rank(en));
      if (r < 9) hits.push({ rank: r, name: adminName(ai), key: "province:" + ai,
        meta: [TIER[admin.tier[ai]][0].replace(/（.*）/, ""), col("parent_zh", ai) || col("parent", ai)].filter(Boolean).join(" · "),
        select: () => { const sd2 = sdNow(); const k = sd2.feature.findIndex((f) => admin.feature_admin[f] === ai); if (k >= 0) selectProvince(k, true); } });
    }
    try { hits.push(...await countySearch(q, rank)); } catch { countyStatus("县级查询暂不可用，可重试载入县界", true); }
    if (snap !== state.snap || $("q").value.trim().toLowerCase() !== q) return;
    hits.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length);
    const seen = new Set();
    for (const hit of hits) {
      if (seen.has(hit.key)) continue; seen.add(hit.key); if (seen.size > 8) break;
      const li = el("li"); const b = el("button"); b.type = "button";
      b.append(el("span", null, hit.name), el("span", "meta", hit.meta));
      b.onclick = hit.select;
      li.append(b); Rs.append(li);
    }
  };
}

function ensureLib() {
  if (!window.maplibregl) return fail(new Error("本地地图引擎载入失败"));
  return boot().catch(fail);
}
function fail(e) { console.error(e); $("loading").hidden = false; $("loading").textContent = "数据载入失败：" + (e && e.message ? e.message : e); }
ensureLib();
