# 桶緝犯

黑客松「市長，你給我聽好了」題目 #2 找回消失的垃圾桶。範圍與時程見 [桶緝犯_作戰計畫.md](桶緝犯_作戰計畫.md)，架構與 API 合約見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 結構

| 資料夾 | 內容 |
|---|---|
| `frontend/` | Vite + React + MapLibre GL（@vis.gl/react-maplibre）；`src/admin/` 管理端（`/`）、`src/citizen/` 市民端（`/b/<桶編號>`）、`src/shared/` API 呼叫與型別；`worker/` 把 `/api/*` 轉給後端 |
| `backend/` | 後端 Worker，四條 `/api/*` 路由，另有一條本機專用的 `DELETE /api/cases`；`migrations/` 是 D1 資料表 |
| `data/bins.json` | 桶位，前後端共用；`bin_id` 就是 QR Code 網址上的編號 |
| `etl/` | 開放資料轉檔（Python，用 `uv` 執行） |

工具：JS 用 `bun`，Cloudflare 用 `cf`（設定檔是各資料夾的 `cloudflare.config.ts`，不是 `wrangler.jsonc`）。

## 部署：只由部署負責人執行

部署負責人：（待確認，見 PR 說明）。部署負責人用 `/deploy`（`.claude/skills/deploy/`）從 `origin/main` 部署，成功後打 `deploy-*` tag，正式環境跑的就是最新的那個 tag。

其他人不要執行下列指令，需要上線時請部署負責人處理：

- `bun run deploy`（frontend 或 backend）
- `bun run db:migrate`（套用 migration 到正式 D1）
- 任何對正式 D1 的寫入或刪除，例如 `cf d1 query ... --sql "DELETE ..."`；正式資料可能是隊友正在 Demo 的案件

改了 `backend/migrations/` 的 PR，要在說明裡寫出需要負責人跑 `db:migrate`。

## 分支與 PR

main 只接受 PR，一律 Squash merge。`ci`（型別、建置、lint、migration 編號）通過就能合併，不需要等人核准；只有 `.github/CODEOWNERS` 列出的路徑要負責人核准。

- 分支從最新的 main 開，命名 `feat/`、`fix/`、`docs/` 加簡短描述，最好半天內合併
- PR 盡量小；改 API 合約時，`frontend/src/shared/api.ts` 和 ARCHITECTURE.md 的 API 表放在同一個 PR，而且先合併，功能 PR 再跟上
- 新增 migration 前先 `git fetch`，編號接在 main 最新的那支之後；main 的 CI 紅燈寫著「重複的 migration 編號」時，後合併的人要改號
- `bun.lock` 衝突不要手動合併：拿 main 的版本，再跑一次 `bun install`
- 要大改共用區塊（例如地圖元件、`src/shared/`）前，先在群組說一聲
- main 的 CI 紅燈時，誰合併造成的就由誰先修

## 本機開發

後端要先跑，前端才轉發得到 `/api/*`。

1. 第一次開發：`cd backend && bun install && bun run db:migrate:local`
2. 終端機一：`cd backend && bun run dev`
3. 終端機二：`cd frontend && bun install && bun run dev`
4. 開 http://localhost:5173/ （埠號被占用時以終端機印出的網址為準）

- 本機 D1 存在 `backend/.cloudflare/state/`，與正式資料分開；要清空就刪掉這個資料夾，再跑一次 `bun run db:migrate:local`。
- 前端 `/api/*` 回 503、訊息是 `Worker "tongjifan-api" not found`：後端沒在跑。
- 後端 `dev` 用 `vite` 而不是 `cf dev`：用 `cf dev` 啟動時前端接不到後端。
- 後端的除錯埠設成 9230（`backend/vite.config.ts`），因為前端已占用預設的 9229。
- 不要重跑 `uv run etl/bins.py`：開放資料有變動時桶編號會改變，已印出的 QR Code 會對不上。

## 測試

目前沒有自動化測試。改完程式後依序做：

1. 型別與建置：`cd backend && bun run typecheck`；`cd frontend && bun run build && bunx oxlint`
2. API 合約：本機兩個 dev server 都在跑時，對前端網址打 API，確認狀態碼符合 ARCHITECTURE.md 的 API 表：

   ```sh
   U=http://localhost:5173
   curl -s -w ' %{http_code}\n' -X POST -H 'content-type: application/json' -d '{"bin_id":300,"source":"sensor","kind":"full"}' $U/api/reports    # 新案 201
   curl -s -w ' %{http_code}\n' -X POST -H 'content-type: application/json' -d '{"bin_id":300,"source":"citizen","kind":"dirty"}' $U/api/reports  # 合併 200，同一個 id
   curl -s -w ' %{http_code}\n' -X POST -H 'content-type: application/json' -d '{"bin_id":9999,"source":"citizen","kind":"full"}' $U/api/reports  # 400
   curl -s -w ' %{http_code}\n' $U/api/cases/99999                                                                                               # 404
   curl -s -w ' %{http_code}\n' -X PATCH -H 'content-type: application/json' -d '{"status":"assigned"}' $U/api/cases/1                           # 第一次 200，再打一次 409
   ```

3. 畫面：開管理端按「模擬感測器」，待辦出現新案件；點地圖上的桶開市民回報頁送出回報；回管理端指派、完成，市民頁的進度在 2 秒內跟著更新。
4. 手機：本機測試不經手機；要用手機掃 QR Code 測，請負責人部署後用正式網址 https://tongjifan.nick12703990.workers.dev/b/300 。
