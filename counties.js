// Fine divisions are static data, fetched only for visible provinces at close zoom.
// The province parcel supplies the political unit, bloc and controller in each view.
const countyState = { indexes: new Map(), chunks: new Map(), rendered: new Map(), ticket: 0,
  selectionTicket: 0, hover: null, painted: new Map(), error: false };
const COUNTY_ZOOM = 6;
const countyEmpty = () => ({ type: "FeatureCollection", features: [] });
const countyLevel = (p) => p.t === 1 ? "县级" : "地区级";
const countyArea = (a) => a < 1 ? a.toFixed(3) + " km²" : km2(a);
const countyLabel = (name) => /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Ideo}\s.,'’\-–()/·]+$/u.test(name) ? halfwidth(name) : null;

function countyIndex(snap) {
  if (!countyState.indexes.has(snap)) {
    const promise = getPacked(`data/counties/index-${snap}.bin`).catch((e) => {
      countyState.indexes.delete(snap); throw e;
    });
    countyState.indexes.set(snap, promise);
  }
  return countyState.indexes.get(snap);
}

function countyChunk(region) {
  const key = region.file;
  if (countyState.chunks.has(key)) {
    const value = countyState.chunks.get(key);
    countyState.chunks.delete(key); countyState.chunks.set(key, value);
    return value;
  }
  const promise = getPacked(`data/counties/${key}`).catch((e) => {
    countyState.chunks.delete(key); throw e;
  });
  countyState.chunks.set(key, promise);
  // Retain a modest cache; moving the map does not accumulate the whole world.
  while (countyState.chunks.size > 32) countyState.chunks.delete(countyState.chunks.keys().next().value);
  return promise;
}

function countyStatus(text, failed = false) {
  $("countyStatus").textContent = text;
  $("countyRetry").hidden = !failed;
  countyState.error = failed;
}

function countyClearRendered() {
  if (!map.getSource("counties")) return;
  if (countyState.hover !== null) $("tip").hidden = true;
  countyState.rendered.clear(); countyState.painted.clear(); countyState.hover = null;
  map.removeFeatureState({ source: "counties" });
  map.getSource("counties").setData(countyEmpty());
  map.getSource("lbl-county").setData(countyEmpty());
}

function countyReset() {
  countyState.ticket++; countyState.selectionTicket++;
  countyClearRendered();
  map.getSource("county-selected-label").setData(countyEmpty());
}

function countyPaint() {
  if (!map.getLayer("county-fill")) return;
  const on = $("tCounties").checked;
  for (const layer of ["county-fill", "county-line", "county-selected"])
    map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
  map.setLayoutProperty("county-lbl", "visibility", on && $("tLabels").checked ? "visible" : "none");
  map.setLayoutProperty("county-selected-label", "visibility", on && $("tLabels").checked ? "visible" : "none");
  map.setPaintProperty("county-fill", "fill-color", fillColor());
  const s = state.sel;
  for (const [id, f] of countyState.rendered) {
    const selected = !!(s?.level === "county" && s.county.properties.g === f.properties.g);
    if (countyState.painted.get(id) !== selected) {
      map.setFeatureState({ source: "counties", id }, { sel: selected });
      countyState.painted.set(id, selected);
    }
  }
  const f = s?.level === "county" ? s.county : null;
  map.getSource("county-selected-label").setData(f && countyLabel(f.properties.n) ? {
    type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: f.properties.xy },
      properties: { n: countyLabel(f.properties.n) } }]
  } : countyEmpty());
  redrawDraped();
}

function countyViewportRegions(index) {
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
  return index.regions.filter((r) => r.bbox[0] <= east && r.bbox[2] >= west && r.bbox[1] <= north && r.bbox[3] >= south);
}

