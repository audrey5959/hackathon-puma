# 桶緝犯：系統架構

前後端分成兩個 Cloudflare Worker：前端 Worker 提供靜態網站，並把 `/api/*` 透過 service binding 轉給後端 Worker；後端 Worker 存取 D1。對外只有一個網址，前端每 2 秒輪詢。不用 Supabase、Vercel，也不用即時推播。

範圍與功能優先順序見 [桶緝犯_作戰計畫.md](桶緝犯_作戰計畫.md) 第 2 節。

## 為什麼這樣選

只有 P0「滿溢回報到處理完成」需要跨裝置共用資料：手機回報後管理端要看到，管理端完成後手機要更新（作戰計畫第 2 節 Demo 成功標準第 2、3 條）。容量地圖、候選點、家用垃圾指引都只讀靜態資料，不需要後端。

所以後端只做這一件事，並選擇服務數最少的做法：

| 考慮過的做法 | 結論 | 原因 |
|---|---|---|
| Supabase + Vercel（作戰計畫原本的建議） | 不用 | 不用寫伺服器，但要設定 RLS、publication、金鑰與兩個平台的環境變數；設定量比程式碼多。Vercel Hobby 方案沒有團隊協作功能 |
| Supabase Realtime 即時推播 | 不用 | 每 2 秒輪詢在現場 Demo 看起來一樣即時，省掉 publication 與 RLS select 設定 |
| 完全不要後端（單機左右並排 Demo） | 不用 | 現場無法用手機掃 QR Code 回報，失去 Demo 最有說服力的一段 |
| **Cloudflare Worker + D1** | **採用** | 一個網址、一個平台；API 只有四條路由 |
| 前後端兩個 Worker 各自對外，前端跨網域呼叫 API | 不用 | 要設定 CORS 與 API 網址環境變數，提交與 Demo 要處理兩個網址；改用 service binding 轉發就只有一個網址 |

## 技術組合

