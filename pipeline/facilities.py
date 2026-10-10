"""Geocode the team's list of Selangor hospitals and clinics for the map (OpenStreetMap Nominatim).

Names and addresses were supplied by the team. Each place is looked up by name first; if that fails,
by its postcode and town, and is then marked approximate. Results are cached in data/raw/geocode_cache.json.
"""
import json
import re
import time
import urllib.parse
import urllib.request

import core as c

GOV = """Hospital Shah Alam|Petaling|Persiaran Kayangan, Seksyen 7, 40000 Shah Alam
Hospital Tengku Ampuan Rahimah|Klang|Jalan Langat, 41200 Klang
Hospital Sungai Buloh|Petaling / Gombak|Jalan Hospital, 47000 Sungai Buloh
Hospital Sultan Idris Shah Serdang|Sepang / Hulu Langat|Jalan Puchong, 43000 Kajang
Hospital Selayang|Gombak|Lebuhraya Selayang-Kepong, 68100 Batu Caves
Hospital Ampang|Hulu Langat|Jalan Mewah Utara, Pandan Mewah, 68000 Ampang
Hospital Kajang|Hulu Langat|Jalan Semenyih, Bandar Kajang, 43000 Kajang
Hospital Cyberjaya|Sepang|Persiaran Multimedia, Cyber 11, 63000 Cyberjaya
Hospital Banting|Kuala Langat|Jalan Sultan Alam Shah, 42700 Banting
Hospital Kuala Kubu Bharu|Hulu Selangor|Jalan Hospital, 44000 Kuala Kubu Bharu
Hospital Tanjong Karang|Kuala Selangor|Jalan Lencungan, Kampung Tanjong Karang, 45500 Tanjong Karang
Hospital Tengku Ampuan Jemaah|Sabak Bernam|Jalan Hospital, 45200 Sabak Bernam
Hospital Sultan Abdul Aziz Shah UPM (teaching)|Sepang|Persiaran MARDI-UPM, 43400 Serdang
Hospital Al-Sultan Abdullah UiTM (teaching)|Kuala Selangor|Jalan Puncak Alam 6/1, Bandar Puncak Alam, 42300 Bandar Puncak Alam"""
PRIVATE = """Subang Jaya Medical Centre|Subang Jaya|1, Jalan SS 12/1A, SS 12, 47500 Subang Jaya
Sunway Medical Centre|Bandar Sunway|5, Jalan Lagoon Selatan, Bandar Sunway, 47500 Subang Jaya
Thomson Hospital Kota Damansara|Kota Damansara|11, Jalan Teknologi, PJU 5, Kota Damansara, 47810 Petaling Jaya
Ara Damansara Medical Centre|Ara Damansara|Lot 2, Jalan Lapangan Terbang Subang, Seksyen U2, 40150 Shah Alam
Assunta Hospital|Petaling Jaya|Jalan Templer, 46928 Petaling Jaya
Beacon Hospital|Petaling Jaya|1, Jalan 215, Seksyen 51A, 46050 Petaling Jaya
KPJ Damansara Specialist Hospital|Damansara Utama|119, Jalan SS 20/10, Damansara Utama, 47400 Petaling Jaya
KPJ Damansara Specialist Hospital 2|Bukit Lanjan|Jalan Bukit Lanjan, 60000 Petaling Jaya
Kelana Jaya Medical Centre|Kelana Jaya|No. 4, Jalan SS 7/13, Kelana Jaya, 47301 Petaling Jaya
Columbia Asia Hospital Petaling Jaya|Petaling Jaya|Lot 69, Jalan Universiti, Seksyen 13, 46200 Petaling Jaya
Columbia Asia Hospital Puchong|Puchong|No. 1, Lebuh Puteri, Bandar Puteri Puchong, 47100 Puchong
KPJ Selangor Specialist Hospital|Shah Alam|Lot 1, Jalan Singa 20/1, Seksyen 20, 40300 Shah Alam
Avisena Specialist Hospital|Shah Alam|No. 4, Jalan Ikhtisas, Seksyen 14, 40000 Shah Alam
Avisena Women's & Children's Specialist Hospital|Shah Alam|No. 8, Jalan Ikhtisas, Seksyen 14, 40000 Shah Alam
SALAM Shah Alam Specialist Hospital|Shah Alam|2-14, Jalan Nelayan 19/B, Seksyen 19, 40300 Shah Alam
Columbia Asia Hospital Bukit Rimau|Shah Alam|No. 3, Persiaran Anggerik Eria, Bukit Rimau, 40460 Shah Alam
KPJ Klang Specialist Hospital|Klang|No. 102, Persiaran Rajawali/KU 1, Bandar Baru Klang, 41150 Klang
Pantai Hospital Klang|Port Klang|Lot 4434, Persiaran Raja Muda Musa, 42000 Pelabuhan Klang
Bukit Tinggi Medical Centre|Klang|1, Persiaran Batu Nilam 1/KS6, Bandar Bukit Tinggi 1, 41200 Klang
Sri Kota Specialist Medical Centre|Klang|Jalan Mohet, 41000 Klang
Columbia Asia Hospital Klang|Klang|Lot 8582, Batu 1 1/4, Jalan Meru, 41050 Klang
KPJ Kajang Specialist Hospital|Kajang|Jalan Cheras, 43000 Kajang
Columbia Asia Hospital Cheras|Balakong|Menara Columbia Asia, Jalan Cheras Selatan, 43200 Balakong
Sungai Long Specialist Hospital|Bandar Sungai Long|Jalan SL 1/1, Bandar Sungai Long, 43000 Kajang
Hospital Islam Az-Zahrah|Bandar Baru Bangi|No. 14 & 16, Medan Pusat Bandar 1, Seksyen 9, 43650 Bangi
Hospital Pakar An-Nur|Bandar Baru Bangi|Jalan Gerbang Wawasan 1, Bangi Gateway, Seksyen 15, 43650 Bangi
KPJ Ampang Puteri Specialist Hospital|Ampang|1, Jalan Mamanda 9, Taman Dato Ahmad Razali, 68000 Ampang
Pantai Hospital Ampang|Pandan Indah|Jalan Perubatan 1, Pandan Indah, 55100 Ampang
KPJ Rawang Specialist Hospital|Rawang|Jalan Rawang, Bandar Baru Rawang, 48000 Rawang"""
CLINICS = """Petaling
Kelana Jaya: Lot 38294, Jalan SS 6/3A, 47301 Kelana Jaya
Taman Medan: Jalan PJS 2C/5, Taman Dato Haron, 46000 Petaling Jaya
Puchong (Batu 14): Batu 14, Jalan Puchong, 47100 Puchong
Batu 13 Puchong: Batu 13, Jalan Klang Lama, 47100 Puchong
Kota Damansara: Tingkat 3, Jalan Pekaka 8/3, Seksyen 8, 47810 Kota Damansara
Seksyen 7 Shah Alam: No. 2, Persiaran Kayangan, Seksyen 7, 40000 Shah Alam
Seksyen 19 Shah Alam: Jalan Gelora 19/46, Seksyen 19, 40300 Shah Alam
Kampung Melayu Subang: Jalan Merbau, Kg Melayu Subang, 40150 Shah Alam
Paya Jaras: Batu 15, Kampung Paya Jaras, 47000 Sungai Buloh
Seri Kembangan: Jalan Besar Seri Kembangan, 43300 Seri Kembangan
Klang
Bandar Botanik: Blok A, Jalan Langat, Bandar Botanik, 41200 Klang
Bukit Kuda: Jalan Batu Tiga Lama, 41300 Klang
Meru: PT 55/61, Jalan Kenangan, 41050 Meru
Pelabuhan Klang: Persiaran Raja Muda Musa, 42000 Pelabuhan Klang
Pulau Indah: Jalan Rahmat, 42920 Pulau Indah
Rantau Panjang: Jalan Rantau Panjang, 42100 Klang
Sungai Bertik: Jalan Tepi Sungai, 41100 Klang
Bukit Naga: Seksyen 32, Bukit Naga, 40460 Shah Alam
Hulu Langat
Kajang: Jalan Semenyih, 43000 Kajang
Bandar Baru Bangi: Persiaran 3, Seksyen 3, 43650 Bandar Baru Bangi
Bandar Seri Putra: Jalan Seri Putra, Bandar Seri Putra, 43000 Kajang
Batu 9 Cheras: Batu 9, Cheras, 43200 Cheras
Batu 14 Hulu Langat: Jalan Hulu Langat, Kampung Batu 14, 43100 Hulu Langat
Bandar Tun Hussein Onn: Jalan Suadamai, Bandar Tun Hussein Onn, 43200 Cheras
Balakong: Kampung Baru Balakong, 43300 Balakong
Semenyih: Kampung Baru Cina, 43500 Semenyih
Beranang: Jalan Seremban, 43700 Beranang
Sungai Chua: Kawasan Perindustrian Sungai Chua, 43000 Kajang
Ampang: Jalan Mewah 3, Pekan Ampang, 68000 Ampang
Gombak
Selayang Baru: Jalan Sungai Tua, Mukim Batu, 68100 Batu Caves
Rawang: Jalan Maxwell, 48000 Rawang
Taman Ehsan: Jalan E4/16, Taman Ehsan, 52100 Kepong
Gombak Setia: PT 4453, Lorong Penghulu, Gombak Setia, 53100 Gombak
Batu 8 Gombak: Batu 8, Jalan Gombak Utara, 53100 Gombak
Kuang: Batu 20, Kuang, 48050 Rawang
Batu Arang: JKR G/1325, 48100 Batu Arang
Hulu Kelang: Jalan Datok Abu Samah, Kampung Pasir, 68000 Ampang
AU2 (Taman Keramat): Jalan AU2, Taman Sri Keramat, 54200 Gombak
Sepang
Cyberjaya: Kompleks Kesihatan Cyberjaya, Persiaran Multimedia, 63000 Cyberjaya
Dengkil: Jalan Besar Dengkil, 43800 Dengkil
Salak: Jalan Salak, 43900 Sepang
Sepang: Jalan Kelap, Pekan Sepang, 43900 Sepang
Sungai Pelek: Jalan Sungai Pelek, 43950 Sungai Pelek
Kuala Langat
Telok Datok: Jalan Pegawai, 42700 Banting
Bukit Changgang: Jalan Labohan Dagang, 42700 Banting
Telok Panglima Garang: Pekan Telok Panglima Garang, 42500 Telok Panglima Garang
Jenjarom: Jalan Kampung, 42600 Jenjarom
Sijangkang: Jalan Sekolah, Batu 1, Kg Sijangkang, 42500 Telok Panglima Garang
Sungai Lang: Kampung Sungai Lang Tengah, 42700 Banting
Tanjung Sepat: Jalan Besar, 42800 Tanjung Sepat
Kampung Bandar: Jalan Kurau Chodoi, Bandar, 42700 Banting
Kuala Selangor
Kuala Selangor: Jalan Klinik, 45000 Kuala Selangor
Tanjung Karang: Jalan Sungai Kajang, 45500 Tanjong Karang
Bestari Jaya: Lot 1867, Jalan Kampong, 45600 Bestari Jaya
Jeram: Jalan Klang, 45800 Jeram
Ijok: JKR 1087, Jalan Simpang 3, 45600 Ijok
Bukit Cherakah: Jalan Masjid, Kampung Bukit Cherakah, 45800 Jeram
Hulu Selangor
Kuala Kubu Bharu: Jalan Hospital, 44000 Kuala Kubu Bharu
Bukit Sentosa: Jalan Bukit Sentosa, 48300 Rawang
Serendah: Jalan Besar, 48200 Serendah
Ulu Yam Bharu: Jalan Besar, 44300 Batang Kali
Rasa: Jalan Besar Rasa, 44200 Rasa
Kalumpang: 44100 Kerling
Hulu Bernam: Jalan Besar, 35900 Hulu Bernam
Sabak Bernam
Sabak Bernam: Jalan Raja Chulan, 45200 Sabak Bernam
Sungai Besar: Jalan Sungai Limau, 45300 Sungai Besar
Sekinchan: Jalan Pekan, 45100 Sekinchan
Sungai Air Tawar: Jalan Sekolah, 45100 Sungai Air Tawar
Bagan Terap: Jalan Parit 4, 45300 Sungai Besar"""