async function refreshCounties() {
  if (!state.snap || !map.getSource("counties")) return;
  const snap = state.snap, ticket = ++countyState.ticket;
  if (!$("tCounties").checked) {
    countyClearRendered(); countyStatus("县级 / 地区级图层已关闭"); return;
  }
  try {
    const index = await countyIndex(snap);
    if (ticket !== countyState.ticket || snap !== state.snap) return;
    if (map.getZoom() < COUNTY_ZOOM) {
      countyClearRendered();
      countyStatus(`放大查看县界 · 已收录 ${index.units.toLocaleString()} 个细分单位`); return;
    }
    const regions = countyViewportRegions(index);
    if (!regions.length) {
      countyClearRendered(); countyStatus("此区域暂无细分界线资料，继续显示省级地块"); return;
    }
    countyStatus("正在载入此区域的县级 / 地区级界线…");
    const batches = new Array(regions.length); let next = 0, failures = 0;
    await Promise.all(Array.from({ length: Math.min(4, regions.length) }, async () => {
      while (next < regions.length && ticket === countyState.ticket && snap === state.snap) {
        const i = next++;
        try { batches[i] = await countyChunk(regions[i]); } catch { failures++; }
      }
    }));
    if (ticket !== countyState.ticket || snap !== state.snap || !$("tCounties").checked) return;
    const sd = sdNow();
    const features = batches.filter(Boolean).flatMap((b) => b.features).map((f) => {
      const k = f.properties.k;
      return { ...f, properties: { ...f.properties, b: sd.bloc[k], c: sd.country[k], u: unitKey(sd, k),
        col: sd.countries[sd.country[k]][3], nc: sd.nations[sd.nation[k]][3] } };
    });
    countyState.rendered = new Map(features.map((f) => [f.id, f]));
    countyState.painted.clear(); countyState.hover = null;
    map.removeFeatureState({ source: "counties" });
    map.getSource("counties").setData({ type: "FeatureCollection", features });
    // Let the map handle collisions; never replace a real small polygon with a marker.
    const labels = features.filter((f) => countyLabel(f.properties.n))
      .map((f) => ({ type: "Feature", id: f.id, geometry: { type: "Point", coordinates: f.properties.xy },
        properties: { n: countyLabel(f.properties.n), a: f.properties.area } }));
    map.getSource("lbl-county").setData({ type: "FeatureCollection", features: labels });
    countyPaint();
    countyStatus(failures ? "部分县界暂未载入，可重试；省级地图仍可使用" :
      "县界已载入 · 点击小区块查看详情和资料年份", failures > 0);
  } catch {
    if (ticket === countyState.ticket && snap === state.snap)
      countyStatus("县界暂未载入，可重试；省级地图仍可使用", true);
  }
}

function showCounty(f, index) {
  const p = f.properties, sd = sdNow(), k = p.k, cid = countryOf(sd, k);
  const D = panel(), crumbs = el("div", "crumbs");
  const nation = el("button", null, countryName(sd, cid, k)); nation.type = "button";
  nation.onclick = () => selectCountry(cid, false, k);
  const province = el("button", null, adminName(p.p)); province.type = "button";
  province.onclick = () => selectProvince(k, false);
  crumbs.append(nation, el("span", null, "›"), province, el("span", null, "›"), el("span", "here", countyLevel(p)));
  const head = el("div", "title"); head.append(el("h2", null, p.n));
  const source = index.sources[p.ds];
  D.append(crumbs, head, chips([[countyLevel(p), "hist"], [blocName(sd, BLOCS[sd.bloc[k]])],
    ...(p.split ? [["此处为跨省界 / 控制线区块的一部分", "approx"]] : [])]));
  const [dl, add] = kvList();
  add("原名", p.local && p.local !== p.n ? p.local : null);
  add("区划代码", p.code); add("类别", p.kind); add("所在省份", adminName(p.p));
  add("法理国家", L(sd, "unit_name_zh", k) || L(sd, "unit_name_en", k));
  add("实际控制国", country(sd, sd.country[k]).zh);
  add("控制性质", TYPE_ZH[L(sd, "control_type", k)] || L(sd, "control_type", k));
  add("此块面积", countyArea(p.area)); add("界线资料年份", source.year);
  if (p.start || p.end) add("施行期间", `${p.start || "?"} – ${p.end || "此后"}`);
  add("界线依据", BASIS_ZH[p.basis] || p.basis);
  add("备注", p.note); add("资料来源", p.src || source.name); add("许可", source.license);
  D.append(dl, el("p", "foot", source.note));
  if (isModern(sd)) D.append(el("p", "foot", "国家、阵营和控制国继承现有 2026 省级地图的判定；县级细分不增加新的控制线或县级人口估计。"));
  const link = el("a", null, "查看原始图源"); link.href = source.url;
  link.target = "_blank"; link.rel = "noopener noreferrer"; D.append(link);
}

async function selectCounty(f, fly = false) {
  const snap = state.snap, ticket = ++countyState.selectionTicket;
  const index = await countyIndex(snap);
  if (snap !== state.snap || ticket !== countyState.selectionTicket) return;
  const k = f.properties.k;
  state.sel = { level: "county", country: countryOf(sdNow(), k), admin: f.properties.p, piece: k, county: f };
  $("tCounties").checked = true;
  applyPaint(); showCounty(f, index);
  if (fly) map.fitBounds(geoBounds(f.geometry.coordinates), { padding: window.innerWidth <= 760 ? 70 : 80, maxZoom: 12, duration: 650 });
  else countyPaint();
}

