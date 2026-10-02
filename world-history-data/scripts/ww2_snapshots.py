"""County-level political situation on six WWII dates.

For each snapshot date:
  * historical counties valid on the date (US versions by date) plus the
    present-day proxy counties, the latter split along the CShapes 2.0
    borders valid on that exact date
  * de jure unit and sovereign (CShapes), de facto controller from, in order:
      CShapes owner -> whole-unit control events (curated/control_events.csv)
      -> East Asia occupation layers traced by K. Lawson (Manchukuo,
         Kwantung, Mengjiang, Japanese-occupied China 1942, CCP base areas
         1941-42, Indochina provinces ceded to Thailand 1941)
      -> curated county/region rules (curated/ww2_region_control.csv)
  * alliance bloc (simplified)
  * population estimate: GHS-POP 1975 at 30 arc-seconds summed per county,
    scaled so the counties of each historical unit add up to that unit's
    population in the main database (US: to each state's census estimate)
Outputs in work/ww2/.
"""
import json
import sys
from collections import defaultdict

import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.windows import Window
from shapely import STRtree
from shapely.geometry import mapping, shape

import topo
from build_database import Namer
from common import RAW, WORK, ROOT
from ww2_common import SNAPSHOTS, WW2_RAW, WW2_WORK
from ww2_counties import polys, eq_area_km2, read_geojson

LAW = WW2_RAW / "lawson"
SPLIT_MIN_SHARE = 0.03
GHS = RAW / "ghs_pop" / "GHS_POP_E1975_30ss.tif"

# Short WWII names for states that appear as controllers
STATE = {255: ("Germany", "德国"), 325: ("Italy", "意大利"), 740: ("Japan", "日本"), 365: ("Soviet Union", "苏联"),
         200: ("United Kingdom", "英国"), 2: ("United States", "美国"), 220: ("France", "法国"),
         710: ("Republic of China", "中华民国"), 310: ("Hungary", "匈牙利"), 360: ("Romania", "罗马尼亚"),
         355: ("Bulgaria", "保加利亚"), 375: ("Finland", "芬兰"), 800: ("Thailand", "泰国"),
         317: ("Slovakia", "斯洛伐克"), 210: ("Netherlands", "荷兰"), 211: ("Belgium", "比利时"),
         235: ("Portugal", "葡萄牙"), 230: ("Spain", "西班牙"), 900: ("Australia", "澳大利亚"),
         339: ("Albania", "阿尔巴尼亚"), 290: ("Poland", "波兰"), 345: ("Yugoslavia", "南斯拉夫"),
         350: ("Greece", "希腊"), 560: ("South Africa", "南非"), 20: ("Canada", "加拿大"), 920: ("New Zealand", "新西兰"),
         -1: ("Allied powers", "同盟国"), -10: ("Axis powers", "轴心国"), -12: ("Independent State of Croatia", "克罗地亚独立国"),
         -20: ("Front line (contested)", "前线（双方争夺）"), -2: ("Chinese Communist Party", "中国共产党"),
         -30: ("Tuvan People's Republic", "图瓦人民共和国"), -3: ("United Nations", "联合国")}

# Alliance bloc of each controller by snapshot (simplified; neutral otherwise)
S = [s[0] for s in SNAPSHOTS]
AXIS = {255: S, 325: S[:4] + [], 740: S, 317: S[:5], -12: S[1:5], -10: S,
        310: S[2:5], 360: S[2:5], 355: S[2:5], 375: S[2:5], 800: S[3:5]}
ALLIED = {200: S, 710: S, -2: S, -1: S, 900: S, 20: S, 920: S, 560: S, 750: S, 290: S, 210: S, 211: S, 385: S, 212: S,
          390: S[5:], 350: S[2:], 345: S[2:], 365: S[2:], 2: S[2:], 220: [S[0], S[4], S[5]],
          140: S[3:], 70: S[3:], 40: S[3:], 42: S[3:], 41: S[3:], 90: S[3:], 91: S[3:], 92: S[3:], 93: S[3:],
          94: S[3:], 95: S[3:], 530: S[3:], 645: S[3:], 630: S[4:], 100: S[4:], 145: S[4:], 450: S[4:],
          640: S[5:], 651: S[5:], 160: S[5:], 155: S[5:], 135: S[5:], 101: S[5:], 130: S[5:], 150: S[5:], 165: S[5:],
          670: S[5:], 660: S[5:], 652: S[5:], 663: S[5:], 712: S[5:], 360: S[5:], 355: S[5:], 310: [], 375: []}
