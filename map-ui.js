// Measure the visible panels only when navigating, without rebuilding map data.
const smallMap = () => matchMedia("(max-width: 960px)").matches;
const motionDuration = (ms) => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;

function setControlsCollapsed(collapsed) {
  $("controls").classList.toggle("collapsed", collapsed);
  $("toggleSheet").textContent = collapsed ? "展开" : "收起";
  $("toggleSheet").setAttribute("aria-expanded", String(!collapsed));
}

function readingPadding() {
  const r = map.getContainer().getBoundingClientRect(), gap = smallMap() ? 14 : 24;
  const padding = { left: gap, right: gap, top: 64, bottom: gap };
  const visible = (id) => {
    const e = $(id);
    return !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : null;
  };
  const controls = visible("controls"), detail = visible("detail");
  if (smallMap()) {
    if (controls) padding.bottom = r.bottom - controls.top + gap;
    if (detail) padding.top = detail.bottom - r.top + gap;
  } else {
    if (controls) padding.left = controls.right - r.left + gap;
    if (detail) padding.right = r.right - detail.left + gap;
  }
  return padding;
}

function fitReadingBounds(bounds, maxZoom, duration = 550) {
  if (bounds) map.fitBounds(bounds, { padding: readingPadding(), maxZoom, duration: motionDuration(duration) });
}

function flyReadingProvince(ai) {
  const p = readingPadding();
  map.flyTo({ center: state.admin.label[ai], zoom: Math.max(map.getZoom(), state.admin.area[ai] > 2e5 ? 4.5 : 5.5),
    offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2], duration: motionDuration(550) });
}

function locateSelection() {
  const s = state.sel;
  if (!s) return;
  if (smallMap()) {
    setControlsCollapsed(true); $("detail").classList.remove("detail-expanded");
    const toggle = $("detail").querySelector(".detail-toggle");
    toggle.textContent = "展开详情"; toggle.setAttribute("aria-expanded", "false");
  }
  if (s.level === "county") fitReadingBounds(geoBounds(s.county.geometry.coordinates), 12);
  else if (s.level === "province") fitReadingBounds(geoBounds(state.adminGeo[s.admin]), 9);
  else {
    const sd = sdNow();
    fitReadingBounds(state.mode === "control" ? geoBounds(sd.ctrlGeo[sd.countries[s.country][8]]) : piecesBounds(piecesOf(s.country)), 6);
  }
}

function worldView(duration = 550) {
  clearSelection(); state.userPitch = false;
  map.fitBounds([[-178, -58], [178, 80]], { padding: readingPadding(), maxZoom: 2,
    pitch: 0, bearing: 0, duration: motionDuration(duration) });
}

function updatePresentation() {
  $("locateSelection").disabled = !state.sel;
  const z = map.getZoom();
  $("zoomLevel").textContent = z < 3.5 ? "世界视图" : z < COUNTY_ZOOM || !$("tCounties").checked ? "省级视图" : "县级视图 · 有资料地区";
  $("viewContext").textContent = { bloc: "阵营颜色 · 法理国界", nation: "法理国家颜色与国界", control: "控制国颜色与控制线" }[state.mode];
  $("borderKey").textContent = state.mode === "control" ? "控制线" : "国界";
  const key = $("colorKey"), sd = sdNow(), identity = `${state.snap}:${state.mode}`;
  key.hidden = state.mode !== "bloc";
  if (sd && key.dataset.identity !== identity) {
    key.dataset.identity = identity; key.replaceChildren();
    if (state.mode === "bloc") for (const b of BLOCS) {
      const item = el("span"), sw = el("i", "sw"); sw.style.background = BLOC_COLOR[b];
      item.append(sw, el("span", null, blocName(sd, b))); key.append(item);
    }
  }
}

function decorateDetail(D) {
  D.classList.remove("detail-expanded"); D.scrollTop = 0;
  if (smallMap()) setControlsCollapsed(true);
  const toggle = el("button", "detail-toggle", "展开详情");
  toggle.type = "button"; toggle.setAttribute("aria-expanded", "false");
  toggle.onclick = () => {
    const expanded = D.classList.toggle("detail-expanded");
    toggle.textContent = expanded ? "收起详情" : "展开详情";
    toggle.setAttribute("aria-expanded", String(expanded));
  };
  D.append(toggle); updatePresentation();
}

function setMapStyle(base) {
  state.base = base; store.set("2d-slg-map-style-v2", base);
  const terrain = base === "relief";
  $("tTerrain").checked = terrain; $("tTerrain").onchange();
  $("t3d").checked = terrain; state.userPitch = false;
  applyBase(); update3D(); easeToAutoPitch();
}

function wirePresentation() {
  setControlsCollapsed(smallMap());
  $("toggleSheet").onclick = () => setControlsCollapsed(!$("controls").classList.contains("collapsed"));
  $("worldView").onclick = () => worldView();
  $("locateSelection").onclick = locateSelection;
  $("focusMap").onclick = () => {
    const focused = document.body.classList.toggle("focus-map");
    $("focusMap").textContent = focused ? "显示面板" : "专注地图";
    $("focusMap").setAttribute("aria-pressed", String(focused));
  };
  map.on("zoomend", updatePresentation);
  $("q").onkeydown = (e) => {
    if (e.key === "ArrowDown") {
      const first = $("results").querySelector("button");
      if (first) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("q").value) {
      $("q").value = ""; $("results").replaceChildren(); $("searchStatus").hidden = true;
    } else if (document.body.classList.contains("focus-map")) $("focusMap").click();
    else if (state.sel) clearSelection();
  });
}
