"""Private hospitals licensed by the Ministry of Health under Act 586, located for the map.

The list is the "HOSPITAL SWASTA" layer of MyGeoCKAPS Public, the public map of the Ministry's
Private Medical Practice Control Section (CKAPS), hosted on the national geoportal MyGOS:

  app      https://mygos.mygeoportal.gov.my/mygeockaps_public/   (linked from https://hq.moh.gov.my/medicalprac/)
  layer    https://mygos.mygeoportal.gov.my/gisserver/rest/services/KKM/FASILITI_KESIHATAN_SWASTA_PUBLIC/MapServer/1
  retrieved 11 October 2026, live (not archived). 214 hospitals.

The layer states no "as at" date. One record quotes a licensing committee meeting of 15 January 2026,
so the layer was edited after that. Hospitals that only hold approval to build (Borang 2) sit in a
separate layer (15) and are left out, as are maternity homes (layer 8), ambulatory care centres,
clinics, dialysis centres and nursing homes. The layer has no licence numbers and no sub-category.

Each hospital comes with the Ministry's own map point. That point is checked against the state
boundaries and against OpenStreetMap (one Overpass extract of hospitals and clinics in Malaysia, plus
a Nominatim search by name where the extract has nothing):
  - an OpenStreetMap feature of the same name within 300 m: keep the Ministry point;
  - an OpenStreetMap hospital of the same name 300 m to 1 km away: use the OpenStreetMap hospital;
  - an OpenStreetMap hospital of the same name 1 to 10 km away: the two disagree. Keep whichever lies
    in the stated state; failing that, whichever stands on a street or in a neighbourhood named in the
    official address (Nominatim reverse lookup); failing that, the town centre, marked approximate;
  - no OpenStreetMap feature of that name: keep the Ministry point, and note whether the street or
    neighbourhood around it (Nominatim reverse lookup) is the one named in the official address.
A hospital with no usable Ministry point is looked up by name, then by its street, then by its town
(the last two are marked approximate).

Run:  py -3.13 -I pipeline/private_hospitals.py            (reuses the newest raw files)
      py -3.13 -I pipeline/private_hospitals.py --refresh  (downloads the list and the OpenStreetMap extract again)
Raw files and the Nominatim cache are kept beside the output in data/raw/facilities/.
"""
import datetime
import difflib
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/facilities"
OUT = RAW / "private_hospitals_licensed.json"
CACHE = RAW / "private_hospitals_geocode_cache.json"
ADM1 = ROOT / "data/raw/mys_adm1.geojson"

SERVICE = "https://mygos.mygeoportal.gov.my/gisserver/rest/services/KKM/FASILITI_KESIHATAN_SWASTA_PUBLIC/MapServer"
LAYER = 1  # HOSPITAL SWASTA
APP_ITEM = "https://mygos.mygeoportal.gov.my/mygos/sharing/rest/content/items/916cdbd22a594df38afc603efb1cfab1?f=json"
OVERPASS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter",
            "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
OVERPASS_QUERY = """[out:json][timeout:240];
(
  nwr["amenity"~"^(hospital|clinic|doctors)$"](0.8,99.5,7.5,104.8);
  nwr["healthcare"~"^(hospital|clinic|centre|doctor|birthing_centre)$"](0.8,99.5,7.5,104.8);
  nwr["amenity"~"^(hospital|clinic|doctors)$"](0.8,109.3,7.5,119.5);
  nwr["healthcare"~"^(hospital|clinic|centre|doctor|birthing_centre)$"](0.8,109.3,7.5,119.5);
);
out center tags;"""
NOMINATIM = "https://nominatim.openstreetmap.org/"
UA = {"User-Agent": "FluSentinel student project"}
BOX = (0.8, 7.5, 99.5, 119.5)  # Malaysia: lat min, lat max, lon min, lon max

NEAR_KM, SAME_AREA_KM, CONFLICT_KM, BORDER_KM, TOWN_KM = 0.3, 1.0, 10.0, 3.0, 25.0

MOH_OK = "Ministry of Health map point, OpenStreetMap agrees"
MOH_ADDR = "Ministry of Health map point, fits its address"
MOH_ONLY = "Ministry of Health map point, not cross-checked"
OSM_NAME = "OpenStreetMap hospital, name match"
BY_STREET = "street in the official address"
BY_TOWN = "town centre"

