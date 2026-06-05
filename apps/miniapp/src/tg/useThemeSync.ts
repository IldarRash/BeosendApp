import { useEffect } from "react";
import { isMiniAppDark, useSignal } from "@telegram-apps/sdk-react";

/**
 * Keeps the custom design tokens in `ui/theme.css` in sync with the Telegram
 * client's appearance.
 *
 * telegram-ui's <AppRoot> already follows the client's dark/light mode, but the
 * BeoSand `--tg-*` tokens are a separate scope. Without this, a dark Telegram
 * client renders telegram-ui dark while our tokens stay light → white text on
 * white cards. We toggle `.tg-theme--dark` on <html> from the SDK's
 * `isMiniAppDark` signal so both flip together and react to live theme changes.
 *
 * Driven by the Telegram client signal, never `prefers-color-scheme`: the OS
 * theme and the Telegram client theme can disagree, and following the OS is what
 * caused the white-on-white regression.
 */
export function useThemeSync(): void {
  const isDark = useSignal(isMiniAppDark);

  useEffect(() => {
    document.documentElement.classList.toggle("tg-theme--dark", isDark);
  }, [isDark]);
}
