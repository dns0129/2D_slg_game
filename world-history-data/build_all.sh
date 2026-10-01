#!/bin/sh
# Rebuild the whole database from scratch.
#   pip install shapely pyproj rasterio numpy scipy pillow matplotlib pyshp pandas pyreadr
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
