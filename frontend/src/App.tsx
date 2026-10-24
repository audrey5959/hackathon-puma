import { lazy, Suspense } from "react";
import Citizen from "./citizen/Citizen";

// 市民回報頁不需要地圖，拆開載入，手機掃 QR Code 時不必下載 MapLibre
const Admin = lazy(() => import("./admin/Admin"));
const Dashboard = lazy(() => import("./admin/Dashboard"));
const BinMap = lazy(() => import("./citizen/BinMap"));

// vite.config.ts 在 build 時注入
declare const __BUILD__: { sha: string; short: string; time: string; iso: string; dev: boolean };

// 正式環境跑的是哪個 commit；dev server 標成 -dev，一看就知道不是正式版
function Version() {
  const b = __BUILD__;
  return (
    <span className="version" title={`commit ${b.sha}\nbuild ${b.iso}${b.dev ? "（dev server）" : ""}`}>
      {b.dev ? `${b.short}-dev` : <>{b.short}<span className="version-time"> · {b.time}</span></>}
    </span>
  );
}

export default function App() {
  const bin = location.pathname.match(/^\/b\/(\d+)$/);
  const dashboard = location.pathname === "/status";
  const finder = location.pathname === "/map";
  return (
    <>
      <header className="bar">
        <a href={bin || finder ? "/map" : "/"} className="brand">桶緝犯</a>
        {bin || finder ? (
          <nav className="nav" aria-label="市民端">
            <a href="/map" aria-current={finder ? "page" : undefined}>地圖找桶</a>
          </nav>
        ) : (
          <nav className="nav" aria-label="管理端">
            <a href="/" aria-current={dashboard ? undefined : "page"}>待辦</a>
            <a href="/status" aria-current={dashboard ? "page" : undefined}>清潔狀態</a>
          </nav>
        )}
        <span className="tag">模擬資料：回報、案件與感測器數值皆為測試資料；桶位為臺北市開放資料</span>
        <Version />
      </header>
      {bin ? (
        <Citizen binId={Number(bin[1])} />
      ) : (
        <Suspense fallback={<p className="muted loading">{dashboard ? "載入清潔狀態中…" : "載入地圖中…"}</p>}>
          {dashboard ? <Dashboard /> : finder ? <BinMap /> : <Admin />}
        </Suspense>
      )}
    </>
  );
}
