# /// script
# requires-python = ">=3.12"
# ///
"""候選點：人流高、附近沒有桶的 200m 格子，輸出 data/candidates.json（GeoJSON 多邊形）。

人流 = 捷運出入口日均進出人次（站的進出量平均分給該站各出入口）＋ YouBike 車位數。
覆蓋 = 格子中心到 data/bins.json 最近一個桶的距離。

  uv run etl/candidates.py                 # 用最新一個月的捷運 OD（約 300 MB，串流處理）
  uv run etl/candidates.py --month 202609
  uv run etl/candidates.py --od local.csv  # 用已下載的 OD 檔
"""

import argparse
import csv
import io
import json
import math
import ssl
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BINS = ROOT / "data/bins.json"
OUT = ROOT / "data/candidates.json"

OD_INDEX = "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=eb481f58-1238-4cff-8caa-fa7bb20cb4f4"
EXITS = "https://data.taipei/api/dataset/cfa4778c-62c1-497b-b704-756231de348b/resource/307a7f61-e302-4108-a817-877ccbfca7c1/download"
YOUBIKE = "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json"

CELL_M = 200  # 格子邊長
MIN_GAP_M = 300  # 最近的桶超過這個距離才算「附近沒有桶」
TAIPEI_YB_M = 500  # 格子 500m 內沒有臺北市 YouBike 站，視為不在臺北市（排除新北的捷運站）
TOP_PER_DISTRICT = 8
# 行政區取最近的 YouBike 站；YouBike 把臺大校園內的站另外標成一區，臺大校總區在大安區
DISTRICT_FIX = {"臺大公館校區": "大安區"}

LAT0, LON0 = 24.95, 121.45
DLAT = CELL_M / 111_320
DLON = CELL_M / (111_320 * math.cos(math.radians(25.05)))


# data.taipei 的憑證缺 Subject Key Identifier，Python 3.13 起預設的嚴格檢查會拒絕；只關掉嚴格旗標，仍照常驗證憑證
TLS = ssl.create_default_context()
TLS.verify_flags &= ~ssl.VERIFY_X509_STRICT


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, context=TLS) as r:
        return r.read()


def dist_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    # 臺北範圍小，用等距圓柱投影就夠準
    x = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 111_320
    return math.hypot(x, y)


def station(name: str) -> str:
    """出入口與 OD 的站名寫法不一致，兩邊都轉成同一種。
    出入口：「西門站出口1」、「台北車站M1出口」；OD：「西門」、「大橋頭站」、「BL板橋」（板橋分兩條線）"""
    name = name.split("出口")[0].replace("臺", "台").removeprefix("BL").removeprefix("Y")
    if name.startswith("台北車站"):
        return "台北車站"
    return name.removesuffix("站")


def od_url(month: str | None) -> str:
    rows = list(csv.reader(io.StringIO(fetch(OD_INDEX).decode("utf-8-sig"))))[1:]
    if month:
        rows = [r for r in rows if f"{r[1]}{int(r[2]):02d}" == month]
        if not rows:
            sys.exit(f"no OD file for {month}")
    return rows[-1][3]


