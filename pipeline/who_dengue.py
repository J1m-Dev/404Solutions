"""Rebuild Malaysia's weekly dengue counts for 2023 onward from WHO Western Pacific Dengue Situation Updates.

No dataset exists for these years. WHO publishes a fortnightly PDF; each one states, in a sentence, the
number of cases in the latest reported week, the week before, and the running total for the year.

    py who_dengue.py fetch     download the PDFs listed in WHO's library (IRIS) for each year
    py who_dengue.py parse     read the Malaysia sentences out of every PDF
    py who_dengue.py build     assemble a weekly series and check it against the running totals

Every figure keeps the name of the report it came from. Nothing is read from charts.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request

import core as c

DIR = c.ROOT / "data" / "raw" / "who_dengue"
HANDLES = {2023: "10665/365676", 2024: "10665/375485", 2025: "10665/380305", 2026: "10665/384752"}
API = "https://iris.who.int/server/api"
UA = {"User-Agent": "Mozilla/5.0 (student research project; FluSentinel)", "Accept": "application/json"}


def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read() if binary else json.loads(r.read().decode("utf-8"))


def fetch():
    listing = []
    for year, handle in HANDLES.items():
        item = get(f"{API}/pid/find?id={handle}")
        bundles = get(f"{API}/core/items/{item['uuid']}/bundles")["_embedded"]["bundles"]
        orig = next(b for b in bundles if b["name"] == "ORIGINAL")
        page, files = 0, []
        while True:
            d = get(f"{API}/core/bundles/{orig['uuid']}/bitstreams?page={page}&size=100")
            files += d["_embedded"]["bitstreams"]
            if page + 1 >= d["page"]["totalPages"]:
                break
            page += 1
        (DIR / str(year)).mkdir(parents=True, exist_ok=True)
        for f in files:
            path = DIR / str(year) / re.sub(r"[^A-Za-z0-9._-]", "_", f["name"])
            listing.append({"year": year, "name": f["name"], "file": str(path.relative_to(DIR)), "size": f["sizeBytes"]})
            if not path.exists() and f["name"].lower().endswith(".pdf"):
                path.write_bytes(get(f"{API}/core/bitstreams/{f['uuid']}/content", binary=True))
                time.sleep(0.4)
        print(year, len(files), "files listed")
    (DIR / "listing.json").write_text(json.dumps(listing, indent=1))


def text_of(path):
    return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, encoding="utf-8", errors="ignore").stdout


NUM = r"(\d{1,3}(?:[ ,]\d{3})+|\d+)"
num = lambda x: int(re.sub(r"[ ,]", "", x))
# The sentence wording changed several times between 2023 and 2026. Each pattern captures: this week's
# cases, and where stated the previous week's cases. Tried in order; the first that matches is used.
CASES = [
    rf"was reported with {NUM}(?: cases)? (?:as )?compared to {NUM} cases reported in the previous week",
    rf"in week \d+ \(n={NUM} cases\) compared to week \d+ \(n={NUM} cases\)",
    rf"there were {NUM}(?: dengue)?(?: cases)?,? compared to {NUM}(?: cases)? in the (?:previous week|epidemiological week \d+)",
    rf"(?:there were )?{NUM} dengue cases(?: and \d+ deaths?)?(?: were)? reported\. This is an? (?:increase|decrease) compared to the {NUM} cases reported in the previous week",
    rf"a total of {NUM} cases were reported, an? (?:increase|decrease) compared to ?{NUM} cases in week \d+",
    rf"{NUM} new dengue(?: cases)?[^.]{{0,80}}? an? (?:increase|decrease) from {NUM} cases in week \d+",
]
CUM = [
    rf"cumulative number of dengue cases reported [^.]{{0,70}}? is {NUM}",
    rf"cumulative number of dengue cases reported up to week \d+ of \d{{4}} is {NUM}",
    rf"cumulative year-? ?to-date number of dengue cases(?: reported)? as of week \d+ is {NUM}",
    rf"cumulative number of dengue cases reported to date is {NUM}",
    rf"a total of {NUM} cases were cumulatively reported",
    rf"Cumulatively, (?:a total of )?{NUM} cases",
]


def parse():
    out, failed = [], []
    for path in sorted(DIR.glob("20*/*.pdf")):
        text = re.sub(r"\s+", " ", text_of(path).replace("–", "-"))
        text = re.sub(r"Dengue Situation Update \d+ ?\d* ", "", text)  # page footers that land mid-sentence
        m = re.search(r"Malaysia ?(?:\(Monthly update\) )?(There (?:is|was|are|have been) no (?:further )?updates? (?:for|in|since) (?:this reporting period|the previous report)\. )?((?:During|In) epidemiological week ?(\d+)(?: of (\d{4}))?(?: \(([^)]*)\))?.{0,900})", text)
        rep = {"report": path.name, "report_date": re.search(r"(\d{8})", path.name).group(1)}
        if not m:
            failed.append({**rep, "why": "no Malaysia sentence found"})
            continue
        para, week = m.group(2), int(m.group(3))
        ry = int(rep["report_date"][:4])
        year = int(m.group(4)) if m.group(4) else None
        if year is None and m.group(5):
            ys = re.findall(r"(20\d{2})", m.group(5))
            year = int(ys[-1]) if ys else None
            if year and week >= 52 and re.search(r"Dec", m.group(5)) and re.search(r"Jan", m.group(5)):
                year -= 1
        if year is None:
            year = ry - 1 if (week >= 45 and rep["report_date"][4:6] in ("01", "02")) else ry
        cs = next((re.search(pt, para, re.I) for pt in CASES if re.search(pt, para, re.I)), None)
        cm = next((re.search(pt, para, re.I) for pt in CUM if re.search(pt, para, re.I)), None)
        if not cs:
            failed.append({**rep, "why": "case sentence not recognised", "text": para[:260]})
            continue
        # cumulative totals in early-January reports can refer to the year that just ended
        cum_year = year
        cy = re.search(r"epidemiological weeks 1 ?-? ?\d+ of (\d{4}), a total of", para)
        if cy:
            cum_year = int(cy.group(1))
        out.append({**rep, "no_update": bool(m.group(1)), "year": year, "week": week, "cases": num(cs.group(1)), "previous_week_cases": num(cs.group(2)),
                    "cumulative": num(cm.group(1)) if cm else None, "cumulative_year": cum_year, "sentence": para[:300]})
    (DIR / "parsed.json").write_text(json.dumps({"parsed": out, "failed": failed}, indent=1), encoding="utf-8")
    print(len(out), "reports read,", len(failed), "not read")
    print("fresh reports:", sum(not r["no_update"] for r in out), "| repeats of an earlier week:", sum(r["no_update"] for r in out), "| without a running total:", sum(r["cumulative"] is None for r in out))
    for f in failed:
        print("FAILED", f["report"], f["why"], f.get("text", "")[:200])


# Malaysia's epidemiological weeks run Sunday to Saturday. First day of week 1, and weeks in the year,
# read off the date ranges printed in the reports.
WEEK1 = {2023: "2023-01-01", 2024: "2023-12-31", 2025: "2024-12-29", 2026: "2026-01-04"}
WEEKS = {2023: 52, 2024: 52, 2025: 53, 2026: 52}
# Year totals stated in the reports (used as the last running total of the year).
YEAR_TOTAL = {2023: (123133, "Dengue-20250109.pdf, comparison with the same period in 2023")}


def build():
    import datetime as dt
    d = json.loads((DIR / "parsed.json").read_text(encoding="utf-8"))
    direct, anchors, notes = {}, {}, []
    for r in d["parsed"]:
        y, w = r["year"], r["week"]
        prev = (y, w - 1) if w > 1 else (y - 1, WEEKS.get(y - 1, 52))
        for key, val, role in (((y, w), r["cases"], "this week"), (prev, r["previous_week_cases"], "previous week")):
            direct.setdefault(key, []).append((val, r["report"], role))
        if r["cumulative"] is not None:
            ay = r["cumulative_year"]
            anchors[(ay, w if ay == y else WEEKS.get(ay, 52))] = (r["cumulative"], r["report"])
    for y, (tot, src) in YEAR_TOTAL.items():
        anchors.setdefault((y, WEEKS[y]), (tot, src))
    chosen = {}
    for key, vals in direct.items():
        distinct = sorted({v for v, _, _ in vals})
        best = max(vals, key=lambda v: v[1])  # reports disagree rarely; the latest report is taken as the corrected figure
        chosen[key] = best
        if len(distinct) > 1:
            notes.append(f"{key[0]}-W{key[1]:02d}: reports disagree ({', '.join(f'{v} in {rp} as {ro}' for v, rp, ro in vals)}); used {best[0]}")
    rows = []
    for y in sorted(WEEK1):
        start = dt.date.fromisoformat(WEEK1[y])
        wk = {w: None for w in range(1, WEEKS[y] + 1)}
        status = {}
        for w in wk:
            if (y, w) in chosen:
                wk[w], status[w] = chosen[(y, w)][0], ("reported", chosen[(y, w)][1])
        an = sorted([(0, 0, "start of year")] + [(w, v, src) for (ay, w), (v, src) in anchors.items() if ay == y])
        for (a, ca, _), (b, cb, src) in zip(an, an[1:]):
            span = list(range(a + 1, b + 1))
            total = cb - ca
            known = sum(wk[w] for w in span if wk[w] is not None)
            miss = [w for w in span if wk[w] is None]
            if not miss:
                if abs(known - total) > 0.02 * max(total, 1):
                    notes.append(f"{y} weeks {a + 1}-{b}: weekly figures sum to {known} but the running totals differ by {total} ({src})")
            elif len(miss) == 1:
                v = total - known
                wk[miss[0]], status[miss[0]] = v, ("derived", f"running totals in {src}")
                if v <= 0:
                    notes.append(f"{y}-W{miss[0]:02d}: derived value {v} is not plausible")
            else:
                rest = total - known
                # shape: straight line between the nearest known weeks, then scaled so the weeks add up to the published total
                lo = next((wk[w] for w in range(miss[0] - 1, 0, -1) if wk[w] is not None), None)
                hi = next((wk[w] for w in range(miss[-1] + 1, WEEKS[y] + 1) if wk[w] is not None), None)
                lo, hi = lo if lo is not None else (hi or rest / len(miss)), hi if hi is not None else (lo or rest / len(miss))
                shape = [lo + (hi - lo) * (k + 1) / (len(miss) + 1) for k in range(len(miss))]
                scale = rest / sum(shape)
                for w, sh in zip(miss, shape):
                    wk[w], status[w] = round(sh * scale), ("estimated", f"{len(miss)} weeks share a published total of {rest} ({src})")
        for w in wk:
            st = status.get(w, ("missing", "no report covers this week"))
            rows.append({"year": y, "week": w, "start": str(start + dt.timedelta(weeks=w - 1)), "cases": wk[w], "status": st[0], "basis": st[1]})
    last = max(i for i, r in enumerate(rows) if r["cases"] is not None)
    rows = rows[: last + 1]
    import csv
    with open(DIR / "mys_weekly_2023_2026.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)
    (DIR / "build_notes.json").write_text(json.dumps(notes, indent=1), encoding="utf-8")
    from collections import Counter
    print(len(rows), "weeks,", rows[0]["start"], "to", rows[-1]["start"])
    for y in sorted(WEEK1):
        cnt = Counter(r["status"] for r in rows if r["year"] == y)
        tot = sum(r["cases"] or 0 for r in rows if r["year"] == y)
        print(y, dict(cnt), "| sum of weeks", tot)
    print("notes:")
    for n in notes:
        print(" -", n)


def model():
    """Join the rebuilt 2023-2026 weeks to the 2011-2022 series and run the same model comparison.

    Forecast errors are reported twice: on every test week, and only on test weeks whose value WHO stated
    or that follows exactly from its running totals. The second is the fair one, because estimated weeks
    are smooth by construction and therefore easy to "predict".
    """
    import csv
    import datetime as dt
    import dengue as dg
    old = dg.load()
    for r in old:
        r["status"] = "reported"
    new = []
    for r in csv.DictReader(open(DIR / "mys_weekly_2023_2026.csv", encoding="utf-8")):
        if r["cases"] not in ("", None):
            new.append({"start": dt.date.fromisoformat(r["start"]), "cases": float(r["cases"]), "status": r["status"]})
    rows = dg.prep([{"start": r["start"], "cases": r["cases"], "status": r["status"]} for r in old] + new)
    src = "2011 to 2022: OpenDengue V1.3. 2023 to 2026: rebuilt by us from 80 WHO Western Pacific Dengue Situation Updates (figures from the Ministry of Health)"
    mask = [r["status"] != "estimated" for r in rows]
    measured = dg.main(rows, "extended_measured", src, None, score_mask=mask)
    full = dg.main(rows, "extended", src, "dengue.json")
    site = json.loads((c.ROOT / "site/data/dengue.json").read_text())
    from collections import Counter
    comp = Counter(r["status"] for r in new)
    site.update({"status": [r["status"] for r in rows], "forecast_measured": measured["forecast"], "rebuilt_from": str(new[0]["start"]),
                 "composition": dict(comp), "missing_weeks": "2025 weeks 50 to 53 (no report covers them)",
                 "notes": json.loads((DIR / "build_notes.json").read_text(encoding="utf-8")),
                 "earlier_result": "On the original 2011 to 2022 data alone, with settings frozen beforehand, ridge regression cut the error of 'same as last week' by 5% to 24%."})
    (c.ROOT / "site/data/dengue.json").write_text(json.dumps(site))
    print("weeks", len(rows), "| train to", full["train_end"], "| test", full["test_start"], "to", full["test_end"], "| rebuilt weeks", dict(comp))
    for a, b in zip(full["forecast"], measured["forecast"]):
        print(f"+{a['weeks_ahead']}w all test weeks n={a['n_test']} {a['mae']} best {a['best']} || measured only n={b['n_test']} {b['mae']} best {b['best']}")
    print("extrapolation", full["extrapolation"])


if __name__ == "__main__":
    {"fetch": fetch, "parse": parse, "build": build, "model": model}[sys.argv[1]]()
