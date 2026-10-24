# /// script
# requires-python = ">=3.12"
# ///
"""垃圾車停靠點：臺北市每個停靠點一筆，輸出 data/trucks.json（GeoJSON 點）。

來源是臺北市「垃圾車點位路線資訊」（https://data.gov.tw/dataset/136515 ），一列就是一個停靠點。
同一個地點被多條路線或多個車次停靠時，各自保留一筆，用 arrive 區分。

  uv run etl/trucks.py
"""

import csv
import io
import json
import re
import ssl
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/trucks.json"

SRC = "https://data.taipei/api/dataset/6bb3304b-4f46-4bb0-8cd1-60c66dcd1cae/resource/a6e90031-7ec4-4089-afb5-361a4efe7202/download"

LON_RANGE = (121.4, 121.7)
LAT_RANGE = (24.9, 25.25)


# data.taipei 的憑證缺 Subject Key Identifier，Python 3.13 起預設的嚴格檢查會拒絕；只關掉嚴格旗標，仍照常驗證憑證
TLS = ssl.create_default_context()
TLS.verify_flags &= ~ssl.VERIFY_X509_STRICT


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, context=TLS) as r:
        return r.read()


def hhmm(s: str) -> str | None:
    s = s.strip()
    if not re.fullmatch(r"\d{3,4}", s):
        return None
    s = s.zfill(4)
    return f"{s[:2]}:{s[2:]}" if int(s[:2]) < 24 and int(s[2:]) < 60 else None


def main() -> None:
    rows = csv.DictReader(io.StringIO(fetch(SRC).decode("utf-8-sig")))
    features, dropped = [], 0
    for r in rows:
        try:
            lon, lat = round(float(r["經度"]), 6), round(float(r["緯度"]), 6)
        except ValueError:
            dropped += 1
            continue
        arrive = hhmm(r["抵達時間"])
        if arrive is None or not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            dropped += 1
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "district": r["行政區"],
                    "village": r["里別"].strip(),
                    "address": r["地點"].strip(),
                    "arrive": arrive,
                    "leave": hhmm(r["離開時間"]) or arrive,
                    "route": r["路線"].strip(),
                },
            }
        )
    features.sort(key=lambda f: (f["properties"]["district"], f["properties"]["arrive"]))
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    kept = Counter(f["properties"]["district"] for f in features)
    print(f"{len(features)} stops -> {OUT.relative_to(ROOT)}, dropped {dropped}, kept {dict(kept)}")


if __name__ == "__main__":
    main()