STATE = {"W.P. KUALA LUMPUR": "Kuala Lumpur", "W.P PUTRAJAYA": "Putrajaya", "PUTRAJAYA": "Putrajaya", "W.P. PUTRAJAYA": "Putrajaya",
         "W.P. LABUAN": "Labuan", "LABUAN": "Labuan"}
GEO_NAME = {"Malacca": "Melaka", "Penang": "Pulau Pinang"}
POSTCODE = [(1, 2, "Perlis"), (5, 9, "Kedah"), (10, 14, "Pulau Pinang"), (15, 18, "Kelantan"), (20, 24, "Terengganu"),
            (25, 28, "Pahang"), (30, 36, "Perak"), (39, 39, "Pahang"), (40, 48, "Selangor"), (49, 49, "Pahang"),
            (50, 60, "Kuala Lumpur"), (62, 62, "Putrajaya"), (63, 64, "Selangor"), (68, 68, "Selangor"), (69, 69, "Pahang"),
            (70, 73, "Negeri Sembilan"), (75, 78, "Melaka"), (79, 86, "Johor"), (87, 87, "Labuan"), (88, 91, "Sabah"),
            (93, 98, "Sarawak")]

# Rows whose address field in the source is plainly not the hospital's premises (checked by hand, 11 Oct 2026).
BAD_ADDRESS = {"TUNG SHIN HOSPITAL": "UKM SPECIALIST CENTRE", "PANTAI HOSPITAL CHERAS": "LEVEL 33A, MERCU ASPIRE"}

NOISE = set("sdn bhd m the and dan of di".split())
FACILITY = set("hospital specialist medical centre clinic group".split())
SYNONYM = {"center": "centre", "specialists": "specialist", "speacialist": "specialist", "hopsital": "hospital", "columbi": "columbia",
           "pakar": "specialist", "pusat": "centre", "perubatan": "medical", "klinik": "clinic", "wanita": "women", "womens": "women",
           "childrens": "children", "bersalin": "maternity", "perbidanan": "maternity", "georgetown": "george town",
           "penang": "pulau pinang", "malacca": "melaka", "kl": "kuala lumpur"}
STREET = r"\b(JALAN|LORONG|PERSIARAN|LEBUH|LEBOH|LEBUHRAYA|LINGKARAN|LENGKUK)\b"


# ---------- fetching ----------

def get(url, data=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def newest(prefix):
    files = sorted(RAW.glob(prefix + "_????-??-??.json"))
    return files[-1] if files else None


def official(refresh):
    """The layer exactly as the Ministry's map service returns it."""
    path = None if refresh else newest("ckaps_hospital_swasta")
    if path is None:
        today = datetime.date.today().isoformat()
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "outSR": 4326, "returnGeometry": "true",
                                    "orderByFields": "OBJECTID", "f": "json"})
        body = get(f"{SERVICE}/{LAYER}/query?{q}")
        d = json.loads(body)
        n = json.loads(get(f"{SERVICE}/{LAYER}/query?where=1%3D1&returnCountOnly=true&f=json"))["count"]
        if d.get("exceededTransferLimit") or len(d["features"]) != n:
            raise SystemExit(f"layer returned {len(d['features'])} of {n} rows; page the query before trusting it")
        path = RAW / f"ckaps_hospital_swasta_{today}.json"
        path.write_bytes(body)
        (RAW / f"ckaps_mygeockaps_item_{today}.json").write_bytes(get(APP_ITEM))
    return json.loads(path.read_text(encoding="utf-8"))["features"], path


