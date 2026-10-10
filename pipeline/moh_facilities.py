"""Hospitals and health clinics for the map, from the Ministry of Health's own facility registry.

Source: github.com/MoH-Malaysia/data-resources-public, facilities_master.csv: 5,160 public facilities
"as registered on 31 December 2025", every row open and carrying coordinates. We keep hospitals and the
clinics that see walk-in patients (Klinik Kesihatan, Klinik Komuniti, mother-and-child clinics). Rural
clinics (Klinik Desa), dental clinics, offices and laboratories are left out.

Private hospitals are added from data/raw/facilities/private_hospitals_licensed.json when that file
exists (built by private_hospitals.py from the Ministry's list of hospitals licensed under Act 586).
Private GP clinics are not plotted: no public source gives their positions.

    py -3.13 moh_facilities.py fetch   # download the registry again
    py -3.13 moh_facilities.py         # rebuild site/data/facilities.json
"""
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

import core as c

URL = "https://raw.githubusercontent.com/MoH-Malaysia/data-resources-public/main/facilities_master.csv"
RAW = c.ROOT / "data/raw/facilities"
SRC = RAW / "facilities_master.csv"
PRIVATE = RAW / "private_hospitals_licensed.json"
REPAIR = RAW / "repair_cache.json"  # OpenStreetMap positions for the few registry rows whose coordinates are wrong
AS_AT = "31 December 2025"

HOSPITAL = {"HOSPITAL NEGERI": "State hospital", "HOSPITAL PAKAR MAJOR": "Major specialist hospital", "HOSPITAL PAKAR MINOR": "Minor specialist hospital",
            "HOSPITAL TANPA PAKAR": "District hospital without specialists", "HOSPITAL PENGAJAR": "Teaching hospital",
            "INSTITUSI PERUBATAN KHAS": "Special medical institution", "HOSPITAL TENTERA": "Military hospital"}
CLINIC = {"KLINIK KESIHATAN": "Health clinic (Klinik Kesihatan)", "KLINIK KOMUNITI": "Community clinic (Klinik Komuniti)",
          "KLINIK KESIHATAN IBU DAN ANAK": "Mother and child clinic"}
STATE = {"WILAYAH PERSEKUTUAN KUALA LUMPUR": "Kuala Lumpur", "WILAYAH PERSEKUTUAN LABUAN": "Labuan", "WILAYAH PERSEKUTUAN PUTRAJAYA": "Putrajaya",
         "WILAYAH PERSEKUTUAN KUALA LUMPUR DAN PUTRAJAYA": "Kuala Lumpur and Putrajaya"}
KEEP_UPPER = {"KK", "HSAAS", "UPM", "UKM", "USM", "UM", "UMS", "UNIMAS", "UIAM", "IIUM", "HCTM", "ATM", "TUDM", "TLDM", "KKIA", "UTC", "RTC", "PPUM", "PPUKM", "KLIA", "FELDA", "FELCRA", "IJN", "II", "III", "IV"}
FIX = {"UITM": "UiTM", "UNISZA": "UniSZA", "KKOM": "KKom"}
LEAD = {"KK": "Klinik Kesihatan", "KKom": "Klinik Komuniti", "KKIA": "Klinik Kesihatan Ibu dan Anak"}  # registry abbreviations at the start of a name


def nice(s):
    """Registry text is upper case and may contain line breaks; tidy it for display."""
    words = re.sub(r"\s+", " ", s or "").strip().split(" ")
    out = []
    for w in words:
        bare = re.sub(r"[^A-Z]", "", w.upper())
        out.append(FIX.get(bare, w.upper() if bare in KEEP_UPPER else w.capitalize() if not re.search(r"[('\"/-]", w) else w.title()))
    return " ".join(out).strip(" ,")


def inside(lon, lat, geom):
    """Ray casting on a GeoJSON Polygon or MultiPolygon. Counting every ring makes holes count as outside."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        hit = False
        for ring in poly:
            for i in range(len(ring)):
                (x1, y1), (x2, y2) = ring[i][:2], ring[i - 1][:2]
                if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                    hit = not hit
        if hit:
            return True
    return False


def km_to(lon, lat, geom):
    """Rough distance in km from a point to the nearest corner of a state's outline."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return min(111 * ((x - lon) ** 2 + (y - lat) ** 2) ** 0.5 for poly in polys for ring in poly for x, y in (pt[:2] for pt in ring))


# OpenStreetMap spells this hospital "Tunku Fauziah"; it is the only hospital in Kangar, postcode 01000, as in the registry address.
ALT_QUERY = {"Hospital Tuanku Fauziah": "Hospital Kangar Perlis"}


