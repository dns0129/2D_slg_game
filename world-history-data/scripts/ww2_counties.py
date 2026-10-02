"""Static county layer for 1939-1945, before snapshot-specific splitting.

Base: geoBoundaries (present-day) units at the level closest to a county for
each country, overlaps between country files removed.
Replaced by historical layers where they exist:
  United States (48 states + DC)  Newberry Atlas of Historical County Boundaries, dated versions
  Taiwan                          1930 gun/shi (Academia Sinica, via K. Lawson)
  Korea                           gun/bu reconstructed from NIKH 1914-1926 place records
  Burma                           1931 districts and states (K. Lawson)
Historical first-level parents attached where known (ROC provinces 1928-45,
Manchukuo provinces, Dutch East Indies residencies 1941, Indochina provinces,
Philippine provinces 1939, Indian princely states 1931, Korean provinces,
Taiwan prefectures, Japanese prefectures).

Output: work/ww2/counties.geojson (+ counties.csv without geometry).
"""
import json
import math
import re
import unicodedata
from collections import defaultdict

import numpy as np
import pandas as pd
import shapefile
from pyproj import Transformer
from shapely import STRtree, make_valid, voronoi_polygons
from shapely import transform as shp_transform
from shapely.geometry import MultiPoint, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from common import ROOT
from ww2_common import GB, WW2_RAW, WW2_WORK, TYPICAL_COUNTY_KM2

REPO_SRC = ROOT.parent / "previews" / "historical-atlas-v3" / "source"
LAW = WW2_RAW / "lawson"
EQ = Transformer.from_crs("EPSG:4326", "+proj=eqearth +datum=WGS84", always_xy=True)


def eq_area_km2(g):
    return shp_transform(g, lambda c: np.column_stack(EQ.transform(c[:, 0], c[:, 1]))).area / 1e6


def polys(g):
    g = make_valid(g)
    ps = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and not p.is_empty]
    ps += [q for p in getattr(g, "geoms", []) if p.geom_type == "MultiPolygon" for q in p.geoms]
    if not ps:
        return None
    return MultiPolygon(ps) if len(ps) > 1 else ps[0]


def read_geojson(path):
    d = json.load(open(path))
    return [(f["properties"], polys(shape(f["geometry"]))) for f in d["features"] if f.get("geometry")]


def gb_path(iso, lv):
    return GB / f"{iso}_{lv}_geoBoundaries-{iso}-{lv}_simplified.geojson"


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


# ---------------------------------------------------------------- base layer

def choose_levels():
    isos = sorted({p.name[:3] for p in GB.glob("*_simplified.geojson")})
    choice = {}
    for iso in isos:
        cands = {}
        for lv in ("ADM2", "ADM3"):
            if gb_path(iso, lv).exists():
                feats = read_geojson(gb_path(iso, lv))
                areas = [eq_area_km2(g) for _, g in feats if g is not None]
                if areas:
                    cands[lv] = (float(np.median(areas)), len(areas))
        if cands:
            lv = min(cands, key=lambda k: abs(math.log(max(cands[k][0], 1) / TYPICAL_COUNTY_KM2)))
            choice[iso] = (lv, *cands[lv])
            # communes are far finer than a county: use the first level instead
            if cands[lv][0] < 100 and cands[lv][1] >= 100 and gb_path(iso, "ADM1").exists():
                a1 = [eq_area_km2(g) for _, g in read_geojson(gb_path(iso, "ADM1")) if g is not None]
                if len(a1) >= 8 and np.median(a1) <= 20000:
                    choice[iso] = ("ADM1", float(np.median(a1)), len(a1))
        elif gb_path(iso, "ADM1").exists():
            choice[iso] = ("ADM1", None, None)
    return choice


