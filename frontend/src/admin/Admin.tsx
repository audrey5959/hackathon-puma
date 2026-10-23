import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Layer, Map as MapView, Marker, NavigationControl, Popup, Source, type LayerProps, type MapRef } from "@vis.gl/react-maplibre";
import type { FeatureCollection } from "geojson";
import { useEffect, useRef, useState } from "react";
import bins from "../../../data/bins.json";
import { advance, BINS, binById, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind } from "../shared/api";

// MapLibre 預設從自己檔案的同目錄找 worker；Vite 打包後同目錄沒有這個檔，要明確指定。
// 同一份 maplibregl 也要用 mapLib 傳給 <MapView>，否則 react-maplibre 會自己再載一份，這裡的設定就不生效
maplibregl.setWorkerUrl(workerUrl);

const DEMO_DISTRICTS = ["萬華區", "中正區"];
const DEMO_POOL = BINS.filter((b) => DEMO_DISTRICTS.includes(b.properties.district));
// 跳過已有進行中案件的桶，不然回報會合併進舊案，台上按了按鈕卻沒有新案件
function pickDemoBin(busy: Map<number, Case>) {
  const free = DEMO_POOL.filter((b) => !busy.has(b.properties.id));
  const pool = free.length ? free : DEMO_POOL;
  return pool[Math.floor(Math.random() * pool.length)].properties.id;
}
const hhmm = (utc: string) => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

// OpenFreeMap 免金鑰、無流量限制；淺色底圖讓案件顏色跳出來
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const lons = DEMO_POOL.map((b) => b.geometry.coordinates[0]);
const lats = DEMO_POOL.map((b) => b.geometry.coordinates[1]);
const DEMO_BOUNDS: [number, number, number, number] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];

// 閒置桶由 GPU 畫成小灰點；進行中的案件改用下方的 DOM Marker 畫，這裡把半徑設成 0 避免重疊
// positron 的地名是「拼音＋中文」雙語；台北的圖只留正體中文，讀起來比較乾淨
const ZH_LABEL: maplibregl.ExpressionSpecification = ["coalesce", ["get", "name:zh-Hant"], ["get", "name:nonlatin"], ["get", "name"]];
function applyChineseLabels(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name:latin")) {
      map.setLayoutProperty(layer.id, "text-field", ZH_LABEL);
    }
  }
}

const BIN_LAYER: LayerProps = {
  id: "bins",
  type: "circle",
  paint: {
    "circle-color": ["case", ["boolean", ["feature-state", "hover"], false], "#211d1d", "#8a7f78"],
    // zoom 只能放在最外層的 interpolate，feature-state 判斷放進每個 stop
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"],
      11, ["case", ["boolean", ["feature-state", "active"], false], 0, ["boolean", ["feature-state", "hover"], false], 6, 2],
      14, ["case", ["boolean", ["feature-state", "active"], false], 0, ["boolean", ["feature-state", "hover"], false], 8, 4],
      17, ["case", ["boolean", ["feature-state", "active"], false], 0, ["boolean", ["feature-state", "hover"], false], 11, 7],
    ],
    "circle-stroke-color": "#fff8f4",
    "circle-stroke-width": 1,
    "circle-opacity": 0.85,
  },
};

type Filter = "active" | "done" | "all";
const FILTER_LABEL: Record<Filter, string> = { active: "進行中", done: "已完成", all: "全部" };
const matches = (c: Case, f: Filter) => f === "all" || (f === "done" ? c.status === "done" : c.status !== "done");

const sourceGlyph = (c: Case) => [c.sensor_reports > 0 && "感", c.citizen_reports > 0 && "民"].filter(Boolean).join("");

