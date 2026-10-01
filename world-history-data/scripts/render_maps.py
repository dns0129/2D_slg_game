"""Render one map per year from the database (preview of the data).

Equal Earth projection. Layers: hillshaded terrain, rivers and lakes valid
that year, historical units filled by de facto controller, present-day
admin-1 reference lines, population bubbles (area proportional to people)
with share-of-world labels, and population / GDP share bars by power.

Colour follows the entity, never its rank: four powers carry a fixed
categorical hue (a set that passes the all-pairs colour-vision checks);
everything else is neutral and identified by its label. Dependencies and
occupied units carry a 45-degree texture in the controller's hue.
"""
import json
import logging
import sqlite3
import sys
import textwrap
from multiprocessing import Pool

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.collections import PathCollection, PatchCollection
from matplotlib.patches import PathPatch
from matplotlib.path import Path
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from shapely import transform as shp_transform
from shapely.geometry import shape, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import unary_union

from common import WORK, MAPS, YEARS, HYDE_RES
from build_database import DB

logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
font_manager.fontManager.addfont(FONT)
plt.rcParams["font.family"] = font_manager.FontProperties(fname=FONT).get_name()

POWERS = {"200": "#2a78d6", "220": "#eb6834", "365": "#1baf7a", "740": "#4a3aa7"}  # UK, France, Russia/USSR, Japan
NEUTRAL = "#e6e2d8"
NEUTRAL_DEP = "#efece5"
LAND = "#f3f1eb"  # land outside any political unit (e.g. Antarctica)
OCEAN = "#dde7ee"
INK, INK2, MUTED, HAIR = "#0b0b0b", "#52514e", "#898781", "#c3c2b7"
RIVER = "#6f9fc4"
SURFACE = "#fcfcfb"

W_PX, H_PX, DPI = 2400, 1500, 150
BUBBLE_REF_POP = 1.3e9  # population drawn at the largest bubble size (China, 2000)
TR = Transformer.from_crs("EPSG:4326", "+proj=eqearth +datum=WGS84", always_xy=True)
XMAX, _ = TR.transform(180, 0)
_, YMAX = TR.transform(0, 90)


def proj(g):
    return shp_transform(g, lambda c: np.column_stack(TR.transform(c[:, 0], c[:, 1])))


def tint(hexc, f):
    c = np.array([int(hexc[i:i + 2], 16) for i in (1, 3, 5)]) / 255
    return tuple(1 - (1 - c) * f)


def poly_path(g):
    verts, codes = [], []
    polys = g.geoms if isinstance(g, MultiPolygon) else [g]
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            xy = np.asarray(ring.coords)
            if len(xy) < 3:
                continue
            verts.append(xy)
            codes.append(np.r_[Path.MOVETO, np.full(len(xy) - 2, Path.LINETO), Path.CLOSEPOLY])
    if not verts:
        return None
    return Path(np.vstack(verts), np.concatenate(codes))


def line_path(g):
    verts, codes = [], []
    lines = g.geoms if hasattr(g, "geoms") else [g]
    for ln in lines:
        if ln.geom_type == "Polygon":
            ln = ln.exterior
        xy = np.asarray(ln.coords)
        if len(xy) < 2:
            continue
        verts.append(xy)
        codes.append(np.r_[Path.MOVETO, np.full(len(xy) - 1, Path.LINETO)])
    if not verts:
        return None
    return Path(np.vstack(verts), np.concatenate(codes))


STATIC = {}