CONTESTED = {-20}


def bloc(gw, snap, detail):
    if gw in CONTESTED:
        return "contested"
    if detail and "Vichy" in detail:
        return "neutral"
    if snap in AXIS.get(gw, ()):
        return "axis"
    if snap in ALLIED.get(gw, ()):
        return "allied"
    if gw == 325 and snap == S[4]:
        return "axis"
    return "neutral"


def load_units():
    arcs, geoms = topo.load(RAW / "cshapes_2_gw.topojson")
    out = []
    for g in geoms:
        p = dict(g["properties"])
        p["geom"] = topo.to_shape(arcs, g)
        out.append(p)
    return out


def overlays():
    occ = [g for _, g in read_geojson(LAW / "occupied-zone-1942.geojson")]
    occ = polys(__import__("shapely.ops", fromlist=["unary_union"]).unary_union(occ))
    meng = polys(shape(json.load(open(LAW / "mengjiang-control-1942.geojson"))["features"][0]["geometry"]))
    ccp = [g for _, g in read_geojson(LAW / "ccp-resistance-areas-1941-1942-p199-v2.geojson")]
    ccp = polys(__import__("shapely.ops", fromlist=["unary_union"]).unary_union(ccp))
    ic = read_geojson(LAW / "french-indochina-admin.geojson")
    ceded = polys(__import__("shapely.ops", fromlist=["unary_union"]).unary_union([g for p, g in ic if p.get("ceded")]))
    return occ, meng, ccp, ceded


def control_overlay(snap, county, pt, occ, meng, ccp, ceded):
    """East Asia occupation layers; returns (gw, detail_en, detail_zh, type, source, confidence) or None."""
    year = int(snap[:4])
    if county.get("defacto_parent_kind") == "省 (Manchukuo)" or county.get("defacto_parent_kind") == "leased territory":
        lt = county.get("defacto_parent_kind") == "leased territory"
        if snap == "1945-09-02":
            return (365, "Soviet military occupation of Manchuria", "苏军占领东北", "military_occupation",
                    "overlay:manchukuo", "whole")
        if lt:
            return (740, "Kwantung Leased Territory (Japan)", "关东州（日本租借地）", "leased_territory", "overlay:kwantung", "whole")
        return (740, f"Manchukuo ({county.get('defacto_parent')} Province)", f"伪满洲国（{county.get('defacto_parent_zh') or ''}省）",
                "client_state", "overlay:manchukuo", "whole")
    if county["iso3"] not in ("CHN",):
        if ceded is not None and county["iso3"] in ("KHM", "LAO") and snap >= "1941-05-09" and ceded.contains(pt):
            return (800, "Thailand (territory ceded by French Indochina, 1941)", "泰国（1941年法属印度支那割让地）",
                    "annexation", "overlay:indochina_ceded", "whole")
        return None
    if snap in ("1941-12-07", "1942-11-01") and ccp.contains(pt):
        return (-2, "CCP base area / guerrilla zone (1941-42)", "中共抗日根据地 / 游击区（1941-42）", "resistance_base",
                "overlay:ccp_bases_1941_42", "approximate")
    if meng is not None and meng.contains(pt) and snap != "1945-09-02":
        return (740, "Mengjiang (Japanese client state)", "蒙疆（日本扶植政权）", "client_state", "overlay:mengjiang",
                "approximate" if snap == "1939-09-01" else "whole")
    if occ is not None and occ.contains(pt):
        if snap == "1945-09-02":
            return (740, "Japanese forces pending surrender (occupied zone of 1942)", "待投降日军（1942年占领区范围）",
                    "surrendering_forces", "overlay:occupied_zone_1942", "approximate")
        conf = "approximate" if snap in ("1939-09-01", "1940-07-01", "1944-06-06") else "whole"
        return (740, "Japanese-occupied China (incl. Wang Jingwei regime)", "日占区（含汪精卫政权）", "military_occupation",
                "overlay:occupied_zone_1942", conf)
    return None


