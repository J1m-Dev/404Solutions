"""Dengue models on OpenDengue national weekly data for Malaysia (compiled from MOH / WHO reports).

Split by date: earliest 70% of weeks train, latest 30% test. Models are fitted once on the training
weeks and then applied to the test weeks. Settings are fixed in this file; nothing is tuned.

A) Case forecast 1 to 4 weeks ahead: last value, same-week average, ridge, gradient boosting.
B) Outbreak within the next 4 weeks (yes/no), under two definitions:
   usual  : cases above the same-week average of training years + 2 SD
   rising : cases at least 50% higher than 4 weeks earlier
"""
import csv
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/raw/opendengue/mys_weekly_national.csv"  # Malaysia weekly rows from the OpenDengue V1.3 temporal extract
H = (1, 2, 3, 4)


def load(path=SRC, extra=()):
    rows = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        if r["ISO_A0"] == "MYS" and r["T_res"] == "Week" and r["S_res"] == "Admin0":
            d = dt.date.fromisoformat(r["calendar_start_date"])
            rows.append({"start": d, "cases": float(r["dengue_total"])})
    rows += list(extra)
    return prep(rows)


def prep(rows):
    """Sort weekly rows and mark unbroken segments, ISO week and year."""
    rows.sort(key=lambda r: r["start"])
    seg = 0
    for i, r in enumerate(rows):
        if i and (r["start"] - rows[i - 1]["start"]).days > 10:
            seg += 1
        r["seg"] = seg
        r["week"] = min(r["start"].isocalendar()[1], 52)
        r["year"] = r["start"].isocalendar()[0]
    return rows


def feats(rows, y, i, h):
    w = (rows[i]["week"] - 1 + h) % 52 + 1
    f = [y[i], y[i] - y[i - 1], y[i - 1] - y[i - 2], y[i] - y[i - 3], y[i] - float(np.mean(y[i - 7:i + 1]))]
    for k in (1, 2):
        a = 2 * math.pi * k * w / 52
        f += [math.sin(a), math.cos(a)]
    return f


def usable(rows, i, h):
    """Need 8 earlier weeks and h later weeks, all in the same unbroken segment."""
    return i - 7 >= 0 and i + h < len(rows) and rows[i - 7]["seg"] == rows[i]["seg"] == rows[i + h]["seg"]


def confusion(pred, act):
    pred, act = np.array(pred, bool), np.array(act, bool)
    tp, fp = int((pred & act).sum()), int((pred & ~act).sum())
    fn, tn = int((~pred & act).sum()), int((~pred & ~act).sum())
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None}


def main(rows=None, tag="national", source="OpenDengue V1.3 temporal extract, Malaysia national weekly (MOH / WHO reports)", site_file="dengue.json", test_from=None):
    rows = rows or load()
    N = len(rows)
    split = int(N * 0.70) if test_from is None else next(i for i, r in enumerate(rows) if r["start"] >= test_from)
    c = np.array([r["cases"] for r in rows])
    y = np.log1p(c)
    train_years = sorted({r["year"] for r in rows[:split]})
    wk_mean, wk_sd = {}, {}
    for w in range(1, 53):
        v = [c[i] for i in range(split) if rows[i]["week"] == w]
        wk_mean[w], wk_sd[w] = float(np.mean(v)), float(np.std(v))
    out = {"source": source, "weeks": N,
           "segments": [[str(rows[i]["start"]) for i in (min(j for j in range(N) if rows[j]["seg"] == s), max(j for j in range(N) if rows[j]["seg"] == s))] for s in sorted({r["seg"] for r in rows})],
           "train_end": str(rows[split - 1]["start"]), "test_start": str(rows[split]["start"]), "test_end": str(rows[-1]["start"]),
           "train_years": train_years, "forecast": [], "outbreak": []}

    # A) forecast
    for h in H:
        tr = [i for i in range(split) if usable(rows, i, h) and i + h < split]
        te = [i for i in range(N) if usable(rows, i, h) and i + h >= split]
        Xtr, Xte = np.array([feats(rows, y, i, h) for i in tr]), np.array([feats(rows, y, i, h) for i in te])
        dtr = np.array([y[i + h] - y[i] for i in tr])
        actual = np.array([c[i + h] for i in te])
        ridge = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(Xtr, dtr)
        gbm = GradientBoostingRegressor(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(Xtr, dtr)
        preds = {"last_value": np.array([c[i] for i in te]),
                 "same_week_average": np.array([wk_mean[(rows[i]["week"] - 1 + h) % 52 + 1] for i in te]),
                 "ridge": np.expm1(np.array([y[i] for i in te]) + ridge.predict(Xte)),
                 "gradient_boosted": np.expm1(np.array([y[i] for i in te]) + gbm.predict(Xte))}
        mae = {k: round(float(np.mean(np.abs(v - actual))), 1) for k, v in preds.items()}
        out["forecast"].append({"weeks_ahead": h, "n_train": len(tr), "n_test": len(te), "mean_actual": round(float(actual.mean()), 1), "mae": mae,
                                "best": min(mae, key=mae.get)})

    # B) outbreak within the next 4 weeks
    is_out = {"usual": lambda j: c[j] > wk_mean[rows[j]["week"]] + 2 * wk_sd[rows[j]["week"]],
              "rising": lambda j: rows[j - 4]["seg"] == rows[j]["seg"] and c[j] >= 1.5 * c[j - 4]}
    for name, rule in is_out.items():
        idx = [i for i in range(N) if usable(rows, i, 4)]
        lab = {i: any(rule(i + k) for k in H) for i in idx}
        tr, te = [i for i in idx if i + 4 < split], [i for i in idx if i >= split]
        Xtr, Xte = np.array([feats(rows, y, i, 2) for i in tr]), np.array([feats(rows, y, i, 2) for i in te])
        ytr, yte = [lab[i] for i in tr], [lab[i] for i in te]
        res = {"definition": name, "n_train": len(tr), "train_outbreak_weeks": int(sum(ytr)), "n_test": len(te), "test_outbreak_weeks": int(sum(yte)), "models": {}}
        res["models"]["already_in_outbreak_now"] = confusion([rule(i) for i in te], yte)
        if 0 < sum(ytr) < len(ytr):
            lr = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000)).fit(Xtr, ytr)
            gb = GradientBoostingClassifier(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(Xtr, ytr)
            res["models"]["logistic_regression"] = confusion(lr.predict(Xte), yte)
            res["models"]["gradient_boosted"] = confusion(gb.predict(Xte), yte)
        else:
            res["note"] = "Training weeks contain only one class, so no classifier could be trained."
        out["outbreak"].append(res)

    # Extrapolation: ridge refitted on every week, projected 1 to 4 weeks past the end of the data.
    out["extrapolation"] = []
    for h in H:
        idx = [i for i in range(N) if usable(rows, i, h)]
        m = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(np.array([feats(rows, y, i, h) for i in idx]), np.array([y[i + h] - y[i] for i in idx]))
        out["extrapolation"].append({"weeks_ahead": h, "start": str(rows[-1]["start"] + dt.timedelta(weeks=h)),
                                     "cases": round(float(np.expm1(y[-1] + m.predict([feats(rows, y, N - 1, h)])[0])))})
    out["split_index"] = split
    out["series"] = [[str(r["start"]), r["cases"]] for r in rows]
    if site_file:
        (ROOT / "site" / "data" / site_file).write_text(json.dumps(out))
    out = {k: v for k, v in out.items() if k != "series"}

    (ROOT / "outputs").mkdir(exist_ok=True)
    (ROOT / "outputs" / f"dengue_{tag}.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    print(json.dumps(main(), indent=1))
