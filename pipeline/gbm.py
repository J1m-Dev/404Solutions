"""Gradient-boosted forecast. Usage: gbm.py train|test

Predicts the CHANGE in logit positivity from the newest week to h weeks ahead, so that
"no change" (the last-value baseline) is the starting point the trees must improve on.
The test weeks were already scored once for the ridge model; this is a second scoring.
"""
import json
import math
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

import core as c
from evaluate import iscore

CFG = dict(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, min_samples_leaf=8)


def features(series, y, s, h):
    w = c.week_after(series[s]["week"], h)
    typed = series[s]["h3"] + series[s]["h1"] + series[s]["b"] or 1.0
    f = [y[s], y[s] - y[s - 1], y[s - 1] - y[s - 2], y[s] - y[s - 3], y[s] - float(np.mean(y[s - 7: s + 1])),
         series[s]["h3"] / typed, series[s]["b"] / typed]
    for k in (1, 2):
        a = 2 * math.pi * k * w / 52.0
        f += [math.sin(a), math.cos(a)]
    return f


def run(series, first, last, cfg):
    y, p, n, wk, yr = c.arrays(series)
    rows = []
    for h in c.HORIZONS:
        for t in range(first, last + 1):
            if t + h >= len(y):
                continue
            idx = range(7, t - h + 1)
            X = np.array([features(series, y, s, h) for s in idx])
            Y = np.array([y[s + h] - y[s] for s in idx])
            m = GradientBoostingRegressor(random_state=0, **cfg).fit(X, Y)
            yh = y[t] + float(m.predict([features(series, y, t, h)])[0])
            qp = np.quantile(Y, [0.10, 0.90])  # width from last-value errors on past weeks
            tw = c.week_after(wk[t], h)
            rows.append({"t": t, "h": h, "actual": p[t + h], "model": c.inv(yh), "persist": p[t],
                         "seasonal": c.epiweek_mean(p, wk, yr, t, tw, yr[t] + (1 if tw < wk[t] else 0)),
                         "lo": c.inv(yh + qp[0]), "hi": c.inv(yh + qp[1]),
                         "plo": c.inv(y[t] + qp[0]), "phi": c.inv(y[t] + qp[1])})
    return rows


def summarise(rows):
    out = []
    for h in c.HORIZONS:
        r = [x for x in rows if x["h"] == h]
        mae = lambda k: float(np.mean([abs(x[k] - x["actual"]) for x in r]))
        m, pe, se = mae("model"), mae("persist"), mae("seasonal")
        cov = float(np.mean([x["lo"] <= x["actual"] <= x["hi"] for x in r]))
        ris = float(np.mean([iscore(x["lo"], x["hi"], x["actual"]) for x in r]) / np.mean([iscore(x["plo"], x["phi"], x["actual"]) for x in r]))
        out.append({"h": h, "n": len(r), "mae_model": m, "mae_persist": pe, "mae_seasonal": se, "skill_persist": 1 - m / pe,
                    "coverage80": cov, "rel_interval_score": ris,
                    "passed": bool(m < pe and m < se and 0.70 <= cov <= 0.90 and ris < 1)})
    return out


if __name__ == "__main__":
    series = c.load_series()
    N = len(series)
    split = int(N * c.TRAIN_SHARE)
    if sys.argv[1] == "train":
        for cfg in [CFG, dict(CFG, max_depth=1), dict(CFG, n_estimators=60, learning_rate=0.05), dict(CFG, max_depth=3, min_samples_leaf=12),
                    dict(CFG, n_estimators=300, learning_rate=0.01)]:
            s = summarise(run(series[:split], 110, split - 2, cfg))
            print({k: cfg[k] for k in ("n_estimators", "max_depth", "learning_rate")}, "| skill", " ".join(f"{x['h']}:{x['skill_persist']:+.2f}" for x in s),
                  "| cov", " ".join(f"{x['coverage80']:.2f}" for x in s))
    else:
        rows = [x for x in run(series, split - 1, N - 2, CFG) if x["t"] + x["h"] >= split]
        res = summarise(rows)
        v = json.loads((c.ROOT / "outputs/validation.json").read_text())
        v["gbm"] = {"note": "Second scoring of the same test weeks (first was the ridge model). Frozen at tag freeze-v2.", "config": CFG, "per_horizon": res}
        c.dump(v, c.ROOT / "outputs/validation.json")
        for x in res:
            print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in x.items()})
