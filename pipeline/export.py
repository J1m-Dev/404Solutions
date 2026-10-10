"""Write everything the static site reads: site/data/site.json, map data, templates, demo files."""
import csv
import json

import numpy as np

import core as c

SITE = c.ROOT / "site"
REPLAY_CUT = (2025, 37)  # replay demo: public data ends here, later weeks arrive by upload
DISTRICTS = {"Gombak": "Gombak", "Klang": "Klang", "Kuala Langat": "Kuala Langat",
             "Kuala Selangor": "Kuala Selangor", "Petaling": "Petaling", "Sabak Bernam": "Sabak Bernam",
             "Sepang": "Sepang", "Ulu Langat": "Hulu Langat", "Ulu Selangor": "Hulu Selangor"}
# Government hospitals in Selangor (names as tagged in OpenStreetMap). Beds are SIMULATED placeholders.
HOSPITALS = {"Hospital Tengku Ampuan Rahimah": 60, "Hospital Selayang": 50, "Hospital Sungai Buloh": 60,
             "Hospital Sultan Idris Shah Serdang": 50, "Hospital Ampang": 45, "Hospital Shah Alam": 40,
             "Hospital Kajang": 35, "Hospital Banting": 20, "Hospital Kuala Kubu Bharu": 15,
             "Hospital Tanjong Karang": 15, "Hospital Tengku Ampuan Jemaah": 15, "Hospital Cyberjaya": 30}
# Cumulative influenza cases to epi week 42/2025, Selangor State Assembly answer (Nov 2025)
PUBLISHED_DISTRICT_CASES = {"Petaling": 534, "Hulu Langat": 487, "Gombak": 341, "Klang": 291}


def model_set(series, t):
    y, p, n, wk, yr = c.arrays(series)
    out = {}
    for h in c.HORIZONS:
        beta, q, qp = c.fit(y, n, wk, t, h)
        out[str(h)] = {"beta": [round(float(b), 6) for b in beta],
                       "q": [round(float(v), 4) for v in q], "qp": [round(float(v), 4) for v in qp]}
    return out


def levels(series, first, last, th, lag=0):
    y, p, n, wk, yr = c.arrays(series)
    out = {}
    for t in range(first, last + 1):
        ahead = [c.inv(c.predict(c.fit(y, n, wk, t, h)[0], y, t, wk[t], h)) for h in c.ahead_horizons(lag)]
        if lag == 0:
            ahead = [p[t]] + ahead
        out[t] = c.alert_level(p[t], ahead, th)
    return out


