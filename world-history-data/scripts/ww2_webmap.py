"""Data files for the interactive 1939-1945 county maps (ww2/maps/).

  geo.bin           all county pieces of the six snapshots, simplified; zigzag-varint
                    deltas of 1/1000 degree, per feature: parts, rings, points
  geo-units.bin     CShapes units valid on any snapshot date (same encoding)
  counties.json     static county attributes (columnar)
  snap-<date>.json  per-snapshot rows: which features exist and who controls them
  terrain.png       land hillshade in Web Mercator (alpha = shade)
  hydro.json        main rivers and lakes
"""
import json

import numpy as np
import pandas as pd
from PIL import Image
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import reproject, Resampling
from shapely.geometry import shape, MultiPolygon

import topo
from common import RAW, WORK, ROOT, HYDE_RES
from ww2_common import SNAPSHOTS, WW2_WORK, WW2_OUT

OUT = WW2_OUT / "maps" / "data"
Q = 1000  # coordinate units per degree
TOL_COUNTY = 0.008
TOL_UNIT = 0.02
BLOCS = ["allied", "axis", "neutral", "contested"]
BASIS = ["historical_dated", "historical_1930", "historical_1931", "reconstructed_1914_1926", "modern_proxy"]
CONF = ["whole", "approximate"]


def varint(n, out):
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def zz(n):
    return (n << 1) ^ (n >> 63)


def encode(geoms, tol):
    buf = bytearray()
    for g in geoms:
        s = g.simplify(tol, preserve_topology=True)
        ps = [p for p in getattr(s, "geoms", [s]) if p.geom_type == "Polygon" and not p.is_empty]
        ps = [p for p in ps if p.area > (tol * tol) / 4] or ps[:1]
        polys = []
        for p in ps:
            rings = []
            for r in [p.exterior, *p.interiors]:
                c = np.round(np.asarray(r.coords)[:-1] * Q).astype(np.int64)
                c = c[np.r_[True, np.any(np.diff(c, axis=0) != 0, axis=1)]]
                if len(c) > 1 and (c[0] == c[-1]).all():
                    c = c[:-1]
                if len(c) >= 3:
                    rings.append(c)
                elif not rings:
                    break  # exterior collapsed: drop the polygon
            if rings:
                polys.append(rings)
        if not polys:  # keep tiny units clickable: a small triangle at the label point
            pt = g.representative_point()
            x, y = round(pt.x * Q), round(pt.y * Q)
            polys = [[np.array([[x - 2, y - 2], [x + 2, y - 2], [x, y + 2]], dtype=np.int64)]]
        varint(len(polys), buf)
        px = py = 0
        for rings in polys:
            varint(len(rings), buf)
            for c in rings:
                varint(len(c), buf)
                for x, y in c:
                    varint(zz(int(x - px)), buf)
                    varint(zz(int(y - py)), buf)
                    px, py = int(x), int(y)
    return bytes(buf)