def rule_match(rule, c):
    if rule["iso3"] != "*" and c["iso3"] not in rule["iso3"].split("|"):
        return False
    if rule["field"] == "*":
        return True
    v = c.get(rule["field"])
    if not isinstance(v, str):
        return False
    v = v.replace("\xa0", "").strip()
    return any(v == m or (m.endswith("*") and v.startswith(m[:-1])) for m in rule["match"].split("|"))


def ghs_zonal(pieces):
    """pieces: list of (key, geom). Returns dict key -> GHS-1975 people (30 arc-second grid)."""
    out = defaultdict(float)
    with rasterio.open(GHS) as src:
        tr = src.transform
        tree = STRtree([g for _, g in pieces])
        T = 2400
        for r0 in range(0, src.height, T):
            for c0 in range(0, src.width, T):
                w = Window(c0, r0, min(T, src.width - c0), min(T, src.height - r0))
                wt = src.window_transform(w)
                west, north = wt.c, wt.f
                east, south = west + w.width * wt.a, north + w.height * wt.e
                from shapely.geometry import box
                idx = tree.query(box(west, south, east, north))
                if len(idx) == 0:
                    continue
                order = sorted(idx, key=lambda i: -pieces[i][1].area)
                ids = rasterize(((mapping(pieces[i][1]), int(i) + 1) for i in order), out_shape=(w.height, w.width),
                                transform=wt, fill=0, dtype="int32")
                a = src.read(1, window=w)
                a = np.where(a > 0, a, 0.0)
                s = np.bincount(ids.ravel(), weights=a.ravel(), minlength=len(pieces) + 1)
                for i in np.flatnonzero(s[1:]) :
                    out[pieces[i][0]] += float(s[i + 1])
        # pieces smaller than a pixel: take the pixel under the representative point, scaled by area
        px_km2 = (abs(tr.a) * 111.32) ** 2
        for k, g in pieces:
            if out.get(k, 0) == 0:
                p = g.representative_point()
                row, col = src.index(p.x, p.y)
                if 0 <= row < src.height and 0 <= col < src.width:
                    v = float(src.read(1, window=Window(col, row, 1, 1))[0, 0])
                    out[k] = max(v, 0) * min(1.0, eq_area_km2(g) / (px_km2 * np.cos(np.radians(p.y)) + 1e-9))
    return out


