"""SQLite database of county-level administrative divisions and control, 1939-1945.

Geometry is GeoJSON text (EPSG:4326), simplified for size; full-detail source
geometry stays in work/ww2/. Tables are documented in ww2/README.md.
"""
import datetime as dt
import json
import sqlite3

import numpy as np
import pandas as pd
from shapely.geometry import shape, mapping

from common import ROOT
from ww2_common import SNAPSHOTS, WW2_DB, WW2_WORK

TOL = 0.004  # degrees (~400 m) for stored geometry

SOURCES = [
    ("geoboundaries", "geoBoundaries gbOpen", "Runfola, D. et al. (2020) geoBoundaries: A global database of political "
     "administrative boundaries. PLoS ONE 15(4): e0231866.", "https://github.com/wmgeolab/geoBoundaries", "CC BY 4.0 (per country, see metadata)",
     "Present-day county-level units used as proxies where no historical layer exists"),
    ("ahcb", "Atlas of Historical County Boundaries", "Newberry Library, Dr. William M. Scholl Center (2010). Via R package "
     "USAboundariesData (rOpenSci).", "https://github.com/ropensci/USAboundariesData", "CC0",
     "United States counties with exact validity dates"),
    ("sinica_taiwan", "Taiwan 1930 gun/shi", "Academia Sinica, Center for GIS, Japanese-era administrative boundaries; "
     "via K. Lawson, japanese-empire-student-map.", "https://github.com/kmlawson/japanese-empire-student-map",
     "CC BY-NC-SA 4.0", "Taiwan prefectures and districts (1930)"),
    ("nikh", "NIKH Modern Geographic Information DB", "National Institute of Korean History, 근대지리정보 (1914-1926 "
     "place records); via K. Lawson.", "https://hgis.history.go.kr/", "KOGL (attribution)",
     "Korean county/city (gun/bu) boundaries reconstructed from township office and facility points"),
    ("lawson", "An interactive map of the Japanese Empire", "Lawson, K. Georeferencing and tracing of East and South-East "
     "Asian historical maps (Burma 1931, DEI 1941, Indochina, Philippines 1939, Korea provinces, Manchukuo, Mengjiang, "
     "occupied China 1942, CCP base areas 1941-42, Indian princely states 1931).",
     "https://github.com/kmlawson/japanese-empire-student-map", "CC0 (tracing); underlying sources vary",
     "Historical parents and East Asian occupation layers"),
    ("enp_china", "ENP-China provincial boundaries", "Elites, Networks and Power in Modern China, Aix-Marseille University; "
     "adjusted by K. Lawson.", "https://www.enp-china.eu/", "CC BY 4.0", "Republican Chinese provinces 1928-1945"),
    ("nbs_names", "China county names", "National Bureau of Statistics administrative division names, via "
     "modood/Administrative-divisions-of-China; matched to geoBoundaries by pinyin.",
     "https://github.com/modood/Administrative-divisions-of-China", "WTFPL (compilation)", "Chinese county names"),
    ("cshapes2", "CShapes 2.0", "Schvitz, G. et al. (2022). Mapping the International System, 1886-2019. JCR 66(1).",
     "https://icr.ethz.ch/data/cshapes/", "CC BY-NC-SA 4.0", "Country and colony borders on each exact date"),
    ("ghspop", "GHS-POP R2023A", "European Commission JRC (2023).", "https://human-settlement.emergency.copernicus.eu/",
     "CC BY 4.0", "Spatial pattern for county population estimates (1975 grid)"),
    ("curated", "Curated control rules", "Compiled for this database from standard histories of the war "
     "(curated/ww2_region_control.csv, curated/control_events.csv).", "curated/", "CC0",
     "De facto control on each snapshot date"),
]

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sources (source_id TEXT PRIMARY KEY, name TEXT, citation TEXT, url TEXT, license TEXT, used_for TEXT);
CREATE TABLE snapshots (snapshot TEXT PRIMARY KEY, title_zh TEXT, title_en TEXT, n_units INTEGER,
  population_est REAL, pop_allied REAL, pop_axis REAL, pop_neutral REAL, pop_contested REAL);
