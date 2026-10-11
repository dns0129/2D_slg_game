"""Export real fine administrative outlines as static, province-sized gzip GeoJSON.

Build dependencies: shapely, pyproj, pyshp, rdata. No database is used or exported.
Pass a separate source cache populated with the files listed in SOURCES below.
Historical dates and source licenses remain attached to every exported outline.
"""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import warnings

import shapefile
import rdata
from pyproj import Geod
from shapely import STRtree, make_valid, set_precision
from shapely.geometry import MultiPolygon, Polygon, mapping, shape

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
GEOD = Geod(ellps="WGS84")
HISTORY = "430e8b9c99fdf05be2d4f094e64659a75fdf4100"
SOURCES = {
    "historical": {"name": "world_map_history 历史细分区划", "year": "1939-09-01",
        "url": f"https://github.com/dns0129/world_map_history/tree/{HISTORY}",
        "license": "逐块保留原图源；Newberry / OpenHistoricalMap CC0；台湾 CC BY-NC-SA 4.0",
        "note": "只恢复当日有效的县级和地区级轮廓；不采用点位 Voronoi 推算的县界。"},
    "usa": {"name": "美国 Census 县界（Plotly 数据副本）", "year": "2010 人口普查数据",
        "url": "https://github.com/plotly/datasets/blob/0c447c47b757ad74edecab31f0d72f849d2e67c2/geojson-counties-fips.json",
        "license": "美国 Census 公有领域",
        "note": "县界、名称取自资料版本；2026 的国家与控制判定继承现有省级地图。"},
    "china": {"name": "mapchina 0.1.0 区县地图", "year": "2018 前后（资料版本）",
        "url": "https://github.com/xmc811/mapchina/tree/053136c1c9c01742681bf9224ecad4d8c0bf9df0",
        "license": "GPL-3.0；本图源的导出区县数据同样按 GPL-3.0 提供",
        "note": "原数据坐标为 WGS84，名称和六位区划代码保留。不是 2026 最新区划普查。"},
    "india": {"name": "DataMeet 印度 Census 地区界", "year": "2011 人口普查区划",
        "url": "https://github.com/datameet/maps/tree/b3fbbde595310b397a55d718e0958ce249a4fa1f/Districts",
        "license": "CC BY 2.5 India",
        "note": "District 为地区级，不能等同于所有国家的县。区划名称保留资料原名。"},
    "brazil": {"name": "IBGE 巴西市镇界（geodata-br）", "year": "geodata-br 2021 仓库版本",
        "url": "https://github.com/tbrugz/geodata-br/tree/c39dfb040bfd466fe2a476bafed00749c5c42f16",
        "license": "CC0-1.0",
        "note": "Município 为县级相当单位；轮廓、名称不宣称是 2026 最新版本。"},
    "naturalearth": {"name": "Natural Earth 原始细分行政区", "year": "Natural Earth 5.1.1，约 2020 年",
        "url": "https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19",
        "license": "公有领域",
        "note": "恢复原地图合并为大区的省、郡、部门等细分单位；1:1000 万制图轮廓，非地籍界线。"},
}


def read_json(path):
    b = path.read_bytes()
    return json.loads(gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b)


def decode_geometry(path):
    data = path.read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    offset = 0

    def number():
        nonlocal offset
        value, shift = 0, 0
        while True:
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value
            shift += 7

    def delta():
        n = number()
        return -(n + 1) // 2 if n % 2 else n // 2

    out = []
    while offset < len(data):
        polys = []
        x = y = 0
        for _ in range(number()):
            rings = []
            for _ in range(number()):
                ring = []
                for _ in range(number()):
                    x += delta()
                    y += delta()
                    ring.append((x / 1000, y / 1000))
                rings.append(ring)
            if rings:
                polys.append(Polygon(rings[0], rings[1:]))
        out.append(clean(MultiPolygon(polys)))
    return out


def clean(g):
    if not g.is_valid:
        g = make_valid(g)
    if g.geom_type == "Polygon":
        return MultiPolygon([g])
    if g.geom_type == "MultiPolygon":
        return g
    return MultiPolygon([p for x in getattr(g, "geoms", []) for p in
                         ([x] if x.geom_type == "Polygon" else list(x.geoms) if x.geom_type == "MultiPolygon" else [])])


def area(g):
    return sum(abs(GEOD.geometry_area_perimeter(p)[0]) for p in g.geoms) / 1e6


