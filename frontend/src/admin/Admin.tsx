import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { divIcon, latLngBounds } from "leaflet";
import { CircleMarker, MapContainer, Marker, Popup, useMap } from "react-leaflet";
import { advance, BINS, binById, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind } from "../shared/api";

setWorkerUrl(workerUrl);

const POSITRON_STYLE = "https://tiles.openfreemap.org/styles/positron";

function PositronBasemap() {
  const map = useMap();
  useEffect(() => {
    const layer = maplibreGL({ style: POSITRON_STYLE }).addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);
  return null;
}

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
const CITY_CENTER: [number, number] = [25.04, 121.505];
const CITY_ZOOM = 14;
const COLOR: Record<string, string> = { open: "#db6a41", assigned: "#d9a400", idle: "#211d1d" };
const hhmm = (utc: string) => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

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
const TRASH_ICON = divIcon({
  className: "trash-pin",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
  html: `<span class="trash-pin-dot"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff8f4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg></span>`,
});

function pickBin(district: string) {
  const pool = district ? BINS.filter((b) => b.properties.district === district) : DEMO_POOL;
  return pool[Math.floor(Math.random() * pool.length)].properties.id;
}

function pointsIn(district: string): [number, number][] {
  return BINS.flatMap((b) =>
    b.properties.district === district ? [[b.geometry.coordinates[1], b.geometry.coordinates[0]] as [number, number]] : [],
  );
}

function FocusDistrict({ district }: { district: string }) {
  const map = useMap();
  const skipCity = useRef(true);
  useEffect(() => {
    if (!district) {
      if (skipCity.current) {
        skipCity.current = false;
        return;
      }
      map.flyTo(CITY_CENTER, CITY_ZOOM, { duration: 0.7 });
      return;
    }
    skipCity.current = false;
    const points = pointsIn(district);
    if (points.length === 0) return;
    map.flyToBounds(latLngBounds(points), { padding: [36, 36], maxZoom: 16, duration: 0.7 });
  }, [district, map]);
  return null;
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

function BinPopup({ id, address, onSimulate }: { id: number; address: string; onSimulate: () => void }) {
  return (
    <Popup>
      <b>#{id}</b> {address}
      <br />
      <a href={`/b/${id}`} target="_blank">開啟市民回報頁（QR Code 網址）</a>
      <br />
      <button onClick={onSimulate}>模擬感測器 85% 滿</button>
    </Popup>
  );
}

export default function Admin() {
  const [cases, refresh] = usePoll<Case[]>("/api/cases");
  const [district, setDistrict] = useState("");
  const active = new Map((cases ?? []).filter((c) => c.status !== "done").map((c) => [c.bin_id, c]));
  const visible = (cases ?? []).filter((c) => !district || binById(c.bin_id)?.properties.district === district);
  const pinned = new Set(visible.filter((c) => c.status !== "done").map((c) => c.bin_id));

  async function simulateSensor(binId?: number) {
    await report(binId ?? pickBin(district), "sensor", "full");
    refresh();
  }

  async function move(c: Case, status: "assigned" | "done") {
    await advance(c.id, status);
    refresh();
  }

  return (
    <main className="admin">
      <MapContainer
        center={CITY_CENTER}
        zoom={CITY_ZOOM}
        minZoom={1}
        maxBounds={[[-85, -Infinity], [85, Infinity]]}
        maxBoundsViscosity={1}
        className="map"
      >
        <PositronBasemap />
        <FocusDistrict district={district} />
        {BINS.map((b) => {
          if (pinned.has(b.properties.id)) return null;
          const c = active.get(b.properties.id);
          const [lon, lat] = b.geometry.coordinates;
          return (
            <CircleMarker
              key={b.properties.id}
              center={[lat, lon]}
              radius={c ? 9 : 5}
              pathOptions={{ color: "#fff8f4", weight: 1, fillColor: COLOR[c?.status ?? "idle"], fillOpacity: 0.9 }}
            >
              <BinPopup id={b.properties.id} address={b.properties.address} onSimulate={() => simulateSensor(b.properties.id)} />
            </CircleMarker>
          );
        })}
        {visible.filter((c) => c.status !== "done").map((c) => {
          const bin = binById(c.bin_id);
          if (!bin) return null;
          const [lon, lat] = bin.geometry.coordinates;
          return (
            <Marker key={c.id} position={[lat, lon]} icon={TRASH_ICON} zIndexOffset={500}>
              <BinPopup id={bin.properties.id} address={bin.properties.address} onSimulate={() => simulateSensor(bin.properties.id)} />
            </Marker>
          );
        })}
      </MapContainer>

      <aside className="panel">
        <div className="row">
          <h2>待辦</h2>
          <button onClick={() => simulateSensor()}>模擬感測器</button>
        </div>
        <DistrictSelect value={district} options={DISTRICTS} onChange={setDistrict} />
        {cases && visible.length === 0 && (
          <p className="muted">{district ? `${district}目前沒有案件。` : "目前沒有案件。按「模擬感測器」或用手機開市民回報頁。"}</p>
        )}
        <ul className="cases">
          {visible.map((c) => {
            const bin = binById(c.bin_id);
            return (
              <li key={c.id} className={c.status}>
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
                {c.status === "open" && <button onClick={() => move(c, "assigned")}>指派</button>}
                {c.status === "assigned" && <button onClick={() => move(c, "done")}>標記完成</button>}
              </li>
            );
          })}
        </ul>
      </aside>
    </main>
  );
}
