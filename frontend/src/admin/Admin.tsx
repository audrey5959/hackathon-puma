import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, useMap } from "react-leaflet";
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
const pickDemoBin = () => DEMO_POOL[Math.floor(Math.random() * DEMO_POOL.length)].properties.id;
const COLOR: Record<string, string> = { open: "#db6a41", assigned: "#d9a400", idle: "#211d1d" };
const hhmm = (utc: string) => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

export default function Admin() {
  const [cases, refresh] = usePoll<Case[]>("/api/cases");
  const active = new Map((cases ?? []).filter((c) => c.status !== "done").map((c) => [c.bin_id, c]));

  async function simulateSensor(binId?: number) {
    await report(binId ?? pickDemoBin(), "sensor", "full");
    refresh();
  }

  async function move(c: Case, status: "assigned" | "done") {
    await advance(c.id, status);
    refresh();
  }

  return (
    <main className="admin">
      <MapContainer
        center={[25.04, 121.505]}
        zoom={14}
        minZoom={1}
        maxBounds={[[-85, -Infinity], [85, Infinity]]}
        maxBoundsViscosity={1}
        className="map"
      >
        <PositronBasemap />
        {BINS.map((b) => {
          const c = active.get(b.properties.id);
          const [lon, lat] = b.geometry.coordinates;
          return (
            <CircleMarker
              key={b.properties.id}
              center={[lat, lon]}
              radius={c ? 9 : 5}
              pathOptions={{ color: "#fff8f4", weight: 1, fillColor: COLOR[c?.status ?? "idle"], fillOpacity: 0.9 }}
            >
              <Popup>
                <b>#{b.properties.id}</b> {b.properties.address}
                <br />
                <a href={`/b/${b.properties.id}`} target="_blank">開啟市民回報頁（QR Code 網址）</a>
                <br />
                <button onClick={() => simulateSensor(b.properties.id)}>模擬感測器 85% 滿</button>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <aside className="panel">
        <div className="row">
          <h2>待辦</h2>
          <button onClick={() => simulateSensor()}>模擬感測器</button>
        </div>
        {cases?.length === 0 && <p className="muted">目前沒有案件。按「模擬感測器」或用手機開市民回報頁。</p>}
        <ul className="cases">
          {cases?.map((c) => {
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
