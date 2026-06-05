import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Resolve the shared packages to source (as vite.config.ts does) so tests run
// against the same contracts the bundle uses, not a possibly stale dist build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@beosand/types": fileURLToPath(
        new URL("../../packages/types/src/index.ts", import.meta.url)
      ),
      "@beosand/i18n": fileURLToPath(new URL("../../packages/i18n/src/index.ts", import.meta.url))
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"]
  }
});
