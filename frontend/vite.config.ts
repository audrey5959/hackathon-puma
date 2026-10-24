import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// 不在 git 工作區（例如解壓的原始碼）時不讓 build 失敗
function git(args: string) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// 部署成功後才打 deploy-* tag，build 時拿不到 tag 名稱，改顯示 commit 與 build 時間；
// 對照 tag 用 git tag --points-at <SHA>
function build(dev: boolean) {
  const sha = git('rev-parse HEAD')
  const now = new Date()
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((x) => [x.type, x.value]),
  )
  return {
    sha,
    short: sha.slice(0, 7),
    time: `${p.month}/${p.day} ${p.hour}:${p.minute}`,
    iso: now.toISOString(),
    dev,
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), cloudflare()],
  define: { __BUILD__: JSON.stringify(build(command === 'serve')) },
}))