| 層 | 選擇 | 備註 |
|---|---|---|
| 前端 | Vite 8、React 19、TypeScript | `frontend/`；市民端（`src/citizen/`）與管理端（`src/admin/`）是同一份程式的兩個路由 |
| 地圖 | MapLibre GL JS 6.15、@vis.gl/react-maplibre 8.1.3 | WebGL 繪圖；桶位是一個 GeoJSON source，案件狀態用 feature-state 更新，輪詢時不重畫整個圖層。管理端用 `React.lazy` 拆開，市民回報頁不載入地圖 |
| 底圖 | [OpenFreeMap](https://openfreemap.org/) positron 向量圖磚 | 免金鑰、無流量限制、可商用；必須標示 © OpenMapTiles 與 © OpenStreetMap，MapLibre 會自動加上。地名改成只顯示正體中文 |
| 後端 | Cloudflare Worker | `backend/`；只處理 `/api/*`，不放靜態檔 |
| 資料庫 | Cloudflare D1 | 只存回報與案件 |
| 靜態資料 | GeoJSON，Python（uv）轉檔 | `data/bins.json`，前端畫地圖、後端驗證 `bin_id`，不進資料庫 |
| 工具 | bun、cf CLI | |

版本為 2026-10-23 在 npm 上的最新版。

## 系統架構

```mermaid
graph LR
    subgraph Users[使用者]
        Citizen[市民手機<br/>掃 QR Code]
        Admin[清潔隊管理端]
    end

    subgraph CF[Cloudflare]
        Static[前端 Worker tongjifan<br/>React + MapLibre]
        API[後端 Worker tongjifan-api<br/>/api/*]
    end

    subgraph Data[資料]
        Geo[GeoJSON<br/>桶位・捷運・垃圾車]
        D1[(D1<br/>reports・cases)]
    end

    OSM[OpenFreeMap 向量圖磚]
    Open[政府開放資料<br/>CSV Big5]
    ETL[轉檔腳本<br/>Python + uv]

    Citizen --> Static
    Admin --> Static
    Static --> Geo
    Static --> OSM
    Static -->|service binding<br/>轉發 /api/*| API
    API --> D1
    Open --> ETL --> Geo
```

## P0 流程

```mermaid
sequenceDiagram
    participant C as 市民手機
    participant S as 模擬感測器
    participant W as Worker API
    participant D as D1
    participant A as 管理端

    S->>W: POST /api/reports source=sensor
    C->>W: POST /api/reports source=citizen
    W->>D: 同桶有未完成案件就合併，否則開新案
    loop 每 2 秒
        A->>W: GET /api/cases
        W-->>A: 案件列表（標示來源）
    end
    A->>W: PATCH /api/cases/:id
    W->>D: 更新狀態
    loop 每 2 秒
        C->>W: GET /api/cases/:id
        W-->>C: 最新狀態
    end
```

模擬感測器是管理端的一個按鈕，呼叫和民眾回報同一支 API，只是 `source` 不同。

## API

| 方法與路徑 | 輸入 | 輸出 | 錯誤 |
|---|---|---|---|
| `POST /api/reports` | `bin_id`、`source`（`sensor`／`citizen`）、`kind`（`full`／`dirty`／`missing`） | 合併後或新開的案件 | `bin_id` 不存在或欄位值不合法回 400 |
| `GET /api/cases` | 選填 `status` | 案件列表，新的在前 | |
| `GET /api/cases/:id` | | 單一案件 | 不存在回 404 |
| `PATCH /api/cases/:id` | `status`（`assigned`／`done`） | 更新後的案件 | 狀態只能往前走（`open` → `assigned` → `done`），否則回 409 |
| `DELETE /api/cases` | | 清空所有案件與回報 | 只在 `localhost` 生效，正式網址回 404 |

**合併規則**：同一個 `bin_id` 已有未完成（`open` 或 `assigned`）的案件時，新回報掛到那個案件上，不另開新案，避免重複派工。

## 資料

**D1 兩張表**

- `cases`：案件編號、`bin_id`、狀態、指派的清潔隊、開案／指派／完成時間。
- `reports`：回報編號、`case_id`、`source`、`kind`、時間。案件上顯示的「民眾 ×2」由這張表計算。

**靜態 GeoJSON**

- 臺北市行人專用清潔箱：全市 661 筆，北投區 0 筆，內容可能只到 2018 年。原始檔是 Big5 編碼；有一筆經緯度欄位互換、一筆經度寫成 `121.513.652`，轉檔時要修正。
- 開放資料沒有箱號，`bin_id` 由轉檔腳本依輸出順序編號，GeoJSON 檔進版控，編號就固定。QR Code 網址帶的是這個編號。
- 候選點 `data/candidates.json`（`etl/candidates.py` 產生）：臺北切成 200m 格子，挑出「有人流、300m 內沒有桶」的格子，每區取人流指數最高的 8 格（目前 11 區共 88 格）。桶位資料整區缺漏的行政區不列入：北投區在開放資料裡是 0 筆，但官方並沒有說北投沒有桶，那裡算出的「附近沒有桶」不可信。管理端地圖圖例勾選「建議增設」後才顯示（預設不顯示，不影響 P0 Demo 畫面）。顏色依人流指數分三級：高（65 以上）、中（30–64）、低（30 以下，附近沒有捷運出入口、只有 YouBike）；點格子顯示區內名次與 `reasons`。每格是一個正方形 Polygon，properties：
  - `score`：人流指數 0–100，捷運占 7 成（取 log，避免台北車站一站獨大）、YouBike 車位占 3 成
  - `district`、`mrt_daily`（格內出入口的日均進出人次）、`mrt_exits`、`youbike_stations`、`youbike_docks`、`nearest_bin_m`、`nearest_bin_id`
  - `reasons`：點開格子要顯示的原因，例如「捷運台北車站（3 個出口），日均進出約 11.4 萬人次」「最近的桶在 340 m 外（#233 …）」
- 候選點的人流來源：捷運各站分時進出量（一個月約 300 MB，轉檔時串流加總，不進版控）、捷運出入口座標（Big5）、YouBike 2.0 站點。站的進出量平均分給該站各出入口；格子 500m 內沒有臺北市 YouBike 站就視為新北，不列入。
- 垃圾車停靠點 `data/trucks.json`（`etl/trucks.py` 產生）：臺北市垃圾車點位路線資料，全市 12 區約 4,000 個停靠點（約 1 MB，`/trash` 延遲載入，gzip 後約 100 KB）。每個停靠點一個 Point，properties 是 `district`、`village`、`address`、`arrive`、`leave`（`HH:MM`）、`route`；同一地點有多個車次時各算一筆。市民端 `/trash` 預設以萬華區西門里為位置（不在載入時跳出定位授權），可以按「使用我的位置」，或改選「行政區 里」（以該里停靠點的平均位置為準，不需要地址轉座標服務）；最近的停靠點超過 3 km 就視為不在臺北市，請使用者改選。列出所選時間起 60 分鐘內到站、最近的 10 個停靠點，附 Google 地圖步行導航。垃圾種類（一般垃圾與廚餘、平面類、立體類）的收運日寫死在 `frontend/src/citizen/Trash.tsx`，依據臺北市環保局的分天分類規定，選到當天不收的種類就不列垃圾車。
- iTrash 站點 `data/itrash.json`：從 [iTrash 官網](https://www.itrash.com.tw/pages/site) 手抄的 18 個站點（站名、地址、有沒有垃圾收集機與瓶罐收集機），沒有座標，導航連結直接帶地址。因為沒有座標，不依距離排序。

**真實與模擬**

| 資料 | 真實或模擬 |
|---|---|
| 桶位、捷運站、垃圾車點位 | 真實（開放資料） |
| 候選點 | 由開放資料計算（捷運 2026-09 進出量、YouBike 站點）；人流指數的權重是我們訂的 |
| 剩餘容量 | 模擬，在前端計算 |
| 回報、案件、處理紀錄 | 模擬（現場 Demo 時即時產生） |

桶位開放資料的每一筆是座標點，不是桶數，同一地點可能有好幾筆；只能拿來看位置，不要加總成「臺北有幾個桶」。數量請引用官方數字並註明單位（一組兩座），各年份與單位的整理見 [臺北行人清潔箱數量摘要](https://data.bin.ianwu.net/)。

## 部署

| Worker | 資料夾 | 網址 | 綁定 |
|---|---|---|---|
| `tongjifan`（前端） | `frontend/` | https://tongjifan.nick12703990.workers.dev | `API` → `tongjifan-api` |
| `tongjifan-api`（後端） | `backend/` | 不對外使用，只經由前端轉發 | `DB` → D1 `tongjifan` |

- 前端設定 `assets.notFoundHandling: "single-page-application"` 與 `assets.runWorkerFirst: ["/api/*"]`：`/api/*` 進前端 Worker，由它 `env.API.fetch(req)` 原樣轉給後端，其餘路由回傳前端檔案（[Static Assets 路由](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)）。
- 設定檔是各資料夾的 `cloudflare.config.ts`（`cf` 的 TypeScript 格式，不是 `wrangler.jsonc`）。`cf` 是 beta，D1 migrations 與 Wrangler 相容。
- 資料表用 D1 migrations 建立（`backend/migrations/`），部署用 `cf deploy`。指令見 [backend/README.md](backend/README.md) 與 [frontend/README.md](frontend/README.md)。
- 新的 Worker 第一次部署後約 5 分鐘內會間歇回 `error code: 1042`，之後穩定；重新部署不會再出現。所以兩個 Worker 要在 Demo 前一晚先部署好。
- 本機開發要同時跑前後端兩個 dev server，前端才轉發得到本機後端；只跑前端時 `/api/*` 回 503。

## 待確認

- repo 目前是私人的，作品提交前要改成公開（作戰計畫第 6 節）。
- 底圖依賴 OpenFreeMap 的公開服務。賽後若要自己掌握，可以把臺北範圍的 Protomaps PMTiles 放到 R2，由 Worker 轉發。