def load_static():
    con = sqlite3.connect(DB)
    st = {}
    st["units"] = {u: proj(shape(json.loads(g))) for u, g in con.execute("SELECT unit_id, geometry FROM units")}
    st["pieces"] = {}
    for pid, g in con.execute("SELECT piece_id, geometry FROM admin1_pieces"):
        p = line_path(proj(shape(json.loads(g)).boundary))
        if p is not None:
            st["pieces"][pid] = p
    st["label"] = {u: TR.transform(x, y) for u, x, y in con.execute("SELECT unit_id, label_lon, label_lat FROM units")}
    rivers = []
    for props, g in con.execute("SELECT properties, geometry FROM physical_features WHERE layer='rivers'"):
        p = json.loads(props)
        if p.get("scalerank") is not None and p["scalerank"] <= 6:
            rivers.append((p["scalerank"], line_path(proj(shape(json.loads(g))))))
    st["rivers"] = rivers
    land = [poly_path(proj(shape(json.loads(g)))) for (g,) in
            con.execute("SELECT geometry FROM physical_features WHERE layer='land'")]
    st["land"] = Path.make_compound_path(*[p for p in land if p is not None])
    lakes = []
    for props, g in con.execute("SELECT properties, geometry FROM physical_features WHERE layer='lakes'"):
        p = json.loads(props)
        if p.get("scalerank", 9) <= 6:
            lakes.append((p.get("valid_from"), p.get("valid_to"), poly_path(proj(shape(json.loads(g))))))
    st["lakes"] = lakes
    # hillshade reprojected to the output pixel grid (multiply layer)
    hs = np.asarray(Image.open(WORK / "physical" / "hillshade_5m.png"), dtype=np.float32)
    nx, ny = 2000, int(2000 * YMAX / XMAX)
    dst = np.full((ny, nx), 255, dtype=np.float32)
    reproject(hs, dst, src_transform=from_origin(-180, 90, HYDE_RES, HYDE_RES), src_crs="EPSG:4326",
              dst_transform=from_origin(-XMAX, YMAX, 2 * XMAX / nx, 2 * YMAX / ny),
              dst_crs="+proj=eqearth +datum=WGS84", resampling=Resampling.bilinear, dst_nodata=255)
    rgba = np.zeros((ny, nx, 4), dtype=np.float32)
    rgba[..., 3] = np.clip((255 - dst) / 255 * 0.9, 0, 1)
    st["shade"] = rgba
    # map frame (outline of the globe)
    lon = np.r_[np.full(181, -180), np.linspace(-180, 180, 361), np.full(181, 180), np.linspace(180, -180, 361)]
    lat = np.r_[np.linspace(-90, 90, 181), np.full(361, 90), np.linspace(90, -90, 181), np.full(361, -90)]
    fx, fy = TR.transform(lon, lat)
    st["frame"] = Path(np.column_stack([fx, fy]))
    con.close()
    return st


def colour(code, dependent):
    base = POWERS.get(str(code))
    if base is None:
        return NEUTRAL_DEP if dependent else NEUTRAL, None
    return (tint(base, 0.30) if dependent else tint(base, 0.48)), base


