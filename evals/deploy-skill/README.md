# /deploy skill 的 eval

檢查 `.claude/skills/deploy/SKILL.md` 改動後，Claude 是否還照原本的部署規則做：等同意才部署、先後端再前端、只用 GET 驗證、沒有 D1 權限時交給 Nick、拒絕 `--temporary-account`、失敗時回退到上一個 `deploy-*` tag。

`skills/deploy` 是指向 `.claude/skills/deploy` 的 symlink，`.claude-plugin/plugin.json` 只是讓 `claude plugin eval` 能載入它的外殼；正式使用時還是輸入 `/deploy`。

## 執行

改了 `.claude/skills/deploy/` 之後，在這個資料夾執行：

```sh
claude plugin eval . --ablation none --trust-plugin --no-publish \
  --disallow-tools Bash Write Edit WebFetch WebSearch Agent TaskStop -j 4
```

- 7 個案例、每個跑 3 次，約 1.6 美元、1 分鐘；只跑一個案例用 `--case <名稱>`（重複指定只有最後一個生效）
- 每個案例都要 1.00；低於 1.00 時看 `cases/results/<時間>/report.html` 裡被判 FAIL 的回覆
- `--disallow-tools` 讓 Claude 沒有任何能執行指令的工具，案例裡的指令輸出都寫在 prompt 中，所以不會真的部署
- `--ablation none`：baseline 沒有載入 skill，`/deploy-eval:deploy` 無法執行，比較沒有意義

## 新增案例

在 `cases/<名稱>/` 放 `prompt.md`（開頭是 `/deploy-eval:deploy`，接著寫目前進度和假的指令輸出）與 `graders/*.md`（`type: llm`，內容寫通過條件）。不要用 `regex` 的 `not_contains` 檢查指令名稱：Claude 在說明「不要執行 X」時也會寫出 X。
