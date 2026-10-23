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
        <label className="field">
          行政區
          <select value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">全部</option>
            {DISTRICTS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
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
                  {c.sensor_reports > 0 && <span className="badge">感測器 ×{c.sensor_reports}</span>}
                  {c.citizen_reports > 0 && <span className="badge">民眾 ×{c.citizen_reports}</span>}
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
