import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	// 前端 dev server 已佔用預設的 9229，兩邊同時跑時要錯開
	plugins: [cloudflare({ inspectorPort: 9230 })],
});
