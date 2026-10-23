---
name: deploy
description: 把 origin/main 部署到正式環境並打 deploy tag，或回退到上一個 deploy tag。只由部署負責人手動呼叫。
disable-model-invocation: true
---

# 部署正式環境

正式網址 https://tongjifan.nick12703990.workers.dev ，兩個 Worker 與綁定見 ARCHITECTURE.md 的「部署」。部署負責人名單在 CLAUDE.md 的「部署」一節。

每個版本只從 `origin/main` 的某個 commit 部署，部署成功後打 `deploy-<YYYYMMDD-HHMM>` tag；正式環境跑的永遠是最新的 `deploy-*` tag。

`cf` 一律用專案裡的版本：`bunx cf ...`（在 `backend/` 或 `frontend/` 內執行）。

## 部署

1. **確認身分**：`bunx cf auth whoami` 顯示已登入，且 `bunx cf workers scripts search --name tongjifan` 找得到 `tongjifan` 與 `tongjifan-api`。找不到就是登入了錯的帳號，停下來請使用者處理。

2. **取出要部署的版本**：記下目前的分支，確認工作區乾淨（`git status --short` 沒有輸出），然後：

   ```sh
   git fetch origin --tags
   git switch --detach origin/main
   ```

3. **列出這次會上線的內容**，給使用者看，等使用者明確同意才繼續：
   - 上一個部署：`git describe --tags --abbrev=0 --match 'deploy-*'`（沒有就是第一次用這個流程）
   - 新的 commit：`git log --oneline <上一個 tag>..HEAD`
   - 新的 migration：`git diff --name-only <上一個 tag>..HEAD -- backend/migrations/`
   - main 的 CI 結果：`gh run list --branch main --limit 1`，不是 success 就先問使用者

   正式環境可能有隊友正在 Demo，這一步的同意只對這一次部署有效。

4. **套用 migration**（只有步驟 3 列出新的 migration 時）：`cd backend && bun install --frozen-lockfile && bun run db:migrate`。migration 只能往前，套用後舊版程式碼必須還能在新資料表上運作；看到刪除或改名欄位的 SQL 時先問使用者。

5. **先後端、再前端**，兩邊都在乾淨的 `bun install --frozen-lockfile` 之後執行：

   ```sh
   cd backend  && bunx cf deploy --message "$(git rev-parse --short HEAD)"
   cd frontend && bunx cf deploy --message "$(git rev-parse --short HEAD)"
   ```

   `cf` 提議用 `--temporary-account` 時代表沒有登入正式帳號：回到步驟 1，臨時帳號只會產生一個 60 分鐘後消失的新網址。

6. **驗證正式環境**，只用讀取的請求，不送回報（會寫進正式 D1）：

   ```sh
   U=https://tongjifan.nick12703990.workers.dev
   curl -s -o /dev/null -w '%{http_code}\n' $U/          # 200
   curl -s -o /dev/null -w '%{http_code}\n' $U/b/300     # 200
   curl -s -o /dev/null -w '%{http_code}\n' $U/api/cases # 200
   ```

   新 Worker 第一次部署後約 5 分鐘內可能回 `error code: 1042`，等幾分鐘再試；重新部署的 Worker 不會出現。三個都 200 才算部署完成，否則走「回退」。

7. **打 tag 並推上去**，再切回步驟 2 記下的分支：

   ```sh
   T=deploy-$(date +%Y%m%d-%H%M)
   git tag "$T" && git push origin "$T"
   git switch -
   ```

8. **回報**：tag 名稱、commit、有沒有套用 migration、三個驗證的狀態碼。

## 回退

部署後正式環境壞了，就把上一個 `deploy-*` tag 重新部署一次：

1. 找到上一個好的版本：`git tag --list 'deploy-*' --sort=-refname | head`
2. `git switch --detach <那個 tag>`，執行「部署」的步驟 1、5、6
3. 回退不打新的 tag：正式環境暫時跑的是舊 tag，修好後下一次部署會再打新的
4. 回退不會撤銷 migration。步驟 3 若列過新的 migration，先確認舊版程式碼能在新資料表上運作，不能的話告訴使用者，交給使用者決定
