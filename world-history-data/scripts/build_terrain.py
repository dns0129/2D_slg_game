"""Static physical geography: elevation grid, hillshade, hypsometric bands and
Natural Earth hydrography / physical labels.

Elevation comes from Mapzen/Tilezen Terrarium tiles (zoom 5, Web Mercator,
SRTM/GMTED/ETOPO1 sources) reprojected to the 5' geographic grid. Mercator
tiles stop at 85.05 deg N/S; cells beyond are filled from the nearest value.

Hydrography is present-day Natural Earth 1:10m, with two time controls:
  * reservoirs carry the dam completion year (valid_from)
  * historic extents of the Aral Sea, Lake Chad and Lop Nur are used before
    1970 and the present-day polygons from 1970 (approximation)
"""
import json

import numpy as np
import rasterio
import shapefile
from PIL import Image
from rasterio.features import rasterize, shapes
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import reproject, Resampling
from scipy import ndimage
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from common import RAW, WORK, HYDE_RES, HYDE_W, HYDE_H

T5 = from_origin(-180, 90, HYDE_RES, HYDE_RES)
Z = 5
MERC = 20037508.342789244
LAND_LEVELS = [200, 500, 1000, 1500, 2000, 3000, 4000, 5000]
SEA_LEVELS = [-200, -1000, -2000, -3000, -4000, -5000, -6000]
HISTORIC_LAKES = {"Aral Sea", "Lake Chad", "Lop Nur"}
HISTORIC_SWITCH = 1970


def mosaic():
    n = 2 ** Z
    out = np.zeros((n * 256, n * 256), dtype=np.float32)
    for x in range(n):
        for y in range(n):
            a = np.asarray(Image.open(RAW / "terrarium" / str(Z) / f"{x}_{y}.png").convert("RGB"), dtype=np.float32)
            out[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return out


def elevation():
    src = mosaic()
    n = src.shape[0]
    dst = np.full((HYDE_H, HYDE_W), np.nan, dtype=np.float32)
    reproject(src, dst, src_transform=from_bounds(-MERC, -MERC, MERC, MERC, n, n), src_crs="EPSG:3857",
              dst_transform=T5, dst_crs="EPSG:4326", resampling=Resampling.average, dst_nodata=np.nan)
    # Rows beyond the Mercator limit get the zonal mean of the last valid row
    # (Antarctic plateau / Arctic Ocean), which avoids striping.
    valid_rows = np.flatnonzero(~np.isnan(dst).all(axis=1))
    top, bot = valid_rows[0], valid_rows[-1]
    dst[:top] = np.nanmean(dst[top])
    dst[bot + 1:] = np.nanmean(dst[bot])
    miss = np.isnan(dst)
    if miss.any():
        _, (ri, ci) = ndimage.distance_transform_edt(miss, return_indices=True)
        dst[miss] = dst[ri[miss], ci[miss]]
    return dst


def hillshade(z, land, az=315, alt=45):
    """Land-only shade for multiply blending: 255 = lit/flat, darker = shadow."""
    lat = 90 - (np.arange(HYDE_H) + 0.5) * HYDE_RES
    dx = 2 * np.pi * 6371000 * np.cos(np.radians(lat))[:, None] / HYDE_W
    dy = np.pi * 6371000 / HYDE_H
    zz = ndimage.gaussian_filter(z, 0.6)
    gy, gx = np.gradient(zz)
    gx = gx / np.maximum(dx, 1000)
    gy = -gy / dy
    exag = 12.0
    slope = np.arctan(exag * np.hypot(gx, gy))
    aspect = np.arctan2(gy, -gx)
    out = np.zeros_like(z, dtype=np.float64)
    for azi, w in ((az, 0.6), (az - 45, 0.2), (az + 45, 0.2)):
        a, b = np.radians(360 - azi + 90), np.radians(alt)
        out += w * (np.sin(b) * np.cos(slope) + np.cos(b) * np.sin(slope) * np.cos(a - aspect))
    flat = np.sin(np.radians(alt))
    shade = 255 * np.clip(1 - 1.6 * np.clip(flat - out, 0, None), 0.25, 1)
    shade[~land] = 255
    return shade.astype(np.uint8)


def geojson(features, path):
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False,
                  separators=(",", ":"))


def rnd(geom, nd=3):
    """Round coordinates to cut file size (0.001 deg ~ 100 m)."""
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def bands(z, land):
    zs = ndimage.gaussian_filter(z, 1.0)
    feats = []
    for lvl in LAND_LEVELS:
        mask = ((zs >= lvl) & land).astype(np.uint8)
        feats += polygons(mask, dict(kind="land", min_elevation_m=lvl), 0.04, min_area=0.02)
    for lvl in SEA_LEVELS:
        mask = ((zs <= lvl) & ~land).astype(np.uint8)
        feats += polygons(mask, dict(kind="sea", max_elevation_m=lvl), 0.08, min_area=0.1)
    return feats


def polygons(mask, props, tol, min_area):
    geoms = [shape(g) for g, v in shapes(mask, mask=mask.astype(bool), transform=T5) if v == 1]
    if not geoms:
        return []
    u = unary_union(geoms).simplify(tol, preserve_topology=True)
    parts = [p for p in getattr(u, "geoms", [u]) if p.area >= min_area]
    return [{"type": "Feature", "properties": props, "geometry": rnd(p)} for p in parts]


