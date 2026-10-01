"""Per-year population/GDP distribution on the historical political map.

For every year Y (snapshot 1 July):
  1. population pattern on the 5' grid
       HYDE 3.5 (interpolated between its time steps) when downloaded, else
       GHS-POP R2023A: epochs interpolated 1975-2000, 1975 pattern before 1975
  2. calibrate the grid so each modern country sums to its annual national
     population (build_country_series.py) and, where available, each
     sub-national unit to its annual population (build_subnational.py)
  3. GDP grid = population x GDP per capita of the modern country of the cell
  4. sum population, GDP and area inside each CShapes 2.0 unit valid on Y-07-01,
     inside each modern admin-1 piece of those units, and per sovereign
  5. apply curated de facto control events (curated/control_events.csv)

Outputs go to work/ and are assembled into the database by build_database.py.
"""
import json
from collections import defaultdict

import numpy as np
import pandas as pd
from pyproj import Geod
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage
from shapely import STRtree
from shapely.geometry import mapping, shape
from shapely.prepared import prep

import topo
from common import RAW, WORK, ROOT, YEARS, HYDE_RES, HYDE_W, HYDE_H, GRID_RES, snapshot_date

T5 = from_origin(-180, 90, HYDE_RES, HYDE_RES)
GHS_EPOCHS = [1975, 1980, 1985, 1990, 1995, 2000]
GEOD = Geod(ellps="WGS84")
AGG = int(round(GRID_RES / HYDE_RES))  # 5' cells per output grid cell

# Stage-2 calibration: independent units whose borders differ from every
# present-day country are rescaled to the Correlates of War National Material
# Capabilities population (contemporary borders) before this year.
NMC_UNTIL = 1949
NMC_RATIO_BOUNDS = (0.6, 1.67)
MODERN_MATCH = 0.95
# COW state-years whose population counts annexations or occupations that
# CShapes does not draw inside the unit polygon.
NMC_EXCLUDE = {255: range(1939, 1946), 365: range(1939, 1946), 310: range(1939, 1945),
               360: range(1940, 1945), 355: range(1941, 1945), 325: range(1939, 1944)}

SPECIAL_CONTROLLERS = {-1: "Allied powers", -2: "non-state / de facto authority", -3: "United Nations"}


def geodesic_area_km2(g):
    return abs(GEOD.geometry_area_perimeter(g)[0]) / 1e6


# ---------------------------------------------------------------- inputs

def load_series():
    cs = pd.read_csv(WORK / "country_series.csv")
    codes = sorted(cs.code.unique())
    cid = {c: i for i, c in enumerate(codes)}
    pop = np.full((len(codes), len(YEARS)), np.nan)
    gpc = np.full((len(codes), len(YEARS)), np.nan)
    yi = {y: i for i, y in enumerate(YEARS)}
    for r in cs.itertuples():
        pop[cid[r.code], yi[r.year]] = r.population
        gpc[cid[r.code], yi[r.year]] = r.gdppc_2011usd
    return codes, cid, pop, gpc, cs


def base_pattern_source():
    hyde = sorted(int(p.stem.split("_")[-1]) for p in WORK.glob("hyde_5m_*.npy"))
    if hyde:
        return "hyde", hyde
    return "ghs", GHS_EPOCHS


_cache = {}


def grid(name):
    if name not in _cache:
        _cache[name] = np.load(WORK / f"{name}.npy")
    return _cache[name]


def base_pattern(year, kind, steps):
    prefix = "hyde_5m_" if kind == "hyde" else "ghs_5m_"
    if year <= steps[0]:
        return grid(prefix + str(steps[0])).astype(np.float64), f"{kind}_{steps[0]}_pattern"
    if year >= steps[-1]:
        return grid(prefix + str(steps[-1])).astype(np.float64), f"{kind}_{steps[-1]}_pattern"
    for a, b in zip(steps, steps[1:]):
        if a <= year <= b:
            if year == a:
                return grid(prefix + str(a)).astype(np.float64), f"{kind}_{a}"
            w = (year - a) / (b - a)
            g = grid(prefix + str(a)) * (1 - w) + grid(prefix + str(b)) * w
            return g.astype(np.float64), f"{kind}_{a}_{b}_interpolated"
    raise ValueError(year)