def station_daily(src: str) -> dict[str, float]:
    """每站日均進出人次（進站＋出站）。OD 檔是 UTF-8，一個月約 300 MB，逐行加總不整個讀進記憶體。"""
    stream = open(src, "rb") if Path(src).exists() else urllib.request.urlopen(src, context=TLS)
    total: dict[str, int] = defaultdict(int)
    days = set()
    with stream:
        reader = csv.reader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))
        next(reader)
        for date, _hour, origin, dest, n in reader:
            days.add(date)
            total[station(origin)] += int(n)
            total[station(dest)] += int(n)
    print(f"OD: {len(total)} stations, {len(days)} days", file=sys.stderr)
    return {s: v / len(days) for s, v in total.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="捷運 OD 月份，例如 202609；預設最新")
    ap.add_argument("--od", help="本機的捷運 OD CSV，省略時從網路串流")
    args = ap.parse_args()

    bins = [(f["geometry"]["coordinates"], f["properties"]) for f in json.loads(BINS.read_text())["features"]]
    # 開放資料缺整區（目前是北投區 0 筆，官方說法並非沒有桶），該區算出的「附近沒有桶」不可信，整區不列
    covered = {p["district"] for _, p in bins}
    youbike = [s for s in json.loads(fetch(YOUBIKE)) if s["act"] == "1"]
    exits = list(csv.DictReader(io.StringIO(fetch(EXITS).decode("big5"))))
    daily = station_daily(args.od or od_url(args.month))

    per_station: dict[str, int] = defaultdict(int)
    for e in exits:
        per_station[station(e["出入口名稱"])] += 1
    missing = sorted({s for s in per_station if s not in daily})
    if missing:
        print(f"exits without OD data (skipped): {', '.join(missing)}", file=sys.stderr)

    cells: dict[tuple[int, int], dict] = defaultdict(lambda: {"mrt": 0.0, "exits": [], "yb": 0, "docks": 0})
    key = lambda lon, lat: (math.floor((lon - LON0) / DLON), math.floor((lat - LAT0) / DLAT))
    for e in exits:
        name = station(e["出入口名稱"])
        if name not in daily:
            continue
        c = cells[key(float(e["經度"]), float(e["緯度"]))]
        c["mrt"] += daily[name] / per_station[name]
        c["exits"].append(e["出入口名稱"].replace("臺", "台"))
    for s in youbike:
        c = cells[key(s["longitude"], s["latitude"])]
        c["yb"] += 1
        c["docks"] += s["Quantity"]

    rows = []
    for (ix, iy), c in cells.items():
        lon, lat = LON0 + (ix + 0.5) * DLON, LAT0 + (iy + 0.5) * DLAT
        yb_m, yb = min((dist_m(lon, lat, s["longitude"], s["latitude"]), s) for s in youbike)
        if yb_m > TAIPEI_YB_M:
            continue
        district = DISTRICT_FIX.get(yb["sarea"], yb["sarea"])
        if district not in covered:
            continue
        bin_m, (_, near) = min((dist_m(lon, lat, *coord), (i, p)) for i, (coord, p) in enumerate(bins))
        if bin_m < MIN_GAP_M:
            continue
        rows.append({"ix": ix, "iy": iy, "lon": lon, "lat": lat, "district": district, "bin_m": bin_m, "bin": near, **c})

    # 人流指數 0–100：捷運占 7 成（取 log，避免台北車站一站獨大）、YouBike 車位占 3 成
    max_mrt = max(math.log1p(r["mrt"]) for r in rows)
    max_docks = max(r["docks"] for r in rows)
    for r in rows:
        r["score"] = round(100 * (0.7 * math.log1p(r["mrt"]) / max_mrt + 0.3 * r["docks"] / max_docks))
    rows.sort(key=lambda r: (-r["score"], -r["bin_m"]))

    # 每區各取前幾名，不取全市前幾名：否則人流少的區（例如萬華）一格都不會出現，管理端依行政區篩選時是空的
    picked: list[dict] = []
    per_district: dict[str, int] = defaultdict(int)
    for r in rows:
        if per_district[r["district"]] < TOP_PER_DISTRICT:
            per_district[r["district"]] += 1
            picked.append(r)

    features = []
    for r in picked:
        x0, y0 = LON0 + r["ix"] * DLON, LAT0 + r["iy"] * DLAT
        ring = [[x0, y0], [x0 + DLON, y0], [x0 + DLON, y0 + DLAT], [x0, y0 + DLAT], [x0, y0]]
        reasons = []
        if r["exits"]:
            stations = Counter(station(e) for e in r["exits"])
            names = "、".join(f"{s if s == '台北車站' else s + '站'}（{n} 個出口）" for s, n in stations.items())
            reasons.append(f"捷運{names}，日均進出約 {r['mrt'] / 10_000:.1f} 萬人次")
        if r["yb"]:
            reasons.append(f"YouBike {r['yb']} 站、{r['docks']} 個車位")
        reasons.append(f"最近的桶在 {round(r['bin_m'], -1):.0f} m 外（#{r['bin']['id']} {r['bin']['address']}）")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]},
            "properties": {
                "id": len(features) + 1,
                "district": r["district"],
                "score": r["score"],
                "mrt_daily": round(r["mrt"]),
                "mrt_exits": r["exits"],
                "youbike_stations": r["yb"],
                "youbike_docks": r["docks"],
                "nearest_bin_m": round(r["bin_m"]),
                "nearest_bin_id": r["bin"]["id"],
                "reasons": reasons,
            },
        })
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    print(f"{len(rows)} cells without a bin within {MIN_GAP_M} m; top {TOP_PER_DISTRICT} per district, {len(features)} -> {OUT}")


if __name__ == "__main__":
    main()
