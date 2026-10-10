"""Real bed counts for the hospital pop-ups on the map and for the Selangor capacity table.

Source 1  Ministry of Health, bedutil_facility.csv (github.com/MoH-Malaysia/data-resources-public), last
          updated 3 September 2024: non-ICU beds, ICU beds and ventilators, with utilisation, for 149 public
          hospitals. 40 rows have no bed figure. Utilisation is patchy: several large hospitals report exactly
          0% and one is negative. A reported 0% or a negative figure is treated as "not reported"; figures a
          little over 100% are kept, because wards do run over their official beds.
Source 2  Selangor State Legislative Assembly, written answer "Fasiliti kesihatan di Selangor" (sitting of
          18 February to 3 March 2025, dewan.selangor.gov.my/question/fasiliti-kesihatan-di-selangor/): official
          beds, beds in operation and the 2024 bed occupancy rate for every Ministry hospital in Selangor. Saved
          as selangor_assembly_beds_2025.csv. This is the first choice for the capacity table: it is newer and
          complete, and its occupancy column has no gaps. The capacity table uses beds in operation.
Source 3  selangor_beds_lookup.json: the same hospitals looked up one by one on their own pages, kept as a
          cross-check with the page each figure was read from.
Source 4  None of the above: the median for hospitals of the same type in source 1, marked "estimated".

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
ASSEMBLY = RAW / "selangor_assembly_beds_2025.csv"
ASSEMBLY_URL = "https://dewan.selangor.gov.my/question/fasiliti-kesihatan-di-selangor/"
# Names in the Assembly table that differ from the names used on the site.
ASSEMBLY_NAME = {"Hospital Tengku Ampuan Rahimah (HTAR), Klang": "Hospital Tengku Ampuan Rahimah", "Hospital Sultan Idris Shah (HSIS), Serdang": "Hospital Sultan Idris Shah Serdang",
                 "Hospital Sungai Buloh (termasuk Pusat Kawalan Kusta Negara)": "Hospital Sungai Buloh", "Hospital Tengku Ampuan Jemaah (HTAJ), Sabak Bernam": "Hospital Tengku Ampuan Jemaah"}
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
    asm = {ASSEMBLY_NAME.get(x["hospital"], x["hospital"]): x for x in csv.DictReader(open(ASSEMBLY, encoding="utf-8"))} if ASSEMBLY.exists() else {}
    rows = []
    for name, reg in PLANNER.items():
        r, lk = pub[reg], look.get(name) or {}
        h = {"name": name, "lat": r["lat"], "lon": r["lon"], "district": r["district"], "type": r["type"], "occ": r.get("occ"), "icu": r.get("icu"), "vent": r.get("vent")}
        if name in asm:
            a = asm[name]
            h.update(beds=int(a["beds_operating"]), beds_official=int(a["beds_official"]), occ=float(a["occupancy_2024_percent"]), beds_src="assembly",
                     src="Selangor State Assembly answer, 2025", src_url=ASSEMBLY_URL)
        elif "beds" in r:
            h.update(beds=r["beds"], beds_src="ministry", src=f"Ministry of Health bed file, {UPDATED}")
        elif lk.get("beds"):
            tier = {"hospital site": "the hospital's own page", "ministry": "a Ministry of Health publication", "news": "a news report quoting the Ministry"}.get(lk.get("tier"), "a published source")
            h.update(beds=int(lk["beds"]), beds_src="lookup", src=f"{tier}{', ' + str(lk['year']) if lk.get('year') else ''}", src_url=lk.get("source_url"))
        else:
            h.update(beds=int(statistics.median(by_type[r["type"]])), beds_src="estimated", src=f"estimated: the middle value for a {r['type'].lower()} in the Ministry bed file")
        rows.append(h)
    counts = {k: sum(1 for h in rows if h["beds_src"] == k) for k in ("assembly", "ministry", "lookup", "estimated")}
    part = {"assembly": "beds in operation from a Selangor State Assembly written answer (sitting of 18 February to 3 March 2025)", "ministry": f"the Ministry of Health bed file (last updated {UPDATED})",
            "lookup": "the hospital's own page", "estimated": "an estimate (the middle value for a hospital of the same type)"}
    note = "Bed totals: " + "; ".join(f"{part[k]} for {n} hospital{'s' if n != 1 else ''}" for k, n in counts.items() if n) + ". "
    n_occ = sum(1 for h in rows if h["occ"] is not None)
    note += ("Occupancy is each hospital's 2024 average from the same answer, not today's figure. " if n_occ == len(rows) and counts["assembly"] == len(rows)
             else f"Occupancy is a reported figure for {n_occ} of {len(rows)} hospitals; the others use the slider. ")
    # cross-check against the one-by-one look-up and the Ministry bed file
    for h in rows:
        lk, mo = look.get(h["name"]) or {}, pub[PLANNER[h["name"]]].get("beds")
        if h["beds_src"] == "assembly" and lk.get("beds") and int(lk["beds"]) != h["beds_official"]:
            print(f"  note: {h['name']}: Assembly official beds {h['beds_official']} vs looked-up {lk['beds']}")
        if h["beds_src"] == "assembly" and mo:
            print(f"  cross-check {h['name']}: in operation {h['beds']} (Assembly, 2025) vs non-ICU beds {mo} (Ministry bed file, 2024)")
    meta = {"bed_file": "Ministry of Health Malaysia, bedutil_facility.csv (github.com/MoH-Malaysia/data-resources-public)", "bed_file_updated": UPDATED, "counts": counts, "note": note,
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