def load_cow():
    import pyreadr
    d = RAW / "peacesciencer"
    nmc = next(iter(pyreadr.read_r(d / "cow_nmc.rda").values()))
    sdp = next(iter(pyreadr.read_r(d / "cow_sdp_gdp.rda").values()))
    gw = next(iter(pyreadr.read_r(d / "cow_gw_years.rda").values()))
    gw = gw.dropna(subset=["gwcode", "ccode"])
    key = {(int(r.year), int(r.gwcode)): int(r.ccode) for r in gw.itertuples()}
    tpop = {(int(r.ccode), int(r.year)): float(r.tpop) * 1000 for r in nmc.itertuples() if r.tpop == r.tpop and r.tpop > 0}
    fgdp = {(int(r.ccode), int(r.year)): float(np.exp(r.wbgdp2011est)) for r in sdp.itertuples()
            if r.wbgdp2011est == r.wbgdp2011est and r.wbgdp2011est > 0}
    return key, tpop, fgdp


# ---------------------------------------------------------------- CShapes

def load_cshapes():
    arcs, geoms = topo.load(RAW / "cshapes_2_gw.topojson")
    recs = []
    for g in geoms:
        p = dict(g["properties"])
        p["geom"] = topo.to_shape(arcs, g)
        recs.append(p)
    return recs


def active(recs, date):
    return [r for r in recs if r["start"] <= date <= r["end"]]


def owner_name(recs, owner, date):
    if owner in ("0", 0):
        return "League of Nations"
    o = int(owner)
    cands = [r for r in recs if r["gwcode"] == o and r["status"] == "independent"]
    if not cands:
        return None
    on = [r for r in cands if r["start"] <= date <= r["end"]]
    r = on[0] if on else min(cands, key=lambda r: abs(int(r["start"][:4]) - int(date[:4])))
    return r["country_name"]


# ---------------------------------------------------------------- admin-1 pieces

def build_pieces(recs, needed_fids):
    """Clip present-day admin-1 polygons to each historical unit."""
    a1 = json.load(open(RAW / "naturalearth" / "ne_10m_admin_1_states_provinces.geojson"))
    a1g = [shape(f["geometry"]).simplify(0.005, preserve_topology=True).buffer(0) for f in a1["features"]]
    a1area = np.array([g.area for g in a1g])
    tree = STRtree(a1g)
    pieces = {}           # piece_id -> dict(a1, geom, fids)
    by_fid = defaultdict(dict)  # fid -> {a1: piece_id}
    for r in recs:
        if r["fid"] not in needed_fids:
            continue
        ug = r["geom"]
        pu = prep(ug)
        for i in tree.query(ug, predicate="intersects"):
            g = a1g[i]
            if pu.contains(g):
                frac, clipped = 1.0, None
            else:
                inter = ug.intersection(g)
                frac = inter.area / a1area[i] if a1area[i] > 0 else 0
                clipped = inter
            if frac < 0.03:
                continue
            if frac >= 0.97:
                pid = f"a1-{i}"
                geom = g
            else:
                clipped = clipped.buffer(0)
                polys = [p for p in getattr(clipped, "geoms", [clipped]) if p.geom_type == "Polygon"]
                if not polys:
                    continue
                from shapely.geometry import MultiPolygon
                geom = MultiPolygon(polys) if len(polys) > 1 else polys[0]
                key = hash(tuple(round(v, 3) for v in geom.bounds) + (round(geom.area, 4),))
                pid = f"a1-{i}-{abs(key) % 10**8:08d}"
            if pid not in pieces:
                pieces[pid] = dict(a1=i, geom=geom, frac=round(frac, 4), fids=set())
            pieces[pid]["fids"].add(r["fid"])
            by_fid[r["fid"]][i] = pid
    return pieces, by_fid, a1g


# ---------------------------------------------------------------- main