def main(only=None):
    counties = pd.read_csv(WW2_WORK / "counties.csv", low_memory=False)
    geoms = {f["properties"]["county_id"]: shape(f["geometry"])
             for f in json.load(open(WW2_WORK / "counties.geojson"))["features"]}
    crow = counties.set_index("county_id").to_dict("index")
    for k, v in crow.items():
        v["county_id"] = k
    units = load_units()
    namer = Namer()
    events = pd.read_csv(ROOT / "curated" / "control_events.csv")
    rules = pd.read_csv(ROOT / "curated" / "ww2_region_control.csv", dtype=str).fillna("").to_dict("records")
    occ, meng, ccp, ceded = overlays()
    uy = pd.read_csv(WORK / "unit_year.csv")
    targets = pd.read_csv(WORK / "admin1_targets.csv")
    years = pd.read_csv(WORK / "years.csv").set_index("year")

    piece_geom = {}
    rows = []
    for snap, title_zh, title_en in SNAPSHOTS:
        if only and snap not in only:
            continue
        year = int(snap[:4])
        act = [u for u in units if u["start"] <= snap <= u["end"]]
        ug = [u["geom"] for u in act]
        tree = STRtree(ug)
        state_name = {}
        for u in act:
            if u["status"] == "independent":
                state_name[str(u["gwcode"])] = namer(u["country_name"], "independent", year)
        ev = events[(events.start_date <= snap) & (events.end_date >= snap) & (events.scope == "whole")]
        whole = {(e.unit_name, e.unit_gwcode): e for e in ev.itertuples()}
        partial = defaultdict(list)
        for e in events[(events.start_date <= snap) & (events.end_date >= snap) & (events.scope == "partial")].itertuples():
            partial[(e.unit_name, e.unit_gwcode)].append(e.event_id)

        snap_pieces = []
        for cid, c in crow.items():
            vf, vt = c.get("valid_from"), c.get("valid_to")
            sn = int(snap.replace("-", ""))
            if isinstance(vf, (int, float)) and vf == vf and not (int(vf) <= sn <= int(vt)):
                continue
            g = geoms[cid]
            pt = g.representative_point()
            cand = list(tree.query(g, predicate="intersects"))
            parts = []
            if c["basis"] != "modern_proxy" or len(cand) <= 1:
                hit = [i for i in cand if ug[i].contains(pt)] or cand or [tree.nearest(pt)]
                parts = [(hit[0], None)]
            else:
                shares = [(i, g.intersection(ug[i]).area / max(g.area, 1e-12)) for i in cand]
                shares = [(i, s) for i, s in shares if s >= SPLIT_MIN_SHARE]
                if not shares:
                    parts = [(tree.nearest(pt), None)]
                elif max(s for _, s in shares) >= 1 - SPLIT_MIN_SHARE or len(shares) == 1:
                    parts = [(max(shares, key=lambda t: t[1])[0], None)]
                else:
                    for i, s in shares:
                        pg = polys(g.intersection(ug[i]))
                        if pg is not None:
                            parts.append((i, pg))
            for i, pg in parts:
                u = act[i]
                pid = cid if pg is None else f"{cid}@{u['fid']}"
                if pg is not None:
                    piece_geom[pid] = pg
                snap_pieces.append((pid, cid, i, pg if pg is not None else g))

        # ---- attributes
        for pid, cid, i, g in snap_pieces:
            c = crow[cid]
            u = act[i]
            status = u["status"]
            uen, uzh = namer(u["country_name"], status, year)
            sov_gw = u["gwcode"] if status == "independent" else int(u["owner"])
            sov_en, sov_zh = STATE.get(sov_gw) or state_name.get(str(sov_gw)) or (None, None)
            ctrl = dict(gw=sov_gw, en=sov_en, zh=sov_zh, detail=None, detail_zh=None, type=status, source="cshapes",
                        conf="whole")
            e = whole.get((u["country_name"], u["gwcode"]))
            if e is not None:
                gw = int(e.controller_gwcode)
                ctrl.update(gw=gw, en=STATE.get(gw, (e.controller_name,))[0], zh=STATE.get(gw, (None, e.controller_name_zh))[1],
                            detail=e.controller_name, detail_zh=e.controller_name_zh, type=e.control_type,
                            source=f"event:{e.event_id}")
            pt = g.representative_point()
            ov = control_overlay(snap, c, pt, occ, meng, ccp, ceded)
            if ov:
                gw, den, dzh, typ, src, conf = ov
                ctrl.update(gw=gw, en=STATE.get(gw, (den,))[0], zh=STATE.get(gw, (None, dzh))[1], detail=den, detail_zh=dzh,
                            type=typ, source=src, conf=conf)
            for k, r in enumerate(rules):
                if snap in r["snapshots"].split("|") and rule_match(r, c):
                    gw = int(r["controller_gwcode"])
                    ctrl.update(gw=gw, en=STATE.get(gw, (r["controller_name"],))[0],
                                zh=STATE.get(gw, (None, r["controller_name_zh"]))[1], detail=r["controller_name"],
                                detail_zh=r["controller_name_zh"], type=r["control_type"], source=f"rule:{k + 2}",
                                conf=r["confidence"])
            if ctrl["en"] is None:
                ctrl["en"], ctrl["zh"] = state_name.get(str(ctrl["gw"]), (str(ctrl["gw"]), None))
            rows.append(dict(
                snapshot=snap, piece_id=pid, county_id=cid, unit_id=u["fid"], unit_gwcode=u["gwcode"],
                unit_name_en=uen, unit_name_zh=uzh, unit_status=status, sovereign_gwcode=sov_gw,
                sovereign_name_en=sov_en, sovereign_name_zh=sov_zh, controller_gwcode=ctrl["gw"],
                controller_name_en=ctrl["en"], controller_name_zh=ctrl["zh"], controller_detail_en=ctrl["detail"],
                controller_detail_zh=ctrl["detail_zh"], control_type=ctrl["type"], control_source=ctrl["source"],
                control_confidence=ctrl["conf"], bloc=bloc(ctrl["gw"], snap, ctrl["detail"]),
                partial_control_events=";".join(partial.get((u["country_name"], u["gwcode"]), [])),
                area_km2=round(eq_area_km2(g), 2), _geom=g))
        print(snap, "pieces:", len(snap_pieces), flush=True)

        # ---- population estimate
        cur = [r for r in rows if r["snapshot"] == snap]
        base = ghs_zonal([(r["piece_id"], r["_geom"]) for r in cur])
        upop = uy[uy.year == year].set_index("unit_id").population.to_dict()
        ugw = uy[uy.year == year].groupby("gwcode").population.sum().to_dict()
        world_ratio = years.loc[year, "world_population"] / 4.069e9
        by_unit = defaultdict(float)
        for r in cur:
            r["pop_base_1975"] = base.get(r["piece_id"], 0.0)
            by_unit[r["unit_id"]] += r["pop_base_1975"]
        st = targets[targets.year == year].set_index("iso_3166_2").population.to_dict()
        us_state_base = defaultdict(float)
        for r in cur:
            c = crow[r["county_id"]]
            if c["basis"] == "historical_dated":
                us_state_base[c["hist_parent"]] += r["pop_base_1975"]
        state_code = {n: k for k, n in zip(*_us_states())}
        for r in cur:
            c = crow[r["county_id"]]
            if c["basis"] == "historical_dated" and state_code.get(c["hist_parent"]) in st and us_state_base[c["hist_parent"]] > 0:
                f = st[state_code[c["hist_parent"]]] / us_state_base[c["hist_parent"]]
                r["pop_method"] = "GHS-1975 pattern scaled to state census estimate"
            elif by_unit[r["unit_id"]] > 0 and (r["unit_id"] in upop):
                f = upop[r["unit_id"]] / by_unit[r["unit_id"]]
                r["pop_method"] = "GHS-1975 pattern scaled to unit population"
            elif by_unit[r["unit_id"]] > 0 and r["unit_gwcode"] in ugw:
                f = ugw[r["unit_gwcode"]] / by_unit[r["unit_id"]]
                r["pop_method"] = "GHS-1975 pattern scaled to unit population (matched by GW code)"
            else:
                f = world_ratio
                r["pop_method"] = "GHS-1975 pattern scaled by world growth"
            r["population_est"] = round(r["pop_base_1975"] * f)
        print(snap, "population", f"{sum(r['population_est'] for r in cur) / 1e9:.3f} bn", flush=True)

    out = pd.DataFrame([{k: v for k, v in r.items() if k != "_geom"} for r in rows])
    for snap, d in out.groupby("snapshot"):
        d.to_csv(WW2_WORK / f"snapshot_{snap}.csv", index=False)
        keep = set(d.piece_id)
        with open(WW2_WORK / f"split_{snap}.geojson", "w") as f:
            json.dump({"type": "FeatureCollection", "features": [
                {"type": "Feature", "properties": {"piece_id": k}, "geometry": mapping(g)}
                for k, g in piece_geom.items() if k in keep]}, f)
    print(out.groupby("snapshot").agg(pieces=("piece_id", "count"), pop=("population_est", "sum")))
    print(out.groupby(["snapshot", "bloc"]).population_est.sum().unstack())


def _us_states():
    codes = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
             "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
             "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]
    names = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
             "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
             "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
             "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
             "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
             "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
             "West Virginia", "Wisconsin", "Wyoming"]
    return ["US-" + c for c in codes], names


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