CACHE = c.ROOT / "data/raw/geocode_cache.json"
BOX = (2.55, 3.90, 100.75, 102.0)  # Selangor and its edges


def lookup(q, cache):
    if q not in cache:
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 3, "countrycodes": "my"})
        req = urllib.request.Request(url, headers={"User-Agent": "FluSentinel-student-project/0.1"})
        try:
            cache[q] = [(float(r["lat"]), float(r["lon"])) for r in json.load(urllib.request.urlopen(req, timeout=30))]
        except Exception:
            cache[q] = []
        CACHE.write_text(json.dumps(cache))
        time.sleep(1.1)
    return next(((a, b) for a, b in cache[q] if BOX[0] <= a <= BOX[1] and BOX[2] <= b <= BOX[3]), None)


def place(name, kind, district, address, cache):
    clean = re.sub(r"\s*\(.*?\)", "", name)
    queries = [f"{clean}, Selangor, Malaysia"]
    if kind == "clinic":
        queries = [f"Klinik Kesihatan {clean}, Selangor, Malaysia"]
    hit = next((h for h in (lookup(q, cache) for q in queries) if h), None)
    exact = bool(hit)
    if not hit:
        m = re.search(r"(\d{5})\s+(.+)$", address)
        if m:
            hit = lookup(f"{m.group(2)}, {m.group(1)}, Malaysia", cache) or lookup(f"{m.group(2)}, Selangor, Malaysia", cache)
    if not hit:
        return None
    return {"name": ("Klinik Kesihatan " + name) if kind == "clinic" else name, "kind": kind, "district": district,
            "address": address, "lat": round(hit[0], 5), "lon": round(hit[1], 5), "approximate": not exact}


def main():
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    out, missing = [], []
    items = [(n, "government", d, a) for n, d, a in (l.split("|") for l in GOV.splitlines())]
    items += [(n, "private", d, a) for n, d, a in (l.split("|") for l in PRIVATE.splitlines())]
    district = None
    for l in CLINICS.splitlines():
        if ":" not in l:
            district = l.strip()
        else:
            n, a = l.split(":", 1)
            items.append((n.strip(), "clinic", district, a.strip()))
    for n, k, d, a in items:
        p = place(n, k, d, a, cache)
        (out.append(p) if p else missing.append(n))
    c.dump(out, c.ROOT / "site/data/facilities.json")
    for k in ("government", "private", "clinic"):
        s = [p for p in out if p["kind"] == k]
        print(k, len(s), "placed,", sum(p["approximate"] for p in s), "approximate")
    print("not found:", missing)


if __name__ == "__main__":
    main()
