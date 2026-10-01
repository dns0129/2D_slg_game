"""Assemble everything into one SQLite database.

Geometry is stored as GeoJSON text (EPSG:4326) so any SQLite client can read
it without GIS extensions; grids and rasters are stored as zlib-compressed
little-endian arrays with their georeferencing in the same row.
"""
import datetime as dt
import io
import json
import sqlite3
import zlib

import numpy as np
import pandas as pd
from PIL import Image
from shapely.geometry import shape, mapping

import topo
from common import RAW, WORK, ROOT, DB_DIR, YEARS, GRID_RES, HYDE_RES, SNAPSHOT_MONTH_DAY

DB = DB_DIR / f"world_history_{YEARS[0]}_{YEARS[-1]}.sqlite"
UNIT_TOL = 0.01      # degrees, shared-arc simplification for unit borders
PIECE_TOL = 0.01
DB_GRID_RES = 0.5    # population/GDP grids stored in the DB


SOURCES = [
    ("cshapes2", "CShapes 2.0", "Schvitz, G., Girardin, L., Rüegger, S., Weidmann, N. B., Cederman, L.-E., Gleditsch, K. S. (2022). "
     "Mapping the International System, 1886-2019: The CShapes 2.0 Dataset. Journal of Conflict Resolution 66(1).",
     "https://icr.ethz.ch/data/cshapes/ (copy bundled in the CRAN package cshapes 2.0)", "CC BY-NC-SA 4.0",
     "Borders, status (independent/colony/protectorate/mandate/occupied) and owner of every state and dependency"),
    ("ghspop", "GHS-POP R2023A", "Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023). GHS-POP R2023A - GHS population grid "
     "multitemporal (1975-2030). European Commission, Joint Research Centre.",
     "https://human-settlement.emergency.copernicus.eu/ (AWS s3://jrc-ghsl/ghs-pop)", "CC BY 4.0",
     "Spatial pattern of population inside each country (1975-2000 epochs)"),
    ("hyde35", "HYDE 3.5", "Klein Goldewijk, K. et al. HYDE 3.5 (2025), Utrecht University.",
     "https://geo.public.data.uu.nl/vault-hyde/", "CC BY 3.0",
     "Preferred historical population pattern; used only when downloaded (see README)"),
    ("unwpp", "UN World Population Prospects", "United Nations, DESA, Population Division. World Population Prospects "
     "(via Gapminder ddf--gapminder--population).", "https://github.com/open-numbers/ddf--gapminder--population", "CC BY 3.0 IGO / CC BY 4.0",
     "National population 1950-2000 (present-day borders)"),
    ("gapminder_pop", "Gapminder population v5", "Gapminder (2017), population by country 1800-2100, via Our World in Data owid-datasets.",
     "https://github.com/owid/owid-datasets", "CC BY 4.0", "National population 1900-1949 (spliced to UN level at 1950)"),
    ("maddison2020", "Maddison Project Database 2020", "Bolt, J. and van Zanden, J. L. (2020). Maddison style estimates of the evolution "
     "of the world economy. A new 2020 update. Via Our World in Data owid-datasets.",
     "https://www.rug.nl/ggdc/historicaldevelopment/maddison/", "CC BY 4.0", "GDP per capita levels (2011 international $)"),
    ("gapminder_gdp", "Gapminder GDP per capita (constant PPP)", "Gapminder GDP per capita, constant 2017 PPP $ (ddf--gapminder--gdp_per_capita_cppp).",
     "https://github.com/open-numbers/ddf--gapminder--gdp_per_capita_cppp", "CC BY 4.0", "Annual path used to fill gaps between/around Maddison values"),
    ("cow_nmc", "Correlates of War National Material Capabilities v6", "Singer, J. D., Bremer, S., Stuckey, J. (1972); Greig, J. M. and Enterline, A. J. "
     "(2021) NMC v6.0. Via R package peacesciencer (Miller 2022).", "https://correlatesofwar.org/", "Free for research use, cite",
     "Population of independent states in contemporary borders (stage-2 calibration before 1950)"),
    ("fariss2022", "Fariss et al. historical GDP", "Fariss, C. J., Anders, T., Markowitz, J. N., Barnum, M. (2022). New Estimates of Over 500 Years "
     "of Historic GDP and Population Data. Journal of Conflict Resolution 66(3). Via peacesciencer.",
     "https://github.com/svmiller/peacesciencer", "see source", "Alternative GDP of independent states in contemporary borders (cross-check column)"),
    ("us_states", "US Census state population estimates", "US Census Bureau annual estimates via FRED, compiled by J. Tauberer.",
     "https://github.com/JoshData/historical-state-population-csv", "Public domain", "Sub-national calibration, United States 1900-2000"),
    ("naturalearth", "Natural Earth 1:10m", "Natural Earth. Free vector and raster map data @ naturalearthdata.com.",
     "https://github.com/nvkelso/natural-earth-vector", "Public domain",
     "Admin-0 (modern country grid), admin-1 reference units, rivers, lakes, coast, land, glaciers, physical labels"),
    ("terrarium", "Mapzen/Tilezen Terrarium terrain tiles", "Terrain tiles; SRTM and GMTED2010 courtesy of the U.S. Geological Survey; "
     "ETOPO1 courtesy NOAA NCEI.", "https://registry.opendata.aws/terrain-tiles/", "see attribution",
     "Elevation grid, hillshade and hypsometric bands"),
    ("curated", "Curated tables (this project)", "Control events (de facto occupations/annexations not coded in CShapes) and "
     "time-aware English/Chinese unit names compiled for this database.", "curated/", "CC0", "De facto control overlay and names"),
]

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sources (source_id TEXT PRIMARY KEY, name TEXT, citation TEXT, url TEXT, license TEXT, used_for TEXT);
CREATE TABLE years (
  year INTEGER PRIMARY KEY, snapshot_date TEXT, world_population REAL, world_gdp_2011usd REAL,
  n_units INTEGER, n_independent INTEGER, n_dependent INTEGER, population_pattern TEXT,
  unassigned_population REAL, n_control_events_whole INTEGER, n_control_events_partial INTEGER);
