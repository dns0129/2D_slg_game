"""Verify the fine layer's sources, indexes, parent ownership and geometry records."""
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FINE = DATA / "counties"


def load(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def main():
    admin = load(DATA / "admin.bin")
    manifest = json.loads((FINE / "manifest.json").read_text())
    assert set(manifest["scenarios"]) == {"1939-09-01", "2026"}
    expected_files = {"manifest.json", "index-1939-09-01.bin", "index-2026.bin"}
    for snap in manifest["scenarios"]:
        index = load(FINE / f"index-{snap}.bin")
        sd = json.loads((DATA / f"snap-{snap}.json").read_text())
        assert index["snapshot"] == snap and index["min_zoom"] == 4.5
        assert index["units"] == len(index["search"]) > 1000
        ids, unit_ids, searchable = set(), set(), {}
        countries = collections.defaultdict(set)
        for region in index["regions"]:
            path = FINE / region["file"]
            expected_files.add(region["file"])
            assert hashlib.sha256(path.read_bytes()).hexdigest() == region["sha256"]
            data = load(path)
            assert data["type"] == "FeatureCollection" and len(data["features"]) == region["count"] > 0
            for f in data["features"]:
                p = f["properties"]
                assert f["id"] not in ids
                ids.add(f["id"]); unit_ids.add(p["g"])
                searchable[f["id"]] = (p["n"], p["p"], *p["xy"], p["ds"], p["t"])
                assert p["p"] == region["p"] == admin["feature_admin"][sd["feature"][p["k"]]]
                assert p["t"] in {1, 2} and isinstance(p["n"], str) and p["n"]
                assert p["ds"] in index["sources"] and p["area"] >= 0
                assert "pop" not in p and "population" not in p
                source = index["sources"][p["ds"]]
                assert all(source[key] for key in ["name", "year", "url", "license"])
                if snap == "1939-09-01":
                    assert p["ds"] == "historical" and not (p.get("basis") or "").startswith("reconstructed")
                    if p.get("start"): assert p["start"] <= snap
                    if p.get("end"): assert p["end"] >= snap
                else:
                    assert p["ds"] != "historical"
                countries[sd["countries"][sd["country"][p["k"]]][1]].add(p["g"])
                geo = f["geometry"]
                assert geo["type"] == "MultiPolygon" and geo["coordinates"]
                for poly in geo["coordinates"]:
                    assert poly
                    for ring in poly:
                        assert len(ring) >= 4 and ring[0] == ring[-1]
                        for x, y in ring:
                            assert math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90
                            b = region["bbox"]
                            assert b[0] <= x <= b[2] and b[1] <= y <= b[3]
        assert len(ids) == index["pieces"] == manifest["scenarios"][snap]["pieces"]
        assert len(unit_ids) == index["units"] == manifest["scenarios"][snap]["units"]
        assert {c["name"]: c["count"] for c in index["countries"]} == {c: len(v) for c, v in countries.items()}
        for row in index["search"]:
            assert searchable[row[0]] == tuple(row[1:])
        print(f"{snap}: {len(unit_ids):,} fine divisions, {len(ids):,} clipped parcels, {len(countries)} controllers")
    assert {str(p.relative_to(FINE)) for p in FINE.rglob("*") if p.is_file()} == expected_files
    assert not list(ROOT.rglob("*.sqlite"))
    print("Fine divisions have dated sources and valid province/controller references; no database or invented county population.")


if __name__ == "__main__":
    main()
