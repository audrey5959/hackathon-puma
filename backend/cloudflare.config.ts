import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "tongjifan-api",
		compatibilityDate: "2026-09-25",
		entrypoint,
		observability: { enabled: true },
		env: {
			DB: bindings.d1({ id: "d41bd622-3049-4e7f-9589-68465e19b128", name: "tongjifan" }),
		},
	},
});