CREATE TABLE units (
  unit_id INTEGER PRIMARY KEY, gwcode INTEGER, cshapes_name TEXT, status TEXT, owner_gwcode TEXT,
  start_date TEXT, end_date TEXT, capital TEXT, cap_lon REAL, cap_lat REAL, area_km2 REAL,
  label_lon REAL, label_lat REAL, geometry TEXT);
CREATE TABLE unit_year (
  year INTEGER, unit_id INTEGER, name_en TEXT, name_zh TEXT, cshapes_name TEXT, gwcode INTEGER,
  cshapes_status TEXT, sovereign_gwcode TEXT, sovereign_name_en TEXT, sovereign_name_zh TEXT,
  controller_gwcode TEXT, controller_name_en TEXT, controller_name_zh TEXT, control_type TEXT,
  control_event TEXT, partial_control_events TEXT,
  population REAL, pop_calibration TEXT, nmc_tpop REAL, gdp_2011usd REAL, gdp_alt_fariss2022_2011usd REAL,
  area_km2 REAL, pop_share_world REAL, gdp_share_world REAL, gdp_per_capita REAL, density_per_km2 REAL,
  pop_share_de_jure_sovereign REAL, pop_share_de_facto_sovereign REAL,
  PRIMARY KEY (year, unit_id));
CREATE TABLE sovereign_year (
  year INTEGER, basis TEXT, sovereign_gwcode TEXT, sovereign_name_en TEXT, sovereign_name_zh TEXT,
  population REAL, gdp_2011usd REAL, area_km2 REAL, n_units INTEGER, pop_share_world REAL, gdp_share_world REAL,
  PRIMARY KEY (year, basis, sovereign_gwcode, sovereign_name_en));
CREATE TABLE admin1_pieces (
  piece_id INTEGER PRIMARY KEY, piece_key TEXT, a1_index INTEGER, ne_id INTEGER, adm1_code TEXT, name TEXT, name_en TEXT, name_zh TEXT,
  type_en TEXT, modern_country TEXT, iso_3166_2 TEXT, share_of_modern_unit REAL, area_km2 REAL,
  label_lon REAL, label_lat REAL, unit_ids TEXT, geometry TEXT);
CREATE TABLE admin1_year (
  year INTEGER, unit_id INTEGER, piece_id INTEGER, population REAL, gdp_2011usd REAL,
  pop_share_unit REAL, pop_share_world REAL, PRIMARY KEY (year, unit_id, piece_id));
CREATE TABLE country_series (
  code TEXT, name TEXT, subregion TEXT, year INTEGER, population REAL, pop_source TEXT,
  gdppc_2011usd REAL, gdppc_source TEXT, gdppc_gapminder_2017usd REAL, gdp_2011usd REAL, PRIMARY KEY (code, year));
CREATE TABLE admin1_targets (code TEXT, iso_3166_2 TEXT, year INTEGER, population REAL, source TEXT);
CREATE TABLE control_events (
  event_id TEXT PRIMARY KEY, unit_name TEXT, unit_gwcode INTEGER, start_date TEXT, end_date TEXT, scope TEXT,
  control_type TEXT, controller_name TEXT, controller_name_zh TEXT, controller_gwcode INTEGER, note TEXT);
