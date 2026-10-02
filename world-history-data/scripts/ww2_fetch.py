"""Download the sources for the 1939-1945 county database into raw/.

  raw/geoboundaries/   geoBoundaries gbOpen ADM1/ADM2/ADM3 (simplified) for every country
  raw/ww2/             US historical counties (Newberry AHCB via USAboundariesData),
                       Konrad Lawson's East Asia 1930-1942 layers, NIKH Korea places,
                       Chinese county names (modood/Administrative-divisions-of-China)
All hosts are GitHub (git, raw and LFS media).
"""
import concurrent.futures as cf
import re
import shutil
import subprocess
import time
import urllib.request
import zipfile

from common import RAW

GB = RAW / "geoboundaries"
WW2 = RAW / "ww2"
LAWSON_FILES = [
    "LICENSE.md",
    "tools/cache/taiwan_1930.geojson", "tools/cache/taiwan_1930_shu.geojson",
    "tools/cache/korea_13_provinces_fine.json", "tools/cache/adm2_PHL_1939.json",
    "tools/cache/manchukuo-provinces-v2.geojson", "tools/cache/mengjiang-1940.geojson",
    "tools/cache/princely-states-india-1931-v1.2026.8.11.geojson", "tools/cache/kwantung-1935.geojson",
    "tools/cache/ccp-resistance-areas-1941-1942-p199-v2.geojson",
    "deploy/gis/occupied-zone-1942.geojson", "occupation-maps/mengjiang-control-1942.geojson",
    "data/burma/burma-1931-admin-units.geojson", "data/dei/dei-1941-admin.geojson",
    "data/indochina/french-indochina-admin.geojson", "data/nikh-korea/mk_mod_info.zip",
    "data/population/japan-1940.csv", "data/population/korea-1942.csv", "data/population/taiwan-1941.csv",
    "data/population/manchukuo-1943.csv",
]


def get(url, dest, tries=5):
    for a in range(tries):
        try:
            data = urllib.request.urlopen(url, timeout=300).read()
            dest.write_bytes(data)
            return
        except Exception:
            time.sleep(2 ** a)
    raise RuntimeError(url)


def sparse(url, dest, paths=None):
    if not dest.exists():
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", url, str(dest)],
                       check=True)
    if paths:
        subprocess.run(["git", "-C", str(dest), "checkout", "-q", "HEAD", "--", *paths], check=True)


def geoboundaries():
    GB.mkdir(parents=True, exist_ok=True)
    src = RAW / "geoboundaries-src"
    sparse("https://github.com/wmgeolab/geoBoundaries", src)
    names = subprocess.run(["git", "-C", str(src), "ls-tree", "-r", "--name-only", "HEAD", "releaseData/gbOpen"],
                           capture_output=True, text=True, check=True).stdout.split()
    files = [n for n in names if re.search(r"/ADM[123]/.*_simplified\.geojson$", n)]

    def one(f):
        dest = GB / f.split("gbOpen/")[1].replace("/", "_")
        if not (dest.exists() and dest.stat().st_size > 200):
            get("https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/" + f, dest)

    with cf.ThreadPoolExecutor(12) as ex:
        list(ex.map(one, files))
    print("geoBoundaries files:", len(files))


def main():
    WW2.mkdir(parents=True, exist_ok=True)
    geoboundaries()
    base = "https://raw.githubusercontent.com/ropensci/USAboundariesData/master/data-raw/historical/"
    for f in ("histcounties.geojson", "histstates.geojson"):
        if not (WW2 / f"us_{f}").exists():
            get(base + f, WW2 / f"us_{f}")
    src = RAW / "lawson-src"
    sparse("https://github.com/kmlawson/japanese-empire-student-map", src, LAWSON_FILES)
    (WW2 / "lawson").mkdir(exist_ok=True)
    for f in LAWSON_FILES:
        shutil.copy(src / f, WW2 / "lawson" / f.split("/")[-1])
    with zipfile.ZipFile(WW2 / "lawson" / "mk_mod_info.zip") as z:
        for n in z.namelist():
            if n.startswith("place_modern_open."):
                (WW2 / "lawson" / n).write_bytes(z.read(n))
    cn = WW2 / "cn-names"
    cn.mkdir(exist_ok=True)
    base = "https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/"
    for f in ("dist/provinces.csv", "dist/cities.csv", "dist/areas.csv", "LICENSE"):
        if not (cn / f.split("/")[-1]).exists():
            get(base + f, cn / f.split("/")[-1])
    print("done")


if __name__ == "__main__":
    main()