def base_pieces(scenario):
    admin = read_json(DATA / "admin.bin")
    sd = read_json(DATA / f"snap-{scenario}.json")
    geoms = decode_geometry(DATA / f"geo-{scenario}.bin")
    ag = dict(zip(sd["admin_active"], geoms))
    offset = len(ag)
    fg = dict(zip(sd["geo_feature"], geoms[offset:]))
    pieces = [fg[f] if f in fg else ag[admin["feature_admin"][f]] for f in sd["feature"]]
    return admin, sd, pieces


def historical(cache):
    a = read_json(cache / "1939/admin.json")
    sd = read_json(cache / "1939/snap-1939-09-01.json")
    ag = decode_geometry(cache / "1939/geo-admin.bin")
    fg = decode_geometry(cache / "1939/geo.bin")
    col = lambda name, i: a["cols"][name]["lut"][a["cols"][name]["idx"][i]]
    for k, f in enumerate(sd["feature"]):
        i = a["feature_admin"][f]
        if a["tier"][i] > 2 or (col("basis", i) or "").startswith("reconstructed"):
            continue
        g = fg[f] if not fg[f].is_empty else ag[i]
        # The old encoder substitutes tiny triangles for collapsed outlines. Do not restore those.
        if len(g.geoms) == 1 and len(g.geoms[0].exterior.coords) == 4:
            pts = list(g.geoms[0].exterior.coords)[:3]
            if abs(pts[1][0] - pts[0][0] - .004) < 1e-8 and abs(pts[2][1] - pts[0][1] - .004) < 1e-8:
                continue
        props = {"n": col("name_zh", i) or col("name", i), "local": col("name", i),
                 "g": a["admin_id"][i], "ds": "historical", "t": a["tier"][i],
                 "kind": col("kind", i), "basis": col("basis", i), "src": col("source", i),
                 "note": col("note", i), "start": col("start", i), "end": col("end", i)}
        props["_unit"] = sd["luts"]["unit_name_en"][sd["rows"]["unit_name_en"][k]]
        yield props, g, None


def modern(cache):
    for f in read_json(cache / "usa-2026.geojson")["features"]:
        p = f["properties"]
        yield {"n": p["NAME"], "g": "US-" + f["id"], "ds": "usa", "t": 1, "kind": "County / county equivalent"}, clean(shape(f["geometry"])), "USA"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        china = rdata.read_rda(cache / "china.rda")["china"]
    for _, row in china.iterrows():
        polys = [Polygon(p[0], p[1:]) for p in row.geometry]
        city = row.Code_County in {"442000", "441900", "460400", "620200"}
        yield {"n": row.Name_County, "g": "CN-" + row.Code_County, "ds": "china", "t": 2 if city else 1,
               "kind": "不设县级区的地级市（图源最细单位）" if city else "区 / 县 / 县级市",
               "code": row.Code_County}, clean(MultiPolygon(polys)), None
    r = shapefile.Reader(str(cache / "india/india-districts.shp"))
    for sr in r.iterShapeRecords():
        p = sr.record.as_dict()
        yield {"n": p["DISTRICT"], "g": "IN-" + str(p["censuscode"]), "ds": "india", "t": 2,
               "kind": "District（地区）"}, clean(shape(sr.shape.__geo_interface__)), "IND"
    for f in read_json(cache / "brazil.geojson")["features"]:
        p = f["properties"]
        yield {"n": p["name"], "g": "BR-" + p["id"], "ds": "brazil", "t": 1,
               "kind": "Município（市镇）"}, clean(shape(f["geometry"])), "BRA"
    # These countries' leaf units were dissolved by the copied map into larger regions.
    nested = {"GBR", "SVN", "LVA", "ITA", "FRA", "MLT", "ESP", "PHL", "MKD", "KOS", "BFA", "GIN"}
    for f in read_json(cache / "ne-admin1.geojson")["features"]:
        p = f["properties"]
        if p["adm0_a3"] not in nested:
            continue
        yield {"n": p.get("name_zh") or p["name"], "local": p["name"], "g": p["adm1_code"],
               "ds": "naturalearth", "t": 2, "kind": p.get("type_en") or p.get("type")}, clean(shape(f["geometry"])), p["adm0_a3"]


