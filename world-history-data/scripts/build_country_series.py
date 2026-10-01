"""Annual population and GDP per capita for modern countries, 1900-2000.

These series are in *modern* (present-day) borders. They are inputs for the
population/GDP grids, which are then summed inside each year's historical
polygons. Every value carries a source flag.

Population
  1950+      UN World Population Prospects, via Gapminder ddf--gapminder--population
  1800-1949  Gapminder population v5 (via OWID), spliced to the UN level at 1950
             with a constant ratio per country
  no pre-1950 series (mostly small territories): back-cast with the summed
             growth of the other countries in the same Natural Earth subregion

GDP per capita (2011 international dollars, Maddison Project Database 2020)
  observed   Maddison value
  between Maddison observations: Gapminder's annual GDP-per-capita path, scaled
             so it passes through both Maddison values (log-linear ratio)
  outside the Maddison range: Gapminder growth chained to the nearest Maddison
             value
  no Maddison at all: Gapminder value times the median Maddison/Gapminder ratio
             of that year
  neither: median of the same subregion that year
"""
import json

import numpy as np
import pandas as pd

from common import RAW, WORK, YEARS

Y0, Y1 = YEARS[0], YEARS[-1]

NAME_FIX = {
    "Congo": "cog", "Democratic Republic of Congo": "cod", "Czechia": "cze",
    "Czech Republic": "cze", "Hong Kong": "hkg", "Kyrgyzstan": "kgz", "Laos": "lao",
    "Saint Lucia": "lca", "Slovakia": "svk", "United Arab Emirates": "are",
    "United Kingdom": "gbr", "United States": "usa", "Macedonia": "mkd",
    "Micronesia": "fsm", "Saint Kitts and Nevis": "kna",
    "Saint Vincent and the Grenadines": "vct", "Swaziland": "swz", "Timor": "tls",
    "Vatican": "vat",
}

# Natural Earth units that have no series of their own are folded into the
# country whose statistics include them.
NE_FOLD = {"SOL": "som", "CYN": "cyp", "CNM": "cyp", "ESB": "cyp", "WSB": "cyp",
           "USG": "cub", "KAS": "ind"}


def ne_code_table():
    """Natural Earth admin-0 features -> series code (lower-case ISO3)."""
    ne = json.load(open(RAW / "naturalearth" / "ne_10m_admin_0_countries.geojson"))
    rows = []
    for i, f in enumerate(ne["features"]):
        p = f["properties"]
        code = NE_FOLD.get(p["ADM0_A3"])
        if code is None:
            iso = p["ISO_A3_EH"] if p["ISO_A3_EH"] != "-99" else p["ADM0_A3"]
            code = iso.lower()
        rows.append(dict(ne_index=i, adm0_a3=p["ADM0_A3"], code=code, name=p["NAME"],
                         name_zh=p.get("NAME_ZH"), subregion=p["SUBREGION"],
                         continent=p["CONTINENT"], sovereignt=p["SOVEREIGNT"]))
    return pd.DataFrame(rows)