def stress(series, split, th):
    rng = np.random.default_rng(7)
    base = levels(series, split, len(series) - 1, th)
    res = []
    for name in ("half the samples", "10% of weeks missing", "both"):
        agree = []
        for _ in range(20):
            s2 = [dict(s) for s in series]
            if name != "10% of weeks missing":
                for s in s2:
                    k = int(s["n"] // 2)
                    s["pos"] = float(rng.hypergeometric(int(s["pos"]), int(s["n"] - s["pos"]), k))
                    s["n"] = float(k)
            if name != "half the samples":
                for i in range(5, len(s2)):
                    if rng.random() < 0.10:
                        s2[i]["n"], s2[i]["pos"] = s2[i - 1]["n"], s2[i - 1]["pos"]
            lv = levels(s2, split, len(series) - 1, th)
            hi = lambda x: x in ("orange", "red")
            agree.append(np.mean([hi(lv[t]) == hi(base[t]) for t in base]))
        res.append({"test": name, "runs": 20, "high_alert_agreement": round(float(np.mean(agree)), 3),
                    "worst_run": round(float(np.min(agree)), 3)})
    return res


def main():
    series = c.load_series()
    N = len(series)
    split = int(N * c.TRAIN_SHARE)
    y, p, n, wk, yr = c.arrays(series)
    th = c.thresholds(p[:split])
    cut = next(i for i, s in enumerate(series) if (s["year"], s["week"]) == REPLAY_CUT)
    val = json.loads((c.ROOT / "outputs" / "validation.json").read_text())
    lv0 = levels(series, split, N - 1, th)
    cross = next(i for i in range(split, N) if p[i] > th["orange"])
    first_yellow = next(t for t in range(cross - 8, cross + 1) if lv0[t] != "green")
    val["stress"] = stress(series, split, th)
    val["descriptive_after_scoring"] = {
        "note": "Looked at after the test was scored; not a pre-registered result.",
        "first_non_green_week_before_2025_surge": f"{series[first_yellow]['year']}-W{series[first_yellow]['week']:02d}",
        "weeks_before_orange_crossing": cross - first_yellow}
    c.dump(val, c.ROOT / "outputs" / "validation.json")

    site = {"generated": "2026-10-10", "source": "WHO FluNet, Malaysia sentinel surveillance",
            "pub_lag": c.PUB_LAG, "n_lags": c.N_LAGS, "n_harm": c.N_HARM, "thresholds": th,
            "series": series, "replay_cut_index": cut,
            "models": {"current": model_set(series, N - 1), "replay": model_set(series, cut)},
            "validation": val}
    c.dump(site, SITE / "data" / "site.json")

    # map: Selangor districts with latest population (thousands)
    pop = {}
    for r in csv.DictReader(open(c.ROOT / "data/raw/population_district.csv", encoding="utf-8")):
        if r["state"] == "Selangor" and r["sex"] == "both" and r["age"] == "overall" and r["ethnicity"] == "overall":
            pop[r["district"]] = (r["date"], float(r["population"]))
    g = json.load(open(c.ROOT / "data/raw/mys_adm2.geojson", encoding="utf-8"))
    feats = []
    for f in g["features"]:
        nm = DISTRICTS.get(f["properties"]["shapeName"])
        if nm:
            d = pop.get(nm) or pop.get(f["properties"]["shapeName"]) or (None, None)
            f["properties"] = {"name": nm, "pop_thousand": d[1], "pop_date": d[0],
                               "published_cases_w42_2025": PUBLISHED_DISTRICT_CASES.get(nm)}
            feats.append(f)
    c.dump({"type": "FeatureCollection", "features": feats}, SITE / "data" / "districts.geojson")
    osm = json.load(open(c.ROOT / "data/raw/osm_hospitals_selangor.json", encoding="utf-8"))
    hosp = []
    for e in osm["elements"]:
        nm = e.get("tags", {}).get("name", "")
        key = next((k for k in HOSPITALS if nm.startswith(k)), None)
        if key and not any(h["name"] == key for h in hosp):
            hosp.append({"name": key, "lat": e.get("lat") or e["center"]["lat"], "lon": e.get("lon") or e["center"]["lon"],
                         "beds_simulated": HOSPITALS[key]})
    c.dump(hosp, SITE / "data" / "hospitals.json")
    print("districts", [(f["properties"]["name"], f["properties"]["pop_thousand"]) for f in feats])
    print("hospitals", len(hosp), sorted(set(HOSPITALS) - {h["name"] for h in hosp}))

    # templates and demo files
    T = SITE / "templates"
    T.mkdir(exist_ok=True)
    w = lambda name, rows: csv.writer(open(T / name, "w", newline="", encoding="utf-8")).writerows(rows)
    lab_head = ["year", "week", "samples_tested", "influenza_positive", "a_h3", "a_h1n1", "b"]
    w("template_lab_counts.csv", [lab_head, [2026, 38, 900, 150, 30, 60, 60]])
    w("template_ili_rate.csv", [["year", "week", "ili_rate_percent"], [2026, 38, 6.5]])
    w("template_clusters.csv", [["year", "week", "district", "clusters"], [2026, 38, "Petaling", 3]])
    w("template_beds.csv", [["hospital", "beds_available"]] + [[h["name"], h["beds_simulated"]] for h in hosp])
    w("demo_real_replay_2025_W38_W41.csv", [lab_head] + [
        [s["year"], s["week"], int(s["n"]), int(s["pos"]), int(s["h3"]), int(s["h1"]), int(s["b"])]
        for s in series[cut + 1: cut + 5]])
    w("demo_SIMULATED_bad_file.csv", [lab_head, [2025, 38, 120, 40, 30, 5, 5]])
    print("replay cut", series[cut]["start"], "p=", round(p[cut], 1), "| stress", val["stress"], val["descriptive_after_scoring"])


if __name__ == "__main__":
    main()