def render(year):
    st = STATIC
    con = sqlite3.connect(DB)
    yr = con.execute("SELECT world_population, world_gdp_2011usd, n_units, n_independent, n_dependent, "
                     "population_pattern, snapshot_date FROM years WHERE year=?", (year,)).fetchone()
    rows = con.execute("SELECT unit_id, name_zh, name_en, cshapes_status, controller_gwcode, sovereign_gwcode, "
                       "control_event, population, pop_share_world, area_km2, controller_name_zh "
                       "FROM unit_year WHERE year=? ORDER BY population DESC", (year,)).fetchall()
    pieces = [r[0] for r in con.execute("SELECT DISTINCT piece_id FROM admin1_year WHERE year=?", (year,))]
    sov = {b: con.execute("SELECT sovereign_gwcode, sovereign_name_zh, sovereign_name_en, pop_share_world, gdp_share_world "
                          "FROM sovereign_year WHERE year=? AND basis=? ORDER BY population DESC", (year, b)).fetchall()
           for b in ("de_facto",)}
    partial = con.execute("SELECT DISTINCT e.event_id, COALESCE(u.name_zh, e.unit_name), e.controller_name_zh, e.control_type "
                          "FROM control_events e LEFT JOIN unit_year u ON u.year=? AND u.cshapes_name=e.unit_name "
                          "AND u.gwcode=e.unit_gwcode WHERE e.scope='partial' AND e.start_date<=? AND e.end_date>=?",
                          (year, yr[6], yr[6])).fetchall()
    con.close()

    fig = plt.figure(figsize=(W_PX / DPI, H_PX / DPI), dpi=DPI, facecolor=SURFACE)
    ax = fig.add_axes([0.01, 0.20, 0.98, 0.74])
    ax.set_xlim(-XMAX * 1.005, XMAX * 1.005)
    ax.set_ylim(-YMAX * 1.01, YMAX * 1.01)
    ax.set_aspect("equal")
    ax.axis("off")
    frame = PathPatch(st["frame"], facecolor=OCEAN, edgecolor=HAIR, lw=0.6, zorder=0)
    ax.add_patch(frame)
    ax.add_patch(PathPatch(st["land"], facecolor=LAND, edgecolor="none", zorder=0.5))

    # units
    by_ctrl = {}
    for (uid, nzh, nen, status, ctrl, sovc, ev, pop, share, area, cnz) in rows:
        g = st["units"][uid]
        path = poly_path(g)
        if path is None:
            continue
        dependent = status != "independent" or ev is not None
        fc, base = colour(ctrl, dependent)
        hatch_c = base or MUTED
        ax.add_patch(PathPatch(path, facecolor=fc, edgecolor="none", lw=0, zorder=1))
        if dependent:
            ax.add_patch(PathPatch(path, facecolor="none", edgecolor=tint(hatch_c, 0.55), hatch="////", lw=0, zorder=1.1))
        by_ctrl.setdefault(str(ctrl), []).append(g)

    shade = ax.imshow(st["shade"], extent=(-XMAX, XMAX, -YMAX, YMAX), zorder=2, interpolation="bilinear")
    shade.set_clip_path(frame)

    # hydrography
    lake_paths = [p for vf, vt, p in st["lakes"]
                  if p is not None and not (vf is not None and vf > year) and not (vt is not None and vt < year)]
    if lake_paths:
        ax.add_patch(PathPatch(Path.make_compound_path(*lake_paths), facecolor=OCEAN, edgecolor=RIVER, lw=0.2, zorder=3))
    for sr in sorted({sr for sr, _ in st["rivers"]}):
        ps = [p for r, p in st["rivers"] if r == sr and p is not None]
        if ps:
            ax.add_patch(PathPatch(Path.make_compound_path(*ps), facecolor="none", edgecolor=RIVER,
                                   lw=max(0.25, 0.9 - sr * 0.1), zorder=3, capstyle="round"))

    # admin-1 reference lines, unit borders, controller borders
    pp = [st["pieces"][pid] for pid in pieces if pid in st["pieces"]]
    if pp:
        ax.add_patch(PathPatch(Path.make_compound_path(*pp), facecolor="none", edgecolor=INK2, lw=0.12, alpha=0.35,
                               zorder=4))
    up = [p for p in (line_path(st["units"][uid].boundary) for (uid, *_r) in rows) if p is not None]
    ax.add_patch(PathPatch(Path.make_compound_path(*up), facecolor="none", edgecolor=INK2, lw=0.35, zorder=5))
    for code, gs in by_ctrl.items():
        if len(gs) > 1:
            u = unary_union([g.buffer(0) for g in gs])
            p = line_path(u.boundary)
            if p is not None:
                ax.add_patch(PathPatch(p, facecolor="none", edgecolor=INK, lw=0.7, zorder=6))
    ax.add_patch(PathPatch(st["frame"], facecolor="none", edgecolor=HAIR, lw=0.6, zorder=7))

    # population bubbles (area proportional to population)
    pops = np.array([r[7] for r in rows])
    xy = np.array([st["label"][r[0]] for r in rows])
    # fixed scale across years so bubbles are comparable over time
    sizes = 2600.0 * pops / BUBBLE_REF_POP
    ax.scatter(xy[:, 0], xy[:, 1], s=sizes, facecolor=(0.04, 0.04, 0.04, 0.22), edgecolor=SURFACE, lw=1.0, zorder=8)

    # labels: largest populations first, skip collisions
    placed = []
    r_ = fig.canvas.get_renderer()
    n_lab = 0
    for i, (uid, nzh, nen, status, ctrl, sovc, ev, pop, share, area, cnz) in enumerate(rows):
        if n_lab >= 26 or (share < 0.004 and area < 1.5e6):
            continue
        name = nzh or nen
        txt = f"{name}\n{share * 100:.1f}%" if share >= 0.004 else name
        t = ax.text(xy[i, 0], xy[i, 1], txt, fontsize=6.6 if share >= 0.02 else 5.6, color=INK, ha="center",
                    va="center", zorder=9, linespacing=1.0)
        bb = t.get_window_extent(renderer=r_).expanded(1.05, 1.1)
        if any(bb.overlaps(o) for o in placed):
            t.remove()
            continue
        placed.append(bb)
        n_lab += 1

    # title and summary
    fig.text(0.015, 0.975, f"{year} 年 世界政治控制 · 人口分布 · 地形", fontsize=17, color=INK, va="top", weight="bold")
    fig.text(0.015, 0.947,
             f"快照日期 {yr[6]}　世界人口 {yr[0] / 1e8:.2f} 亿　世界GDP {yr[1] / 1e12:.2f} 万亿（2011年国际元）　"
             f"政治单元 {yr[2]}（独立 {yr[3]}，附属/占领 {yr[4]}）",
             fontsize=8.5, color=INK2, va="top")

    # legend (powers + neutral + textures)
    lx = fig.add_axes([0.015, 0.02, 0.27, 0.165])
    lx.axis("off")
    lx.set_xlim(0, 1)
    lx.set_ylim(0, 1)
    items = [("200", "英国"), ("220", "法国"), ("365", "俄国/苏联"), ("740", "日本"), (None, "其他国家")]
    for k, (code, lab) in enumerate(items):
        yy = 0.93 - k * 0.12
        base = POWERS.get(code) if code else None
        lx.add_patch(plt.Rectangle((0.0, yy - 0.04), 0.07, 0.08, facecolor=tint(base, 0.48) if base else NEUTRAL,
                                   edgecolor=INK2, lw=0.4))
        lx.add_patch(plt.Rectangle((0.09, yy - 0.04), 0.07, 0.08, facecolor=tint(base, 0.30) if base else NEUTRAL_DEP,
                                   edgecolor=INK2, lw=0.4))
        lx.add_patch(plt.Rectangle((0.09, yy - 0.04), 0.07, 0.08, facecolor="none", hatch="////",
                                   edgecolor=tint(base or MUTED, 0.55), lw=0))
        lx.text(0.18, yy, lab, fontsize=7.5, color=INK, va="center")
    lx.text(0.0, 0.0, "左：本土/独立　右（斜线）：殖民地·保护国·委任统治·占领区\n"
                       "粗线：同一实际控制者的外界　细线：历史政治单元　浅细线：现代一级行政区（参考）\n"
                       "圆点面积 ∝ 人口（各年同一比例尺），数字为占世界人口比例", fontsize=6.2, color=INK2, va="bottom", linespacing=1.4)

    # share bars by de facto controller: population and GDP (two charts, one axis each)
    for j, (col, title) in enumerate(((3, "占世界人口比例（按实际控制者）"), (4, "占世界GDP比例（按实际控制者）"))):
        top = sorted(sov["de_facto"], key=lambda t: -(t[col] or 0))[:8]
        bx = fig.add_axes([0.35 + j * 0.25, 0.03, 0.19, 0.13])
        vals = [t[col] * 100 for t in top]
        names = [(t[1] or t[2] or "?")[:9] for t in top]
        cols = [POWERS.get(str(t[0]), MUTED) for t in top]
        bx.barh(range(len(top))[::-1], vals, color=cols, height=0.62)
        bx.set_yticks(range(len(top))[::-1], names, fontsize=6.5, color=INK)
        for k, v in enumerate(vals):
            bx.text(v + max(vals) * 0.02, len(top) - 1 - k, f"{v:.1f}%", fontsize=6, va="center", color=INK2)
        bx.set_xlim(0, max(vals) * 1.25)
        bx.set_title(title, fontsize=7.5, color=INK, loc="left", pad=3)
        bx.tick_params(axis="x", labelsize=5.5, colors=MUTED, length=0)
        bx.tick_params(axis="y", length=0)
        for s in bx.spines.values():
            s.set_visible(False)
        bx.grid(axis="x", color=HAIR, lw=0.4)
        bx.set_axisbelow(True)

    # partial control notes + sources
    if partial:
        lines = ["局部控制（未画边界）："] + [f"· {p[1]}：{p[2]}" for p in partial[:7]]
        if len(partial) > 7:
            lines.append(f"· 另 {len(partial) - 7} 项，见 control_events")
        fig.text(0.83, 0.175, "\n".join(textwrap.shorten(l, 30, placeholder="…") for l in lines),
                 fontsize=5.8, color=INK2, va="top", linespacing=1.35)
    fig.text(0.83, 0.075,
             "边界 CShapes 2.0；人口 UN WPP / Gapminder / COW NMC，\n空间分布 GHS-POP；GDP Maddison 2020 / Gapminder；\n"
             "地形 Terrarium；水系 Natural Earth。人口分布模式：" + yr[5],
             fontsize=5.4, color=MUTED, va="top", linespacing=1.4)

    out = MAPS / f"{year}.png"
    fig.savefig(out, dpi=DPI, facecolor=SURFACE)
    plt.close(fig)
    im = Image.open(out).convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    im.save(out, optimize=True)
    return year


def _init():
    global STATIC
    STATIC = load_static()


if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or YEARS
    with Pool(4, initializer=_init) as pool:
        for y in pool.imap_unordered(render, years):
            print("map", y, flush=True)
