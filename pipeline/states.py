"""State-by-state series for the "All states" chart, and the same model comparison run per state.

Dengue (OpenDengue V1.3, compiled from Ministry of Health and WHO reports):
  monthly by state 1993-2010 (ten states), yearly by state 2009-2018 and 2023, plus national totals.
Influenza: no state-level series is public; only the national weekly series and a few published snapshots.

Per state, on the monthly series: split by date 70/30, forecast 1 to 3 months ahead, and compare
"same as last month", the same-month average, ridge regression and gradient boosting. The settings are
the ones used for the weekly models (pipeline/dengue.py); nothing is tuned.
"""
import csv
import datetime as dt
import json
import math

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import core as c

OD = c.ROOT / "data/raw/opendengue"
H = (1, 2, 3)
NICE = {"W.P. KUALA LUMPUR": "Kuala Lumpur", "KUALA LUMPUR": "Kuala Lumpur", "W.P. LABUAN": "Labuan", "LABUAN": "Labuan",
        "PULAU PINANG": "Pulau Pinang", "NEGERI SEMBILAN": "Negeri Sembilan"}
nice = lambda n: NICE.get(n, n.title())

# Published influenza snapshots by state (Ministry of Health statement reported by Bernama, 9 Oct 2025; epi week 40/2025).
FLU_SNAPSHOTS = [
    {"state": "Selangor", "clusters_week_40_2025": 43, "ili_rate_percent_week_40_2025": 14.63},
    {"state": "Kuala Lumpur and Putrajaya", "clusters_week_40_2025": 15, "ili_rate_percent_week_40_2025": 11.62},
    {"state": "Pulau Pinang", "clusters_week_40_2025": 10, "ili_rate_percent_week_40_2025": 12.49},
    {"state": "Johor", "clusters_week_40_2025": 9, "ili_rate_percent_week_40_2025": None},
    {"state": "Kedah", "clusters_week_40_2025": 5, "ili_rate_percent_week_40_2025": None},
    {"state": "Melaka", "clusters_week_40_2025": None, "ili_rate_percent_week_40_2025": 12.49},
    {"state": "Sabah", "clusters_week_40_2025": None, "ili_rate_percent_week_40_2025": 8.73},
]


def feats(y, i, month):
    f = [y[i], y[i] - y[i - 1], y[i - 1] - y[i - 2], y[i] - y[i - 3], y[i] - float(np.mean(y[i - 5:i + 1]))]
    for k in (1, 2):
        a = 2 * math.pi * k * month / 12
        f += [math.sin(a), math.cos(a)]
    return f


