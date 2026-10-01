"""Write import-ready files for a dynamic (animated) map.

exports/
  index.json                         list of years, file layout, field descriptions
  geometry/units.topojson            every historical unit polygon (shared borders)
  geometry/admin1_pieces.geojson     present-day admin-1 units clipped to each unit
  physical/*.geojson, elevation_5m.tif, hillshade_5m.png
  grids/population_<year>.tif        persons per 0.5 deg cell (uint32, deflate)
  years/<year>.json                  one file per year, identical schema

Geometry is loaded once; each year file only lists which units/pieces exist
that year and their values, keyed by unit_id / piece_id.
"""
import json
import shutil
import sqlite3
import zlib

import numpy as np
import rasterio
from rasterio.transform import from_origin

import topo
from common import RAW, WORK, EXPORTS, YEARS
from build_database import DB, UNIT_TOL

SCHEMA_VERSION = 1


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def write_units_topojson(con, path):
    arcs, geoms = topo.load(RAW / "cshapes_2_gw.topojson")
    keep = {r[0] for r in con.execute("SELECT unit_id FROM units")}
    props = {r[0]: r for r in con.execute(
        "SELECT unit_id, gwcode, cshapes_name, status, owner_gwcode, start_date, end_date, capital, cap_lon, cap_lat, "
        "area_km2, label_lon, label_lat FROM units")}
    used = sorted({abs(a) if a >= 0 else ~a for g in geoms if g["properties"]["fid"] in keep
                   for part in ([g["arcs"]] if g["type"] == "Polygon" else g["arcs"]) for ring in part for a in ring})
    remap = {old: new for new, old in enumerate(used)}
    sarcs = topo.simplify_arcs([arcs[i] for i in used], UNIT_TOL, ndigits=3)

    def re(ring):
        return [remap[a] if a >= 0 else ~remap[~a] for a in ring]

    out = []
    for g in geoms:
        fid = g["properties"]["fid"]
        if fid not in keep:
            continue
        p = props[fid]
        a = [[re(r) for r in g["arcs"]]] if g["type"] == "Polygon" else [[re(r) for r in part] for part in g["arcs"]]
        out.append({"type": "MultiPolygon", "arcs": a, "properties": {
            "unit_id": fid, "gwcode": p[1], "cshapes_name": p[2], "status": p[3], "owner_gwcode": p[4],
            "start_date": p[5], "end_date": p[6], "capital": p[7], "capital_lonlat": [p[8], p[9]],
            "area_km2": p[10], "label_lonlat": [p[11], p[12]]}})
    topo_doc = {"type": "Topology", "arcs": sarcs, "objects": {"units": {"type": "GeometryCollection", "geometries": out}}}
    path.write_text(dumps(topo_doc))


