import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The admin SPA is a pure browser client. It reads only VITE_-prefixed env
// (e.g. VITE_API_URL) — never server secrets from @beosand/config.
//
// Resolve @beosand/types and @beosand/i18n to their TypeScript source so Vite
// compiles the ESM contracts/catalog directly. Each package's published CJS build
// re-exports via `export *`, which Rollup can't statically trace for named exports
// at build time; pointing at the source keeps the shared contracts and the i18n
// catalog as the single source of truth without a CJS interop shim.
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
  server: {
    port: 5173
  }
});