def load_base(choice):
    rows = []
    for iso, (lv, _, _) in sorted(choice.items()):
        adm1 = read_geojson(gb_path(iso, "ADM1")) if gb_path(iso, "ADM1").exists() and lv != "ADM1" else []
        a1 = [g for _, g in adm1 if g is not None]
        a1n = [p.get("shapeName") for p, g in adm1 if g is not None]
        tree = STRtree(a1) if a1 else None
        adm2 = read_geojson(gb_path(iso, "ADM2")) if lv == "ADM3" and gb_path(iso, "ADM2").exists() else []
        a2 = [g for _, g in adm2 if g is not None]
        a2n = [p.get("shapeName") for p, g in adm2 if g is not None]
        tree2 = STRtree(a2) if a2 else None
        for p, g in read_geojson(gb_path(iso, lv)):
            if g is None:
                continue
            rp = g.representative_point()
            parent = None
            if tree is not None:
                hit = tree.query(rp, predicate="within")
                if len(hit) == 0:
                    hit = [tree.nearest(rp)]
                parent = a1n[hit[0]]
            elif lv == "ADM1":
                parent = p.get("shapeName")
            parent2 = None
            if tree2 is not None:
                hit = tree2.query(rp, predicate="within")
                parent2 = a2n[hit[0] if len(hit) else tree2.nearest(rp)]
            rows.append(dict(county_id=f"{iso}-{lv}-{p.get('shapeID')}", name=p.get("shapeName"), iso3=iso, gb_level=lv,
                             adm1_modern=parent, adm2_modern=parent2, basis="modern_proxy",
                             source="geoBoundaries gbOpen (present-day boundaries)", geom=g))
    return rows


def fill_gaps(rows, choice):
    """Add first-level areas that the chosen county level does not cover (e.g. Moscow and
    St Petersburg have no district polygons in geoBoundaries)."""
    by_iso = defaultdict(list)
    for r in rows:
        by_iso[r["iso3"]].append(r["geom"])
    added = []
    for iso, (lv, _, _) in choice.items():
        if lv == "ADM1" or not gb_path(iso, "ADM1").exists() or iso not in by_iso:
            continue
        tree = STRtree(by_iso[iso])
        for p, g in read_geojson(gb_path(iso, "ADM1")):
            if g is None:
                continue
            near = [by_iso[iso][i] for i in tree.query(g, predicate="intersects")]
            covered = unary_union(near).intersection(g).area if near else 0
            if covered < 0.8 * g.area:
                rest = polys(g.difference(unary_union(near)) if near else g)
                if rest is None or rest.area < 0.2 * g.area:
                    continue
                added.append(dict(county_id=f"{iso}-ADM1fill-{p.get('shapeID')}", name=p.get("shapeName"), iso3=iso,
                                  gb_level="ADM1 (gap fill)", adm1_modern=p.get("shapeName"), basis="modern_proxy",
                                  source="geoBoundaries gbOpen first level, where no county-level polygon exists",
                                  geom=rest))
    print("gap-filled first-level areas:", len(added), [a["name"] for a in added][:20])
    return rows + added


def drop_overlaps(rows):
    """Disputed areas appear in several country files; keep the first."""
    geoms = [r["geom"] for r in rows]
    tree = STRtree(geoms)
    area = np.array([g.area for g in geoms])
    keep = np.ones(len(rows), bool)
    for i, g in enumerate(geoms):
        if not keep[i]:
            continue
        for j in tree.query(g, predicate="intersects"):
            if j <= i or not keep[j] or rows[j]["iso3"] == rows[i]["iso3"]:
                continue
            inter = g.intersection(geoms[j]).area
            if inter > 0.5 * area[j]:
                keep[j] = False
    print("dropped overlapping units:", int((~keep).sum()))
    return [r for r, k in zip(rows, keep) if k]


# ---------------------------------------------------------------- historical layers

def us_counties():
    out = []
    for p, g in read_geojson(WW2_RAW / "us_histcounties.geojson"):
        if g is None or p["END_N"] < 19390101 or p["START_N"] > 19451231:
            continue
        if p["STATE_TERR"] in ("Alaska", "Hawaii"):
            continue
        out.append(dict(county_id=f"US-AHCB-{p['ID']}-v{p['VERSION']}", name=p["NAME"].title(), iso3="USA",
                        gb_level="historical", adm1_modern=p["STATE_TERR"], basis="historical_dated",
                        source="Newberry Library, Atlas of Historical County Boundaries (CC0), via USAboundariesData",
                        valid_from=str(p["START_N"]), valid_to=str(p["END_N"]),
                        hist_parent=p["STATE_TERR"], hist_parent_kind="state", hist_parent_basis="historical_dated",
                        county_kind=p.get("CNTY_TYPE"), geom=g))
    return out


def read_projected(path, epsg):
    tr = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    return [(p, polys(shp_transform(g, lambda c: np.column_stack(tr.transform(c[:, 0], c[:, 1])))))
            for p, g in read_geojson(path)]


