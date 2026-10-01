"""Consistency checks on the finished database and exports; writes checks.json."""
import json
import sqlite3
import zlib

import numpy as np

from common import ROOT, EXPORTS, MAPS, YEARS
from build_database import DB


def main():
    con = sqlite3.connect(DB)
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    checks = {}

    def check(name, ok, detail):
        checks[name] = {"ok": bool(ok), "detail": detail}

    yrs = [r[0] for r in q("SELECT year FROM years ORDER BY year")]
    check("every_year_present", yrs == YEARS, f"{len(yrs)} years {yrs[0]}-{yrs[-1]}")

    diffs = q("""SELECT y.year, y.world_population, SUM(u.population), y.world_gdp_2011usd, SUM(u.gdp_2011usd)
                 FROM years y JOIN unit_year u USING(year) GROUP BY y.year""")
    worst_p = max(abs(a - b) / a for _, a, b, _, _ in diffs)
    worst_g = max(abs(a - b) / a for _, _, _, a, b in diffs)
    check("units_sum_to_world_population", worst_p < 1e-6, f"max relative gap {worst_p:.2e}")
    check("units_sum_to_world_gdp", worst_g < 1e-6, f"max relative gap {worst_g:.2e}")

    gap = q("""SELECT MAX(ABS(s.p - u.population) / MAX(u.population, 1)) FROM unit_year u JOIN
               (SELECT year, unit_id, SUM(population) p FROM admin1_year GROUP BY year, unit_id) s USING(year, unit_id)
               WHERE u.population > 100000""")[0][0]
    check("admin1_pieces_sum_to_unit", gap < 0.01, f"max relative gap {gap:.2e} (units > 100k people)")

    no_pieces = q("""SELECT COUNT(*), COALESCE(SUM(u.population), 0) FROM unit_year u
                     LEFT JOIN (SELECT DISTINCT year, unit_id FROM admin1_year) a USING(year, unit_id)
                     WHERE a.unit_id IS NULL""")[0]
    check("units_without_admin1_pieces", True, f"{no_pieces[0]} unit-years, {no_pieces[1]:.0f} people")

    for basis in ("de_jure", "de_facto"):
        s = q("SELECT year, SUM(pop_share_world), SUM(gdp_share_world) FROM sovereign_year WHERE basis=? GROUP BY year", basis)
        worst = max(max(abs(a - 1), abs(b - 1)) for _, a, b in s)
        check(f"{basis}_shares_sum_to_one", worst < 1e-6, f"max deviation {worst:.2e}")

    neg = q("SELECT COUNT(*) FROM unit_year WHERE population < 0 OR gdp_2011usd < 0")[0][0]
    check("no_negative_values", neg == 0, f"{neg} negative rows")
    unnamed = q("SELECT COUNT(*) FROM unit_year WHERE name_zh IS NULL OR name_en IS NULL")[0][0]
    check("all_units_named_en_zh", unnamed == 0, f"{unnamed} unit-years without a name")
    nogeom = q("SELECT COUNT(*) FROM units WHERE geometry IS NULL OR length(geometry) < 30")[0][0]
    check("all_units_have_geometry", nogeom == 0, f"{nogeom} units without geometry")

    gd = []
    for y, data, w, h, tot in q("""SELECT g.year, g.data, g.width, g.height, y.world_population FROM grids g
                                   JOIN years y USING(year) WHERE variable='population'"""):
        a = np.frombuffer(zlib.decompress(data), dtype="<u4").reshape(h, w)
        gd.append(abs(a.sum() - tot) / tot)
    check("population_grid_matches_world", max(gd) < 1e-4, f"max relative gap {max(gd):.2e}")

    ev = q("SELECT COUNT(*), SUM(scope='whole'), SUM(scope='partial') FROM control_events")[0]
    check("control_events", True, f"{ev[0]} events ({ev[1]} whole-unit, {ev[2]} partial)")

    keys = None
    same = True
    for y in YEARS:
        d = json.loads((EXPORTS / "years" / f"{y}.json").read_text())
        k = (tuple(sorted(d)), tuple(sorted(d["units"][0])), tuple(d["admin1"]["columns"]))
        same &= keys is None or k == keys
        keys = k
    check("export_years_same_schema", same, f"{len(YEARS)} year files")
    maps = [y for y in YEARS if (MAPS / f"{y}.png").exists()]
    check("one_map_per_year", len(maps) == len(YEARS), f"{len(maps)} map images")

    summary = {}
    for y in (1900, 1913, 1938, 1942, 1950, 1975, 2000):
        r = q("SELECT world_population, world_gdp_2011usd, n_units, n_independent, n_dependent FROM years WHERE year=?", y)[0]
        top = q("""SELECT sovereign_name_zh, ROUND(pop_share_world*100, 1), ROUND(gdp_share_world*100, 1)
                   FROM sovereign_year WHERE year=? AND basis='de_facto' ORDER BY population DESC LIMIT 5""", y)
        summary[y] = {"world_population": round(r[0]), "world_gdp_2011usd": round(r[1]), "units": r[2],
                      "independent": r[3], "dependent": r[4],
                      "top_de_facto_by_population": [{"name": t[0], "pop_share_pct": t[1], "gdp_share_pct": t[2]} for t in top]}
    out = {"database": DB.name, "checks": checks, "summary": summary}
    (ROOT / "checks.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    bad = [k for k, v in checks.items() if not v["ok"]]
    for k, v in checks.items():
        print(("PASS " if v["ok"] else "FAIL ") + k + ": " + v["detail"])
    if bad:
        raise SystemExit(f"{len(bad)} checks failed")


if __name__ == "__main__":
    main()
