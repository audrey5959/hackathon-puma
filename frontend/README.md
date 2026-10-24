# 桶緝犯 frontend

Vite + React + MapLibre GL（@vis.gl/react-maplibre）。前端 Worker `tongjifan` 提供靜態檔，並把 `/api/*` 轉給後端 Worker `tongjifan-api`。架構與 API 合約見 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

| 路由 | 畫面 | 程式 |
|---|---|---|
| `/` | 管理端：地圖、待辦、模擬感測器 | `src/admin/Admin.tsx` |
| `/status` | 管理端：各區清潔狀態 | `src/admin/Dashboard.tsx` |
| `/bins` | 管理端：桶一覽（使用強度） | `src/admin/Bins.tsx` |
| `/b/<桶編號>` | 市民回報頁（QR Code 網址） | `src/citizen/Citizen.tsx` |
| `/map` | 市民地圖：在地圖上找桶、點桶回報 | `src/citizen/BinMap.tsx` |
| `/trash` | 家用垃圾收受指引；停靠點小地圖按了才載入 | `src/citizen/Trash.tsx` |

各路由的載入方式與輪詢間隔見 [../ARCHITECTURE.md](../ARCHITECTURE.md)「前端路由」。`public/sw.js` 只用來顯示「處理完畢」通知，不快取檔案。

共用的 API 呼叫與型別在 `src/shared/api.ts`，MapLibre 設定在 `src/shared/map.ts`（只能從 `lazy()` 載入的頁面引用，`/b/<桶編號>` 不載入地圖），桶位讀 `../data/bins.json`。

## 指令

```sh
bun install
bun run dev      # 要先在另一個終端機跑 backend 的 bun run dev，否則 /api/* 回 503
bun run build
bun run deploy   # 只由部署負責人執行（見 ../CLAUDE.md），用 /deploy；正式網址 https://tongjifan.nick12703990.workers.dev
```
