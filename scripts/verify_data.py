"""Check map coverage, geometry indexes, controller data and the copy boundary."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EXPECTED = {"1939-09-01": (1350, 1214, 69), "2026": (3523, 3515, 208)}


def geometry_count(path):
    data = gzip.decompress(path.read_bytes())
    offset, count = 0, 0

    def number():
        nonlocal offset
        result, shift = 0, 0
        while True:
            assert offset < len(data), f"Truncated geometry: {path}"
            byte = data[offset]
            offset += 1
            result += (byte & 127) << shift
            if not byte & 128:
                return result
            shift += 7
            assert shift < 56, "Invalid geometry varint"

    while offset < len(data):
        for _ in range(number()):
            for _ in range(number()):
                points = number()
                assert points >= 3, "Polygon ring needs at least three points"
                for _ in range(points * 2):
                    number()
        count += 1
    return count


def main():
    index = json.loads((DATA / "index.json").read_text())
    assert [s["snapshot"] for s in index["snapshots"]] == list(EXPECTED)
    assert {p.name for p in DATA.glob("snap-*.json")} == {f"snap-{s}.json" for s in EXPECTED}
    assert {p.name for p in DATA.glob("geo-*.bin")} == {f"geo-{s}.bin" for s in EXPECTED}
    assert not list(ROOT.rglob("*.sqlite")) and not (ROOT / "db").exists()
    assert not (ROOT / "game.js").exists() and not (ROOT / "previews").exists()
    admin = json.loads(gzip.decompress((DATA / "admin.bin").read_bytes()))
    manifest = json.loads((DATA / "copy-manifest.json").read_text())
    assert manifest["scenarios"] == list(EXPECTED)
    used_admin, used_features = set(), set()
    for key in ("admin_id", "tier", "partial", "merged", "area", "label"):
        assert len(admin[key]) == admin["n"]
    for col in admin["cols"].values():
        assert len(col["idx"]) == admin["n"]
        assert all(0 <= i < len(col["lut"]) for i in col["idx"])
    for scenario, (pieces, provinces, countries) in EXPECTED.items():
        sd = json.loads((DATA / f"snap-{scenario}.json").read_text())
        assert sd["snapshot"] == scenario
        assert (len(sd["feature"]), len(sd["admin_active"]), len(sd["countries"])) == (pieces, provinces, countries)
        for field in ("unit", "country", "nation", "bloc", "conf", "ctrl_gw", "split", "area", "pop"):
            assert len(sd[field]) == pieces
        for field, values in sd["rows"].items():
            assert len(values) == pieces
            assert all(0 <= i < len(sd["luts"][field]) for i in values)
        active, outlines = set(sd["admin_active"]), set(sd["geo_feature"])
        for k, f in enumerate(sd["feature"]):
            assert 0 <= f < len(admin["feature_admin"])
            assert admin["feature_admin"][f] in active
            assert 0 <= sd["country"][k] < countries
            assert 0 <= sd["nation"][k] < len(sd["nations"])
            assert sd["bloc"][k] in range(4)
            assert sd["unit"][k] < 0 or sd["unit"][k] in sd["units_active"]
            # The source rounds km² to one decimal; tiny islands can round to 0.
            assert sd["area"][k] >= 0 and sd["pop"][k] >= 0
        assert outlines.issubset(sd["feature"])
        geom = DATA / f"geo-{scenario}.bin"
        assert geometry_count(geom) == provinces + len(outlines) + len(sd["units_active"]) + countries
        assert hashlib.sha256(geom.read_bytes()).hexdigest() == manifest["source_files"][f"ww2/maps/data/{geom.name}"]
        summary = next(s for s in index["snapshots"] if s["snapshot"] == scenario)
        assert sum(sd["pop"]) == summary["population"] == sum(sd["bloc_pop"].values())
        used_admin.update(active)
        used_features.update(sd["feature"])
        print(f"{scenario}: {pieces} pieces, {provinces} provinces, {countries} controllers; geometry unchanged")
    assert used_admin == set(range(admin["n"]))
    assert used_features == set(range(len(admin["feature_admin"])))
    for name in ("hydro.bin", "hydro-detail.bin"):
        hydro = json.loads(gzip.decompress((DATA / name).read_bytes()))
        assert hydro["type"] == "FeatureCollection" and hydro["features"]
    print("Only the two requested maps are present; no database or unused province indexes.")


if __name__ == "__main__":
    main()
