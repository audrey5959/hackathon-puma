import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Layer, Map as MapView, Marker, NavigationControl, Popup, Source, type LayerProps, type MapRef } from "@vis.gl/react-maplibre";
import type { FeatureCollection } from "geojson";
import { useEffect, useRef, useState } from "react";
import bins from "../../../data/bins.json";
import { advance, BINS, binById, clearCases, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind } from "../shared/api";

// MapLibre 預設從自己檔案的同目錄找 worker；Vite 打包後同目錄沒有這個檔，要明確指定。
// 同一份 maplibregl 也要用 mapLib 傳給 <MapView>，否則 react-maplibre 會自己再載一份，這裡的設定就不生效
maplibregl.setWorkerUrl(workerUrl);

const DEMO_DISTRICTS = ["萬華區", "中正區"];
const DEMO_POOL = BINS.filter((b) => DEMO_DISTRICTS.includes(b.properties.district));
const DISTRICT_ORDER = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"];
const DISTRICTS = [...new Set(BINS.map((b) => b.properties.district))].sort((a, b) => {
  const rank = (name: string) => {
    const i = DISTRICT_ORDER.indexOf(name);
    return i === -1 ? DISTRICT_ORDER.length : i;
  };
  return rank(a) - rank(b);
});
const hhmm = (utc: string) => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

// 跳過已有進行中案件的桶，不然回報會合併進舊案，台上按了按鈕卻沒有新案件
function pickBin(district: string, busy: Map<number, Case>) {
  const all = district ? BINS.filter((b) => b.properties.district === district) : DEMO_POOL;
  const free = all.filter((b) => !busy.has(b.properties.id));
  const pool = free.length ? free : all;
  return pool[Math.floor(Math.random() * pool.length)].properties.id;
}