def main():
    codes, cid, pop_s, gpc_s, cs = load_series()
    ne_codes = pd.read_csv(WORK / "ne_admin0_codes.csv")
    ne_to_cid = np.array([cid.get(c, -1) for c in ne_codes.code] + [-1], dtype=np.int32)
    cgrid = grid("ne_country_5m").astype(np.int32)
    code_grid = ne_to_cid[np.where(cgrid >= 0, cgrid, len(ne_to_cid) - 1)]
    a1grid = grid("ne_admin1_5m")
    a1tab = pd.read_csv(WORK / "ne_admin1.csv")
    area_row = np.load(WORK / "cell_area_km2.npy")
    targets = pd.read_csv(WORK / "admin1_targets.csv")
    iso2_to_a1 = {v: i for i, v in zip(a1tab.a1_index, a1tab.iso_3166_2) if isinstance(v, str)}
    kind, steps = base_pattern_source()
    print("population pattern source:", kind, steps)

    recs = load_cshapes()
    by_fid_rec = {r["fid"]: r for r in recs}
    dates = {y: snapshot_date(y) for y in YEARS}
    needed = {r["fid"] for y in YEARS for r in active(recs, dates[y])}
    print("CShapes records used:", len(needed))

    events = pd.read_csv(ROOT / "curated" / "control_events.csv")
    cow_key, nmc_pop, fariss_gdp = load_cow()

    print("clipping admin-1 pieces ...")
    pieces, piece_by_fid, a1g = build_pieces(recs, needed)
    print("pieces:", len(pieces))

    # ---- static unit table
    units = []
    for fid in sorted(needed):
        r = by_fid_rec[fid]
        c = r["geom"].representative_point()
        units.append(dict(unit_id=fid, gwcode=r["gwcode"], name=r["country_name"], status=r["status"],
                          owner_gwcode=r["owner"], start_date=r["start"], end_date=r["end"],
                          capital=r["capname"], cap_lon=r["caplong"], cap_lat=r["caplat"],
                          area_km2=round(geodesic_area_km2(r["geom"]), 1),
                          label_lon=round(c.x, 4), label_lat=round(c.y, 4), b_def=r.get("b_def")))
    pd.DataFrame(units).to_csv(WORK / "units.csv", index=False)
    unit_area = {u["unit_id"]: u["area_km2"] for u in units}

    piece_rows = []
    for pid, p in pieces.items():
        a = a1tab.iloc[p["a1"]]
        rp = p["geom"].representative_point()
        piece_rows.append(dict(piece_id=pid, a1_index=int(p["a1"]), ne_id=a.ne_id, adm1_code=a.adm1_code,
                               name=a["name"], name_en=a.name_en, name_zh=a.name_zh, type_en=a.type_en,
                               modern_country=a.admin, iso_3166_2=a.iso_3166_2, share_of_modern_unit=p["frac"],
                               area_km2=round(geodesic_area_km2(p["geom"]), 1),
                               label_lon=round(rp.x, 4), label_lat=round(rp.y, 4),
                               unit_ids=";".join(str(f) for f in sorted(p["fids"]))))
    pd.DataFrame(piece_rows).to_csv(WORK / "pieces.csv", index=False)
    with open(WORK / "pieces.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"piece_id": pid},
             "geometry": mapping(p["geom"])} for pid, p in pieces.items()]}, f)

    # nearest piece for raster cells whose (unit, admin1) pair has no vector piece
    a1_centroid = {i: g.representative_point() for i, g in enumerate(a1g)}

    def piece_for(fid, a):
        pid = piece_by_fid[fid].get(a)
        if pid is not None:
            return pid
        cand = piece_by_fid[fid]
        if not cand or a < 0:
            return None
        pt = a1_centroid.get(a)
        best = min(cand.items(), key=lambda kv: pieces[kv[1]]["geom"].distance(pt))
        piece_by_fid[fid][a] = best[1]
        return best[1]

    unit_grid_cache = {}
    last_ratio = {}  # gwcode -> (year, NMC/stage-1 ratio) of the last accepted calibration
    populated_any = (code_grid >= 0) & (code_grid != cid.get("ata", -9))
    for s_ in steps:
        populated_any |= grid(("hyde_5m_" if kind == "hyde" else "ghs_5m_") + str(s_)) > 0
    unit_rows, piece_year_rows, sov_rows, year_rows = [], [], [], []
    (WORK / "grids").mkdir(exist_ok=True)
    area_grid_row = area_row[:, None]

    for yi, y in enumerate(YEARS):
        date = dates[y]
        base, basis = base_pattern(y, kind, steps)

        # ---- national calibration
        flat_code = code_grid.ravel()
        valid = flat_code >= 0
        sums = np.bincount(flat_code[valid], weights=base.ravel()[valid], minlength=len(codes))
        ncell = np.bincount(flat_code[valid], minlength=len(codes))
        target = pop_s[:, yi]
        factor = np.ones(len(codes))
        ok = (~np.isnan(target)) & (sums > 0)
        factor[ok] = target[ok] / sums[ok]
        popg = base * np.where(code_grid >= 0, factor[np.maximum(code_grid, 0)], 1.0)
        empty = (~np.isnan(target)) & (sums <= 0) & (ncell > 0) & (target > 0)
        for c in np.flatnonzero(empty):
            m = code_grid == c
            popg[m] = target[c] / m.sum()

        # ---- sub-national calibration
        ty = targets[targets.year == y]
        for code, grp in ty.groupby("code"):
            c = cid[code]
            cm = code_grid == c
            a_in = a1grid[cm]
            p_in = popg[cm]
            cur = pd.Series(p_in).groupby(a_in).sum()
            tmap = {iso2_to_a1[k]: v for k, v in zip(grp.iso_3166_2, grp.population) if k in iso2_to_a1}
            covered = [a for a in cur.index if a in tmap]
            uncovered_pop = cur.drop(covered).sum()
            total = np.nansum(p_in)
            covered_target = total - uncovered_pop
            tsum = sum(tmap[a] for a in covered)
            f = np.ones(int(a1grid.max()) + 2)
            for a in covered:
                if cur[a] > 0:
                    f[a] = covered_target * tmap[a] / tsum / cur[a]
            popg[cm] = p_in * f[a_in]

        # ---- GDP grid
        gpc = gpc_s[:, yi]
        gdpg = popg * np.where(code_grid >= 0, np.nan_to_num(gpc[np.maximum(code_grid, 0)]), 0.0)

        # ---- historical units
        act = active(recs, date)
        key = tuple(sorted(r["fid"] for r in act))
        if key not in unit_grid_cache:
            items = sorted(((r["geom"], r["fid"]) for r in act), key=lambda t: -t[0].area)
            ug = rasterize(((mapping(g), f) for g, f in items), out_shape=(HYDE_H, HYDE_W),
                           transform=T5, fill=-1, dtype="int32")
            present = set(np.unique(ug).tolist())
            for g, f in items:
                if f not in present:
                    pt = g.representative_point()
                    ug[min(int((90 - pt.y) / HYDE_RES), HYDE_H - 1), min(int((pt.x + 180) / HYDE_RES), HYDE_W - 1)] = f
            populated = populated_any
            if ((ug < 0) & populated).any():
                _, (ri, ci) = ndimage.distance_transform_edt(ug < 0, return_indices=True)
                miss = (ug < 0) & populated
                ug[miss] = ug[ri[miss], ci[miss]]
            unit_grid_cache = {key: ug}
        ug = unit_grid_cache[key]

        fl = ug.ravel()
        m = fl >= 0
        nf = int(fl.max()) + 1

        # ---- stage 2: contemporary-border population for independent units
        calib = {}
        if y <= NMC_UNTIL:
            upop0 = np.bincount(fl[m], weights=popg.ravel()[m], minlength=nf)
            pair = fl[m].astype(np.int64) * 1000 + code_grid.ravel()[m].astype(np.int64) + 1
            up, upi = np.unique(pair, return_inverse=True)
            pw = np.bincount(upi, weights=popg.ravel()[m])
            code_tot = np.bincount(flat_code[valid], weights=popg.ravel()[valid], minlength=len(codes))
            comp = defaultdict(list)
            for kk, v in zip(up, pw):
                comp[int(kk // 1000)].append((int(kk % 1000) - 1, v))
            scale = np.ones(nf)
            for r in act:
                fid = r["fid"]
                if r["status"] != "independent" or upop0[fid] <= 0:
                    continue
                cc = cow_key.get((y, r["gwcode"]))
                target_n = nmc_pop.get((cc, y)) if cc is not None else None
                if target_n is None:
                    continue
                c_main, v_main = max(comp[fid], key=lambda t: t[1])
                frac = v_main / upop0[fid]
                capture = v_main / code_tot[c_main] if c_main >= 0 and code_tot[c_main] > 0 else 0
                ratio = target_n / upop0[fid]
                if frac >= MODERN_MATCH and capture >= MODERN_MATCH:
                    calib[fid] = ("modern_series", target_n)
                elif y in NMC_EXCLUDE.get(r["gwcode"], ()):
                    # COW counts annexed/occupied areas outside this polygon: carry
                    # the last accepted correction ratio instead
                    if r["gwcode"] in last_ratio:
                        scale[fid] = last_ratio[r["gwcode"]][1]
                        calib[fid] = (f"nmc_ratio_carried_from_{last_ratio[r['gwcode']][0]}", target_n)
                    else:
                        calib[fid] = ("modern_series (nmc_wartime_territory_mismatch)", target_n)
                elif not NMC_RATIO_BOUNDS[0] <= ratio <= NMC_RATIO_BOUNDS[1]:
                    calib[fid] = ("modern_series (nmc_outlier)", target_n)
                else:
                    scale[fid] = ratio
                    calib[fid] = ("cow_nmc_tpop", target_n)
                    last_ratio[r["gwcode"]] = (y, ratio)
            if (scale != 1).any():
                sg = np.where(ug >= 0, scale[np.maximum(ug, 0)], 1.0)
                popg = popg * sg
                gdpg = gdpg * sg

        upop = np.bincount(fl[m], weights=popg.ravel()[m], minlength=nf)
        ugdp = np.bincount(fl[m], weights=gdpg.ravel()[m], minlength=nf)
        world_pop = float(np.nansum(popg))
        world_gdp = float(np.nansum(gdpg))
        unassigned = world_pop - float(upop.sum())

        # admin-1 pieces: combine unit and admin-1 ids
        a1f = a1grid.ravel()
        k = fl[m].astype(np.int64) * 100000 + (a1f[m].astype(np.int64) + 1)
        uk, inv = np.unique(k, return_inverse=True)
        kp = np.bincount(inv, weights=popg.ravel()[m])
        kg = np.bincount(inv, weights=gdpg.ravel()[m])
        ppop, pgdp = defaultdict(float), defaultdict(float)
        for kk, pv, gv in zip(uk, kp, kg):
            fid, a = int(kk // 100000), int(kk % 100000) - 1
            if pv == 0 and gv == 0:
                continue
            pid = piece_for(fid, a)
            if pid is None:
                continue
            ppop[(fid, pid)] += pv
            pgdp[(fid, pid)] += gv
        for fid in key:  # pieces without population still belong to the year
            for pid in set(piece_by_fid[fid].values()):
                ppop.setdefault((fid, pid), 0.0)
                pgdp.setdefault((fid, pid), 0.0)

        # ---- control
        ev_y = events[(events.start_date <= date) & (events.end_date >= date)]
        whole = {(e.unit_name, e.unit_gwcode): e for e in ev_y.itertuples() if e.scope == "whole"}
        partial = defaultdict(list)
        for e in ev_y.itertuples():
            if e.scope == "partial":
                partial[(e.unit_name, e.unit_gwcode)].append(e.event_id)

        rows_y = []
        for r in act:
            fid = r["fid"]
            owner_nm = r["country_name"] if r["status"] == "independent" else owner_name(recs, r["owner"], date)
            owner_gw = str(r["gwcode"]) if r["status"] == "independent" else str(r["owner"])
            e = whole.get((r["country_name"], r["gwcode"]))
            if e is not None:
                ctrl_nm, ctrl_gw, ctype, ceid = e.controller_name, str(e.controller_gwcode), e.control_type, e.event_id
            else:
                ctrl_nm, ctrl_gw, ctype, ceid = owner_nm, owner_gw, r["status"], None
            rows_y.append(dict(year=y, unit_id=fid, name=r["country_name"], gwcode=r["gwcode"],
                               cshapes_status=r["status"], sovereign_gwcode=owner_gw, sovereign_name=owner_nm,
                               controller_gwcode=ctrl_gw, controller_name=ctrl_nm, control_type=ctype,
                               control_event=ceid,
                               partial_control_events=";".join(partial.get((r["country_name"], r["gwcode"]), [])),
                               pop_calibration=calib.get(fid, ("modern_series", None))[0],
                               nmc_tpop=calib.get(fid, (None, None))[1],
                               gdp_alt_fariss2022_2011usd=(fariss_gdp.get((cow_key.get((y, r["gwcode"])), y))
                                                           if r["status"] == "independent" else None),
                               population=float(upop[fid]) if fid < nf else 0.0,
                               gdp_2011usd=float(ugdp[fid]) if fid < nf else 0.0))
        uy = pd.DataFrame(rows_y)
        uy["area_km2"] = uy.unit_id.map(unit_area)
        uy["pop_share_world"] = uy.population / world_pop
        uy["gdp_share_world"] = uy.gdp_2011usd / world_gdp
        uy["gdp_per_capita"] = uy.gdp_2011usd / uy.population.replace(0, np.nan)
        uy["density_per_km2"] = uy.population / uy.area_km2
        for basis_col, nm_col, out in (("sovereign_gwcode", "sovereign_name", "de_jure"),
                                       ("controller_gwcode", "controller_name", "de_facto")):
            tot = uy.groupby(basis_col).population.transform("sum")
            uy[f"pop_share_{out}_sovereign"] = np.where(tot > 0, uy.population / tot, np.nan)
            g = uy.groupby([basis_col, nm_col]).agg(population=("population", "sum"), gdp_2011usd=("gdp_2011usd", "sum"),
                                                    area_km2=("area_km2", "sum"), n_units=("unit_id", "count")).reset_index()
            g = g.rename(columns={basis_col: "sovereign_gwcode", nm_col: "sovereign_name"})
            g.insert(0, "basis", out)
            g.insert(0, "year", y)
            g["pop_share_world"] = g.population / world_pop
            g["gdp_share_world"] = g.gdp_2011usd / world_gdp
            sov_rows.append(g)
        unit_rows.append(uy)

        upop_map = dict(zip(uy.unit_id, uy.population))
        for (fid, pid), pv in ppop.items():
            piece_year_rows.append((y, fid, pid, pv, pgdp[(fid, pid)]))

        # ---- grids (aggregated to GRID_RES)
        pg = popg.reshape(HYDE_H // AGG, AGG, HYDE_W // AGG, AGG).sum(axis=(1, 3)).astype(np.float32)
        gg = gdpg.reshape(HYDE_H // AGG, AGG, HYDE_W // AGG, AGG).sum(axis=(1, 3)).astype(np.float32)
        np.save(WORK / "grids" / f"pop_{y}.npy", pg)
        np.save(WORK / "grids" / f"gdp_{y}.npy", gg)

        year_rows.append(dict(year=y, snapshot_date=date, world_population=world_pop, world_gdp_2011usd=world_gdp,
                              n_units=len(act), n_independent=int(sum(r["status"] == "independent" for r in act)),
                              n_dependent=int(sum(r["status"] != "independent" for r in act)),
                              population_pattern=basis, unassigned_population=unassigned,
                              n_control_events_whole=len(whole), n_control_events_partial=int((ev_y.scope == "partial").sum())))
        print(y, f"world {world_pop / 1e9:.3f} bn, GDP {world_gdp / 1e12:.2f} tn, units {len(act)}, "
              f"unassigned {unassigned:.0f}, pattern {basis}", flush=True)

    pd.concat(unit_rows).to_csv(WORK / "unit_year.csv", index=False)
    pd.concat(sov_rows).to_csv(WORK / "sovereign_year.csv", index=False)
    py = pd.DataFrame(piece_year_rows, columns=["year", "unit_id", "piece_id", "population", "gdp_2011usd"])
    uyall = pd.concat(unit_rows)[["year", "unit_id", "population"]].rename(columns={"population": "unit_pop"})
    py = py.merge(uyall, on=["year", "unit_id"], how="left")
    py["pop_share_unit"] = np.where(py.unit_pop > 0, py.population / py.unit_pop, np.nan)
    wp = pd.DataFrame(year_rows).set_index("year").world_population
    py["pop_share_world"] = py.population / py.year.map(wp)
    py.drop(columns="unit_pop").to_csv(WORK / "piece_year.csv", index=False)
    pd.DataFrame(year_rows).to_csv(WORK / "years.csv", index=False)


if __name__ == "__main__":
    main()
