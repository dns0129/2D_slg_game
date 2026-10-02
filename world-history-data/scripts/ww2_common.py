"""Shared settings for the 1939-1945 county-level database."""
from common import RAW, WORK, ROOT, DB_DIR

WW2_RAW = RAW / "ww2"
GB = RAW / "geoboundaries"
WW2_WORK = WORK / "ww2"
WW2_OUT = ROOT / "ww2"
WW2_DB = DB_DIR / "ww2_counties_1939_1945.sqlite"
WW2_WORK.mkdir(parents=True, exist_ok=True)
WW2_OUT.mkdir(parents=True, exist_ok=True)

# Six snapshots spanning the war (exact dates, not mid-year).
SNAPSHOTS = [
    ("1939-09-01", "德国入侵波兰，第二次世界大战在欧洲爆发", "Germany invades Poland"),
    ("1940-07-01", "法国停战后，德国控制西欧", "After the fall of France"),
    ("1941-12-07", "珍珠港事件当日，德军止步莫斯科城下", "Pearl Harbor; Germans before Moscow"),
    ("1942-11-01", "轴心国扩张的最大范围（阿拉曼、斯大林格勒之前）", "Greatest Axis extent"),
    ("1944-06-06", "诺曼底登陆日", "D-Day"),
    ("1945-09-02", "日本签署投降书，战争结束", "Japan signs the surrender"),
]
SNAP_DATES = [s[0] for s in SNAPSHOTS]

TYPICAL_COUNTY_KM2 = 1500.0  # target size used to pick each country's county level
