"""State-by-state series for the "All states" chart and heat map, and the same model comparison per state.

Dengue by state
  yearly  1999-2017  Mendeley Data "Dengue Statistics in Malaysia, per state" (CC BY 4.0)
          2018-2021  Ministry of Health file on the archived national open-data portal (CC BY), summed over age groups
          2022       Peninsular states only, summed from a weekly district file (source undocumented; matches MOH totals)
          2023       OpenDengue V1.3
  monthly 1993-2010  OpenDengue V1.3 (ten states)
  weekly  Feb 2010-Apr 2015 and Dec 2019-Aug 2022 (all states), continued to Dec 2024 for Peninsular states.
          These weekly files carry no stated source or licence. They are used because their yearly sums agree
          with official totals; the site says so.
Influenza by state: no series exists. Only Ministry of Health cluster counts for a few weeks of 2025.

The three weekly files are not committed, because they carry no licence. `py -3.13 states.py fetch` downloads
every file listed in SOURCES into data/raw/states/ again.

Models: per state, split by date 70/30 and compare "same as last period", the same-period average, ridge
regression and gradient boosting, with the settings used everywhere else. Nothing is tuned per state.
"""
import csv
import datetime as dt
import json
import math

import numpy as np
import openpyxl
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import core as c
import dengue as dg

OD = c.ROOT / "data/raw/opendengue"
SD = c.ROOT / "data/raw/states"
SOURCES = {  # local file name: where it was downloaded from (10 Oct 2026)
    "mendeley_dengue_state_1999_2019.xlsx": "https://data.mendeley.com/public-files/datasets/r3k8rxg2cw/files/8c27e41d-8c5d-4f9a-9021-99185867320b/file_downloaded",
    "adg_dengue_state_age_2018_2021.csv": "https://archive.data.gov.my/data/dataset/b36d588f-ced4-4c16-ba9a-021e9bf38ae5/resource/216eb37a-d676-4c53-9f54-878e91a98e47/download/_202301090525170_bilangan-kes-penyakit-denggi-tahunan-mengikut-negeri-dan-kumpulan-umur.csv",
    "weekly_state_2010_2015.csv": "https://raw.githubusercontent.com/owenwooooooo/malaysian-dengue-predictor/HEAD/data/kaggle_dengue_old.csv",
    "weekly_state_2020_2022.csv": "https://raw.githubusercontent.com/owenwooooooo/malaysian-dengue-predictor/HEAD/data/kaggle_dengue.csv",
    "district_weekly_2022_2024.csv": "https://raw.githubusercontent.com/afiqamsyar90/Spatial-Dengue-2026/HEAD/data.csv",
}


def fetch():
    import urllib.request
    SD.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        (SD / name).write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "FluSentinel student project"}), timeout=120).read())
        print("downloaded", name)
H = (1, 2, 3)
ALIASES = {"W.P. KUALA LUMPUR": "Kuala Lumpur", "KUALA LUMPUR": "Kuala Lumpur", "WPKL/PUTRAJAYA": "Kuala Lumpur", "WP KUALA LUMPUR": "Kuala Lumpur",
           "WPKL_PUTRAJAYA": "Kuala Lumpur", "KUALALUMPUR": "Kuala Lumpur", "W.P. LABUAN": "Labuan", "WP LABUAN": "Labuan", "WP_LABUAN": "Labuan",
           "PULAU PINANG": "Pulau Pinang", "P_PINANG": "Pulau Pinang", "PULAUPINANG": "Pulau Pinang", "NEGERI SEMBILAN": "Negeri Sembilan",
           "N.SEMBILAN": "Negeri Sembilan", "N_SEMBILAN": "Negeri Sembilan", "NEGERISEMBILAN": "Negeri Sembilan", "TRENGGANU": "Terengganu"}
nice = lambda n: ALIASES.get(n.strip().upper(), n.strip().title())