def osm_extract(refresh):
    path = None if refresh else newest("osm_health_malaysia")
    if path is None:
        body = None
        for url in OVERPASS:
            try:
                body = get(url, urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode(), timeout=300)
                json.loads(body)["elements"]
                break
            except Exception as e:
                print("overpass failed:", url, type(e).__name__)
                body = None
        if body is None:
            raise SystemExit("no Overpass server answered; try again later")
        path = RAW / f"osm_health_malaysia_{datetime.date.today().isoformat()}.json"
        path.write_bytes(body)
    out = []
    for e in json.loads(path.read_text(encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        lat = e.get("lat", (e.get("center") or {}).get("lat"))
        lon = e.get("lon", (e.get("center") or {}).get("lon"))
        names = [p.strip() for k in ("name", "name:en", "name:ms", "official_name", "alt_name", "short_name", "old_name")
                 for p in t.get(k, "").split(";") if p.strip()]
        if lat is None or not names:
            continue
        out.append({"id": f"{e['type']}/{e['id']}", "lat": lat, "lon": lon, "name": names[0].replace("\xa0", " "),
                    "names": [(wordset(n), key(n), words(n)) for n in names],
                    "hospital": "hospital" in (t.get("amenity"), t.get("healthcare")),
                    "street": t.get("addr:street", ""), "number": t.get("addr:housenumber", "")})
    return out, path


def nominatim(cache, **params):
    """One Nominatim call (search by q=, or reverse by lat=, lon=), at most one request a second, cached."""
    k = json.dumps(params, sort_keys=True)
    if k not in cache:
        kind = "reverse" if "lat" in params else "search"
        extra = {"format": "jsonv2", "zoom": 18, "addressdetails": 1} if kind == "reverse" else {"format": "json", "limit": 10, "countrycodes": "my"}
        try:
            d = json.loads(get(NOMINATIM + kind + "?" + urllib.parse.urlencode({**params, **extra}), timeout=40))
        except Exception:
            return {} if kind == "reverse" else []  # not cached, so a later run tries again
        cache[k] = d.get("address", {}) if kind == "reverse" else [[float(r["lat"]), float(r["lon"]), r.get("class"), r.get("type"), r.get("display_name", "")] for r in d]
        CACHE.write_text(json.dumps(cache, indent=0), encoding="utf-8")
        time.sleep(1.1)
    return cache[k] if "lat" in params else [r for r in cache[k] if inside(r[0], r[1])]


# ---------- geometry ----------

def inside(lat, lon):
    return BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]


def km(a, b, c, d):
    p = math.pi / 180
    return 6371 * math.hypot((d - b) * p * math.cos((a + c) * p / 2), (c - a) * p)


def in_ring(x, y, ring):
    hit, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def load_states():
    out = []
    for f in json.loads(ADM1.read_text(encoding="utf-8"))["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        n = f["properties"]["shapeName"]
        out.append((GEO_NAME.get(n, n), polys))
    return out


def state_at(lat, lon, states):
    for name, polys in states:
        for p in polys:
            if in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]):
                return name
    return None


def border_km(lat, lon, name, states):
    return min((km(lat, lon, q[1], q[0]) for n, polys in states if n == name for p in polys for ring in p for q in ring),
               default=float("inf"))


# ---------- names ----------