CREATE TABLE counties (
  county_id TEXT PRIMARY KEY, name TEXT, name_zh TEXT, name_zh_note TEXT, county_kind TEXT,
  iso3_modern TEXT, source_level TEXT, basis TEXT, source TEXT, valid_from TEXT, valid_to TEXT,
  adm1_modern TEXT, adm2_modern TEXT,
  hist_parent TEXT, hist_parent_zh TEXT, hist_parent_kind TEXT, hist_parent_basis TEXT, hist_grandparent TEXT,
  defacto_parent TEXT, defacto_parent_zh TEXT, area_km2 REAL, label_lon REAL, label_lat REAL, geometry TEXT);
CREATE TABLE split_pieces (piece_id TEXT PRIMARY KEY, county_id TEXT, area_km2 REAL, geometry TEXT);
CREATE TABLE county_snapshot (
  snapshot TEXT, piece_id TEXT, county_id TEXT, unit_id INTEGER, unit_gwcode INTEGER,
  unit_name_en TEXT, unit_name_zh TEXT, unit_status TEXT,
  sovereign_gwcode INTEGER, sovereign_name_en TEXT, sovereign_name_zh TEXT,
  controller_gwcode INTEGER, controller_name_en TEXT, controller_name_zh TEXT,
  controller_detail_en TEXT, controller_detail_zh TEXT, control_type TEXT, control_source TEXT,
  control_confidence TEXT, bloc TEXT, partial_control_events TEXT,
  area_km2 REAL, population_est INTEGER, pop_method TEXT,
  PRIMARY KEY (snapshot, piece_id)) WITHOUT ROWID;
CREATE TABLE control_rules (row INTEGER PRIMARY KEY, snapshots TEXT, iso3 TEXT, field TEXT, match TEXT,
  controller_name TEXT, controller_name_zh TEXT, controller_gwcode INTEGER, control_type TEXT, confidence TEXT, note TEXT);
CREATE TABLE control_events (event_id TEXT PRIMARY KEY, unit_name TEXT, unit_gwcode INTEGER, start_date TEXT,
  end_date TEXT, scope TEXT, control_type TEXT, controller_name TEXT, controller_name_zh TEXT, controller_gwcode INTEGER,
  note TEXT);
