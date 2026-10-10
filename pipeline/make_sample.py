"""Write SIMULATED 500-week sample files in the upload format (lab counts and ILI rate).

Weeks start right after the newest public FluNet week, because lab uploads must continue the series.
The numbers are invented for testing the upload; they are not forecasts or real data.
"""
import csv
import math

import numpy as np

import core as c

rng = np.random.default_rng(2026)
last = c.load_series()[-1]
year, week = last["year"], last["week"]
lab, ili, level = [], [], 0.18
for i in range(500):
    week += 1
    if week > 52:
        year, week = year + 1, 1
    season = 0.10 + 0.05 * math.sin(2 * math.pi * (week - 20) / 52) + 0.04 * math.sin(2 * math.pi * i / 137)
    level = min(0.45, max(0.01, 0.9 * level + 0.1 * season + rng.normal(0, 0.012) + (0.06 if rng.random() < 0.02 else 0)))
    n = int(rng.normal(900, 35))
    pos = int(rng.binomial(n, level))
    mix = rng.dirichlet([3 + 4 * math.sin(i / 40) ** 2, 2 + 3 * math.cos(i / 55) ** 2, 2 + 3 * math.sin(i / 70 + 1) ** 2])
    h3, h1 = int(pos * mix[0]), int(pos * mix[1])
    lab.append([year, week, n, pos, h3, h1, pos - h3 - h1])
    ili.append([year, week, round(float(3.5 + 18 * level + rng.normal(0, 0.3)), 1)])
T = c.ROOT / "site" / "templates"
w = lambda name, head, rows: csv.writer(open(T / name, "w", newline="", encoding="utf-8")).writerows([head] + rows)
w("sample_SIMULATED_500_weeks_lab_counts.csv", ["year", "week", "samples_tested", "influenza_positive", "a_h3", "a_h1n1", "b"], lab)
w("sample_SIMULATED_500_weeks_ili_rate.csv", ["year", "week", "ili_rate_percent"], ili)
p = [100 * r[3] / r[2] for r in lab]
print(len(lab), "weeks", lab[0][:2], "to", lab[-1][:2], "| positivity min/median/max", round(min(p), 1), round(float(np.median(p)), 1), round(max(p), 1))

# SIMULATED cluster list for the map hotspots: invented clusters placed near real clinic locations.
import json

clinics = [f for f in json.loads((c.ROOT / "site/data/facilities.json").read_text(encoding="utf-8")) if f["kind"] == "clinic"]
weight = {"Petaling": 8, "Hulu Langat": 6, "Gombak": 5, "Klang": 4, "Sepang": 2, "Kuala Langat": 1, "Kuala Selangor": 1, "Hulu Selangor": 1, "Sabak Bernam": 0.5}
pw = np.array([weight.get(f["district"], 1) for f in clinics]); pw = pw / pw.sum()
settings = ["Secondary school", "Primary school", "Kindergarten", "School hostel", "Private home"]
clusters = []
for i in range(28):
    f = clinics[int(rng.choice(len(clinics), p=pw))]
    cases = int(min(160, max(4, rng.lognormal(2.9, 0.8))))
    clusters.append([f"Simulated cluster {i + 1:02d}", f["district"], cases, settings[int(rng.integers(len(settings)))],
                     round(f["lat"] + float(rng.normal(0, 0.012)), 5), round(f["lon"] + float(rng.normal(0, 0.012)), 5)])
head = ["name", "district", "cases", "setting", "lat", "lon"]
w("demo_SIMULATED_cluster_list.csv", head, clusters)
w("template_cluster_list.csv", head, [["Example school", "Petaling", 25, "Secondary school", 3.0738, 101.5183]])
print(len(clusters), "simulated clusters; largest", max(r[2] for r in clusters))

# A short own-network series (the first 20 simulated weeks) to show the "uncalibrated" state.
w("demo_SIMULATED_own_series_20_weeks.csv", ["year", "week", "samples_tested", "influenza_positive", "a_h3", "a_h1n1", "b"], lab[:20])
