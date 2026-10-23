---
type: llm
---

依序包含以下指令，順序正確：(1) backend 的 bunx cf deploy 在 frontend 的 bunx cf deploy 之前；(2) 兩個 deploy 都帶 --message 加上 commit 編號；(3) 部署之後才驗證正式網址；(4) 驗證之後才打 deploy-<YYYYMMDD-HHMM> 格式的 git tag 並 push 這個 tag；(5) 最後切回原本的分支（git switch - 或 git switch feat/x）。因為沒有 migration，不能出現要執行 db:migrate 的指令。