CREATE TABLE county_levels (iso3 TEXT PRIMARY KEY, level TEXT, median_km2 REAL, n INTEGER);
CREATE INDEX cs_county ON county_snapshot(county_id);
CREATE INDEX cs_controller ON county_snapshot(snapshot, controller_gwcode);
CREATE INDEX counties_parent ON counties(hist_parent);
"""


def gj(g, tol=TOL, nd=4):
    g = g.simplify(tol, preserve_topology=True)

    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    m = mapping(g)
    return json.dumps({"type": m["type"], "coordinates": r(m["coordinates"])}, separators=(",", ":"))


def load_snapshots():
    frames = [pd.read_csv(WW2_WORK / f"snapshot_{s[0]}.csv", low_memory=False) for s in SNAPSHOTS]
    df = pd.concat(frames, ignore_index=True)
    pieces = {}
    for s in SNAPSHOTS:
        for f in json.load(open(WW2_WORK / f"split_{s[0]}.geojson"))["features"]:
            pieces[f["properties"]["piece_id"]] = shape(f["geometry"])
    return df, pieces


def main():
    if WW2_DB.exists():
        WW2_DB.unlink()
    con = sqlite3.connect(WW2_DB)
    con.executescript(SCHEMA)
    df, pieces = load_snapshots()
    counties = pd.read_csv(WW2_WORK / "counties.csv", low_memory=False)
    geoms = {f["properties"]["county_id"]: shape(f["geometry"])
             for f in json.load(open(WW2_WORK / "counties.geojson"))["features"]}

    meta = {
        "title": "World county-level administrative divisions and control, 1939-1945",
        "snapshots": ";".join(s[0] for s in SNAPSHOTS),
        "crs": "EPSG:4326", "geometry": f"GeoJSON text simplified at {TOL} deg, coordinates to 1e-4 deg",
        "county_definition": "historical county/district where a historical layer exists; otherwise the present-day "
                             "geoBoundaries level closest to a typical county (~1,500 km2), see county_levels",
        "population": "estimate: GHS-POP 1975 pattern scaled to each historical unit's population for the snapshot year",
        "built_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    con.executemany("INSERT INTO meta VALUES (?,?)", meta.items())
    con.executemany("INSERT INTO sources VALUES (?,?,?,?,?,?)", SOURCES)

    for snap, tzh, ten in SNAPSHOTS:
        d = df[df.snapshot == snap]
        b = d.groupby("bloc").population_est.sum()
        con.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?)",
                    (snap, tzh, ten, int(d.unit_id.nunique()), float(d.population_est.sum()), float(b.get("allied", 0)),
                     float(b.get("axis", 0)), float(b.get("neutral", 0)), float(b.get("contested", 0))))

    used = set(df.county_id)
    rows = []
    for c in counties.itertuples():
        if c.county_id not in used:
            continue
        v = lambda x: None if (isinstance(x, float) and np.isnan(x)) else x
        rows.append((c.county_id, v(c.name), v(c.name_zh), v(c.name_zh_note), v(c.county_kind), c.iso3, c.gb_level, c.basis,
                     c.source, v(c.valid_from), v(c.valid_to), v(c.adm1_modern), v(c.adm2_modern), v(c.hist_parent),
                     v(c.hist_parent_zh), v(c.hist_parent_kind), v(c.hist_parent_basis), v(c.hist_grandparent),
                     v(c.defacto_parent), v(c.defacto_parent_zh), c.area_km2, c.label_lon, c.label_lat,
                     gj(geoms[c.county_id])))
    con.executemany("INSERT INTO counties VALUES (" + ",".join("?" * 24) + ")", rows)
    con.executemany("INSERT INTO split_pieces VALUES (?,?,?,?)",
                    [(k, k.split("@")[0], float(df[df.piece_id == k].area_km2.iloc[0]) if False else None, gj(g))
                     for k, g in pieces.items()])
    cols = ["snapshot", "piece_id", "county_id", "unit_id", "unit_gwcode", "unit_name_en", "unit_name_zh", "unit_status",
            "sovereign_gwcode", "sovereign_name_en", "sovereign_name_zh", "controller_gwcode", "controller_name_en",
            "controller_name_zh", "controller_detail_en", "controller_detail_zh", "control_type", "control_source",
            "control_confidence", "bloc", "partial_control_events", "area_km2", "population_est", "pop_method"]
    df = df.drop_duplicates(["snapshot", "piece_id"])
    df[cols].to_sql("county_snapshot", con, if_exists="append", index=False)
    con.execute("UPDATE split_pieces SET area_km2 = (SELECT MAX(area_km2) FROM county_snapshot s "
                "WHERE s.piece_id = split_pieces.piece_id)")
    rules = pd.read_csv(ROOT / "curated" / "ww2_region_control.csv")
    rules.insert(0, "row", range(2, len(rules) + 2))
    rules.to_sql("control_rules", con, if_exists="append", index=False)
    pd.read_csv(ROOT / "curated" / "control_events.csv").to_sql("control_events", con, if_exists="append", index=False)
    lv = pd.read_csv(WW2_WORK / "county_levels.csv")
    lv.to_sql("county_levels", con, if_exists="append", index=False)
    con.commit()
    con.execute("VACUUM")
    con.close()
    print(WW2_DB, f"{WW2_DB.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