# Influenza clusters by state from Ministry of Health statements (7 and 14 Nov 2025; week 40 from the 9 Oct 2025
# statement as reported by Bernama, which named only the five highest states for each measure).
FLU_STATES = {  # state: (week 43, week 44, week 45, cumulative to week 45)
    "Selangor": (22, 21, 27, 313), "Kuala Lumpur and Putrajaya": (2, 7, 4, 148), "Johor": (0, 3, 6, 87), "Pulau Pinang": (0, 1, 1, 66),
    "Perak": (2, 3, 2, 59), "Kedah": (0, 3, 2, 58), "Negeri Sembilan": (1, 0, 2, 45), "Kelantan": (1, 1, 1, 23), "Sarawak": (1, 2, 1, 21),
    "Pahang": (1, 0, 0, 18), "Terengganu": (0, 0, 0, 8), "Melaka": (0, 0, 0, 7), "Sabah": (0, 2, 0, 6), "Perlis": (0, 0, 0, 4), "Labuan": (0, 0, 0, 3)}
# National cluster totals from the same statements (Bernama, 9 Oct and 14 Nov 2025). Weeks 43 to 45 equal the sum of the states.
FLU_NATIONAL = {"w39": 14, "w40": 97, "w43": 30, "w44": 43, "w45": 46}
FLU_WEEK40 = {"Selangor": (43, 14.63), "Kuala Lumpur and Putrajaya": (15, 11.62), "Pulau Pinang": (10, 12.49), "Johor": (9, None), "Kedah": (5, None),
              "Melaka": (None, 12.49), "Sabah": (None, 8.73)}


def feats(y, i, month):
    f = [y[i], y[i] - y[i - 1], y[i - 1] - y[i - 2], y[i] - y[i - 3], y[i] - float(np.mean(y[i - 5:i + 1]))]
    for k in (1, 2):
        a = 2 * math.pi * k * month / 12
        f += [math.sin(a), math.cos(a)]
    return f


def evaluate(months, values):
    """Monthly series: per-horizon errors on the latest 30%, and a three-month projection."""
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


