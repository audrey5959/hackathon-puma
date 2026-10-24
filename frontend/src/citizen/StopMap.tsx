import { Map as MapView, Marker, type MapRef } from "@vis.gl/react-maplibre";
import { useEffect, useRef } from "react";
import { applyChineseLabels, maplibregl, MAP_STYLE, MAX_BOUNDS } from "../shared/map";

// 只畫清單上那幾站，不把全市停靠點放進地圖。由 Trash lazy 載入，/trash 打開時不下載 MapLibre
export type MapStop = { coords: number[]; address: string; arrive: string; route: string };

export default function StopMap({ here, hereLabel, stops }: { here: number[]; hereLabel: string; stops: MapStop[] }) {
  const mapRef = useRef<MapRef>(null);
  const ready = useRef(false);
  const frame = useRef({ here, stops });
  const signature = `${here[0]},${here[1]}|${stops.map((s) => `${s.route} ${s.arrive} ${s.coords[0]},${s.coords[1]}`).join(";")}`;

  useEffect(() => {
    frame.current = { here, stops };
  }, [here, stops]);

  function fit() {
    const map = mapRef.current;
    const { here: origin, stops: list } = frame.current;
    if (!map || !ready.current || list.length === 0) return;
    const lons = [origin[0], ...list.map((s) => s.coords[0])];
    const lats = [origin[1], ...list.map((s) => s.coords[1])];
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 16, duration: 0 },
    );
  }

  useEffect(() => {
    fit();
  }, [signature]);

  return (
    <div className="stop-map" id="stop-map" role="region" aria-label="附近停靠點">
      <MapView
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={MAP_STYLE}
        initialViewState={{ longitude: here[0], latitude: here[1], zoom: 14 }}
        maxBounds={MAX_BOUNDS}
        style={{ width: "100%", height: "100%" }}
        onLoad={(e) => {
          applyChineseLabels(e.target);
          ready.current = true;
          fit();
        }}
      >
        <Marker longitude={here[0]} latitude={here[1]} anchor="center" style={{ zIndex: 1 }}>
          <div className="me" role="img" aria-label={hereLabel} />
        </Marker>
        {stops.map((s, i) => (
          <Marker
            key={`${s.route}-${s.arrive}-${s.coords[0]}-${s.coords[1]}`}
            longitude={s.coords[0]}
            latitude={s.coords[1]}
            anchor="center"
            style={{ zIndex: i === 0 ? 3 : 2 }}
          >
            <div className={i === 0 ? "stop-pin first" : "stop-pin"} role="img" aria-label={i === 0 ? `下一班 ${s.address}` : s.address}>
              {i + 1}
            </div>
          </Marker>
        ))}
      </MapView>
    </div>
  );
}
