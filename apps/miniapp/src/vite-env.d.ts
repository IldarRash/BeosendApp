/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Browser-safe; never a server secret. */
  readonly VITE_API_URL?: string;
  /**
   * Comma-separated extra hostnames Vite dev accepts (the HTTPS tunnel host).
   * Read only by vite.config.ts at dev time; not used in the browser bundle.
   */
  readonly VITE_DEV_ALLOWED_HOSTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