def taiwan():
    shu = read_projected(LAW / "taiwan_1930_shu.geojson", 3826)
    tree = STRtree([g for _, g in shu])
    out = []
    for p, g in read_projected(LAW / "taiwan_1930.geojson", 3826):
        par = shu[tree.query(g.representative_point(), predicate="within")[0]][0] \
            if len(tree.query(g.representative_point(), predicate="within")) else shu[tree.nearest(g.representative_point())][0]
        out.append(dict(county_id=f"TW1930-{p['ID']}", name=p["NAME"], name_zh=p["NAMEC"], iso3="TWN",
                        gb_level="historical", adm1_modern=None, basis="historical_1930",
                        source="Academia Sinica, Taiwan 1930 gun/shi boundaries (CC BY-NC-SA 4.0), via K. Lawson",
                        hist_parent=par["NAME"], hist_parent_zh=par["NAME"], hist_parent_kind=par["TYPE"],
                        hist_parent_basis="historical_1930", county_kind=p["NAME"][-1], geom=g))
    return out


VARIANT = str.maketrans({"淸": "清", "尙": "尚", "黃": "黄", "慶": "慶", "羅": "羅", "咸": "咸", "鏡": "鏡"})


def korea():
    kcsv = pd.read_csv(REPO_SRC / "korea.csv")
    prov = {}
    for p, g in read_geojson(LAW / "korea_13_provinces_fine.json"):
        row = kcsv[kcsv.key == p["shapeName"]].iloc[0]
        prov[row.zh.translate(VARIANT)] = (row.key, row.zh, row.en, g)
    r = shapefile.Reader(str(LAW / "place_modern_open.shp"), encoding="utf-8")
    pts = defaultdict(list)
    for rec in r.records():
        lv1 = (rec["adm_lv1"] or "").translate(VARIANT)
        lv2 = (rec["adm_lv2"] or "").strip()
        if lv1 in prov and re.search(r"(郡|府|島)$", lv2):
            pts[lv1].append((float(rec["long"]), float(rec["lat"]), lv2.translate(VARIANT)))
    tr = Transformer.from_crs("EPSG:4326", "EPSG:5179", always_xy=True)
    inv = Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)
    to_m = lambda g: shp_transform(g, lambda c: np.column_stack(tr.transform(c[:, 0], c[:, 1])))
    to_ll = lambda g: shp_transform(g, lambda c: np.column_stack(inv.transform(c[:, 0], c[:, 1])))
    out = []
    for lv1, (key, zh, en, pg) in prov.items():
        p = pts.get(lv1, [])
        uniq = {}
        for x, y, n in p:
            uniq.setdefault((round(x, 5), round(y, 5)), n)
        xy = np.array([tr.transform(x, y) for (x, y) in uniq])
        names = list(uniq.values())
        pm = to_m(pg)
        cells = voronoi_polygons(MultiPoint(xy), extend_to=pm.envelope.buffer(50000))
        groups = defaultdict(list)
        cell_tree = STRtree(list(cells.geoms))
        for k, (x, y) in enumerate(xy):
            from shapely.geometry import Point
            hit = cell_tree.query(Point(x, y), predicate="intersects")
            if len(hit):
                groups[names[k]].append(cells.geoms[hit[0]])
        for gun, cs in groups.items():
            g = unary_union(cs).intersection(pm)
            g = polys(to_ll(g))
            if g is None:
                continue
            out.append(dict(county_id=f"KR1914-{key}-{gun}", name=gun, name_zh=gun, iso3="KOR/PRK", gb_level="historical",
                            adm1_modern=None, basis="reconstructed_1914_1926",
                            source="Reconstructed (Voronoi of township/facility points) from NIKH Modern Geographic "
                                   "Information DB 1914-1926, clipped to K. Lawson's 13 provinces",
                            hist_parent=en, hist_parent_zh=zh, hist_parent_kind="道", hist_parent_basis="historical_1941",
                            county_kind=gun[-1], geom=g))
    return out


def burma():
    out = []
    for k, (p, g) in enumerate(read_geojson(LAW / "burma-1931-admin-units.geojson")):
        name = p.get("name") or f"{p.get('group') or 'Burma'} (unnamed unit {k})"
        out.append(dict(county_id=f"MM1931-{k:03d}-{norm(name)}", name=name, iso3="MMR", gb_level="historical",
                        adm1_modern=None, basis="historical_1931",
                        source="Burma 1931 census districts and states, traced by K. Lawson (CC0)",
                        hist_parent=p.get("group"), hist_parent_kind="division / states",
                        hist_parent_basis="historical_1931", county_kind="district", geom=g))
    return out