def main():
    con = sqlite3.connect(DB)
    for d in ("geometry", "physical", "grids", "years"):
        (EXPORTS / d).mkdir(parents=True, exist_ok=True)

    write_units_topojson(con, EXPORTS / "geometry" / "units.topojson")

    feats = []
    for r in con.execute("SELECT piece_id, name, name_en, name_zh, type_en, modern_country, iso_3166_2, "
                         "share_of_modern_unit, area_km2, label_lon, label_lat, unit_ids, geometry FROM admin1_pieces"):
        feats.append({"type": "Feature", "id": r[0], "properties": {
            "piece_id": r[0], "name": r[1], "name_en": r[2], "name_zh": r[3], "type_en": r[4], "modern_country": r[5],
            "iso_3166_2": r[6], "share_of_modern_unit": r[7], "area_km2": r[8], "label_lonlat": [r[9], r[10]],
            "unit_ids": [int(x) for x in r[11].split(";")]}, "geometry": json.loads(r[12])})
    (EXPORTS / "geometry" / "admin1_pieces.geojson").write_text(dumps({"type": "FeatureCollection", "features": feats}))

    for p in (WORK / "physical").iterdir():
        if p.name != "coastline.geojson":  # same line work as land.geojson outlines
            shutil.copy(p, EXPORTS / "physical" / p.name)
    lakes = json.load(open(WORK / "physical" / "lakes.geojson"))["features"]

    events = {r[0]: r for r in con.execute(
        "SELECT event_id, unit_name, unit_gwcode, start_date, end_date, scope, control_type, controller_name, "
        "controller_name_zh, controller_gwcode, note FROM control_events")}

    cols = [c[1] for c in con.execute("PRAGMA table_info(unit_year)")]
    for y in YEARS:
        yr = dict(zip([c[0] for c in con.execute("SELECT * FROM years LIMIT 0").description],
                      con.execute("SELECT * FROM years WHERE year=?", (y,)).fetchone()))
        units = []
        for row in con.execute("SELECT uy.*, u.label_lon, u.label_lat, u.capital, u.cap_lon, u.cap_lat "
                               "FROM unit_year uy JOIN units u USING(unit_id) WHERE year=? ORDER BY population DESC", (y,)):
            r = dict(zip(cols + ["label_lon", "label_lat", "capital", "cap_lon", "cap_lat"], row))
            units.append({
                "unit_id": r["unit_id"], "name_en": r["name_en"], "name_zh": r["name_zh"],
                "cshapes_name": r["cshapes_name"], "gwcode": r["gwcode"], "status": r["cshapes_status"],
                "sovereign": {"gwcode": r["sovereign_gwcode"], "name_en": r["sovereign_name_en"], "name_zh": r["sovereign_name_zh"]},
                "controller": {"gwcode": r["controller_gwcode"], "name_en": r["controller_name_en"],
                               "name_zh": r["controller_name_zh"], "control_type": r["control_type"],
                               "event_id": r["control_event"]},
                "partial_control_events": [e for e in (r["partial_control_events"] or "").split(";") if e],
                "population": r["population"], "pop_share_world": r["pop_share_world"],
                "pop_share_de_jure_sovereign": r["pop_share_de_jure_sovereign"],
                "pop_share_de_facto_sovereign": r["pop_share_de_facto_sovereign"],
                "pop_calibration": r["pop_calibration"],
                "gdp_2011usd": r["gdp_2011usd"], "gdp_share_world": r["gdp_share_world"],
                "gdp_per_capita": r["gdp_per_capita"], "gdp_alt_fariss2022_2011usd": r["gdp_alt_fariss2022_2011usd"],
                "area_km2": r["area_km2"], "density_per_km2": r["density_per_km2"],
                "label_lonlat": [r["label_lon"], r["label_lat"]],
                "capital": {"name": r["capital"], "lonlat": [r["cap_lon"], r["cap_lat"]]}})
        sov = {}
        for basis in ("de_jure", "de_facto"):
            sov[basis] = [dict(zip(["gwcode", "name_en", "name_zh", "population", "gdp_2011usd", "area_km2", "n_units",
                                    "pop_share_world", "gdp_share_world"], r)) for r in con.execute(
                "SELECT sovereign_gwcode, sovereign_name_en, sovereign_name_zh, population, gdp_2011usd, area_km2, "
                "n_units, pop_share_world, gdp_share_world FROM sovereign_year WHERE year=? AND basis=? "
                "ORDER BY population DESC", (y, basis))]
        a1 = con.execute("SELECT piece_id, unit_id, population, pop_share_unit, pop_share_world, gdp_2011usd "
                         "FROM admin1_year WHERE year=? ORDER BY unit_id, population DESC", (y,)).fetchall()
        active = []
        date = yr["snapshot_date"]
        for e in events.values():
            if e[3] <= date <= e[4]:
                active.append(dict(zip(["event_id", "unit_name", "unit_gwcode", "start_date", "end_date", "scope",
                                        "control_type", "controller_name", "controller_name_zh", "controller_gwcode",
                                        "note"], e)))
        lake_ids = [i for i, f in enumerate(lakes)
                    if (f["properties"]["valid_from"] is None or f["properties"]["valid_from"] <= y)
                    and (f["properties"]["valid_to"] is None or f["properties"]["valid_to"] >= y)]

        g = con.execute("SELECT width, height, resolution_deg, west, north, data FROM grids WHERE year=? AND variable='population'",
                        (y,)).fetchone()
        a = np.frombuffer(zlib.decompress(g[5]), dtype="<u4").reshape(g[1], g[0])
        with rasterio.open(EXPORTS / "grids" / f"population_{y}.tif", "w", driver="GTiff", width=g[0], height=g[1],
                           count=1, dtype="uint32", crs="EPSG:4326", transform=from_origin(g[3], g[4], g[2], g[2]),
                           compress="deflate", predictor=2) as dst:
            dst.write(a, 1)
            dst.update_tags(year=str(y), unit="persons per cell")

        doc = {
            "schema_version": SCHEMA_VERSION, "year": y, "snapshot_date": date,
            "world": {"population": yr["world_population"], "gdp_2011usd": yr["world_gdp_2011usd"],
                      "n_units": yr["n_units"], "n_independent": yr["n_independent"], "n_dependent": yr["n_dependent"],
                      "population_pattern": yr["population_pattern"]},
            "units": units,
            "sovereigns": sov,
            "admin1": {"columns": ["piece_id", "unit_id", "population", "pop_share_unit", "pop_share_world", "gdp_2011usd"],
                       "rows": [[p, u, round(pp or 0), round(su, 6) if su == su and su is not None else None,
                                 round(sw, 8) if sw is not None else None, round(gd or 0, -3)] for p, u, pp, su, sw, gd in a1]},
            "control_events": active,
            "physical": {"lake_feature_ids": lake_ids},
            "files": {"units_geometry": "geometry/units.topojson", "admin1_geometry": "geometry/admin1_pieces.geojson",
                      "population_grid": f"grids/population_{y}.tif", "map_image": f"../maps/{y}.png"},
        }
        (EXPORTS / "years" / f"{y}.json").write_text(dumps(doc))

    index = {
        "schema_version": SCHEMA_VERSION,
        "years": YEARS,
        "snapshot": "1 July of each year",
        "crs": "EPSG:4326",
        "gdp_unit": "2011 international dollars",
        "files": {
            "year": "years/{year}.json", "units_geometry": "geometry/units.topojson (object 'units', key unit_id)",
            "admin1_geometry": "geometry/admin1_pieces.geojson (key piece_id)",
            "population_grid": "grids/population_{year}.tif (0.5 deg, persons per cell)",
            "physical": sorted(p.name for p in (EXPORTS / "physical").iterdir()),
            "map_image": "../maps/{year}.png",
        },
        "unit_fields": {
            "status": "CShapes status: independent, colony, protectorate, mandate, occupied, N/A",
            "sovereign": "de jure owner per CShapes (itself if independent)",
            "controller": "de facto controller after curated whole-unit control events",
            "partial_control_events": "events affecting part of the unit (no geometry); see control_events",
            "pop_calibration": "modern_series = calibrated to present-day-border national series; cow_nmc_tpop = rescaled to COW NMC contemporary-border population",
        },
    }
    (EXPORTS / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    con.close()
    tot = sum(p.stat().st_size for p in EXPORTS.rglob("*") if p.is_file())
    print("exports", f"{tot / 1e6:.1f} MB")
    for d in ("geometry", "physical", "grids", "years"):
        s = sum(p.stat().st_size for p in (EXPORTS / d).iterdir())
        print(" ", d, f"{s / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