CREATE TABLE unit_names (cshapes_name TEXT, applies_to TEXT, year_from INTEGER, year_to INTEGER, name_en TEXT, name_zh TEXT);
CREATE TABLE grids (
  year INTEGER, variable TEXT, unit TEXT, resolution_deg REAL, west REAL, north REAL, width INTEGER, height INTEGER,
  dtype TEXT, encoding TEXT, data BLOB, PRIMARY KEY (year, variable));
CREATE TABLE rasters (
  name TEXT PRIMARY KEY, description TEXT, unit TEXT, resolution_deg REAL, west REAL, north REAL, width INTEGER,
  height INTEGER, dtype TEXT, encoding TEXT, data BLOB);
CREATE TABLE physical_features (
  layer TEXT, feature_id INTEGER, name TEXT, name_zh TEXT, featurecla TEXT, scalerank REAL,
  valid_from INTEGER, valid_to INTEGER, properties TEXT, geometry TEXT, PRIMARY KEY (layer, feature_id));
CREATE INDEX unit_year_unit ON unit_year(unit_id);
CREATE INDEX admin1_year_piece ON admin1_year(piece_id);
CREATE INDEX admin1_year_unit ON admin1_year(year, unit_id);
CREATE INDEX sovereign_year_year ON sovereign_year(year, basis);
"""


class Namer:
    def __init__(self):
        self.t = pd.read_csv(ROOT / "curated" / "unit_names.csv")
        self.cache = {}

    def __call__(self, cshapes_name, status, year):
        k = (cshapes_name, status, year)
        if k in self.cache:
            return self.cache[k]
        dep = status not in ("independent", None)
        res = (cshapes_name, None)
        for r in self.t[self.t.cshapes_name == cshapes_name].itertuples():
            if r.applies_to == "dependent" and not dep:
                continue
            if r.applies_to == "independent" and dep:
                continue
            if r.year_from == r.year_from and year < r.year_from:
                continue
            if r.year_to == r.year_to and year > r.year_to:
                continue
            res = (r.name_en, r.name_zh)
            break
        self.cache[k] = res
        return res


def rnd_geojson(geom, nd=3):
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    g = mapping(geom)
    return json.dumps({"type": g["type"], "coordinates": r(g["coordinates"])}, separators=(",", ":"))


def unit_geometries(tol=UNIT_TOL):
    arcs, geoms = topo.load(RAW / "cshapes_2_gw.topojson")
    sarcs = topo.simplify_arcs(arcs, tol)
    return {g["properties"]["fid"]: topo.to_shape(sarcs, g) for g in geoms}


def pack(a):
    return zlib.compress(np.ascontiguousarray(a).astype(a.dtype.newbyteorder("<")).tobytes(), 9)


def main():
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    namer = Namer()
    events = pd.read_csv(ROOT / "curated" / "control_events.csv")
    ctrl_zh = dict(zip(events.controller_name, events.controller_name_zh))

    years = pd.read_csv(WORK / "years.csv")
    meta = {
        "title": "World history yearly database (political control, population, GDP, terrain)",
        "years": f"{YEARS[0]}-{YEARS[-1]}",
        "snapshot": f"Each year describes the world on {SNAPSHOT_MONTH_DAY} (mid-year) of that year",
        "crs": "EPSG:4326 (WGS84 longitude/latitude)",
        "geometry_encoding": "GeoJSON text; coordinates rounded to 0.001 deg",
        "gdp_unit": "2011 international dollars (Maddison Project Database 2020 convention)",
        "population_unit": "persons",
        "population_pattern": ";".join(sorted(years.population_pattern.unique())),
        "grid_encoding": "zlib-compressed little-endian array, row 0 = northernmost row, column 0 = westernmost",
        "built_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema_version": "1",
    }
    con.executemany("INSERT INTO meta VALUES (?,?)", meta.items())
    con.executemany("INSERT INTO sources VALUES (?,?,?,?,?,?)", SOURCES)
    years.to_sql("years", con, if_exists="append", index=False)

    # ---- units
    ug = unit_geometries()
    units = pd.read_csv(WORK / "units.csv")
    rows = []
    for u in units.itertuples():
        rows.append((u.unit_id, u.gwcode, u.name, u.status, str(u.owner_gwcode), u.start_date, u.end_date, u.capital,
                     u.cap_lon, u.cap_lat, u.area_km2, u.label_lon, u.label_lat, rnd_geojson(ug[u.unit_id])))
    con.executemany("INSERT INTO units VALUES (" + ",".join("?" * 14) + ")", rows)

    # ---- unit_year with names
    uy = pd.read_csv(WORK / "unit_year.csv")
    # display names of independent states per year, keyed by GW code
    state_name = {}
    for r in uy[uy.cshapes_status == "independent"].itertuples():
        state_name[(r.year, str(r.gwcode))] = namer(r.name, "independent", r.year)

    def sovereign_display(year, code, cs_name):
        if (year, str(code)) in state_name:
            return state_name[(year, str(code))]
        if isinstance(cs_name, str):
            return namer(cs_name, "independent", year)
        return (None, None)

    def controller_display(year, code, name):
        single = int(code) > 0 and not any(k in name for k in ("/", "powers", "allies", " and "))
        if single and (year, str(code)) in state_name:
            return state_name[(year, str(code))]
        return (name, ctrl_zh.get(name))

    rows = []
    for r in uy.itertuples():
        en, zh = namer(r.name, r.cshapes_status, r.year)
        s_en, s_zh = sovereign_display(r.year, r.sovereign_gwcode, r.sovereign_name)
        if isinstance(r.control_event, str):
            c_en, c_zh = controller_display(r.year, r.controller_gwcode, r.controller_name)
        else:
            c_en, c_zh = s_en, s_zh
        rows.append((en, zh, s_en, s_zh, c_en, c_zh))
    nm = pd.DataFrame(rows, columns=["name_en", "name_zh", "sovereign_name_en", "sovereign_name_zh",
                                     "controller_name_en", "controller_name_zh"])
    out = pd.DataFrame({
        "year": uy.year, "unit_id": uy.unit_id, "name_en": nm.name_en, "name_zh": nm.name_zh, "cshapes_name": uy.name,
        "gwcode": uy.gwcode, "cshapes_status": uy.cshapes_status, "sovereign_gwcode": uy.sovereign_gwcode.astype(str),
        "sovereign_name_en": nm.sovereign_name_en, "sovereign_name_zh": nm.sovereign_name_zh,
        "controller_gwcode": uy.controller_gwcode.astype(str),
        "controller_name_en": nm.controller_name_en, "controller_name_zh": nm.controller_name_zh,
        "control_type": uy.control_type,
        "control_event": uy.control_event, "partial_control_events": uy.partial_control_events.fillna(""),
        "population": uy.population.round(0), "pop_calibration": uy.pop_calibration, "nmc_tpop": uy.nmc_tpop,
        "gdp_2011usd": uy.gdp_2011usd.round(-3), "gdp_alt_fariss2022_2011usd": uy.gdp_alt_fariss2022_2011usd.round(-3),
        "area_km2": uy.area_km2, "pop_share_world": uy.pop_share_world, "gdp_share_world": uy.gdp_share_world,
        "gdp_per_capita": uy.gdp_per_capita.round(1), "density_per_km2": uy.density_per_km2.round(3)})

    # ---- sovereign aggregates (de jure = CShapes owner, de facto = after control events)
    world = years.set_index("year")
    sov = []
    for basis, code_col, en_col, zh_col in (("de_jure", "sovereign_gwcode", "sovereign_name_en", "sovereign_name_zh"),
                                           ("de_facto", "controller_gwcode", "controller_name_en", "controller_name_zh")):
        key = np.where(out[code_col].astype(int) > 0, out[code_col], out[code_col] + "|" + out[en_col].fillna(""))
        g = out.assign(_k=key).groupby(["year", "_k"]).agg(
            sovereign_gwcode=(code_col, "first"), sovereign_name_en=(en_col, "first"), sovereign_name_zh=(zh_col, "first"),
            population=("population", "sum"), gdp_2011usd=("gdp_2011usd", "sum"), area_km2=("area_km2", "sum"),
            n_units=("unit_id", "count")).reset_index().drop(columns="_k")
        # prefer the state's own display name over an event label
        g["sovereign_name_en"], g["sovereign_name_zh"] = zip(*[
            state_name.get((y, c), (e, z)) for y, c, e, z in
            zip(g.year, g.sovereign_gwcode, g.sovereign_name_en, g.sovereign_name_zh)])
        g.insert(1, "basis", basis)
        g["pop_share_world"] = g.population / g.year.map(world.world_population)
        g["gdp_share_world"] = g.gdp_2011usd / g.year.map(world.world_gdp_2011usd)
        sov.append(g)
        share = out.population / out.groupby(["year", code_col]).population.transform("sum")
        out[f"pop_share_{basis}_sovereign"] = share
    sy = pd.concat(sov)
    out.to_sql("unit_year", con, if_exists="append", index=False)
    out.to_csv(WORK / "unit_year_named.csv", index=False)
    sy.to_sql("sovereign_year", con, if_exists="append", index=False)
    sy.to_csv(WORK / "sovereign_year_named.csv", index=False)

    # ---- admin-1 pieces
    pieces = pd.read_csv(WORK / "pieces.csv").sort_values("piece_id").reset_index(drop=True)
    piece_no = {k: i + 1 for i, k in enumerate(pieces.piece_id)}
    pg = {f["properties"]["piece_id"]: shape(f["geometry"])
          for f in json.load(open(WORK / "pieces.geojson"))["features"]}
    rows = []
    for p in pieces.itertuples():
        g = pg[p.piece_id].simplify(PIECE_TOL, preserve_topology=True)
        rows.append((piece_no[p.piece_id], p.piece_id, p.a1_index, p.ne_id, p.adm1_code, p.name, p.name_en, p.name_zh, p.type_en,
                     p.modern_country, p.iso_3166_2, p.share_of_modern_unit, p.area_km2, p.label_lon, p.label_lat,
                     p.unit_ids, rnd_geojson(g)))
    con.executemany("INSERT INTO admin1_pieces VALUES (" + ",".join("?" * 17) + ")", rows)
    py = pd.read_csv(WORK / "piece_year.csv")
    py["piece_id"] = py.piece_id.map(piece_no)
    py = py.round({"population": 0, "gdp_2011usd": -3})
    py.to_sql("admin1_year", con, if_exists="append", index=False)

    # ---- inputs and curated tables
    pd.read_csv(WORK / "country_series.csv").to_sql("country_series", con, if_exists="append", index=False)
    pd.read_csv(WORK / "admin1_targets.csv").to_sql("admin1_targets", con, if_exists="append", index=False)
    events.to_sql("control_events", con, if_exists="append", index=False)
    namer.t.to_sql("unit_names", con, if_exists="append", index=False)

    # ---- grids (aggregated to DB_GRID_RES)
    f = int(round(DB_GRID_RES / GRID_RES))
    for y in YEARS:
        for var, unit in (("population", "persons per cell"), ("gdp", "2011 international $ per cell")):
            a = np.load(WORK / "grids" / f"{'pop' if var == 'population' else 'gdp'}_{y}.npy")
            h, w = a.shape
            a = a.reshape(h // f, f, w // f, f).sum(axis=(1, 3))
            if var == "population":
                a = np.round(a).astype(np.uint32)
                dtype = "uint32"
            else:
                a = np.round(a / 1e3).astype(np.uint32)  # thousands of dollars
                unit = "thousand 2011 international $ per cell"
                dtype = "uint32"
            con.execute("INSERT INTO grids VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (y, var, unit, DB_GRID_RES, -180.0, 90.0, a.shape[1], a.shape[0], dtype, "zlib", pack(a)))

    # ---- rasters
    z = np.load(WORK / "elevation_5m.npy")
    con.execute("INSERT INTO rasters VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                ("elevation", "Elevation / bathymetry (Terrarium z5, area-averaged)", "metres", HYDE_RES, -180.0, 90.0,
                 z.shape[1], z.shape[0], "int16", "zlib", pack(np.round(z).astype(np.int16))))
    hs = (WORK / "physical" / "hillshade_5m.png").read_bytes()
    con.execute("INSERT INTO rasters VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                ("hillshade", "Land hillshade for multiply blending (255 = lit/flat, darker = shadow)", "0-255",
                 HYDE_RES, -180.0, 90.0, z.shape[1], z.shape[0], "uint8", "png", hs))

    # ---- physical vector layers
    for layer in ("land", "rivers", "lakes", "glaciers", "elevation_bands", "regions", "marine",
                  "region_points", "peaks"):
        feats = json.load(open(WORK / "physical" / f"{layer}.geojson"))["features"]
        rows = []
        for i, ft in enumerate(feats):
            p = ft["properties"]
            rows.append((layer, i, p.get("name"), p.get("name_zh"), p.get("featurecla") or p.get("kind"),
                         p.get("scalerank"), p.get("valid_from"), p.get("valid_to"),
                         json.dumps(p, ensure_ascii=False), json.dumps(ft["geometry"], separators=(",", ":"))))
        con.executemany("INSERT INTO physical_features VALUES (?,?,?,?,?,?,?,?,?,?)", rows)

    con.commit()
    con.execute("VACUUM")
    con.close()
    print(DB, f"{DB.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
