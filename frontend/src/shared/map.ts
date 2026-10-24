import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// 管理端與市民地圖共用的 MapLibre 設定。只能從 lazy() 載入的頁面引用，
// 否則 /b/<桶編號> 回報頁也會把 MapLibre 打包進去

// MapLibre 預設從自己檔案的同目錄找 worker；Vite 打包後同目錄沒有這個檔，要明確指定。
// 同一份 maplibregl 也要用 mapLib 傳給 <MapView>，否則 react-maplibre 會自己再載一份，這裡的設定就不生效
maplibregl.setWorkerUrl(workerUrl);
export { maplibregl };

// OpenFreeMap 免金鑰、無流量限制；淺色底圖讓案件顏色跳出來
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const MAX_BOUNDS: [number, number, number, number] = [121.3, 24.85, 121.8, 25.3];

// positron 的地名是「拼音＋中文」雙語；台北的圖只留正體中文，讀起來比較乾淨
const ZH_LABEL: maplibregl.ExpressionSpecification = ["coalesce", ["get", "name:zh-Hant"], ["get", "name:nonlatin"], ["get", "name"]];
export function applyChineseLabels(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name:latin")) {
      map.setLayoutProperty(layer.id, "text-field", ZH_LABEL);
    }
  }
}