async function selectCountyResult(entry, index) {
  const snap = state.snap, ticket = ++countyState.selectionTicket;
  try {
    const region = index.regions.find((r) => r.p === entry[2]);
    const data = await countyChunk(region);
    if (snap !== state.snap || ticket !== countyState.selectionTicket) return;
    const f = data.features.find((f) => f.id === entry[0]);
    if (f) await selectCounty(f, true);
  } catch {
    if (snap === state.snap) countyStatus("所选县界暂未载入，请重试查询", true);
  }
}

async function countySearch(q, rank) {
  const snap = state.snap;
  const index = await countyIndex(snap);
  if (snap !== state.snap || $("q").value.trim().toLowerCase() !== q) return [];
  return index.search.map((entry) => ({ entry, rank: rank(entry[1].toLowerCase()) }))
    .filter((h) => h.rank < 9).sort((a, b) => a.rank - b.rank || a.entry[1].length - b.entry[1].length)
    .slice(0, 8).map(({ entry, rank }) => ({ rank, name: entry[1], key: entry[1] + "|" + entry[2],
      meta: `${entry[6] === 1 ? "县级" : "地区级"} · ${adminName(entry[2])}`,
      select: () => selectCountyResult(entry, index) }));
}

function countyHit(e) {
  if (!$("tCounties").checked || map.getZoom() < COUNTY_ZOOM) return null;
  const f = map.queryRenderedFeatures(e.point, { layers: ["county-fill"] })[0];
  return f ? countyState.rendered.get(f.id) : null;
}

function countyTip(e, f) {
  const p = f.properties, sd = sdNow(), k = p.k, tip = $("tip"); tip.replaceChildren();
  tip.append(el("b", null, p.n), el("div", null, `${countyLevel(p)} · ${adminName(p.p)}`),
    el("div", null, `实际控制：${country(sd, sd.country[k]).zh}`), el("span", "num", countyArea(p.area)));
  tip.hidden = false;
  const r = map.getContainer().getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(e.point.x + 14, r.width - 270)) + "px";
  tip.style.top = Math.max(4, Math.min(e.point.y + 14, r.height - tip.offsetHeight - 4)) + "px";
}

function setupCounties() {
  for (const source of ["counties", "lbl-county", "county-selected-label"])
    map.addSource(source, { type: "geojson", data: countyEmpty(), tolerance: .03, maxzoom: 14 });
  map.addLayer({ id: "county-fill", type: "fill", source: "counties", minzoom: COUNTY_ZOOM,
    paint: { "fill-color": fillColor(), "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], .48,
      ["boolean", ["feature-state", "hov"], false], .18, 0] } }, "prov-line");
  map.addLayer({ id: "county-line", type: "line", source: "counties", minzoom: COUNTY_ZOOM,
    paint: { "line-color": "#58675f", "line-width": ["interpolate", ["linear"], ["zoom"], 6, .4, 10, .85],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, .25, 8, .65] } }, "prov-line");
  map.addLayer({ id: "county-selected", type: "line", source: "counties", minzoom: COUNTY_ZOOM,
    paint: { "line-color": "#914926", "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.7,
      ["boolean", ["feature-state", "hov"], false], 1.4, 0] } });
  map.addLayer({ id: "county-lbl", type: "symbol", source: "lbl-county", minzoom: 6.5,
    filter: ["step", ["zoom"], [">=", ["get", "a"], 1500], 7.5, [">=", ["get", "a"], 100], 9, true],
    layout: { "text-field": ["get", "n"], "text-font": ["sans"], "text-size": 10.5,
      "text-max-width": 7, "text-padding": 4, "symbol-sort-key": ["-", 0, ["get", "a"]] },
    paint: { "text-color": "#495d50", "text-halo-color": HALO, "text-halo-width": 1.3 } });
  map.addLayer({ id: "county-selected-label", type: "symbol", source: "county-selected-label", minzoom: COUNTY_ZOOM,
    layout: { "text-field": ["get", "n"], "text-font": ["sans"], "text-size": 12,
      "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#914926", "text-halo-color": HALO, "text-halo-width": 1.6 } });
  map.on("moveend", refreshCounties);
  $("tCounties").onchange = () => {
    countyState.selectionTicket++;
    if (!$("tCounties").checked && state.sel?.level === "county") selectProvince(state.sel.piece, false);
    countyPaint(); refreshCounties();
  };
  $("countyRetry").onclick = refreshCounties;
}
