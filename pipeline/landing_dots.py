"""Write site/data/dots.json: the dotted Earth for the landing page.

World land comes from Natural Earth 110m (public domain); Malaysia from the district
boundaries already in data/raw. Standard library only.
"""
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAND = ROOT / "data" / "raw" / "ne_110m_land.geojson"
LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
MYS = ROOT / "data" / "raw" / "mys_adm2.geojson"
STEP = 1.8        # degrees between world dots
MYS_STEP = 0.36   # finer dots inside Malaysia


def rings(path):
    out = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            ring = poly[0]
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            out.append((min(xs), min(ys), max(xs), max(ys), ring))
    return out


def inside(x, y, shapes):
    for x0, y0, x1, y1, ring in shapes:
        if x < x0 or x > x1 or y < y0 or y > y1:
            continue
        hit, j = False, len(ring) - 1
        for i in range(len(ring)):
            xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
        if hit:
            return True
    return False


def main():
    if not LAND.exists():
        urllib.request.urlretrieve(LAND_URL, LAND)
    land, mys = rings(LAND), rings(MYS)
    world = []
    lat = -60.0
    while lat <= 84:
        n = max(1, round(360 * math.cos(math.radians(lat)) / STEP))
        for k in range(n):
            lon = -180 + 360 * (k + 0.5) / n
            if inside(lon, lat, land) and not inside(lon, lat, mys):
                world.append([round(lon, 1), round(lat, 1)])
        lat += STEP
    my = []
    lat = 0.8
    while lat <= 7.6:
        lon = 99.5
        while lon <= 119.5:
            if inside(lon, lat, mys):
                my.append([round(lon, 2), round(lat, 2)])
            lon += MYS_STEP
        lat += MYS_STEP
    out = ROOT / "site" / "data" / "dots.json"
    out.write_text(json.dumps({"source": "Natural Earth 110m land; geoBoundaries Malaysia districts",
                               "land": world, "malaysia": my}, separators=(",", ":")), encoding="utf-8")
    print("world dots", len(world), "| malaysia dots", len(my), "|", out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
