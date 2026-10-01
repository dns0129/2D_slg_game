"""Download every raw source used by the pipeline into raw/.

All hosts used here are reachable from restricted CI sandboxes (GitHub and
AWS S3). Official landing pages for each dataset are listed in README.md.
"""
import concurrent.futures as cf
import lzma
import subprocess
import sys
import urllib.request
from pathlib import Path

from common import RAW

UA = {"User-Agent": "world-history-data/1.0"}

# HYDE 3.5 (Klein Goldewijk et al., April 2025) baseline NetCDF grids from the
# Utrecht University public data vault. This host was blocked by the network
# policy of the environment that built this release, so the release uses the
# GHS-POP fallback described in README.md. Run `fetch_sources.py hyde` where
# geo.public.data.uu.nl is reachable, then rebuild to switch to HYDE.
HYDE_BASE = ("https://geo.public.data.uu.nl/vault-hyde/hyde35_c9_apr2025%5B1749214444%5D"
             "/original/gbc2025_7apr_base/NetCDF/")
HYDE_FILES = ["urban_population.nc", "rural_population.nc"]

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE_LAYERS = [
    "ne_10m_admin_0_countries",
    "ne_10m_admin_1_states_provinces",
    "ne_10m_rivers_lake_centerlines",
    "ne_10m_lakes",
    "ne_10m_land",
    "ne_10m_coastline",
    "ne_10m_minor_islands",
    "ne_10m_geography_regions_polys",
    "ne_10m_geography_regions_points",
    "ne_10m_geography_regions_elevation_points",
    "ne_10m_geography_marine_polys",
    "ne_10m_glaciated_areas",
    "ne_50m_rivers_lake_centerlines",
    "ne_50m_lakes",
    "ne_50m_land",
]

# JRC GHS-POP R2023A (1975-2030 in 5-year epochs), 30 arc-second WGS84 COGs.
GHS_URL = ("https://jrc-ghsl.s3.amazonaws.com/ghs-pop/r2023a/4326/30ss/{y}/"
           "GHS_POP_E{y}_GLOBE_R2023A_4326_30ss_V1_0.tif")
GHS_EPOCHS = [1975, 1980, 1985, 1990, 1995, 2000]

# The GeoJSON copy of the river layer lacks translated names; the shapefile
# carries name_zh and wikidataid.
NE_SHP = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_physical/"
NE_SHP_LAYERS = ["ne_10m_rivers_lake_centerlines"]

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TERRAIN_ZOOM = 5

GIT_SOURCES = {
    # CShapes 2.0 with status/owner fields, as bundled in the CRAN package.
    "cran-cshapes": "https://github.com/cran/cshapes",
}

OWID_DATASETS = [
    "Maddison Project Database 2020 (Bolt and van Zanden (2020))",
    "Population by country, 1800 to 2100 (Gapminder & UN)",
]


def fetch(url: str, dest: Path, min_size: int = 1) -> Path:
    if dest.exists() and dest.stat().st_size >= min_size:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            tmp.rename(dest)
            return dest
        except Exception as e:  # network hiccups: retry with backoff
            if attempt == 4:
                raise RuntimeError(f"failed {url}: {e}")
            import time
            time.sleep(2 ** (attempt + 1))
    return dest


def git_sparse(url: str, dest: Path, paths=None):
    if not dest.exists():
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none",
                        "--no-checkout", url, str(dest)], check=True)
    if paths:
        subprocess.run(["git", "-C", str(dest), "checkout", "-q", "HEAD", "--", *paths], check=True)
    else:
        subprocess.run(["git", "-C", str(dest), "checkout", "-q", "HEAD"], check=True)


def main(what):
    jobs = []
    if "hyde" in what:
        for name in HYDE_FILES:
            jobs.append((HYDE_BASE + name, RAW / "hyde35" / name, 1_000_000))
    if "ghs" in what:
        for y in GHS_EPOCHS:
            jobs.append((GHS_URL.format(y=y), RAW / "ghs_pop" / f"GHS_POP_E{y}_30ss.tif", 100_000_000))
    if "ne" in what:
        for layer in NE_LAYERS:
            jobs.append((NE_BASE + layer + ".geojson", RAW / "naturalearth" / f"{layer}.geojson", 1000))
        for layer in NE_SHP_LAYERS:
            for ext in ("shp", "shx", "dbf", "prj", "cpg"):
                jobs.append((NE_SHP + f"{layer}.{ext}", RAW / "naturalearth" / "shp" / f"{layer}.{ext}", 1))
    if "terrain" in what:
        n = 2 ** TERRAIN_ZOOM
        for x in range(n):
            for y in range(n):
                jobs.append((TERRARIUM.format(z=TERRAIN_ZOOM, x=x, y=y),
                             RAW / "terrarium" / str(TERRAIN_ZOOM) / f"{x}_{y}.png", 100))
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(fetch, u, d, m): u for u, d, m in jobs}
        for i, f in enumerate(cf.as_completed(futs), 1):
            f.result()
            if i % 50 == 0 or i == len(jobs):
                print(f"{i}/{len(jobs)} downloaded", flush=True)
    if "git" in what:
        git_sparse(GIT_SOURCES["cran-cshapes"], RAW / "cran-cshapes")
        xz = RAW / "cran-cshapes" / "inst" / "extdata" / "cshapes_2_gw.topojson.xz"
        out = RAW / "cshapes_2_gw.topojson"
        if not out.exists():
            out.write_bytes(lzma.decompress(xz.read_bytes()))
        git_sparse("https://github.com/owid/owid-datasets", RAW / "owid-datasets",
                   [f"datasets/{d}" for d in OWID_DATASETS])
        git_sparse("https://github.com/open-numbers/ddf--gapminder--gdp_per_capita_cppp",
                   RAW / "gapminder-gdp", ["README.md", "ddf--entities--geo.csv",
                   "ddf--datapoints--income_per_person_gdppercapita_ppp_inflation_adjusted--by--geo--time.csv",
                   "ddf--datapoints--gdp_total_ppp_inflation_adjusted--by--geo--time.csv"])
        git_sparse("https://github.com/open-numbers/ddf--gapminder--population",
                   RAW / "gapminder-pop", ["README.md", "ddf--entities--geo--country.csv",
                   "ddf--datapoints--population--by--country--year.csv",
                   "ddf--datapoints--population--by--global--year.csv"])
        # COW NMC, Fariss et al. GDP and the COW<->GW year table (R package peacesciencer)
        ps = RAW / "peacesciencer-src"
        git_sparse("https://github.com/cran/peacesciencer", ps,
                   ["data/cow_nmc.rda", "data/cow_sdp_gdp.rda", "data/cow_gw_years.rda", "DESCRIPTION"])
        (RAW / "peacesciencer").mkdir(exist_ok=True)
        for f in ("cow_nmc.rda", "cow_sdp_gdp.rda", "cow_gw_years.rda"):
            (RAW / "peacesciencer" / f).write_bytes((ps / "data" / f).read_bytes())
        fetch("https://raw.githubusercontent.com/JoshData/historical-state-population-csv/master/"
              "historical_state_population_by_year.csv", RAW / "subnational" / "us_state_population_by_year.csv")
    print("done")


if __name__ == "__main__":
    # "hyde" needs geo.public.data.uu.nl (see README); the default set uses
    # only hosts that were reachable when this release was built.
    main(set(sys.argv[1:]) or {"ghs", "ne", "terrain", "git"})
