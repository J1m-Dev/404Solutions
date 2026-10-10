"""Real bed counts for the hospital pop-ups on the map and for the Selangor capacity table.

Source 1  Ministry of Health, bedutil_facility.csv (github.com/MoH-Malaysia/data-resources-public), last
          updated 3 September 2024: non-ICU beds, ICU beds and ventilators, with utilisation, for 149 public
          hospitals. 40 rows have no bed figure. Utilisation is patchy: several large hospitals report exactly
          0% and one is negative. A reported 0% or a negative figure is treated as "not reported"; figures a
          little over 100% are kept, because wards do run over their official beds.
Source 2  selangor_beds_lookup.json: bed counts for the Selangor hospitals missing from source 1, each with
          the official page it was read from.
Source 3  Neither of the above: the median for hospitals of the same type in source 1, marked "estimated".

    py -3.13 moh_facilities.py   # attaches source 1 to the hospitals on the map
    py -3.13 beds.py             # then writes site/data/hospitals.json and the beds upload template
"""
import csv
import json
import re
import statistics

import core as c

RAW = c.ROOT / "data/raw/facilities"
BEDFILE = RAW / "bedutil_facility.csv"
LOOKUP = RAW / "selangor_beds_lookup.json"
UPDATED = "3 September 2024"  # date of the last change to the bed file in the Ministry's repository
STATE = {"W.P. Kuala Lumpur": "Kuala Lumpur", "W.P. Labuan": "Labuan", "W.P. Putrajaya": "Putrajaya"}
SPELL = {"buloh": "buluh", "tanjung": "tanjong", "baru": "bharu", "bahru": "bharu", "hj": "haji", "ulu": "hulu"}
# Hospitals renamed since the bed file was made, or listed under a different form of their name (bed file: registry).
ALIAS = {"Hospital Serdang": "Hospital Sultan Idris Shah", "Hospital Kajang": "Hospital Tengku Permaisuri Norashikin (Hospital Kajang)"}
# The twelve Selangor government hospitals in the capacity table (name used on the site: name in the registry).
PLANNER = {"Hospital Tengku Ampuan Rahimah": "Hospital Tengku Ampuan Rahimah", "Hospital Selayang": "Hospital Selayang",
           "Hospital Sungai Buloh": "Hospital Sungai Buluh", "Hospital Sultan Idris Shah Serdang": "Hospital Sultan Idris Shah",
           "Hospital Ampang": "Hospital Ampang", "Hospital Shah Alam": "Hospital Shah Alam",
           "Hospital Kajang": "Hospital Tengku Permaisuri Norashikin (Hospital Kajang)", "Hospital Banting": "Hospital Banting",
           "Hospital Kuala Kubu Bharu": "Hospital Kuala Kubu Bharu", "Hospital Tanjong Karang": "Hospital Tanjong Karang",
           "Hospital Tengku Ampuan Jemaah": "Hospital Tengku Ampuan Jemaah, Sabak Bernam", "Hospital Cyberjaya": "Hospital Cyberjaya"}


def tokens(name):
    words = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return frozenset(SPELL.get(w, w) for w in words if w != "hospital")


def num(x, low):
    """A figure from the bed file, or None when blank or not above `low`."""
    try:
        v = float(x)
    except ValueError:
        return None
    return v if v > low else None


def bedfile():
    out = []
    for r in csv.DictReader(open(BEDFILE, encoding="utf-8-sig")):
        beds, occ = num(r["beds_nonicu"], 0), num(r["util_nonicu"], 0)
        if beds is None:
            continue
        out.append({"hospital": re.sub(r"\s+", " ", r["hospital"]).strip(), "state": STATE.get(r["state"], r["state"]), "beds": int(beds),
                    "occ": round(occ, 1) if occ is not None and occ <= 120 else None, "icu": int(num(r["beds_icu"], -1) or 0), "vent": int(num(r["vent"], -1) or 0)})
    return out


def attach(rows):
    """Add bed figures to the public hospitals in `rows` (the facility list). Matches by name inside the same state."""
    hosp = [r for r in rows if r["kind"] == "government"]
    matched, missed = 0, []
    for b in bedfile():
        same = [r for r in hosp if r["state"] == b["state"]]
        want = tokens(ALIAS.get(b["hospital"], b["hospital"]))
        hit = [r for r in same if tokens(r["name"]) == want]
        if not hit:  # one name contained in the other, and only one hospital in the state fits
            hit = [r for r in same if want <= tokens(r["name"]) or tokens(r["name"]) <= want]
        if len(hit) != 1 or "beds" in hit[0]:
            missed.append(f"{b['hospital']} ({b['state']})")
            continue
        hit[0].update(beds=b["beds"], icu=b["icu"], vent=b["vent"], **({"occ": b["occ"]} if b["occ"] is not None else {}))
        matched += 1
    return matched, missed


def planner():
    fac = json.load(open(c.ROOT / "site/data/facilities.json", encoding="utf-8"))["rows"]
    pub = {r["name"]: r for r in fac if r["kind"] == "government" and r["state"] == "Selangor"}
    by_type = {}
    for r in fac:
        if r["kind"] == "government" and "beds" in r:
            by_type.setdefault(r["type"], []).append(r["beds"])
    look = {x["hospital"]: x for x in json.load(open(LOOKUP, encoding="utf-8"))} if LOOKUP.exists() else {}
    rows = []
    for name, reg in PLANNER.items():
        r, lk = pub[reg], look.get(name) or {}
        h = {"name": name, "lat": r["lat"], "lon": r["lon"], "district": r["district"], "type": r["type"], "occ": r.get("occ"), "icu": r.get("icu"), "vent": r.get("vent")}
        if "beds" in r:
            h.update(beds=r["beds"], beds_src="ministry", src=f"Ministry of Health bed file, {UPDATED}")
        elif lk.get("beds"):
            tier = {"hospital site": "the hospital's own page", "ministry": "a Ministry of Health publication", "news": "a news report quoting the Ministry"}.get(lk.get("tier"), "a published source")
            h.update(beds=int(lk["beds"]), beds_src="lookup", src=f"{tier}{', ' + str(lk['year']) if lk.get('year') else ''}", src_url=lk.get("source_url"))
        else:
            h.update(beds=int(statistics.median(by_type[r["type"]])), beds_src="estimated", src=f"estimated: the middle value for a {r['type'].lower()} in the Ministry bed file")
        rows.append(h)
    counts = {k: sum(1 for h in rows if h["beds_src"] == k) for k in ("ministry", "lookup", "estimated")}
    meta = {"bed_file": "Ministry of Health Malaysia, bedutil_facility.csv (github.com/MoH-Malaysia/data-resources-public)", "bed_file_updated": UPDATED, "counts": counts,
            "occupancy_reported": [h["name"] for h in rows if h["occ"] is not None]}
    (c.ROOT / "site/data/hospitals.json").write_text(json.dumps({"meta": meta, "rows": rows}, indent=1), encoding="utf-8")
    # Upload template: one row per hospital. The example figure is 5% of its beds; a planner replaces it with the real number free today.
    with open(c.ROOT / "site/templates/template_beds.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([["hospital", "beds_available"]] + [[h["name"], round(h["beds"] * 0.05)] for h in rows])
    print(json.dumps(meta, indent=1))
    for h in rows:
        print(f"  {h['name']:38} {h['beds']:5}  occ {h['occ']}  {h['beds_src']:9} {h['src']}")


if __name__ == "__main__":
    planner()
