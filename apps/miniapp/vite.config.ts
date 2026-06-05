import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Mini App is a pure browser client rendered inside Telegram. It reads only
// VITE_-prefixed env (e.g. VITE_API_URL) — never server secrets from @beosand/config.
//
// Resolve @beosand/types and @beosand/i18n to their TypeScript source so Vite
// compiles the ESM contracts/catalog directly (mirrors apps/admin). Each package's
// published CJS build re-exports via `export *`, which Rollup can't statically trace
// for named exports at build time; pointing at the source keeps the shared contracts
// and the i18n catalog as the single source of truth without a CJS interop shim.
//
// Telegram Mini Apps require HTTPS, so dev needs a tunnel (cloudflared/ngrok). Vite
// blocks unknown Host headers by default; VITE_DEV_ALLOWED_HOSTS (comma-separated)
// adds the tunnel host(s). With none set, dev allows any host (the console is a
// trusted-network dev tool until the real auth seam lands).
const allowedHostsEnv = process.env.VITE_DEV_ALLOWED_HOSTS?.trim();
const allowedHosts = allowedHostsEnv
  ? allowedHostsEnv
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
  : true;

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
    port: 5174,
    allowedHosts
  }
});