def ne(name):
    return json.load(open(RAW / "naturalearth" / f"{name}.geojson"))["features"]


def lower(p):
    return {k.lower(): v for k, v in p.items()}


def main():
    out = WORK / "physical"
    out.mkdir(exist_ok=True)

    z = elevation()
    np.save(WORK / "elevation_5m.npy", z)
    zi = np.round(z).astype(np.int16)
    with rasterio.open(out / "elevation_5m.tif", "w", driver="GTiff", width=HYDE_W, height=HYDE_H, count=1,
                       dtype="int16", crs="EPSG:4326", transform=T5, compress="deflate", predictor=2,
                       tiled=True, blockxsize=512, blockysize=512) as dst:
        dst.write(zi, 1)
        dst.update_tags(units="metres", source="Mapzen/Tilezen Terrarium z5 (SRTM, GMTED2010, ETOPO1)")
    land_feats = ne("ne_10m_land") + ne("ne_10m_minor_islands")
    land_geom = [shape(f["geometry"]) for f in land_feats]
    land = rasterize(((mapping(g), 1) for g in land_geom), out_shape=(HYDE_H, HYDE_W), transform=T5,
                     fill=0, dtype="uint8", all_touched=True).astype(bool)
    np.save(WORK / "land_5m.npy", land)
    hs = hillshade(z, land)
    Image.fromarray(hs, "L").save(out / "hillshade_5m.png", optimize=True)
    geojson(bands(z, land), out / "elevation_bands.geojson")

    geojson([{"type": "Feature", "properties": {"kind": "land"},
              "geometry": rnd(g.simplify(0.005, preserve_topology=True))} for g in land_geom],
            out / "land.geojson")
    geojson([{"type": "Feature", "properties": {"scalerank": f["properties"].get("scalerank")},
              "geometry": rnd(shape(f["geometry"]).simplify(0.005))} for f in ne("ne_10m_coastline")],
            out / "coastline.geojson")

    # rivers (shapefile carries Chinese names)
    r = shapefile.Reader(str(RAW / "naturalearth" / "shp" / "ne_10m_rivers_lake_centerlines.shp"), encoding="utf-8")
    rivers = []
    for sr in r.iterShapeRecords():
        p = sr.record.as_dict()
        g = shape(sr.shape.__geo_interface__).simplify(0.005)
        if g.is_empty:
            continue
        rivers.append({"type": "Feature", "geometry": rnd(g), "properties": {
            "name": p["name"] or None, "name_en": p["name_en"] or None, "name_zh": p["name_zh"] or None,
            "featurecla": p["featurecla"], "scalerank": p["scalerank"], "min_zoom": p["min_zoom"],
            "wikidataid": p["wikidataid"] or None, "valid_from": None, "valid_to": None}})
    geojson(rivers, out / "rivers.geojson")

    lakes = []
    for f in ne("ne_10m_lakes"):
        p = f["properties"]
        vf = p["year"] if p["featurecla"] == "Reservoir" and p.get("year") and p["year"] > 0 else None
        vt = None
        if p["name"] in HISTORIC_LAKES:
            vf = HISTORIC_SWITCH
        lakes.append({"type": "Feature", "geometry": rnd(shape(f["geometry"]).simplify(0.003, preserve_topology=True)),
                      "properties": {"name": p["name"], "name_zh": p.get("name_zh"), "featurecla": p["featurecla"],
                                     "scalerank": p["scalerank"], "dam_name": p.get("dam_name"),
                                     "valid_from": vf, "valid_to": vt, "wikidataid": p.get("wikidataid")}})
    for f in ne("ne_10m_lakes_historic"):
        p = f["properties"]
        if p["name"] not in HISTORIC_LAKES:
            continue
        lakes.append({"type": "Feature", "geometry": rnd(shape(f["geometry"]).simplify(0.003, preserve_topology=True)),
                      "properties": {"name": p["name"], "name_zh": None, "featurecla": "Historic Lake",
                                     "scalerank": int(p["scalerank"]), "dam_name": None,
                                     "valid_from": None, "valid_to": HISTORIC_SWITCH - 1, "wikidataid": None}})
    geojson(lakes, out / "lakes.geojson")

    geojson([{"type": "Feature", "geometry": rnd(shape(f["geometry"]).simplify(0.01, preserve_topology=True)),
              "properties": {"scalerank": f["properties"]["scalerank"]}} for f in ne("ne_10m_glaciated_areas")],
            out / "glaciers.geojson")

    keep = ("name", "name_en", "name_zh", "featurecla", "scalerank", "region", "subregion",
            "min_label", "max_label", "label", "elevation", "wikidataid", "min_zoom")
    for src, dst, tol in (("ne_10m_geography_regions_polys", "regions", 0.02),
                          ("ne_10m_geography_marine_polys", "marine", 0.02),
                          ("ne_10m_geography_regions_points", "region_points", 0),
                          ("ne_10m_geography_regions_elevation_points", "peaks", 0)):
        feats = []
        for f in ne(src):
            p = lower(f["properties"])
            g = shape(f["geometry"])
            if tol:
                g = g.simplify(tol, preserve_topology=True)
            feats.append({"type": "Feature", "geometry": rnd(g),
                          "properties": {k: p.get(k) for k in keep if k in p}})
        geojson(feats, out / f"{dst}.geojson")
    for p in sorted(out.iterdir()):
        print(p.name, f"{p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
