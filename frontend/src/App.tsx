import { lazy, Suspense } from "react";
import Citizen from "./citizen/Citizen";

// 市民回報頁不需要地圖，拆開載入，手機掃 QR Code 時不必下載 MapLibre
const Admin = lazy(() => import("./admin/Admin"));

export default function App() {
  const bin = location.pathname.match(/^\/b\/(\d+)$/);
  return (
    <>
      <header className="bar">
        <a href="/" className="brand">桶緝犯</a>
        <span className="tag">模擬資料：回報、案件與感測器數值皆為測試資料；桶位為臺北市開放資料</span>
      </header>
      {bin ? (
        <Citizen binId={Number(bin[1])} />
      ) : (
        <Suspense fallback={<p className="muted loading">載入地圖中…</p>}>
          <Admin />
        </Suspense>
      )}
    </>
  );
}
