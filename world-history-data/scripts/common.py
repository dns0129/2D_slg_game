"""Shared paths and constants for the world history data pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"          # downloaded source files (not committed)
WORK = ROOT / "work"        # intermediate products (not committed)
DB_DIR = ROOT / "db"
EXPORTS = ROOT / "exports"
MAPS = ROOT / "maps"

# Years built in this release. The pipeline is parameterised so the 19th and
# 21st centuries can be added later (CShapes 2.0 covers 1886-2019, HYDE 3.2
# population grids cover 1800-2017).
YEAR_START = 1900
YEAR_END = 2000
YEARS = list(range(YEAR_START, YEAR_END + 1))

# Every yearly record describes the world on 1 July (mid-year), the reference
# date used by UN and Maddison mid-year population estimates.
SNAPSHOT_MONTH_DAY = "07-01"

# HYDE 3.2 grid: 5 arc-minutes, global, cell (0,0) at 180W / 90N.
HYDE_RES = 1.0 / 12.0
HYDE_W, HYDE_H = 4320, 2160

# Population grid stored in the database (aggregated from the HYDE grid).
GRID_RES = 0.25
GRID_W, GRID_H = 1440, 720

for d in (RAW, WORK, DB_DIR, EXPORTS, MAPS):
    d.mkdir(parents=True, exist_ok=True)


def snapshot_date(year: int) -> str:
    return f"{year:04d}-{SNAPSHOT_MONTH_DAY}"
