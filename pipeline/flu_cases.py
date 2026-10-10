"""Influenza lab-confirmed positives per week (WHO FluNet, Malaysia), using the dengue method unchanged.

Three runs, all split by date:
  recent      : 2022 onward only (245 weeks), 70/30
  with_older  : adds 2017-2019, the only earlier years with a positive count for every week, 70/30
  same_test   : with_older training data, but tested on exactly the 'recent' test weeks, to show
                whether the older years help on the same unseen weeks
"""
import csv
import datetime as dt
import json

import core as c
import dengue as d


def rows(years):
    out = []
    for r in csv.DictReader(open(c.RAW, encoding="utf-8-sig")):
        if r["ORIGIN_SOURCE"] in c.SOURCES and int(r["ISO_YEAR"]) in years and r["INF_ALL"] != "":
            out.append({"start": dt.date.fromisoformat(r["ISO_WEEKSTARTDATE"][:10]), "cases": float(r["INF_ALL"])})
    return d.prep(out)


SRC = "WHO FluNet, Malaysia: influenza-positive lab samples per week"
recent, older = set(range(2022, 2027)), set(range(2017, 2020)) | set(range(2022, 2027))
res = {"recent": d.main(rows(recent), "flu_recent", SRC, None)}
res["with_older"] = d.main(rows(older), "flu_with_older", SRC, None)
res["same_test"] = d.main(rows(older), "flu_same_test", SRC, None, test_from=dt.date.fromisoformat(res["recent"]["test_start"]))
c.dump(res, c.ROOT / "outputs" / "flu_cases.json")
for k, r in res.items():
    print("==", k, r["weeks"], "weeks | train to", r["train_end"], "| test", r["test_start"], "to", r["test_end"])
    for f in r["forecast"]:
        print("  h", f["weeks_ahead"], "n_test", f["n_test"], "mean", f["mean_actual"], f["mae"], "best:", f["best"])
    for o in r["outbreak"]:
        print("  ", o["definition"], "train+", o["train_outbreak_weeks"], "/", o["n_train"], "test+", o["test_outbreak_weeks"], "/", o["n_test"], o.get("note", ""), json.dumps(o["models"]))
