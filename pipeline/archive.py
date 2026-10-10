"""Prospective record: write down what the system says today, before the truth is published.

    py archive.py record            save today's outputs to outputs/prospective/<date>.json
    py archive.py score <csv>       score earlier records against a newer FluNet download

Commit and push each record on the day it is made; the commit time is the proof it came first.
Public data runs about four weeks behind, so the weeks a record speaks about have already happened
but cannot be seen yet. That is what makes this a fair test.
"""
import datetime as dt
import json
import sys

import numpy as np

import core as c
import dengue as d
from export import rise_model
from walkforward import flu_rows

DIR = c.ROOT / "outputs" / "prospective"
wk = lambda s: f"{s['year']}-W{s['week']:02d}"


def after(s, k):
    y, w = s["year"], s["week"] + k
    while w > 52:
        w -= 52
        y += 1
    return {"year": y, "week": w}


def record():
    series = c.load_series()
    y, p, n, wkk, yr = c.arrays(series)
    N = len(series)
    th = c.thresholds(p[: int(N * c.TRAIN_SHARE)])
    t = N - 1
    ahead = [c.inv(c.predict(c.fit(y, n, wkk, t, h)[0], y, t, wkk[t], h)) for h in c.ahead_horizons(c.PUB_LAG)]
    level = c.alert_level(p[t], ahead, th)
    rows = flu_rows()
    ly = np.log1p(np.array([r["cases"] for r in rows]))
    m = rise_model()
    x = d.feats(rows, ly, len(rows) - 1, 2)
    z = m["init"] + m["lr"] * sum((l if x[f] <= thr else r) for f, thr, l, r in m["stumps"])
    prob = 1 / (1 + np.exp(-z))
    last = series[-1]
    today = after(last, c.PUB_LAG)
    rec = {"made_on": str(dt.date.today()), "data_file": c.RAW.name, "newest_published_week": wk(last),
           "newest_positivity_percent": round(float(p[t]), 1), "today_week_estimate": wk(today),
           "alert_level_for_today": level, "alert_line_percent": round(th["orange"], 1),
           "claim_alert": f"Positivity in {wk(today)} will be {'above' if level in ('orange', 'red') else 'at or below'} the alert line of {th['orange']:.1f}%.",
           "rapid_rise_probability": round(float(prob), 3), "rapid_rise_call": bool(prob >= 0.5),
           "claim_rise": f"Weekly positives will{'' if prob >= 0.5 else ' not'} reach 1.5 times their level four weeks earlier in any of {wk(after(last, 1))} to {wk(today)}.",
           "status": "awaiting data"}
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / f"{rec['made_on']}.json"
    if path.exists():
        print("A record for today already exists; not overwriting:", path.name)
        return
    path.write_text(json.dumps(rec, indent=1))
    print(json.dumps(rec, indent=1))


def score(newer_csv):
    series = c.load_series(newer_csv)
    idx = {wk(s): i for i, s in enumerate(series)}
    p = np.array([100.0 * s["pos"] / s["n"] for s in series])
    pos = np.array([s["pos"] for s in series])
    for path in sorted(DIR.glob("*.json")):
        rec = json.loads(path.read_text())
        i0, it = idx.get(rec["newest_published_week"]), idx.get(rec["today_week_estimate"])
        if rec["status"] != "awaiting data" or i0 is None or it is None:
            continue
        above = bool(p[it] > rec["alert_line_percent"])
        rose = any(pos[j] >= 1.5 * pos[j - 4] for j in range(i0 + 1, it + 1))
        rec.update({"status": "scored", "scored_with": str(newer_csv), "actual_positivity_today_week": round(float(p[it]), 1),
                    "alert_correct": above == (rec["alert_level_for_today"] in ("orange", "red")),
                    "rapid_rise_happened": bool(rose), "rise_call_correct": bool(rose) == rec["rapid_rise_call"]})
        path.write_text(json.dumps(rec, indent=1))
        print("scored", path.name, rec["alert_correct"], rec["rise_call_correct"])


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "score":
        score(sys.argv[2])
    else:
        record()
