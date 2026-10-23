# /// script
# requires-python = ">=3.12"
# ///
"""臺北市行人專用清潔箱 CSV 轉 GeoJSON。id 依輸出順序編號，輸出檔進版控後編號固定（QR Code 用）。"""

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

SRC = "https://data.taipei/api/dataset/a835f3ba-7f50-4b0d-91a6-9df128632d1c/resource/267d550f-c6ec-46e0-b8af-fd5a464eb098/download"
OUT = Path(__file__).resolve().parent.parent / "data/bins.json"


def decode(raw: bytes) -> str:
    # 官方檔標示為 Big5，但實際下載過 UTF-8 版本
    for enc in ("utf-8-sig", "big5"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    raise ValueError("unknown encoding")


def num(s: str) -> float:
    # 原始資料有一筆經度寫成 121.513.652
    head, _, tail = s.strip().partition(".")
    return float(f"{head}.{tail.replace('.', '')}")


def main() -> None:
    raw = urllib.request.urlopen(SRC).read()
    rows = list(csv.reader(io.StringIO(decode(raw))))[1:]
    features = []
    for district, address, lon_s, lat_s, *_ in rows:
        lon, lat = num(lon_s), num(lat_s)
        if lon < lat:  # 原始資料有一筆經緯度互換
            lon, lat = lat, lon
        if not (121.4 < lon < 121.7 and 24.9 < lat < 25.25):
            print(f"skip out of bounds: {address}", file=sys.stderr)
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {"id": len(features) + 1, "district": district.strip(), "address": address.strip()},
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    print(f"{len(features)} bins -> {OUT}")


if __name__ == "__main__":
    main()