export default function Admin() {
  const [cases, refresh] = usePoll<Case[]>("/api/cases");
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [toast, setToast] = useState<Case | null>(null);
  const known = useRef<Set<number> | null>(null);
  const activeIds = useRef(new Set<number>());

  const active = new Map((cases ?? []).filter((c) => c.status !== "done").map((c) => [c.bin_id, c]));

  function flyToBin(binId: number) {
    const bin = binById(binId);
    const map = mapRef.current;
    if (!bin || !map) return;
    setSelected(binId);
    map.flyTo({ center: bin.geometry.coordinates as [number, number], zoom: Math.max(map.getZoom(), 16), duration: 800 });
  }

  // 只更新狀態有變的桶，輪詢時不重畫整個圖層
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const next = new Set(active.keys());
    for (const id of activeIds.current) if (!next.has(id)) map.setFeatureState({ source: "bins", id }, { active: false });
    for (const id of next) if (!activeIds.current.has(id)) map.setFeatureState({ source: "bins", id }, { active: true });
    activeIds.current = next;
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || hovered === null) return;
    map.setFeatureState({ source: "bins", id: hovered }, { hover: true });
    return () => {
      map.setFeatureState({ source: "bins", id: hovered }, { hover: false });
    };
  }, [hovered, loaded]);

  // 新案件進來時提示並飛過去；第一次載入的既有案件不提示
  useEffect(() => {
    if (!cases) return;
    if (known.current) {
      const fresh = cases.find((c) => !known.current!.has(c.id));
      if (fresh) {
        setToast(fresh);
        flyToBin(fresh.bin_id);
      }
    }
    known.current = new Set(cases.map((c) => c.id));
  }, [cases]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function simulateSensor(binId?: number) {
    await report(binId ?? pickDemoBin(active), "sensor", "full");
    refresh();
  }

  async function move(c: Case, status: "assigned" | "done") {
    await advance(c.id, status);
    refresh();
  }

  const selectedBin = selected === null ? undefined : binById(selected);
  const selectedCase = selected === null ? undefined : active.get(selected);
  const shown = (cases ?? []).filter((c) => matches(c, filter));

  return (
    <main className="admin">
      <div className="map">
        <MapView
          ref={mapRef}
          mapLib={maplibregl}
          mapStyle={MAP_STYLE}
          initialViewState={{ bounds: DEMO_BOUNDS, fitBoundsOptions: { padding: 40 } }}
          maxBounds={[121.3, 24.85, 121.8, 25.3]}
          interactiveLayerIds={["bins"]}
          cursor={hovered === null ? undefined : "pointer"}
          onLoad={(e) => {
            applyChineseLabels(e.target);
            setLoaded(true);
          }}
          onMouseMove={(e) => setHovered(e.features?.[0] ? Number(e.features[0].id) : null)}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => setSelected(e.features?.[0] ? Number(e.features[0].id) : null)}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source id="bins" type="geojson" data={bins as FeatureCollection} promoteId="id">
            <Layer {...BIN_LAYER} />
          </Source>

          {[...active.values()].map((c) => {
            const [lon, lat] = binById(c.bin_id)!.geometry.coordinates;
            return (
              <Marker
                key={c.bin_id}
                longitude={lon}
                latitude={lat}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setSelected(c.bin_id);
                }}
              >
                <div
                  className={`pin ${c.status}${hovered === c.bin_id || selected === c.bin_id ? " hot" : ""}`}
                  onMouseEnter={() => setHovered(c.bin_id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span>{sourceGlyph(c)}</span>
                </div>
              </Marker>
            );
          })}

          {selectedBin && (
            <Popup
              longitude={selectedBin.geometry.coordinates[0]}
              latitude={selectedBin.geometry.coordinates[1]}
              offset={16}
              closeOnClick={false}
              onClose={() => setSelected(null)}
            >
              <div className="popup">
                <b>#{selectedBin.properties.id}</b> {selectedBin.properties.address}
                {selectedCase && (
                  <div className="muted">
                    案件 #{selectedCase.id}・{STATUS_LABEL[selectedCase.status]}
                  </div>
                )}
                <a href={`/b/${selectedBin.properties.id}`} target="_blank">開啟市民回報頁（QR Code 網址）</a>
                <button onClick={() => simulateSensor(selectedBin.properties.id)}>模擬感測器 85% 滿</button>
              </div>
            </Popup>
          )}
        </MapView>

        <div className="legend">
          <span><i className="dot open" />待處理</span>
          <span><i className="dot assigned" />已指派</span>
          <span><i className="dot idle" />正常</span>
          <span className="muted">感＝感測器　民＝民眾</span>
        </div>

        {toast && (
          <button className="toast" onClick={() => flyToBin(toast.bin_id)}>
            新案件 #{toast.id}（{toast.sensor_reports > 0 ? "感測器" : "民眾"}）{binById(toast.bin_id)?.properties.address}
          </button>
        )}
      </div>

      <aside className="panel">
        <div className="row">
          <h2>待辦</h2>
          <button onClick={() => simulateSensor()}>模擬感測器</button>
        </div>
        <div className="chips">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} {(cases ?? []).filter((c) => matches(c, f)).length}
            </button>
          ))}
        </div>
        {cases?.length === 0 && <p className="muted">目前沒有案件。按「模擬感測器」或用手機開市民回報頁。</p>}
        <ul className="cases">
          {shown.map((c) => {
            const bin = binById(c.bin_id);
            return (
              <li
                key={c.id}
                className={`${c.status}${selected === c.bin_id ? " selected" : ""}`}
                onClick={() => flyToBin(c.bin_id)}
                onMouseEnter={() => setHovered(c.bin_id)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="row">
                  <b>#{c.id} {STATUS_LABEL[c.status]}</b>
                  <span className="muted">{hhmm(c.opened_at)}</span>
                </div>
                <div>{bin?.properties.district} {bin?.properties.address}</div>
                <div className="badges">
                  {c.sensor_reports > 0 && <span className="badge">感測器 ×{c.sensor_reports}</span>}
                  {c.citizen_reports > 0 && <span className="badge">民眾 ×{c.citizen_reports}</span>}
                  {c.kinds?.split(",").map((k) => <span key={k} className="badge kind">{KIND_LABEL[k as Kind]}</span>)}
                </div>
                {c.status === "open" && <button onClick={(e) => { e.stopPropagation(); move(c, "assigned"); }}>指派</button>}
                {c.status === "assigned" && <button onClick={(e) => { e.stopPropagation(); move(c, "done"); }}>標記完成</button>}
              </li>
            );
          })}
        </ul>
      </aside>
    </main>
  );
}