def table(values):
    """Deduplicate strings into a lookup list and index array."""
    lut, idx = [], {}
    out = []
    for v in values:
        v = None if (isinstance(v, float) and np.isnan(v)) else v
        if v not in idx:
            idx[v] = len(lut)
            lut.append(v)
        out.append(idx[v])
    return lut, out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    counties = pd.read_csv(WW2_WORK / "counties.csv", low_memory=False)
    snaps = {s[0]: pd.read_csv(WW2_WORK / f"snapshot_{s[0]}.csv", low_memory=False) for s in SNAPSHOTS}
    cgeom = {f["properties"]["county_id"]: shape(f["geometry"])
             for f in json.load(open(WW2_WORK / "counties.geojson"))["features"]}
    pgeom = {}
    for s in SNAPSHOTS:
        for f in json.load(open(WW2_WORK / f"split_{s[0]}.geojson"))["features"]:
            pgeom[f["properties"]["piece_id"]] = shape(f["geometry"])

    used = sorted(set().union(*[set(d.piece_id) for d in snaps.values()]))
    fidx = {p: i for i, p in enumerate(used)}
    cids = sorted(set(counties.county_id) & set().union(*[set(d.county_id) for d in snaps.values()]))
    cidx = {c: i for i, c in enumerate(cids)}
    geo = encode([pgeom.get(p) or cgeom[p] for p in used], TOL_COUNTY)
    (OUT / "geo.bin").write_bytes(geo)

    crow = counties.set_index("county_id").loc[cids]
    cols = {}
    for col in ("name", "name_zh", "iso3", "county_kind", "hist_parent", "hist_parent_zh", "hist_parent_kind",
                "hist_grandparent", "adm1_modern", "adm2_modern", "defacto_parent", "defacto_parent_zh", "gb_level", "source"):
        lut, idx = table(crow[col].tolist())
        cols[col] = {"lut": lut, "idx": idx}
    static = {
        "n": len(cids), "county_id": cids, "cols": cols,
        "basis": [BASIS.index(b) for b in crow.basis], "basis_lut": BASIS,
        "area": [round(float(a), 1) for a in crow.area_km2],
        "label": [[round(float(x), 3), round(float(y), 3)] for x, y in zip(crow.label_lon, crow.label_lat)],
        "feature_county": [cidx[p.split("@")[0]] for p in used],
    }
    (OUT / "counties.json").write_text(json.dumps(static, ensure_ascii=False, separators=(",", ":")))

    # units (CShapes) for borders and labels
    arcs, gs = topo.load(RAW / "cshapes_2_gw.topojson")
    unit_ids = sorted(set().union(*[set(d.unit_id) for d in snaps.values()]))
    ug = {g["properties"]["fid"]: topo.to_shape(arcs, g) for g in gs if g["properties"]["fid"] in unit_ids}
    (OUT / "geo-units.bin").write_bytes(encode([ug[u] for u in unit_ids], TOL_UNIT))
    uidx = {u: i for i, u in enumerate(unit_ids)}

    summary = []
    for snap, tzh, ten in SNAPSHOTS:
        d = snaps[snap].drop_duplicates("piece_id")
        luts = {}
        rows = {}
        for col in ("unit_name_zh", "unit_name_en", "unit_status", "sovereign_name_zh", "controller_name_zh",
                    "controller_name_en", "controller_detail_zh", "controller_detail_en", "control_type", "control_source",
                    "partial_control_events"):
            luts[col], rows[col] = table(d[col].tolist())
        units = d.groupby("unit_id").agg(name_zh=("unit_name_zh", "first"), name_en=("unit_name_en", "first"),
                                         pop=("population_est", "sum")).reset_index()
        lab = {}
        for u in units.itertuples():
            p = ug[u.unit_id].representative_point()
            lab[uidx[u.unit_id]] = [u.name_zh or u.name_en, round(p.x, 2), round(p.y, 2), int(u.pop), round(ug[u.unit_id].area, 2)]
        ctrl_pop = d.groupby(["controller_gwcode", "controller_name_zh", "bloc"]).population_est.sum().reset_index() \
            .sort_values("population_est", ascending=False)
        doc = {
            "snapshot": snap, "title_zh": tzh, "title_en": ten,
            "feature": [fidx[p] for p in d.piece_id], "unit": [uidx[u] for u in d.unit_id],
            "bloc": [BLOCS.index(b) for b in d.bloc], "conf": [CONF.index(c) if c in CONF else 0 for c in d.control_confidence],
            "ctrl_gw": [int(x) for x in d.controller_gwcode],
            "pop": [int(x) for x in d.population_est], "luts": luts, "rows": rows,
            "units_active": sorted(set(uidx[u] for u in d.unit_id)), "unit_labels": lab,
            "controllers": [[int(r.controller_gwcode), r.controller_name_zh, r.bloc, int(r.population_est)]
                            for r in ctrl_pop.head(40).itertuples()],
            "bloc_pop": {b: int(d[d.bloc == b].population_est.sum()) for b in BLOCS},
        }
        (OUT / f"snap-{snap}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        summary.append({"snapshot": snap, "title_zh": tzh, "title_en": ten, "pieces": len(d),
                        "population": int(d.population_est.sum()), "bloc_pop": doc["bloc_pop"]})
    (OUT / "index.json").write_text(json.dumps({"snapshots": summary, "blocs": BLOCS, "basis": BASIS,
                                                "quantum": Q}, ensure_ascii=False, indent=1))

    # terrain in Web Mercator (alpha from the land hillshade)
    hs = np.asarray(Image.open(WORK / "physical" / "hillshade_5m.png"), dtype=np.float32)
    m = 20037508.342789244
    n = 2048
    dst = np.full((n, n), 255, dtype=np.float32)
    reproject(hs, dst, src_transform=from_origin(-180, 90, HYDE_RES, HYDE_RES), src_crs="EPSG:4326",
              dst_transform=from_bounds(-m, -m, m, m, n, n), dst_crs="EPSG:3857", resampling=Resampling.bilinear,
              dst_nodata=255)
    a = np.clip((255 - dst) * 1.4, 0, 255).astype(np.uint8)
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., 3] = a
    Image.fromarray(rgba, "RGBA").save(OUT / "terrain.png", optimize=True)

    feats = []
    for layer, maxrank, tol in (("rivers", 5, 0.02), ("lakes", 4, 0.02)):
        for f in json.load(open(WORK / "physical" / f"{layer}.geojson"))["features"]:
            p = f["properties"]
            if (p.get("scalerank") or 9) > maxrank:
                continue
            if layer == "lakes" and p.get("valid_to") is not None:
                continue
            g = shape(f["geometry"]).simplify(tol)
            if g.is_empty:
                continue
            gm = json.loads(json.dumps(g.__geo_interface__), parse_float=lambda s: round(float(s), 3))
            feats.append({"type": "Feature", "properties": {"k": layer[0], "r": p.get("scalerank"),
                                                            "n": p.get("name_zh") or p.get("name")}, "geometry": gm})
    (OUT / "hydro.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False,
                                               separators=(",", ":")))
    for p in sorted(OUT.iterdir()):
        print(p.name, f"{p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