def lookup(name, state, cache):
    """OpenStreetMap Nominatim search by name, one request a second, cached."""
    key = f"{name}, {state}"
    if key not in cache:
        cache[key] = []
        for text in [f"{name}, {state}, Malaysia", name] + [ALT_QUERY[name]] * (name in ALT_QUERY):  # the caller checks the state
            q = urllib.parse.urlencode({"q": text, "format": "json", "countrycodes": "my", "limit": 5})
            req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q, headers={"User-Agent": "FluSentinel student project"})
            cache[key] += [[float(x["lat"]), float(x["lon"]), x.get("display_name", "")] for x in json.load(urllib.request.urlopen(req, timeout=30))]
            time.sleep(1.1)
        REPAIR.write_text(json.dumps(cache, indent=1), encoding="utf-8")
    return cache[key]


def build():
    shapes = {f["properties"]["name"]: f["geometry"] for f in json.load(open(c.ROOT / "site/data/states_map.geojson", encoding="utf-8"))["features"]}
    rows, dropped, other_state, repaired = [], [], [], []
    cache = json.load(open(REPAIR, encoding="utf-8")) if REPAIR.exists() else {}
    for r in csv.DictReader(open(SRC, encoding="utf-8-sig")):
        kind = "government" if r["KATEGORI_FASILITI"] == "HOSPITAL" else "clinic" if r["JENIS_FASILITI"].strip() in CLINIC else None
        if not kind or r["STATUS"] != "BUKA":
            continue
        name, state = nice(r["NAMA"]), STATE.get(r["NEGERI"], nice(r["NEGERI"]))
        first, _, rest = name.partition(" ")
        name = f"{LEAD[first]} {rest}" if first in LEAD and rest else name
        own = {"Kuala Lumpur and Putrajaya": ("Kuala Lumpur", "Putrajaya")}.get(state, (state,))
        try:
            lat, lon = float(r["LATITUD"]), float(r["LONGITUD"])
        except ValueError:
            lat = lon = None
        # Outlines are simplified, so a point just over a border is normal. One more than 25 km from its own state
        # is a registry error: it is looked up by name on OpenStreetMap instead, and says so on the map.
        osm = False
        far = None if lat is None else 0 if any(inside(lon, lat, shapes[s]) for s in own) else min(km_to(lon, lat, shapes[s]) for s in own)
        if far is None or far > 25:
            hit = next((h for h in lookup(name, state, cache) if any(inside(h[1], h[0], shapes[s]) for s in own)), None)
            if not hit:
                dropped.append(f"{name} ({state})")
                continue
            repaired.append(f"{name} ({state})")
            lat, lon, osm, far = hit[0], hit[1], True, 0
        elif far:
            other_state.append(f"{name} ({state}), {round(far)} km")
        pc = r["POSKOD"].strip()
        town = " ".join(x for x in ("" if pc and pc in r["ALAMAT"] else pc, nice(r["BANDAR"])) if x)
        rows.append({"name": name, "kind": kind, "type": (HOSPITAL if kind == "government" else CLINIC).get(r["JENIS_FASILITI"].strip(), nice(r["JENIS_FASILITI"])),
                     "state": state, "district": nice(r["DAERAH"]), "address": ", ".join(x for x in (nice(r["ALAMAT"]), town) if x),
                     "lat": round(lat, 5), "lon": round(lon, 5), "approximate": False, **({"osm": True} if osm else {})})
    private = {"listed": 0, "located": 0, "approximate": 0, "not_located": 0, "source": None}
    if PRIVATE.exists():
        src = json.load(open(PRIVATE, encoding="utf-8"))
        items = src["rows"] if isinstance(src, dict) else src
        private.update(listed=len(items), source=(src.get("source") if isinstance(src, dict) else None) or "Ministry of Health list of private hospitals licensed under Act 586")
        for p in items:
            if p.get("lat") is None or p.get("lon") is None:
                private["not_located"] += 1
                continue
            private["approximate" if p.get("approximate") else "located"] += 1
            rows.append({"name": p["name"], "kind": "private", "type": p.get("category") or "Licensed private hospital", "state": p.get("state") or "", "district": "",
                         "address": p.get("address") or "", "lat": round(float(p["lat"]), 5), "lon": round(float(p["lon"]), 5), "approximate": bool(p.get("approximate"))})
    counts = Counter(r["kind"] for r in rows)
    meta = {"source": "Ministry of Health Malaysia, facilities_master.csv (github.com/MoH-Malaysia/data-resources-public)", "as_at": AS_AT,
            "counts": dict(counts), "registry_coordinates_wrong_repositioned": repaired, "registry_coordinates_wrong_left_off": dropped, "just_outside_simplified_outline": len(other_state), "private": private}
    (c.ROOT / "site/data/facilities.json").write_text(json.dumps({"meta": meta, "rows": rows}, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(meta, indent=1))
    print("by state:", dict(Counter(r["state"] for r in rows)))
    print("just outside their state's simplified outline (kept):", len(other_state), other_state[:8])


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        RAW.mkdir(parents=True, exist_ok=True)
        SRC.write_bytes(urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "FluSentinel student project"})).read())
    build()
