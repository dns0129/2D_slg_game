#!/bin/sh
# Rebuild the whole database from scratch.
#   pip install shapely pyproj rasterio numpy scipy pillow matplotlib pyshp pandas pyreadr pypinyin
#   ./build_all.sh            (add "hyde" to also download HYDE 3.5 where reachable)
set -e
cd "$(dirname "$0")/scripts"
python3 fetch_sources.py ghs ne terrain git "$@"
python3 build_country_series.py
python3 build_base_grids.py
python3 build_subnational.py
python3 build_terrain.py
python3 build_yearly.py
python3 build_database.py
python3 export_years.py
python3 render_maps.py
python3 verify_database.py

# 1939-1945 county-level database and interactive maps (needs pypinyin too)
python3 ww2_fetch.py
python3 ww2_counties.py
for d in 1939-09-01 1940-07-01 1941-12-07 1942-11-01 1944-06-06 1945-09-02; do
  python3 ww2_snapshots.py "$d"
  cp ../work/ww2/snapshot_counties.csv "../work/ww2/snapshot_$d.csv"
  cp ../work/ww2/split_pieces.geojson "../work/ww2/split_$d.geojson"
done
python3 ww2_database.py
python3 ww2_webmap.py
python3 ww2_html.py
