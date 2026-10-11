"""Download pinned public fine-division sources to a separate build cache."""
import argparse
import concurrent.futures
from pathlib import Path
import urllib.request

RAW = "https://raw.githubusercontent.com/"
FILES = {
    "1939/admin.json": "dns0129/world_map_history/430e8b9c99fdf05be2d4f094e64659a75fdf4100/ww2/maps/data/admin.json",
    "1939/geo-admin.bin": "dns0129/world_map_history/430e8b9c99fdf05be2d4f094e64659a75fdf4100/ww2/maps/data/geo-admin.bin",
    "1939/geo.bin": "dns0129/world_map_history/430e8b9c99fdf05be2d4f094e64659a75fdf4100/ww2/maps/data/geo.bin",
    "1939/snap-1939-09-01.json": "dns0129/world_map_history/430e8b9c99fdf05be2d4f094e64659a75fdf4100/ww2/maps/data/snap-1939-09-01.json",
    "usa-2026.geojson": "plotly/datasets/0c447c47b757ad74edecab31f0d72f849d2e67c2/geojson-counties-fips.json",
    "china.rda": "xmc811/mapchina/053136c1c9c01742681bf9224ecad4d8c0bf9df0/data/china.rda",
    "brazil.geojson": "tbrugz/geodata-br/c39dfb040bfd466fe2a476bafed00749c5c42f16/geojson/geojs-100-mun.json",
    "ne-admin1.geojson": "nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_1_states_provinces.geojson",
    **{f"india/india-districts.{s}": "datameet/maps/b3fbbde595310b397a55d718e0958ce249a4fa1f/Districts/Census_2011/2011_Dist." + s
       for s in ["shp", "shx", "dbf", "prj"]},
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cache", type=Path)
    args = ap.parse_args()
    if args.cache.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        ap.error("Use a source cache outside the website repository.")

    def one(item):
        name, url = item
        dest = args.cache / name
        if dest.exists():
            return name
        with urllib.request.urlopen(RAW + url, timeout=90) as response:
            data = response.read()
        if data.startswith(b"version https://git-lfs"):
            raise ValueError("Source is an LFS pointer, not boundary data: " + name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return name

    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for name in pool.map(one, FILES.items()):
            print(name, flush=True)


if __name__ == "__main__":
    main()
