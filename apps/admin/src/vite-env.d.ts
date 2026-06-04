/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Browser-safe; never a server secret. */
  readonly VITE_API_URL?: string;
  /**
   * Bot username (without @) for the Telegram Login Widget on the login screen.
   * Browser-safe public identifier; never the bot token.
   */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
