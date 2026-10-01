"""Sub-national population targets used to calibrate the grid inside a country.

Rows: country code (series code), ISO 3166-2 subdivision as used by Natural
Earth admin-1, year, population, source. Add more countries here to improve
the within-country distribution for earlier decades.
"""
import pandas as pd

from common import RAW, WORK


def main():
    us = pd.read_csv(RAW / "subnational" / "us_state_population_by_year.csv",
                     header=None, names=["state", "year", "population"])
    us["code"] = "usa"
    us["iso_3166_2"] = "US-" + us.state
    us["source"] = "US Census Bureau annual state estimates (via FRED / JoshData)"
    out = us[["code", "iso_3166_2", "year", "population", "source"]]
    out.to_csv(WORK / "admin1_targets.csv", index=False)
    print(out.groupby("code").year.agg(["min", "max", "count"]))


if __name__ == "__main__":
    main()