type Bounds = [number, number, number, number];
function boundsOf(pool: typeof BINS): Bounds {
  const lons = pool.map((b) => b.geometry.coordinates[0]);
  const lats = pool.map((b) => b.geometry.coordinates[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
const DEMO_BOUNDS = boundsOf(DEMO_POOL);
const districtBounds = (district: string) => (district ? boundsOf(BINS.filter((b) => b.properties.district === district)) : DEMO_BOUNDS);

// OpenFreeMap 免金鑰、無流量限制；淺色底圖讓案件顏色跳出來
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// positron 的地名是「拼音＋中文」雙語；台北的圖只留正體中文，讀起來比較乾淨
const ZH_LABEL: maplibregl.ExpressionSpecification = ["coalesce", ["get", "name:zh-Hant"], ["get", "name:nonlatin"], ["get", "name"]];
function applyChineseLabels(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name:latin")) {
      map.setLayoutProperty(layer.id, "text-field", ZH_LABEL);
    }
  }
}

// 閒置桶由 GPU 畫成小灰點；進行中的案件改用下方的 DOM Marker 畫，這裡把半徑設成 0 避免重疊
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

function SensorIcon() {
  return (
    <svg className="badge-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="11" r="1.3" fill="currentColor" />
      <path d="M5.2 8.2a3.4 3.4 0 0 1 5.6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2.8 5.4a6.6 6.6 0 0 1 10.4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CitizenIcon() {
  return (
    <svg className="badge-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.4 13.2a4.6 4.6 0 0 1 9.2 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DistrictSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0, maxHeight: 320 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const items = ["", ...options];

  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(440, Math.max(160, window.innerHeight - rect.bottom - 12)),
    });
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onLayout = () => place();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  }, [open]);

  return (
    <div className="field district" ref={root}>
      <label id="district-label" htmlFor="district-trigger">行政區</label>
      <button
        id="district-trigger"
        ref={trigger}
        type="button"
        className="district-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="district-menu"
        aria-labelledby="district-label district-value"
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
      >
        <span id="district-value">{value || "全部"}</span>
        <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          id="district-menu"
          ref={menu}
          className="district-menu"
          role="listbox"
          aria-labelledby="district-label"
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [...event.currentTarget.querySelectorAll("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
            buttons[next]?.focus();
          }}
        >
          {items.map((name) => (
            <li key={name || "all"} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={name === value}
                className={name === value ? "on" : undefined}
                onClick={() => {
                  onChange(name);
                  close();
                }}
              >
                {name || "全部"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Admin() {
  const [cases, refresh] = usePoll<Case[]>("/api/cases");
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [district, setDistrict] = useState("");
  const [toast, setToast] = useState<Case | null>(null);
  const known = useRef<Set<number> | null>(null);
  const activeIds = useRef(new Set<number>());

  const inDistrict = (c: Case) => !district || binById(c.bin_id)?.properties.district === district;
  const active = new Map((cases ?? []).filter((c) => c.status !== "done").map((c) => [c.bin_id, c]));
  const visible = (cases ?? []).filter(inDistrict);

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

  // 切換行政區時框住該區；選「全部」回到示範區域。第一次載入由 initialViewState 處理
  const firstDistrict = useRef(true);
  useEffect(() => {
    if (firstDistrict.current) {
      firstDistrict.current = false;
      return;
    }
    mapRef.current?.fitBounds(districtBounds(district), { padding: 36, maxZoom: 16, duration: 700 });
  }, [district]);

  // 新案件進來時提示；在目前篩選的行政區內才飛過去。第一次載入的既有案件不提示
  useEffect(() => {
    if (!cases) return;
    if (known.current) {
      const fresh = cases.find((c) => !known.current!.has(c.id));
      if (fresh) {
        setToast(fresh);
        if (!district || binById(fresh.bin_id)?.properties.district === district) flyToBin(fresh.bin_id);
      }
    }
    known.current = new Set(cases.map((c) => c.id));
  }, [cases, district]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function simulateSensor(binId?: number) {
    await report(binId ?? pickBin(district, active), "sensor", "full");
    refresh();
  }

  async function move(c: Case, status: "assigned" | "done") {
    await advance(c.id, status);
    refresh();
  }

  const selectedBin = selected === null ? undefined : binById(selected);
  const selectedCase = selected === null ? undefined : active.get(selected);
  const shown = visible.filter((c) => matches(c, filter));

  async function clearAll() {
    if (!confirm("清除本機所有案件與回報？")) return;
    await clearCases();
    refresh();
  }

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

          {/* 圓形＝待處理、菱形＝已指派；其他行政區的案件淡化但不隱藏 */}
          {[...active.values()].map((c) => {
            const [lon, lat] = binById(c.bin_id)!.geometry.coordinates;
            const hot = hovered === c.bin_id || selected === c.bin_id;
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
                  className={`pin ${c.status}${hot ? " hot" : ""}${inDistrict(c) ? "" : " dim"}`}
                  onMouseEnter={() => setHovered(c.bin_id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span>
                    {c.sensor_reports > 0 && <SensorIcon />}
                    {c.citizen_reports > 0 && <CitizenIcon />}
                  </span>
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
          <span className="muted"><SensorIcon />感測器</span>
          <span className="muted"><CitizenIcon />民眾</span>
        </div>

        {toast && (
          <button className="toast" onClick={() => flyToBin(toast.bin_id)}>
            新案件 #{toast.id}（{toast.sensor_reports > 0 ? "感測器" : "民眾"}）{binById(toast.bin_id)?.properties.district} {binById(toast.bin_id)?.properties.address}
          </button>
        )}
      </div>

      <aside className="panel">
        <div className="row">
          <h2>待辦</h2>
          <button onClick={() => simulateSensor()}>模擬感測器</button>
          {import.meta.env.DEV && <button onClick={clearAll}>清除案件</button>}
        </div>
        <DistrictSelect value={district} options={DISTRICTS} onChange={setDistrict} />
        <div className="chips">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} {visible.filter((c) => matches(c, f)).length}
            </button>
          ))}
        </div>
        {cases && visible.length === 0 && (
          <p className="muted">{district ? `${district}目前沒有案件。` : "目前沒有案件。按「模擬感測器」或用手機開市民回報頁。"}</p>
        )}
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
                  {c.sensor_reports > 0 && <span className="badge"><SensorIcon />感測器 ×{c.sensor_reports}</span>}
                  {c.citizen_reports > 0 && <span className="badge"><CitizenIcon />民眾 ×{c.citizen_reports}</span>}
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
