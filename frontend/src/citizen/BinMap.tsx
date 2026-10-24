import { Layer, Map as MapView, Marker, NavigationControl, Source, type LayerProps, type MapLayerMouseEvent, type MapRef } from "@vis.gl/react-maplibre";
import type { ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { useEffect, useRef, useState } from "react";
import bins from "../../../data/bins.json";
import { BINS, binById, KIND_LABEL, STATUS_LABEL, usePoll, type Case, type Kind } from "../shared/api";
import { applyChineseLabels, maplibregl, MAP_STYLE, MAX_BOUNDS } from "../shared/map";

// 市民地圖：在地圖上找桶、點桶回報。桶的顏色看未完成案件的回報種類
type Level = "idle" | "urgent" | "dirty";
const LEVEL_LABEL: Record<Level, string> = { idle: "正常", urgent: "滿了／沒有桶", dirty: "髒亂" };
// 同一個案件可能同時有「髒亂」和「滿了」，有一筆不是髒亂就算急件
const levelOf = (c: Case): Level => (c.kinds && c.kinds.split(",").every((k) => k === "dirty") ? "dirty" : "urgent");

// 預設範圍和管理端一樣框住示範區域；拒絕定位時就停在這裡
const DEFAULT_POOL = BINS.filter((b) => ["萬華區", "中正區"].includes(b.properties.district));
const DEFAULT_BOUNDS: [number, number, number, number] = [
  Math.min(...DEFAULT_POOL.map((b) => b.geometry.coordinates[0])),
  Math.min(...DEFAULT_POOL.map((b) => b.geometry.coordinates[1])),
  Math.max(...DEFAULT_POOL.map((b) => b.geometry.coordinates[0])),
  Math.max(...DEFAULT_POOL.map((b) => b.geometry.coordinates[1])),
];
const inTaipei = ([lon, lat]: [number, number]) => lon >= MAX_BOUNDS[0] && lat >= MAX_BOUNDS[1] && lon <= MAX_BOUNDS[2] && lat <= MAX_BOUNDS[3];

// 手指比滑鼠粗：點擊時找這個半徑（px）內最近的桶，不必剛好點中圓點
const TAP_RADIUS = 18;

const level: ExpressionSpecification = ["coalesce", ["feature-state", "level"], "idle"];
const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
// zoom 只能放在最外層的 interpolate，feature-state 判斷放進每個 stop
const radius = (idle: number, flagged: number): ExpressionSpecification => ["case", selected, flagged + 3, ["==", level, "idle"], idle, flagged];
const BIN_LAYER: LayerProps = {
  id: "bins",
  type: "circle",
  paint: {
    "circle-color": ["match", level, "urgent", "#db6a41", "dirty", "#d9a400", "#8a7f78"],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, radius(3, 5), 14, radius(5, 8), 17, radius(9, 12)],
    "circle-stroke-color": ["case", selected, "#211d1d", "#fff8f4"],
    "circle-stroke-width": ["case", selected, 3, 1.5],
  },
};