# ---------------------------------------------------------------- historical parents for proxies

def parent_layers():
    """(iso set, layer name, [(props, geom)], name fn, zh fn, kind, basis)"""
    china = pd.read_csv(REPO_SRC / "china.csv").set_index("key")
    roc = read_geojson(REPO_SRC / "republican-china-provinces-v5.geojson")
    mk = read_geojson(LAW / "manchukuo-provinces-v2.geojson")
    kw = read_geojson(LAW / "kwantung-1935.geojson")
    kw = [({"name": "Kwantung Leased Territory"}, polys(unary_union([g for _, g in kw])))]
    dei = read_geojson(LAW / "dei-1941-admin.geojson")
    ic = read_geojson(LAW / "french-indochina-admin.geojson")
    ph = read_geojson(LAW / "adm2_PHL_1939.json")
    ps = read_geojson(LAW / "princely-states-india-1931-v1.2026.8.11.geojson")
    alias = {"Tibet": "Xizang", "Rehe": "Jehol", "Chahar": "Chahaer"}
    roc = [(dict(p, name=alias.get(p["name"].strip(), p["name"].strip())), g) for p, g in roc]
    zh_roc = lambda p: china["zh"].get(p["name"], None) if p["name"] in china.index else None
    return [
        ({"CHN", "TWN", "MNG"}, "roc_province", roc, lambda p: p["name"], zh_roc, "省 (ROC 1928-1945)", "historical_1928_1945"),
        ({"CHN"}, "manchukuo_province", mk, lambda p: p["Name"], lambda p: p.get("Name_zh"), "省 (Manchukuo)", "historical_1941"),
        ({"CHN"}, "kwantung", kw, lambda p: p["name"], lambda p: "关东州", "leased territory", "historical_1935"),
        ({"IDN", "TLS", "MYS", "PNG"}, "dei_residency", dei, lambda p: p["name"], lambda p: None, "residentie (DEI 1941)",
         "historical_1941"),
        ({"VNM", "KHM", "LAO", "THA"}, "indochina_province", ic, lambda p: p["name"] + (f" ({p['name_french']})" if p.get("name_french") else ""),
         lambda p: None, "province (" + "French Indochina 1941)", "historical_1941"),
        ({"PHL"}, "philippine_province", ph, lambda p: p["shapeName"], lambda p: None, "province (1939)", "historical_1939"),
        ({"IND", "PAK", "BGD"}, "princely_state", ps, lambda p: p["name"], lambda p: None, "princely state (1931)",
         "historical_1931"),
    ]


def attach_parents(rows):
    layers = parent_layers()
    for isos, lname, feats, fn, fzh, kind, basis in layers:
        geoms = [g for _, g in feats]
        tree = STRtree(geoms)
        defacto = lname in ("manchukuo_province", "kwantung")
        for r in rows:
            if r["iso3"] not in isos or (not defacto and str(r.get("hist_parent_basis", "")).startswith("historical")):
                continue
            rp = r["geom"].representative_point()
            hit = tree.query(rp, predicate="within")
            if not len(hit):
                continue
            p = feats[hit[0]][0]
            if lname in ("manchukuo_province", "kwantung"):
                r["defacto_parent"] = fn(p)
                r["defacto_parent_zh"] = fzh(p)
                r["defacto_parent_kind"] = kind
                continue
            r["hist_parent"] = fn(p)
            r["hist_parent_zh"] = fzh(p)
            r["hist_parent_kind"] = kind
            r["hist_parent_basis"] = basis
            if lname == "indochina_province":
                r["hist_grandparent"] = p.get("protectorate")
            if lname == "dei_residency":
                r["hist_grandparent"] = p.get("gouvernement")
    # Japanese prefectures: present-day ADM1 equals the 1940 prefectures
    jp = pd.read_csv(REPO_SRC / "japan.csv")
    jmap = {norm(k): (row.en, row.zh) for k, row in zip(jp.key, jp.itertuples())}
    for r in rows:
        if r["iso3"] == "JPN" and r.get("adm1_modern"):
            k = norm(re.sub(r"\s*Prefecture$", "", r["adm1_modern"]))
            k = {"tokyo": "tokyo", "hokkaido": "hokkaido"}.get(k, k)
            if k in jmap:
                r["hist_parent"], r["hist_parent_zh"] = jmap[k]
                r["hist_parent_kind"] = "府/県/庁 (1940)"
                r["hist_parent_basis"] = "historical_1940"


