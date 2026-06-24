/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Browser-safe; never a server secret. */
  readonly VITE_API_URL?: string;
  /**
   * Public URL of the personal-data-processing policy, linked from the onboarding
   * consent step. Browser-safe; defaults to "#" (a no-op link) when unset.
   */
  readonly VITE_PRIVACY_POLICY_URL?: string;
  /**
   * Comma-separated extra hostnames Vite dev accepts (the HTTPS tunnel host).
   * Read only by vite.config.ts at dev time; not used in the browser bundle.
   */
  readonly VITE_DEV_ALLOWED_HOSTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