export default function BinMap() {
  // 市民端人數多，輪詢放慢一點；管理端完成案件後幾秒內顏色就會更新
  const [cases] = usePoll<Case[]>("/api/cases", 5000);
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState("");
  const levels = useRef(new Map<number, Level>());

  // 新的在前，同一個桶只取最新的未完成案件
  const open = new Map<number, Case>();
  for (const c of cases ?? []) if (c.status !== "done" && !open.has(c.bin_id)) open.set(c.bin_id, c);

  // 只更新顏色有變的桶，輪詢時不重畫整個圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const next = new Map([...open].map(([id, c]) => [id, levelOf(c)]));
    for (const id of levels.current.keys()) if (!next.has(id)) map.setFeatureState({ source: "bins", id }, { level: "idle" });
    for (const [id, l] of next) if (levels.current.get(id) !== l) map.setFeatureState({ source: "bins", id }, { level: l });
    levels.current = next;
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || picked === null) return;
    map.setFeatureState({ source: "bins", id: picked }, { selected: true });
    return () => {
      map.setFeatureState({ source: "bins", id: picked }, { selected: false });
    };
  }, [picked, loaded]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function pick(e: MapLayerMouseEvent) {
    const map = e.target;
    const { x, y } = e.point;
    const near = map.queryRenderedFeatures([[x - TAP_RADIUS, y - TAP_RADIUS], [x + TAP_RADIUS, y + TAP_RADIUS]], { layers: ["bins"] });
    let best: number | null = null;
    let bestDist = Infinity;
    for (const f of near) {
      const p = map.project(binById(Number(f.id)).geometry.coordinates as [number, number]);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bestDist) [best, bestDist] = [Number(f.id), dist];
    }
    setPicked(best);
  }

  function locate() {
    if (!navigator.geolocation) {
      setNotice("這個瀏覽器不支援定位，可以直接拖曳地圖找桶。");
      return;
    }
    setLocating(true);
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        if (!inTaipei(here)) {
          setNotice("你目前不在臺北市，地圖停在預設範圍。");
          return;
        }
        setMe(here);
        mapRef.current?.flyTo({ center: here, zoom: 16, duration: 800 });
      },
      (err) => {
        setLocating(false);
        setNotice(err.code === err.PERMISSION_DENIED ? "沒有定位權限，可以直接拖曳地圖找桶。" : "暫時無法定位，可以直接拖曳地圖找桶。");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  const bin = picked === null ? undefined : binById(picked);
  const c = picked === null ? undefined : open.get(picked);
  const state: Level = c ? levelOf(c) : "idle";

  return (
    <main className="finder">
      <MapView
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={MAP_STYLE}
        initialViewState={{ bounds: DEFAULT_BOUNDS, fitBoundsOptions: { padding: 24 } }}
        maxBounds={MAX_BOUNDS}
        onLoad={(e) => {
          applyChineseLabels(e.target);
          setLoaded(true);
        }}
        onClick={pick}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <Source id="bins" type="geojson" data={bins as FeatureCollection} promoteId="id">
          <Layer {...BIN_LAYER} />
        </Source>
        {me && (
          <Marker longitude={me[0]} latitude={me[1]}>
            <div className="me" aria-label="你的位置" />
          </Marker>
        )}
      </MapView>

      <div className="legend">
        {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
          <span key={l}><i className={`dot ${l}`} />{LEVEL_LABEL[l]}</span>
        ))}
      </div>

      <div className="finder-foot">
        {notice && <p className="notice" role="status">{notice}</p>}
        <button className="locate" disabled={locating} onClick={locate}>{locating ? "定位中…" : "定位到我附近"}</button>
        {bin ? (
          <section className="sheet">
            <div className="row">
              <span className="muted">{bin.properties.district}・桶 #{bin.properties.id}</span>
              <button className="close" aria-label="關閉" onClick={() => setPicked(null)}>×</button>
            </div>
            <h2>{bin.properties.address}</h2>
            <p className={`state ${state}`}>
              {c
                ? `已有人回報${c.kinds.split(",").map((k) => `「${KIND_LABEL[k as Kind]}」`).join("")}・${STATUS_LABEL[c.status]}`
                : "目前沒有待處理的回報"}
            </p>
            <a className="cta" href={`/b/${bin.properties.id}`}>回報這個桶</a>
            <a
              className="muted"
              href={`https://www.google.com/maps/dir/?api=1&destination=${bin.geometry.coordinates[1]},${bin.geometry.coordinates[0]}&travelmode=walking`}
              target="_blank"
              rel="noreferrer"
            >
              用 Google 地圖導航
            </a>
          </section>
        ) : (
          <p className="hint">點地圖上的桶，就能回報它的狀況</p>
        )}
      </div>
    </main>
  );
}