# ---------------------------------------------------------------- Chinese county names

def china_names(rows):
    """Match geoBoundaries pinyin county names to NBS Chinese names within the same province."""
    from itertools import product
    from pypinyin import lazy_pinyin, pinyin, Style
    cn = WW2_RAW / "cn-names"
    areas = pd.read_csv(cn / "areas.csv", dtype=str)
    prov = pd.read_csv(cn / "provinces.csv", dtype=str).set_index("code").name
    py = lambda s: norm("".join(lazy_pinyin(s)))
    prov_key = {}
    for code, name in prov.items():
        base = re.sub(r"(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$", "", name)
        k = py(base)
        prov_key[{"shanxi": "shanxi"}.get(k, k)] = code
    for alias, zh in (("guangzhou", "广东"), ("innermongolia", "内蒙古"), ("tibet", "西藏"), ("hongkong", "香港"),
                      ("macau", "澳门"), ("macao", "澳门")):
        code = next((c for c, n in prov.items() if n.startswith(zh)), None)
        if code:
            prov_key[alias] = code
    prov_key["shaanxi"] = next(c for c, n in prov.items() if n.startswith("陕西"))
    prov_key["shanxi"] = next(c for c, n in prov.items() if n.startswith("山西"))
    suffix = {"县": "county", "自治县": "county", "区": "district", "市": "city", "旗": "banner", "自治旗": "banner",
              "特区": "district", "林区": "district"}
    index = defaultdict(list)
    national = defaultdict(list)
    ethnic = ("蒙古|回|藏|维吾尔|苗|彝|壮|布依|朝鲜|满|侗|瑶|白|土家|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|"
              "景颇|柯尔克孜|土|达斡尔|仫佬|羌|布朗|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|"
              "裕固|京|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺")
    for a in areas.itertuples():
        m = re.match(r"^(.*?)(自治县|自治旗|特区|林区|县|区|市|旗)$", a.name)
        if not m:
            continue
        base, kind = m.group(1), suffix.get(m.group(2))
        bare = base
        while True:
            b2 = re.sub(rf"(?:{ethnic})族$", "", bare)
            if b2 == bare or not b2:
                break
            bare = b2
        for b in {base, bare}:
            # every reading of polyphonic characters (朝阳 = chaoyang / zhaoyang)
            opts = pinyin(b, style=Style.NORMAL, heteronym=True)
            combos = {py(b)}
            if np.prod([len(o) for o in opts]) <= 32:
                combos |= {norm("".join(c)) for c in product(*opts)}
            for k in combos:
                index[(a.provinceCode, k)].append((a.name, kind))
                national[k].append((a.name, kind))
    words = r"(and|county|district|city|banner|autonomous|prefecture|forest|special|region|zone|new|area|" \
            r"yi|hui|zhuang|miao|tujia|dong|yao|bai|hani|dai|li|lisu|lahu|wa|naxi|qiang|tu|mongol|mongolian|" \
            r"tibetan|manchu|korean|kazak|xibe|tajik|daur|ewenki|oroqen|salar|bonan|dongxiang|yugur|she|maonan|" \
            r"mulao|gelao|shui|jingpo|achang|nu|pumi|derung|blang|jino|deang|bouyei|uyghur|sui)"
    hit = 0
    for r in rows:
        if r["iso3"] != "CHN" or r["gb_level"] != "ADM3":
            continue
        if re.search(r"[\u4e00-\u9fa5]", r["name"]):
            r["name_zh"] = r["name"]
            hit += 1
            continue
        a1 = (r.get("adm1_modern") or "").split(" ")
        pk = prov_key.get(norm(a1[0])) or prov_key.get(norm("".join(a1[:2])))
        tokens = [t for t in re.split(r"[\s\-]+", r["name"]) if t]
        kind = next((w for w in ("county", "district", "city", "banner") if w in r["name"].lower()), None)
        core = [t for t in tokens if not re.fullmatch(words, t.lower())] or tokens[:1]
        keys = [norm("".join(core)), norm(tokens[0])]
        keys += [re.sub(r"(xian|qu|shi|qi)$", "", k) for k in keys]
        cands = []
        for k in keys:
            cands = index.get((pk, k), [])
            if cands:
                break
        if not cands:
            for k in keys:
                if len(k) < 5:  # one-syllable names collide across provinces
                    continue
                nat = [c for c in national.get(k, []) if c[1] == kind] if kind else national.get(k, [])
                if len({c[0] for c in nat}) == 1:
                    cands = nat
                    r["name_zh_note"] = "matched nationally (province differs in source)"
                    break
        if cands and kind:
            same = [c for c in cands if c[1] == kind]
            cands = same or cands
        names = sorted({c[0] for c in cands})
        if len(names) == 1:
            r["name_zh"] = names[0]
            hit += 1
        elif names:  # homophones in one province: leave blank rather than guess
            r["name_zh_note"] = "ambiguous: " + "/".join(names)[:80]
    print("China counties with Chinese names:", hit)


