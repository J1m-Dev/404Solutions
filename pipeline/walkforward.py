"""Walk-forward check of the rapid-rise classifier, run AFTER the main results were known.

The single 70/30 split scores one stretch of weeks. Here each calendar year is tested in turn by a
classifier trained only on the years before it. Settings are unchanged from pipeline/dengue.py.
This is extra evidence, not a pre-registered result.
"""
import csv
import datetime as dt
import json

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import core as c
import dengue as d

TEST_YEARS = (2019, 2022, 2023, 2024, 2025, 2026)


def flu_rows(path=None):
    """Weekly influenza positives for 2017-2019 and 2022 onward (the years with a count every week)."""
    out = []
    for r in csv.DictReader(open(path or c.RAW, encoding="utf-8-sig")):
        y0 = int(r["ISO_YEAR"])
        if r["ORIGIN_SOURCE"] in c.SOURCES and (2017 <= y0 <= 2019 or y0 >= 2022) and r["INF_ALL"] != "":
            out.append({"start": dt.date.fromisoformat(r["ISO_WEEKSTARTDATE"][:10]), "cases": float(r["INF_ALL"])})
    return d.prep(out)


def labelled(rows):
    cs = np.array([r["cases"] for r in rows])
    y = np.log1p(cs)
    rule = lambda j: rows[j - 4]["seg"] == rows[j]["seg"] and cs[j] >= 1.5 * cs[j - 4]
    idx = [i for i in range(len(rows)) if d.usable(rows, i, 4)]
    return y, rule, idx, {i: any(rule(i + k) for k in d.H) for i in idx}


def add(a, b):
    return {k: a.get(k, 0) + b[k] for k in ("tp", "fp", "tn", "fn")}


def rates(m):
    m = dict(m)
    m["recall"] = round(m["tp"] / (m["tp"] + m["fn"]), 3) if m["tp"] + m["fn"] else None
    m["precision"] = round(m["tp"] / (m["tp"] + m["fp"]), 3) if m["tp"] + m["fp"] else None
    return m


def main():
    rows = flu_rows()
    y, rule, idx, lab = labelled(rows)
    folds, pooled = [], {}
    for year in TEST_YEARS:
        te = [i for i in idx if rows[i]["year"] == year]
        if not te:
            continue
        tr = [i for i in idx if i + 4 < te[0]]
        ytr, yte = [lab[i] for i in tr], [lab[i] for i in te]
        if not (0 < sum(ytr) < len(ytr)):
            continue
        Xtr, Xte = np.array([d.feats(rows, y, i, 2) for i in tr]), np.array([d.feats(rows, y, i, 2) for i in te])
        gb = GradientBoostingClassifier(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(Xtr, ytr)
        lr = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000)).fit(Xtr, ytr)
        res = {"already_in_outbreak_now": d.confusion([rule(i) for i in te], yte),
               "logistic_regression": d.confusion(lr.predict(Xte), yte),
               "gradient_boosted": d.confusion(gb.predict(Xte), yte)}
        folds.append({"year": year, "n_train": len(tr), "n_test": len(te), "rises": int(sum(yte)), "models": res})
        for k, m in res.items():
            pooled[k] = add(pooled.get(k, {}), m)
    out = {"note": "Run after the main results were known; settings unchanged. Each year is tested by a classifier trained only on earlier years.",
           "folds": folds, "pooled": {k: rates(m) for k, m in pooled.items()},
           "n_test": sum(f["n_test"] for f in folds), "rises": sum(f["rises"] for f in folds)}
    c.dump(out, c.ROOT / "outputs" / "walkforward.json")
    for f in folds:
        g, s = f["models"]["gradient_boosted"], f["models"]["already_in_outbreak_now"]
        print(f["year"], "train", f["n_train"], "test", f["n_test"], "rises", f["rises"], "| boosted", g["tp"], g["fp"], g["tn"], g["fn"], "| simple", s["tp"], s["fp"], s["tn"], s["fn"])
    print("pooled", json.dumps(out["pooled"]))


if __name__ == "__main__":
    main()
