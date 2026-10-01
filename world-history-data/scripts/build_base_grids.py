"""Static 5 arc-minute grids shared by every year.

  work/ghs_5m_<epoch>.npy   GHS-POP R2023A population counts summed to 5'
  work/hyde_5m_<year>.npy   HYDE 3.5 population counts (only when downloaded)
  work/ne_country_5m.npy    index into work/ne_admin0_codes.csv (-1 = none)
  work/ne_admin1_5m.npy     index into work/ne_admin1.csv (-1 = none)
  work/cell_area_km2.npy    area of each 5' cell (per row)
"""
import json

import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import shape, mapping

from common import RAW, WORK, HYDE_RES, HYDE_W, HYDE_H, YEARS

T5 = from_origin(-180, 90, HYDE_RES, HYDE_RES)
GHS_EPOCHS = [1975, 1980, 1985, 1990, 1995, 2000]


def cell_area_km2():
    r = 6371.0072
    lat_edges = np.linspace(90, -90, HYDE_H + 1)
    band = 2 * np.pi * r * r * np.abs(np.sin(np.radians(lat_edges[:-1])) - np.sin(np.radians(lat_edges[1:])))
    return (band / HYDE_W).astype(np.float64)


def ghs_to_5m(path):
    """Sum 30 arc-second pixels into the 5' cell that contains their centre."""
    out = np.zeros((HYDE_H, HYDE_W), dtype=np.float64)
    with rasterio.open(path) as src:
        t = src.transform
        col_c = t.c + (np.arange(src.width) + 0.5) * t.a
        tcol = np.clip(np.floor((col_c + 180) / HYDE_RES).astype(int), 0, HYDE_W - 1)
        cstarts = np.r_[0, np.flatnonzero(np.diff(tcol)) + 1]
        ccols = tcol[cstarts]
        step = 1200
        for r0 in range(0, src.height, step):
            n = min(step, src.height - r0)
            a = src.read(1, window=((r0, r0 + n), (0, src.width)))
            a = np.where(a > 0, a, 0.0)
            row_c = t.f + (np.arange(r0, r0 + n) + 0.5) * t.e
            trow = np.clip(np.floor((90 - row_c) / HYDE_RES).astype(int), 0, HYDE_H - 1)
            colsum = np.add.reduceat(a, cstarts, axis=1)
            rstarts = np.r_[0, np.flatnonzero(np.diff(trow)) + 1]
            rows = np.add.reduceat(colsum, rstarts, axis=0)
            for k, rs in enumerate(rstarts):
                out[trow[rs], ccols] += rows[k]
    return out.astype(np.float32)


def burn(geoms_ids, fill=-1):
    """Rasterise polygons largest first so small units are not swallowed, then
    make sure every unit owns at least the cell under its representative point."""
    items = sorted(geoms_ids, key=lambda g: -g[0].area)
    grid = rasterize(((mapping(g), i) for g, i in items), out_shape=(HYDE_H, HYDE_W),
                     transform=T5, fill=fill, dtype="int32", all_touched=False)
    present = set(np.unique(grid).tolist())
    for g, i in items:
        if i in present:
            continue
        p = g.representative_point()
        r = min(int((90 - p.y) / HYDE_RES), HYDE_H - 1)
        c = min(int((p.x + 180) / HYDE_RES), HYDE_W - 1)
        grid[r, c] = i
    return grid


def fill_nearest(grid, mask):
    """Give cells in `mask` that have no unit the id of the nearest unit cell."""
    missing = (grid < 0) & mask
    if not missing.any():
        return grid
    _, (ri, ci) = ndimage.distance_transform_edt(grid < 0, return_indices=True)
    out = grid.copy()
    out[missing] = grid[ri[missing], ci[missing]]
    return out


def main():
    np.save(WORK / "cell_area_km2.npy", cell_area_km2())

    for y in GHS_EPOCHS:
        dest = WORK / f"ghs_5m_{y}.npy"
        if not dest.exists():
            g = ghs_to_5m(RAW / "ghs_pop" / f"GHS_POP_E{y}_30ss.tif")
            np.save(dest, g)
            print("GHS", y, f"{g.sum() / 1e9:.3f} bn")

    hyde_dir = RAW / "hyde35"
    if (hyde_dir / "urban_population.nc").exists():
        import xarray as xr
        tot = None
        for name in ("urban_population.nc", "rural_population.nc"):
            ds = xr.open_dataset(hyde_dir / name)
            var = [v for v in ds.data_vars if ds[v].ndim == 3][0]
            tot = ds[var] if tot is None else tot + ds[var]
        tdim = [d for d in tot.dims if d not in ("lat", "lon", "latitude", "longitude", "y", "x")][0]
        years = pd.to_datetime(tot[tdim].values).year if np.issubdtype(tot[tdim].dtype, np.datetime64) \
            else np.asarray(tot[tdim].values).astype(int)
        for y in sorted(set(years) & set(range(YEARS[0] - 10, YEARS[-1] + 11))):
            a = np.nan_to_num(tot.isel({tdim: list(years).index(y)}).values.astype(np.float32))
            lat = [d for d in tot.dims if d.startswith("lat") or d == "y"][0]
            if tot[lat].values[0] < tot[lat].values[-1]:
                a = a[::-1]
            np.save(WORK / f"hyde_5m_{y}.npy", a)
            print("HYDE", y, f"{a.sum() / 1e9:.3f} bn")

    pop_any = np.load(WORK / "ghs_5m_1975.npy") > 0

    if not (WORK / "ne_country_5m.npy").exists():
        build_country_grid(pop_any)
    build_admin1(pop_any)


def build_country_grid(pop_any):
    # modern countries (Natural Earth admin-0) -> series codes
    ne = json.load(open(RAW / "naturalearth" / "ne_10m_admin_0_countries.geojson"))
    geoms = [(shape(f["geometry"]), i) for i, f in enumerate(ne["features"])]
    grid = burn(geoms)
    grid = fill_nearest(grid, pop_any)
    np.save(WORK / "ne_country_5m.npy", grid.astype(np.int16))


def build_admin1(pop_any):
    # admin-1 (Natural Earth, present-day) reference units
    a1 = json.load(open(RAW / "naturalearth" / "ne_10m_admin_1_states_provinces.geojson"))
    rows, geoms = [], []
    for i, f in enumerate(a1["features"]):
        p = f["properties"]
        rows.append(dict(a1_index=i, ne_id=p.get("ne_id"), adm1_code=p.get("adm1_code"),
                         name=p.get("name"), name_en=p.get("name_en"), name_zh=p.get("name_zh"),
                         type_en=p.get("type_en"), admin=p.get("admin"), adm0_a3=p.get("adm0_a3"),
                         iso_a2=p.get("iso_a2"), iso_3166_2=p.get("iso_3166_2"),
                         postal=p.get("postal"), region=p.get("region"),
                         wikidataid=p.get("wikidataid")))
        geoms.append((shape(f["geometry"]), i))
    pd.DataFrame(rows).to_csv(WORK / "ne_admin1.csv", index=False)
    if (WORK / "ne_admin1_5m.npy").exists():
        return
    g1 = burn(geoms)
    g1 = fill_nearest(g1, pop_any)
    np.save(WORK / "ne_admin1_5m.npy", g1.astype(np.int32))
    print("admin1 cells assigned:", len(np.unique(g1)) - 1)


if __name__ == "__main__":
    main()
