/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Browser-safe; never a server secret. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