def yearly_by_state():
    """Merged yearly table: {state: {year: (cases, source)}}. Later sources in this function override earlier ones."""
    out = {}
    put = lambda s, y, v, src: out.setdefault(s, {}).__setitem__(y, (float(v), src))
    for r in csv.DictReader(open(OD / "mys_states.csv", encoding="utf-8")):
        if r["T_res"] == "Year":
            put(nice(r["adm_1_name"]), int(r["Year"]), r["dengue_total"], "OpenDengue")
    ws = openpyxl.load_workbook(SD / "mendeley_dengue_state_1999_2019.xlsx", data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hdr = next(i for i, r in enumerate(rows) if r[0] == "TAHUN")
    years = [v for v in rows[hdr][1:] if isinstance(v, (int, float))]
    for r in rows[hdr + 2:]:
        if not r[0] or str(r[0]).strip().upper() == "MALAYSIA":
            break
        for yv, v in zip(years, r[1:]):
            if isinstance(v, (int, float)):
                put(nice(str(r[0])), int(yv), v, "Mendeley Data")
    a = list(csv.reader(open(SD / "adg_dengue_state_age_2018_2021.csv", encoding="utf-8-sig")))
    tot = {}
    for r in a[1:]:
        for name, v in zip(a[0][2:], r[2:]):
            tot[(nice(name), int(r[0]))] = tot.get((nice(name), int(r[0])), 0) + float(v or 0)
    for (s, yv), v in tot.items():
        put(s, yv, v, "Ministry of Health open data")
    return out


def weekly_by_state():
    """{state: {week_start_date: cases}} from the three weekly files, plus the 2022 yearly sums from the district file."""
    wk, y2022 = {}, {}
    for name, fmt in (("weekly_state_2010_2015.csv", "%d/%m/%Y"), ("weekly_state_2020_2022.csv", "%Y-%m-%d")):
        rows = list(csv.reader(open(SD / name, encoding="utf-8-sig")))
        body = [r for r in rows[1:] if any(float(str(v).replace(",", "") or 0) for v in r[1:])]  # the first file ends with rows of zeros that are not data
        for r in body:
            d = dt.datetime.strptime(r[0], fmt).date()
            d -= dt.timedelta(days=(d.weekday() + 1) % 7)  # move to the Sunday that starts the epidemiological week
            for s, v in zip(rows[0][1:], r[1:]):
                wk.setdefault(nice(s), {})[d] = float(str(v).replace(",", "") or 0)
    agg = {}
    for r in csv.DictReader(open(SD / "district_weekly_2022_2024.csv", encoding="utf-8-sig")):
        if r["Cases"] in ("", "NA"):
            continue
        d = dt.datetime.strptime(r["week_start"], "%d/%m/%Y").date()
        d -= dt.timedelta(days=(d.weekday() + 1) % 7)
        s = "Kuala Lumpur" if r["State"] == "Putrajaya" else nice(r["State"])  # the other files count Putrajaya with Kuala Lumpur
        agg[(s, d)] = agg.get((s, d), 0) + float(r["Cases"])
        if r["year"] == "2022" and r["State"] != "Putrajaya":
            y2022[nice(r["State"])] = y2022.get(nice(r["State"]), 0) + float(r["Cases"])
    overlap = [(wk[s][d], v) for (s, d), v in agg.items() if d in wk.get(s, {})]
    same = sum(abs(a - b) < 0.5 for a, b in overlap)
    for (s, d), v in agg.items():
        wk.setdefault(s, {}).setdefault(d, v)  # keep the earlier file where the two overlap
    return wk, y2022, (same, len(overlap))


def main():
    monthly = {}
    for r in csv.DictReader(open(OD / "mys_states.csv", encoding="utf-8")):
        if r["T_res"] == "Month":
            d = dt.date.fromisoformat(r["calendar_start_date"])
            monthly.setdefault(nice(r["adm_1_name"]), {})[(d.year, d.month)] = float(r["dengue_total"])
    keys = sorted({k for v in monthly.values() for k in v})
    labels = ["%d-%02d" % k for k in keys]
    m_states = {s: [v.get(k) for k in keys] for s, v in sorted(monthly.items())}
    m_total = [sum(v[i] for v in m_states.values() if v[i] is not None) for i in range(len(keys))]
    m_count = [sum(v[i] is not None for v in m_states.values()) for i in range(len(keys))]

    # ---- yearly ----
    yb = yearly_by_state()
    wk, y2022, overlap = weekly_by_state()
    for s, v in y2022.items():
        yb.setdefault(s, {})[2022] = (v, "weekly district file (Peninsular states only)")
    years = list(range(1999, 2024))
    y_states = {s: [yb[s].get(k, (None,))[0] for k in years] for s in sorted(yb)}
    y_src = {s: [yb[s].get(k, (None, None))[1] for k in years] for s in sorted(yb)}
    nat = {}
    for r in csv.DictReader(open(OD / "National_extract_V1_3.csv", encoding="utf-8-sig")):
        if r["ISO_A0"] == "MYS" and r["T_res"] == "Year":
            nat[int(r["Year"])] = float(r["dengue_total"])
    wkn = {}
    for r in csv.DictReader(open(OD / "mys_weekly_national.csv", encoding="utf-8")):
        wkn.setdefault(int(r["calendar_start_date"][:4]), []).append(float(r["dengue_total"]))
    for yy, v in wkn.items():
        if yy not in nat and len(v) >= 51:
            nat[yy] = sum(v)
    for i, k in enumerate(years):  # where every state has a figure, the national line is their sum
        vals = [y_states[s][i] for s in y_states]
        if k not in nat and all(v is not None for v in vals):
            nat[k] = sum(vals)

    pop_name = {"W.P. Kuala Lumpur": "Kuala Lumpur", "W.P. Labuan": "Labuan", "W.P. Putrajaya": "Putrajaya"}
    pop = {}
    for r in csv.DictReader(open(c.ROOT / "data/raw/population_state_overall.csv", encoding="utf-8")):
        pop.setdefault(pop_name.get(r["state"], r["state"]), {})[int(r["year"])] = float(r["population_thousand"])
    # the dengue figure for Kuala Lumpur includes Putrajaya, so its population does too
    y_pop = {s: [(pop.get(s, {}).get(k) or 0) + ((pop.get("Putrajaya", {}).get(k) or 0) if s == "Kuala Lumpur" else 0) or None for k in years] for s in y_states}

    geo_name = {"Malacca": "Melaka", "Penang": "Pulau Pinang"}
    g = json.load(open(c.ROOT / "data/raw/mys_adm1.geojson", encoding="utf-8"))

    def rnd(x):
        return [rnd(v) for v in x] if isinstance(x, list) else round(x, 3)
    for f in g["features"]:
        f["properties"] = {"name": geo_name.get(f["properties"]["shapeName"], f["properties"]["shapeName"])}
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    (c.ROOT / "site" / "data" / "states_map.geojson").write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")

    # ---- weekly ----
    dates = sorted({d for v in wk.values() for d in v})
    w_states = {s: [wk[s].get(d) for d in dates] for s in sorted(wk)}
    natw = {}
    for r in csv.DictReader(open(OD / "mys_weekly_national.csv", encoding="utf-8")):
        natw[dt.date.fromisoformat(r["calendar_start_date"])] = float(r["dengue_total"])
    for r in csv.DictReader(open(c.ROOT / "data/raw/who_dengue/mys_weekly_2023_2026.csv", encoding="utf-8")):
        if r["cases"]:
            natw[dt.date.fromisoformat(r["start"])] = float(r["cases"])
    w_nat = [next((natw[d + dt.timedelta(days=k)] for k in (0, -1, 1, -2, 2, -3, 3) if d + dt.timedelta(days=k) in natw), None) for d in dates]

    # ---- models ----
    models = []
    for s, v in sorted(monthly.items()):
        ks = sorted(v)
        if len(ks) >= 100 and not any((b[0] * 12 + b[1]) - (a[0] * 12 + a[1]) != 1 for a, b in zip(ks, ks[1:])):
            models.append({"state": s, **evaluate(ks, [v[k] for k in ks])})
    full = [i for i, n_ in enumerate(m_count) if n_ == max(m_count)]
    models.append({"state": "All ten states together", **evaluate(keys[full[0]:full[-1] + 1], m_total[full[0]:full[-1] + 1])})

    w_models = []
    for s in sorted(wk):
        rows = dg.prep([{"start": d, "cases": v} for d, v in sorted(wk[s].items())])
        if sum(r["cases"] for r in rows) / len(rows) < 3:
            w_models.append({"state": s, "weeks": len(rows), "skipped": "too few cases to model (under 3 a week on average)"})
            continue
        tag = "state_" + s.replace(" ", "_")
        res = dg.main(rows, tag, "state weekly", None)
        (c.ROOT / "outputs" / f"dengue_{tag}.json").unlink(missing_ok=True)
        w_models.append({"state": s, "weeks": len(rows), "train_end": res["train_end"], "test_start": res["test_start"], "test_end": res["test_end"],
                         "results": [{"weeks_ahead": f["weeks_ahead"], "n_test": f["n_test"], "mean_actual": f["mean_actual"], "mae": f["mae"], "best": f["best"],
                                      "gain_vs_last_value_pct": round(100 * (1 - f["mae"][f["best"]] / f["mae"]["last_value"]), 1) if f["mae"]["last_value"] else None} for f in res["forecast"]]})

    for k in ("w43", "w44", "w45"):
        assert sum(v[("w43", "w44", "w45").index(k)] for v in FLU_STATES.values()) == FLU_NATIONAL[k], k
    flu = c.load_series()
    blank = {"w43": None, "w44": None, "w45": None, "cumulative_w45": None}
    flu_states = {s: {"w43": v[0], "w44": v[1], "w45": v[2], "cumulative_w45": v[3], "w40": FLU_WEEK40.get(s, (None, None))[0], "ili_w40": FLU_WEEK40.get(s, (None, None))[1]}
                  for s, v in FLU_STATES.items()}
    for s, v in FLU_WEEK40.items():
        flu_states.setdefault(s, {**blank, "w40": v[0], "ili_w40": v[1]})
    out = {
        "dengue": {
            "source": "Ministry of Health figures as compiled by OpenDengue V1.3, Mendeley Data, the archived national open-data portal, and community-shared weekly files",
            "monthly": {"labels": labels, "states": m_states, "national": m_total, "national_label": "Sum of the states that reported that month",
                        "note": "Monthly state figures exist for ten states and end in December 2010 (OpenDengue)."},
            "yearly": {"labels": years, "states": y_states, "sources": y_src, "population_thousand": y_pop, "national": [nat.get(k) for k in years],
                       "national_label": "Malaysia (national total)",
                       "note": "1999 to 2017 from Mendeley Data, 2018 to 2021 from the Ministry of Health's open data, 2023 from OpenDengue. For 2022 only Peninsular states are available, from a weekly district file whose source is not documented; Sabah, Sarawak and Labuan are blank that year. Kuala Lumpur includes Putrajaya."},
            "weekly": {"labels": [str(d) for d in dates], "states": w_states, "national": w_nat, "national_label": "Malaysia (national weekly series)",
                       "note": "Weekly state figures cover February 2010 to April 2015 and December 2019 to August 2022 for all states, continuing to December 2024 for Peninsular states. These files were shared online without a stated source or licence; we use them because their yearly sums agree with official totals. The gap from 2015 to 2019 is real: nothing weekly by state was found for those years. Kuala Lumpur includes Putrajaya."},
            "models": models, "weekly_models": w_models,
        },
        "flu": {
            "source": "WHO FluNet (national) and Ministry of Health statements (state clusters)",
            "weekly": {"labels": [f"{s['year']}-W{s['week']:02d}" for s in flu], "national": [round(100 * s["pos"] / s["n"], 1) for s in flu],
                       "national_label": "Malaysia: % of sentinel samples positive"},
            "states": flu_states, "clusters_national": FLU_NATIONAL,
            "note": "No state-by-state influenza series is published in Malaysia, because influenza is not a notifiable disease. The only state figures are cluster counts in Ministry of Health statements during the 2025 surge: all states for weeks 43 to 45, and the five highest for week 40.",
        },
    }
    c.dump(out, c.ROOT / "site" / "data" / "states.json")
    c.dump({"monthly": models, "weekly": w_models}, c.ROOT / "outputs" / "state_models.json")

    print("yearly:", years[0], "-", years[-1], len(y_states), "states | weekly:", dates[0], "to", dates[-1], len(dates), "weeks")
    print("weekly overlap between the two 2022 files: identical in", overlap[0], "of", overlap[1], "state-weeks")
    for yy in (2011, 2013, 2014, 2020, 2021, 2022):
        sw = sum(v for s in wk for d, v in wk[s].items() if d.year == yy)
        sy = sum(yb[s][yy][0] for s in yb if yy in yb[s])
        print(f"  check {yy}: weekly files sum {int(sw)}, yearly table sum {int(sy)}, national {int(nat.get(yy, 0))}")
    od = {(nice(r["adm_1_name"]), int(r["Year"])): float(r["dengue_total"]) for r in csv.DictReader(open(OD / "mys_states.csv", encoding="utf-8")) if r["T_res"] == "Year"}
    diffs = [(s, k, int(v), int(yb[s][k][0])) for (s, k), v in od.items() if k in yb.get(s, {}) and yb[s][k][1] != "OpenDengue" and abs(v - yb[s][k][0]) > 0.02 * max(v, 1)]
    print("  OpenDengue yearly values that differ by over 2% from the replacement:", len(diffs), diffs[:8])
    for m in w_models:
        print(f"{m['state']:16s}", m.get("skipped") or (f"{m['weeks']} wks, test {m['test_start']}..{m['test_end']} | " + " | ".join(f"+{r['weeks_ahead']}w {r['best']} {r['gain_vs_last_value_pct']}%" for r in m["results"])))


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["fetch"]:
        fetch()
    main()