def words(s):
    """Lower-case words, Malay facility words put into English ('hospital pakar' and 'specialist hospital' become the same set)."""
    s = s.lower().replace("&", " and ").replace("’", "").replace("'", "").replace("\xa0", " ")
    s = re.sub(r"kanak\W*kanak", "children", s)
    s = re.sub(r"sakit\W*puan", "sakitpuan", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return [w for w in " ".join(SYNONYM.get(w, w) for w in s.split()).split() if w not in NOISE]


def wordset(s):
    return frozenset(words(s))


def key(s):
    """What sets one facility's name apart: its words without 'hospital', 'medical centre' and the like."""
    return wordset(s) - FACILITY


def official_names(name, town):
    """The ways an official name may be written: without brackets, with a bracketed qualifier, as a bracketed alias, with the town.
    Each is (word set, key, word list, from_the_name); the town form is only ever matched exactly."""
    main = re.sub(r"\([^()]*\)", " ", re.sub(r"\([^()]*\)", " ", name))
    forms = [main]
    for inner in re.findall(r"\(([^()]*)\)", name):
        forms.append(inner if FACILITY & wordset(inner) else f"{main} {inner}")
    out = [(wordset(f), key(f), words(f), True) for f in forms]
    out.append((wordset(f"{main} {town}"), key(f"{main} {town}"), [], False))
    return [f for f in out if f[1]]


def acronym(k, ws):
    """A word of one name spells the initials of a run of words in the other, e.g. KLSMC and Kuala Lumpur Sports Medicine Centre."""
    return any(len(t) >= 3 and any("".join(w[0] for w in ws[i:i + len(t)]) == t for i in range(len(ws) - len(t) + 1)) for t in k)


def match(forms, o, near):
    """'strong': the same name. 'loose' (only asked for features within 300 m): one name contains or closely resembles the other."""
    best = None
    for ows, okey, owords in o["names"]:
        if not okey:
            continue
        for ws, k, wl, from_name in forms:
            if ws == ows or (k == okey and len(k) >= 2):
                return "strong"
            if not near or not from_name:
                continue
            shared = len(k & okey)
            if (k == okey or (shared and (k <= okey or okey <= k) and (o["hospital"] or shared >= 2))
                    or (shared >= 2 and shared / len(k | okey) >= 0.6)
                    or difflib.SequenceMatcher(None, " ".join(sorted(k)), " ".join(sorted(okey))).ratio() >= 0.88
                    or acronym(k, owords) or acronym(okey, wl)):
                best = "loose"
    return best


# ---------- one hospital ----------

def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def street_parts(address):
    """Streets in an address, without unit and lot numbers."""
    out = []
    for part in (address or "").replace("’", "'").split(","):
        m = re.search(STREET + r".*", clean(part), re.I)
        if m:
            out.append(m.group(0))
    return out


def postcode_state(pc):
    if not pc.isdigit():
        return None
    return next((s for a, b, s in POSTCODE if a <= int(pc[:2]) <= b), None)


def address_score(lat, lon, r, cache):
    """How well a point fits the official address: (street and neighbourhood names around it, from a Nominatim reverse
    lookup, that appear in the address allowing for small spelling differences; whether the postcode is the same)."""
    rev = nominatim(cache, lat=round(lat, 5), lon=round(lon, 5))
    source = (r["street_source"] or "").replace("’", "'")
    official = " " + " ".join(words(source)) + " "
    parts = [" ".join(words(x)) for x in source.split(",") + street_parts(source)]
    names = {" ".join(words(v)) for k, v in rev.items() if k not in ("city", "town", "municipality", "county", "district", "state", "region",
                                                                      "country", "country_code", "postcode", "house_number")}
    hits = sum(1 for n in names if len(n.split()) >= 2 and (f" {n} " in official or any(difflib.SequenceMatcher(None, n, q).ratio() >= 0.9 for q in parts)))
    return hits, rev.get("postcode") == r["postcode"]


def build(features, osm, states, cache):
    rows = []
    for f in features:
        a, g = f["attributes"], f.get("geometry") or {}
        name = clean(a.get("NAMA_PENUH_FASILITI"))
        notes = []
        if len(name) > 120 or not name:
            notes.append("The name field in the source holds licensing committee notes instead of a name.")
            name = None
        pc = clean(str(a.get("POSKOD") or ""))
        pc = pc.zfill(5) if pc.isdigit() else pc
        town, address = clean(a.get("BANDAR")), clean(a.get("ALAMAT")).rstrip(",")
        src_state = clean(a.get("NEGERI"))
        state = STATE.get(src_state.upper(), src_state.title())
        x, y = g.get("x"), g.get("y")
        point = (y, x) if isinstance(x, (int, float)) and isinstance(y, (int, float)) and inside(y, x) else None
        if name in BAD_ADDRESS and address.upper().startswith(BAD_ADDRESS[name]):
            notes.append(f"The address field in the source ('{address}') is not this hospital's premises, so it is left out.")
            street_source, address = "", None
        else:
            street_source = address
        rows.append({"a": a, "name": name, "state": state, "src_state": src_state, "town": town, "postcode": pc,
                     "address": address, "street_source": street_source, "point": point, "notes": notes})

    # state: trust the source unless the point and the postcode both say otherwise
    for r in rows:
        r["point_state"] = state_at(*r["point"], states) if r["point"] else None
        if r["point"] and r["point_state"] != r["state"]:
            if r["point_state"] and r["point_state"] == postcode_state(r["postcode"]):
                r["notes"].append(f"The source files this under {r['src_state']}; its map point and postcode are in {r['point_state']}, which is used here.")
                r["state"] = r["point_state"]
            elif border_km(*r["point"], r["state"], states) > BORDER_KM:
                r["notes"].append(f"The Ministry's map point falls in {r['point_state'] or 'no state'}, far from {r['state']}; not used.")
                r["point"] = None

    # OpenStreetMap features of the same name within 10 km of the Ministry point
    def consider(r, o):
        d = km(*r["point"], o["lat"], o["lon"])
        if d > CONFLICT_KM:
            return
        m = match(r["forms"], o, d <= NEAR_KM)
        if not r["name"] and o["hospital"] and d <= NEAR_KM and o["street"] and o["number"] \
                and o["street"].upper().replace("JALAN ", "") in (r["address"] or "").upper() and o["number"] in (r["address"] or ""):
            m = "address"
        if m:
            r["cands"].append((d, m, o))

    def nearest(r):  # within 300 m: the same name first, then a hospital with a similar name, then anything similar
        return min((c for c in r["cands"] if c[0] <= NEAR_KM), default=None,
                   key=lambda c: (0 if c[1] != "loose" else 1 if c[2]["hospital"] else 2, c[0]))

    for r in rows:
        r["forms"] = official_names(r["name"], r["town"]) if r["name"] else []
        r["cands"] = []
        for o in osm if r["point"] else []:
            consider(r, o)
        r["near"] = nearest(r)
    claimed = {r["near"][2]["id"]: r["near"][2] for r in rows if r["near"]}  # so one branch's entry is not taken for another branch
    for r in rows:  # the extract misses buildings mapped without a hospital tag, so ask Nominatim by name
        if r["point"] and r["name"] and not r["near"]:
            plain = clean(re.sub(r"(?i)\bsdn\.?\s*bhd\.?", " ", re.sub(r"\(.*\)", " ", r["name"])))
            for res in nominatim(cache, q=plain):
                first = res[4].split(",")[0]
                if res[2] in ("amenity", "building", "healthcare", "office") \
                        and not any(km(res[0], res[1], c["lat"], c["lon"]) < 0.05 for c in claimed.values()):
                    consider(r, {"id": f"nominatim/{res[0]},{res[1]}", "lat": res[0], "lon": res[1], "name": first,
                                 "names": [(wordset(first), key(first), words(first))], "hospital": res[3] == "hospital",
                                 "street": "", "number": ""})
            r["near"] = nearest(r)
        r["cands"].sort(key=lambda c: c[0])

    out = []
    for r in rows:
        a, p = r["a"], r["point"]
        lat = lon = osm_name = osm_m = None
        approximate, how, unresolved = False, None, False
        other = [c for c in r["cands"] if c[1] == "strong" and c[2]["hospital"] and c[2]["id"] not in claimed]
        area = next((c for c in other if c[0] <= SAME_AREA_KM), None)
        far = next((c for c in other if c[0] > SAME_AREA_KM), None)
        if p and r["near"]:
            (lat, lon), how = p, MOH_OK
            osm_name, osm_m = r["near"][2]["name"], round(r["near"][0] * 1000)
        elif p and area:
            lat, lon, how = area[2]["lat"], area[2]["lon"], OSM_NAME
            osm_name, osm_m = area[2]["name"], round(area[0] * 1000)
            r["notes"].append(f"The Ministry's map point is {osm_m} m from the OpenStreetMap hospital of the same name; the OpenStreetMap position is used.")
        elif p and far:
            o, osm_m = far[2], round(far[0] * 1000)
            osm_name, o_state = o["name"], state_at(far[2]["lat"], far[2]["lon"], states)
            if (r["point_state"] == r["state"]) != (o_state == r["state"]):
                pick, why = ("moh" if r["point_state"] == r["state"] else "osm"), f"only one of them lies in {r['state']}"
            else:
                sp, so = sum(address_score(*p, r, cache)), sum(address_score(o["lat"], o["lon"], r, cache))
                pick, why = ("moh" if sp > so else "osm" if so > sp else None), "it fits the street and neighbourhood in the official address better"
            if pick == "moh":
                (lat, lon), how = p, (MOH_ADDR if address_score(*p, r, cache)[0] else MOH_ONLY)
            elif pick == "osm":
                lat, lon, how = o["lat"], o["lon"], OSM_NAME
            unresolved = pick is None
            r["notes"].append(f"The Ministry's map point and the OpenStreetMap hospital of the same name are {osm_m / 1000:.1f} km apart; "
                              + ("neither could be confirmed, so the pin is approximate." if unresolved else
                                 f"the {'Ministry' if pick == 'moh' else 'OpenStreetMap'} position is used because {why}."))
        elif p:  # nothing of that name in OpenStreetMap: at least see whether the point stands where the address says
            (lat, lon), how = p, (MOH_ADDR if address_score(*p, r, cache)[0] else MOH_ONLY)

        if lat is None and r["name"] and not unresolved:  # no usable point: OpenStreetMap by name within the state, then Nominatim by name
            same = [o for o in osm if o["hospital"] and match(r["forms"], o, False) == "strong"
                    and state_at(o["lat"], o["lon"], states) == r["state"] and o["id"] not in claimed]
            if len(same) == 1:
                lat, lon, osm_name, how = same[0]["lat"], same[0]["lon"], same[0]["name"], OSM_NAME
            else:
                for res in nominatim(cache, q=f"{r['name']}, {r['state']}, Malaysia"):
                    first = res[4].split(",")[0]
                    if res[2] in ("amenity", "building", "healthcare") and state_at(res[0], res[1], states) == r["state"] \
                            and any(wordset(first) == f[0] or (key(first) == f[1] and len(f[1]) >= 2) for f in r["forms"]):
                        lat, lon, osm_name, how = res[0], res[1], first, OSM_NAME
                        break
        towns = [t for t in nominatim(cache, q=f"{r['town']}, {r['state']}, Malaysia") if t[2] in ("place", "boundary")
                 and state_at(t[0], t[1], states) in (r["state"], None)] if r["town"] else []
        if lat is None:  # last resort: a short street named in the address, then the town
            for part in street_parts(r["street_source"]) if not unresolved else []:
                hits = [s for s in nominatim(cache, q=f"{part}, {r['town']}") if s[2] == "highway" and state_at(s[0], s[1], states) == r["state"]]
                if hits and all(km(hits[0][0], hits[0][1], s[0], s[1]) <= 1 for s in hits):
                    lat, lon, approximate, how = hits[0][0], hits[0][1], True, BY_STREET
                    r["notes"].append(f"No map point in the source. Placed on {part.title()}, {r['town'].title()}.")
                    break
            if lat is None and towns:
                lat, lon, approximate, how = towns[0][0], towns[0][1], True, BY_TOWN
        elif towns and km(lat, lon, towns[0][0], towns[0][1]) > TOWN_KM:
            r["notes"].append(f"The pin is {km(lat, lon, towns[0][0], towns[0][1]):.0f} km from the centre of {r['town'].title()}.")
        pin_state = state_at(lat, lon, states) if lat is not None else None
        if pin_state and pin_state != r["state"]:
            r["notes"].append(f"By the state boundary file this pin falls in {pin_state}; the Ministry lists the hospital under {r['state']}.")

        out.append({
            "name": r["name"], "state": r["state"], "town": r["town"] or None, "district": clean(a.get("DAERAH")) or None,
            "postcode": r["postcode"] or None,
            "address": ", ".join(x for x in (r["address"], f"{r['postcode']} {r['town']}".strip()) if x) if r["address"] else None,
            "category": "Hospital Swasta", "beds": a.get("JUMLAH_KATIL"), "licence_or_ref": None,
            "lat": round(lat, 5) if lat is not None else None, "lon": round(lon, 5) if lon is not None else None,
            "approximate": approximate, "located_by": how or "not located", "osm_name": osm_name, "osm_distance_m": osm_m,
            "moh_lat": round(p[0], 5) if p else None, "moh_lon": round(p[1], 5) if p else None,
            "state_source": r["src_state"], "source_bil": a.get("BIL"), "source_objectid": a.get("OBJECTID"),
            "note": " ".join(r["notes"]) or None})
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    refresh = "--refresh" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    features, src = official(refresh)
    osm, osm_src = osm_extract(refresh)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    out = build(features, osm, load_states(), cache)
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")

    print(f"source {src.name}: {len(out)} hospitals; OpenStreetMap extract {osm_src.name}: {len(osm)} named features")
    by_state = {}
    for h in out:
        by_state[h["state"]] = by_state.get(h["state"], 0) + 1
    print("by state:", ", ".join(f"{s} {n}" for s, n in sorted(by_state.items(), key=lambda kv: -kv[1])))
    print("located exactly:", sum(h["lat"] is not None and not h["approximate"] for h in out),
          "| approximate:", sum(h["approximate"] for h in out), "| not located:", sum(h["lat"] is None for h in out))
    for how in (MOH_OK, MOH_ADDR, MOH_ONLY, OSM_NAME, BY_STREET, BY_TOWN, "not located"):
        print(f"  {how}: {sum(h['located_by'] == how for h in out)}")
    print("rows with a note:")
    for h in out:
        if h["note"]:
            print(f"  [{h['source_bil']}] {h['name']} ({h['town']}): {h['located_by']}. {h['note']}")


if __name__ == "__main__":
    main()