def export(scenario, rows, cache):
    admin, sd, parents = base_pieces(scenario)
    tree = STRtree(parents)
    groups = collections.defaultdict(list)
    units = collections.defaultdict(set)
    names = {}
    gid = 0
    for props, raw, iso in rows:
        if raw.is_empty:
            continue
        # Round source vertices, then reset GEOS's precision model so intersections
        # keep the existing province/control edge rather than snapping it outwards.
        g = set_precision(set_precision(raw.simplify(.0005, preserve_topology=True), .00001), 0)
        matches = []
        for k in tree.query(g, predicate="intersects"):
            k = int(k)
            if props.get("_unit") and sd["luts"]["unit_name_en"][sd["rows"]["unit_name_en"][k]] != props["_unit"]:
                continue
            if iso and sd["countries"][sd["country"][k]][0] != "M:" + iso:
                continue
            if props["ds"] == "china" and sd["countries"][sd["country"][k]][0] not in {"M:CHN", "M:TWN", "M:HKG", "M:MAC"}:
                continue
            p = admin["feature_admin"][sd["feature"][k]]
            parent = parents[k]
            cut = clean(g.intersection(parent))
            if cut.is_empty or cut.area < max(g.area * .02, 1e-9):
                continue
            # Leaf divisions must actually be finer than the province already shown.
            if props["ds"] == "naturalearth" and cut.area > .9 * parent.area:
                continue
            if not cut.is_valid or not parent.buffer(1e-8).covers(cut):
                from shapely.validation import explain_validity
                raise ValueError((scenario, props["g"], k, explain_validity(cut),
                                  cut.difference(parent.buffer(1e-8)).area))
            matches.append((k, p, cut))
        for k, p, cut in matches:
            prop = {**props, "k": k, "p": p, "area": round(area(cut), 3),
                    "split": len(matches) > 1}
            prop.pop("_unit", None)
            center = cut.representative_point()
            prop["xy"] = [round(center.x, 5), round(center.y, 5)]
            feature = {"type": "Feature", "id": gid, "properties": prop, "geometry": mapping(cut)}
            groups[p].append(feature)
            units[sd["countries"][sd["country"][k]][1]].add(props["g"])
            entry = [gid, props["n"], p, *prop["xy"], props["ds"], props["t"]]
            if props["g"] not in names or cut.area > names[props["g"]][0]:
                names[props["g"]] = (cut.area, entry)
            gid += 1
        if gid and gid % 2000 == 0:
            print(scenario, gid, "pieces", flush=True)
    output = DATA / "counties" / scenario
    output.mkdir(parents=True, exist_ok=True)
    regions = []
    live_files = set()
    for p, features in sorted(groups.items()):
        name = f"{p}.bin"
        live_files.add(name)
        path = output / name
        b = gzip.compress(json.dumps({"type": "FeatureCollection", "features": features},
                                    ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
        path.write_bytes(b)
        bounds = [shape(f["geometry"]).bounds for f in features]
        regions.append({"p": p, "bbox": [min(x[0] for x in bounds), min(x[1] for x in bounds),
                                          max(x[2] for x in bounds), max(x[3] for x in bounds)],
                        "count": len(features), "file": f"{scenario}/{name}",
                        "sha256": hashlib.sha256(b).hexdigest()})
    for path in output.glob("*.bin"):
        if path.name not in live_files:
            path.unlink()
    index = {"snapshot": scenario, "min_zoom": 6, "units": len(names), "pieces": gid,
             "sources": SOURCES, "countries": [{"name": n, "count": len(u)} for n, u in sorted(units.items())],
             "regions": regions, "search": [entry for _, entry in names.values()]}
    (DATA / "counties" / f"index-{scenario}.bin").write_bytes(gzip.compress(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0))
    print(scenario, "units", len(names), "pieces", gid, "regions", len(regions),
          "countries", len(units), flush=True)
    return {k: index[k] for k in ["units", "pieces", "countries"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cache", type=Path)
    args = ap.parse_args()
    summaries = {"1939-09-01": export("1939-09-01", historical(args.cache), args.cache),
                 "2026": export("2026", modern(args.cache), args.cache)}
    files = ["1939/admin.json", "1939/geo-admin.bin", "1939/geo.bin", "1939/snap-1939-09-01.json",
             "usa-2026.geojson", "china.rda", "brazil.geojson", "ne-admin1.geojson"]
    files += [f"india/india-districts.{s}" for s in ["shp", "shx", "dbf", "prj"]]
    manifest = {"sources": SOURCES, "source_files": {f: hashlib.sha256((args.cache / f).read_bytes()).hexdigest() for f in files},
                "scenarios": summaries, "precision_degrees": .00001, "simplify_degrees": .0005,
                "checks": "Every exported polygon is valid and is covered by its existing province/control parcel."}
    (DATA / "counties" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
