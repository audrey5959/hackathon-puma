import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "tongjifan",
    "compatibilityDate": "2026-09-25",
    "entrypoint": "./worker/index.ts",
    "observability": {
      "enabled": true
    },
    "assets": {
      "notFoundHandling": "single-page-application",
      "runWorkerFirst": ["/api/*"]
    },
    "env": {
      "API": bindings.worker({ worker: "tongjifan-api" })
    }
  }
});