def colony_gaps(rows):
    """Colonies that no county layer covers (geoBoundaries has no New Caledonia or French
    Polynesia): add the CShapes outline of the whole unit as one county-level area."""
    import topo
    from common import RAW
    from ww2_common import SNAPSHOTS
    iso = {"New Caledonia": "NCL", "French Polynesia": "PYF"}
    arcs, gs = topo.load(RAW / "cshapes_2_gw.topojson")
    dates = [s[0] for s in SNAPSHOTS]
    geoms = [r["geom"] for r in rows]
    tree = STRtree(geoms)
    done = []
    added = []
    for g in gs:
        p = g["properties"]
        if p["status"] == "independent" or not any(p["start"] <= d <= p["end"] for d in dates):
            continue
        u = make_valid(topo.to_shape(arcs, g))
        near = [geoms[i] for i in tree.query(u, predicate="intersects")] + [d for d in done if d.intersects(u)]
        rest = polys(u.difference(unary_union(near))) if near else polys(u)
        if rest is None or rest.area < 0.8 * u.area:
            continue
        done.append(rest)
        added.append(dict(county_id=f"CSH-{p['fid']}", name=p["country_name"], iso3=iso.get(p["country_name"], "XXX"),
                          gb_level="CShapes unit", basis="historical_unit", adm1_modern=None, adm2_modern=None,
                          source="CShapes 2.0 outline of the whole colony (no county-level layer available)", geom=rest))
    print("colonies without county coverage:", [a["name"] for a in added])
    return added


# ---------------------------------------------------------------- main

def main():
    choice = choose_levels()
    pd.DataFrame([(k, *v) for k, v in choice.items()], columns=["iso3", "level", "median_km2", "n"]) \
        .to_csv(WW2_WORK / "county_levels.csv", index=False)
    print("countries:", len(choice), pd.Series([v[0] for v in choice.values()]).value_counts().to_dict())
    base = drop_overlaps(fill_gaps(load_base(choice), choice))
    replace = {"USA": lambda r: r["adm1_modern"] not in ("Alaska", "Hawaii"),
               "TWN": lambda r: True, "KOR": lambda r: True, "PRK": lambda r: True, "MMR": lambda r: True}
    base = [r for r in base if not (r["iso3"] in replace and replace[r["iso3"]](r))]
    hist = us_counties() + taiwan() + korea() + burma()
    print("historical units:", pd.Series([h["basis"] for h in hist]).value_counts().to_dict())
    # historical layers are authoritative: drop any proxy whose label point falls inside them
    htree = STRtree([h["geom"] for h in hist])
    before = len(base)
    base = [r for r in base if not len(htree.query(r["geom"].representative_point(), predicate="within"))]
    print("proxies replaced by historical layers (by location):", before - len(base))
    rows = base + hist
    rows += colony_gaps(rows)
    attach_parents(rows)
    china_names(rows)
    for r in rows:
        r["area_km2"] = round(eq_area_km2(r["geom"]), 2)
        rp = r["geom"].representative_point()
        r["label_lon"], r["label_lat"] = round(rp.x, 4), round(rp.y, 4)
    df = pd.DataFrame([{k: v for k, v in r.items() if k != "geom"} for r in rows])
    df.to_csv(WW2_WORK / "counties.csv", index=False)
    with open(WW2_WORK / "counties.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"county_id": r["county_id"]}, "geometry": mapping(r["geom"])} for r in rows]}, f)
    print("counties:", len(df))
    print(df.basis.value_counts())
    print(df.hist_parent_basis.value_counts(dropna=False))


if __name__ == "__main__":
    main()
