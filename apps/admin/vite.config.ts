import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The admin SPA is a pure browser client. It reads only VITE_-prefixed env
// (e.g. VITE_API_URL) — never server secrets from @beosand/config.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