def main():
    ent = pd.read_csv(RAW / "gapminder-pop" / "ddf--entities--geo--country.csv")
    name_to_code = dict(zip(ent.name, ent.country))
    name_to_code.update(NAME_FIX)
    code_name = dict(zip(ent.country, ent.name))

    ne = ne_code_table()
    ne.to_csv(WORK / "ne_admin0_codes.csv", index=False)
    region = ne.drop_duplicates("code").set_index("code").subregion.to_dict()
    for c, r in zip(ent.country, ent.world_4region):  # codes absent from NE
        region.setdefault(c, f"gapminder:{r}")

    # ---------------- population ----------------
    un = pd.read_csv(RAW / "gapminder-pop" / "ddf--datapoints--population--by--country--year.csv")
    un = un.rename(columns={"country": "code"}).set_index(["code", "year"]).population
    gm5 = pd.read_csv(RAW / "owid-datasets" / "datasets" / "Population by country, 1800 to 2100 (Gapminder & UN)"
                      / "Population by country, 1800 to 2100 (Gapminder & UN).csv")
    gm5["code"] = gm5.Entity.map(name_to_code)
    assert gm5.code.notna().all(), gm5[gm5.code.isna()].Entity.unique()
    gm5 = gm5.set_index(["code", "Year"]).iloc[:, 1]

    codes = sorted(set(un.index.get_level_values(0)) | set(ne.code))
    pop = {}
    for c in codes:
        s = {}
        if c in un.index.get_level_values(0):
            u = un.loc[c]
            for y in YEARS:
                if y >= 1950 and y in u.index:
                    s[y] = (float(u[y]), "un_wpp")
            if c in gm5.index.get_level_values(0) and 1950 in u.index:
                g = gm5.loc[c]
                r = float(u[1950]) / float(g[1950])
                for y in YEARS:
                    if y < 1950 and y in g.index:
                        s[y] = (float(g[y]) * r, "gapminder_v5_spliced_to_un")
        if s:
            pop[c] = s
    # back-cast countries with no pre-1950 series using subregion growth
    for c, s in pop.items():
        if Y0 in s or 1950 not in s:
            continue
        peers = [p for p, ps in pop.items() if region.get(p) == region.get(c) and Y0 in ps and p != c]
        if not peers:
            peers = [p for p, ps in pop.items() if Y0 in ps]
        tot = {y: sum(pop[p][y][0] for p in peers) for y in range(Y0, 1951)}
        for y in range(Y0, 1950):
            s[y] = (s[1950][0] * tot[y] / tot[1950], "subregion_growth_backcast")

    # ---------------- GDP per capita ----------------
    mad = pd.read_csv(RAW / "owid-datasets" / "datasets" / "Maddison Project Database 2020 (Bolt and van Zanden (2020))"
                      / "Maddison Project Database 2020 (Bolt and van Zanden (2020)).csv")
    mad["code"] = mad.Entity.map(name_to_code)
    mad = mad[mad.code.notna()].dropna(subset=["GDP per capita"])
    mad = mad.set_index(["code", "Year"])["GDP per capita"]
    gmg = pd.read_csv(RAW / "gapminder-gdp" /
                      "ddf--datapoints--income_per_person_gdppercapita_ppp_inflation_adjusted--by--geo--time.csv")
    gmg = gmg.set_index(["geo", "time"]).iloc[:, 0].astype(float)

    mad_codes = set(mad.index.get_level_values(0))
    gm_codes = set(gmg.index.get_level_values(0))

    # median Maddison/Gapminder ratio per year (for countries with both)
    ratios = {}
    for y in YEARS:
        rs = [mad[c, y] / gmg[c, y] for c in mad_codes & gm_codes
              if (c, y) in mad.index and (c, y) in gmg.index]
        ratios[y] = float(np.median(rs)) if rs else np.nan
    rs = pd.Series(ratios).interpolate(limit_direction="both")

    gdppc = {}
    for c in codes:
        if c in mad_codes and c in gm_codes:
            m = mad.loc[c]
            g = gmg.loc[c]
            anchors = [y for y in m.index if y in g.index and Y0 - 50 <= y <= Y1 + 20]
            lr = pd.Series({y: np.log(m[y] / g[y]) for y in anchors}).sort_index()
            out = {}
            for y in YEARS:
                if y in m.index:
                    out[y] = (float(m[y]), "maddison")
                    continue
                if y < lr.index[0]:
                    k, flag = lr.iloc[0], "gapminder_growth_chained_to_maddison"
                elif y > lr.index[-1]:
                    k, flag = lr.iloc[-1], "gapminder_growth_chained_to_maddison"
                else:
                    k, flag = np.interp(y, lr.index, lr.values), "maddison_interpolated_on_gapminder_path"
                out[y] = (float(g[y] * np.exp(k)), flag)
            gdppc[c] = out
        elif c in gm_codes:
            g = gmg.loc[c]
            gdppc[c] = {y: (float(g[y] * rs[y]), "gapminder_scaled_to_maddison_units") for y in YEARS}
    # Maddison only (no Gapminder path): interpolate log-linearly inside the
    # Maddison range, chain to the subregion median growth outside it.
    for c in sorted(mad_codes - gm_codes):
        if c not in codes:
            continue
        m = mad.loc[c]
        xs = np.array(m.index, dtype=float)
        ys = np.log(m.values.astype(float))
        peers = [p for p in gdppc if region.get(p) == region.get(c)] or list(gdppc)
        med = {y: float(np.median([gdppc[p][y][0] for p in peers])) for y in YEARS}
        lo, hi = int(xs.min()), int(xs.max())
        out = {}
        for y in YEARS:
            if y in m.index:
                out[y] = (float(m[y]), "maddison")
            elif lo < y < hi:
                out[y] = (float(np.exp(np.interp(y, xs, ys))), "maddison_loglinear_interpolated")
            else:
                a = lo if y < lo else hi
                out[y] = (float(m[a]) * med[y] / med[a], "subregion_growth_chained_to_maddison")
        gdppc[c] = out
    for c in codes:
        if c in gdppc:
            continue
        peers = [p for p in gdppc if region.get(p) == region.get(c)] or list(gdppc)
        gdppc[c] = {y: (float(np.median([gdppc[p][y][0] for p in peers])), "subregion_median")
                    for y in YEARS}

    rows = []
    for c in codes:
        for y in YEARS:
            pv, ps = pop.get(c, {}).get(y, (np.nan, "none"))
            gv, gs = gdppc[c][y]
            rows.append(dict(code=c, name=code_name.get(c, ne.set_index("code").name.get(c, c)
                                                         if c in set(ne.code) else c),
                             subregion=region.get(c), year=y, population=pv, pop_source=ps,
                             gdppc_2011usd=gv, gdppc_source=gs,
                             gdppc_gapminder_2017usd=float(gmg[c, y]) if (c, y) in gmg.index else np.nan))
    df = pd.DataFrame(rows)
    df["gdp_2011usd"] = df.population * df.gdppc_2011usd
    df.to_csv(WORK / "country_series.csv", index=False)
    w = df.groupby("year")[["population", "gdp_2011usd"]].sum()
    print(w.loc[[1900, 1913, 1929, 1950, 1973, 2000]])
    print(df[df.year == 1900].pop_source.value_counts())
    print(df[df.year == 1900].gdppc_source.value_counts())
    print("codes without population:", sorted(df[df.population.isna()].code.unique()))


if __name__ == "__main__":
    main()
