# 桶緝犯 frontend

Vite + React + MapLibre GL（@vis.gl/react-maplibre）。前端 Worker `tongjifan` 提供靜態檔，並把 `/api/*` 轉給後端 Worker `tongjifan-api`。架構與 API 合約見 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

| 路由 | 畫面 | 程式 |
|---|---|---|
| `/` | 管理端：地圖、待辦、模擬感測器 | `src/admin/` |
| `/b/<桶編號>` | 市民回報頁（QR Code 網址） | `src/citizen/` |

共用的 API 呼叫與型別在 `src/shared/api.ts`，桶位讀 `../data/bins.json`。

## 指令

```sh
bun install
bun run dev      # 要先在另一個終端機跑 backend 的 bun run dev，否則 /api/* 回 503
bun run build
bun run deploy   # 只由部署負責人執行（見 ../CLAUDE.md），用 /deploy；正式網址 https://tongjifan.nick12703990.workers.dev
```
