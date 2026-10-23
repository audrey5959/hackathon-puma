# 桶緝犯 backend

後端 Worker `tongjifan-api`，四條 `/api/*` 路由，資料在 D1 `tongjifan`。API 合約見 [../ARCHITECTURE.md](../ARCHITECTURE.md#api)。只經由前端 Worker 的 service binding 呼叫。

## 指令

```sh
bun install
bun run db:migrate:local   # 第一次本機開發前，建立本機 D1 資料表
bun run dev                # 本機 API；前端 dev server 會自動接到這裡
bun run typecheck
bun run db:migrate         # 套用 migrations/ 到正式 D1
bun run deploy
```

`dev` 直接跑 `vite` 而不是 `cf dev`：用 `cf dev`（beta）啟動時，前端 dev server 找不到這個 Worker，`/api/*` 一律回 503。

新增資料表或欄位：`cf d1 migrations create <說明>`，在 `migrations/` 寫 SQL，再跑上面兩個 migrate。

`bin_id` 的合法範圍來自 `../data/bins.json`。重跑 `uv run ../etl/bins.py` 時若開放資料有變動，編號會改變，已印出的 QR Code 會對不上，Demo 前不要跑。