def evaluate(months, values):
    """months: list of (year, month); values: cases. Returns per-horizon errors on the latest 30%, and a projection."""
    cs = np.array(values, float)
    y = np.log1p(cs)
    n = len(cs)
    split = int(n * 0.70)
    mon = [m for _, m in months]
    after = lambda i, h: (mon[i] - 1 + h) % 12 + 1
    avg = {m: float(np.mean([cs[i] for i in range(split) if mon[i] == m])) for m in range(1, 13)}
    out, proj = [], []
    for h in H:
        tr = [i for i in range(5, split - h)]
        te = [i for i in range(5, n - h) if i + h >= split]
        Xtr, Xte = np.array([feats(y, i, after(i, h)) for i in tr]), np.array([feats(y, i, after(i, h)) for i in te])
        dtr = np.array([y[i + h] - y[i] for i in tr])
        actual = np.array([cs[i + h] for i in te])
        ridge = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(Xtr, dtr)
        gbm = GradientBoostingRegressor(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(Xtr, dtr)
        base = np.array([y[i] for i in te])
        preds = {"last_value": np.array([cs[i] for i in te]), "same_month_average": np.array([avg[after(i, h)] for i in te]),
                 "ridge": np.expm1(base + ridge.predict(Xte)), "gradient_boosted": np.expm1(base + gbm.predict(Xte))}
        mae = {k: round(float(np.mean(np.abs(v - actual))), 1) for k, v in preds.items()}
        best = min(mae, key=mae.get)
        out.append({"months_ahead": h, "n_test": len(te), "mean_actual": round(float(actual.mean()), 1), "mae": mae, "best": best,
                    "gain_vs_last_value_pct": round(100 * (1 - mae[best] / mae["last_value"]), 1) if mae["last_value"] else None})
        idx = range(5, n - h)
        full = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(np.array([feats(y, i, after(i, h)) for i in idx]), np.array([y[i + h] - y[i] for i in idx]))
        proj.append(round(float(np.expm1(y[-1] + full.predict([feats(y, n - 1, after(n - 1, h))])[0]))))
    return {"months": n, "train_end": "%d-%02d" % months[split - 1], "test_start": "%d-%02d" % months[split], "test_end": "%d-%02d" % months[-1],
            "results": out, "projection": proj}


def main():
    rows = list(csv.DictReader(open(OD / "mys_states.csv", encoding="utf-8")))
    monthly, yearly = {}, {}
    for r in rows:
        s = nice(r["adm_1_name"])
        if r["T_res"] == "Month":
            d = dt.date.fromisoformat(r["calendar_start_date"])
            monthly.setdefault(s, {})[(d.year, d.month)] = float(r["dengue_total"])
        elif r["T_res"] == "Year":
            yearly.setdefault(s, {})[int(r["Year"])] = float(r["dengue_total"])

    # monthly chart: every month from the first to the last seen in any state
    keys = sorted({k for v in monthly.values() for k in v})
    labels = ["%d-%02d" % k for k in keys]
    m_states = {s: [v.get(k) for k in keys] for s, v in sorted(monthly.items())}
    m_total = [sum(v[i] for v in m_states.values() if v[i] is not None) for i in range(len(keys))]
    m_count = [sum(v[i] is not None for v in m_states.values()) for i in range(len(keys))]

    # yearly chart, with a national total from the national files
    nat = {}
    for r in csv.DictReader(open(OD / "National_extract_V1_3.csv", encoding="utf-8-sig")):
        if r["ISO_A0"] == "MYS" and r["T_res"] == "Year":
            nat[int(r["Year"])] = float(r["dengue_total"])
    wk = {}
    for r in csv.DictReader(open(OD / "mys_weekly_national.csv", encoding="utf-8")):
        yy = int(r["calendar_start_date"][:4])
        wk.setdefault(yy, []).append(float(r["dengue_total"]))
    for yy, v in wk.items():
        if yy not in nat and len(v) >= 51:
            nat[yy] = sum(v)
    years = sorted({k for v in yearly.values() for k in v})
    y_states = {s: [v.get(k) for k in years] for s, v in sorted(yearly.items())}

    # state population by year (OpenDOSM), for cases per 100,000 people on the state map
    pop_name = {"W.P. Kuala Lumpur": "Kuala Lumpur", "W.P. Labuan": "Labuan", "W.P. Putrajaya": "Putrajaya"}
    pop = {}
    for r in csv.DictReader(open(c.ROOT / "data/raw/population_state_overall.csv", encoding="utf-8")):
        pop.setdefault(pop_name.get(r["state"], r["state"]), {})[int(r["year"])] = float(r["population_thousand"])
    y_pop = {s: [pop.get(s, {}).get(k) for k in years] for s in y_states}

    # state outlines for the map (geoBoundaries), renamed to match the data
    geo_name = {"Malacca": "Melaka", "Penang": "Pulau Pinang"}
    g = json.load(open(c.ROOT / "data/raw/mys_adm1.geojson", encoding="utf-8"))
    for f in g["features"]:
        f["properties"] = {"name": geo_name.get(f["properties"]["shapeName"], f["properties"]["shapeName"])}
    def rnd(x):
        return [rnd(v) for v in x] if isinstance(x, list) else round(x, 3)
    for f in g["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    (c.ROOT / "site" / "data" / "states_map.geojson").write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")
    print("map states without yearly dengue figures:", sorted({f["properties"]["name"] for f in g["features"]} - set(y_states)))

    models = []
    for s, v in sorted(monthly.items()):
        ks = sorted(v)
        gaps = any((b[0] * 12 + b[1]) - (a[0] * 12 + a[1]) != 1 for a, b in zip(ks, ks[1:]))
        if len(ks) >= 100 and not gaps:
            models.append({"state": s, **evaluate(ks, [v[k] for k in ks])})
    full = [i for i, n_ in enumerate(m_count) if n_ == max(m_count)]
    lo, hi = full[0], full[-1]
    models.append({"state": "All ten states together", **evaluate(keys[lo:hi + 1], m_total[lo:hi + 1])})

    # influenza: national weekly only
    flu = c.load_series()
    out = {
        "dengue": {
            "source": "OpenDengue V1.3 (compiled from Ministry of Health and WHO reports)",
            "monthly": {"labels": labels, "states": m_states, "national": m_total, "states_reporting": m_count,
                        "national_label": "Sum of the states that reported that month",
                        "note": "Monthly state figures exist for ten states and end in December 2010. The other states have no monthly series in this source."},
            "yearly": {"labels": years, "states": y_states, "population_thousand": y_pop, "national": [nat.get(k) for k in years], "national_label": "Malaysia (national total)",
                       "note": "Yearly state figures cover 2009 to 2018 and 2023; 2019 to 2022 are missing by state in this source. Selangor's 2017 and 2018 values are identical in the source, which may be an error there."},
            "models": models,
        },
        "flu": {
            "source": "WHO FluNet (national sentinel laboratories)",
            "weekly": {"labels": [f"{s['year']}-W{s['week']:02d}" for s in flu], "national": [round(100 * s["pos"] / s["n"], 1) for s in flu],
                       "national_label": "Malaysia: % of sentinel samples positive"},
            "snapshots": FLU_SNAPSHOTS,
            "note": "No state-by-state influenza series is published in Malaysia, because influenza is not a notifiable disease. The only state figures are occasional snapshots in Ministry of Health statements, listed below.",
        },
    }
    c.dump(out, c.ROOT / "site" / "data" / "states.json")
    c.dump({"models": models}, c.ROOT / "outputs" / "state_models.json")
    print("monthly:", len(labels), "months,", len(m_states), "states | yearly:", years[0], "-", years[-1], len(y_states), "states")
    for m in models:
        print(f"{m['state']:26s} {m['months']:3d} months, test {m['test_start']}..{m['test_end']} |", " | ".join(
            f"+{r['months_ahead']}m last {r['mae']['last_value']} ridge {r['mae']['ridge']} gbm {r['mae']['gradient_boosted']} best {r['best']} ({r['gain_vs_last_value_pct']}%)" for r in m["results"]))


if __name__ == "__main__":
    main()
