import type { ReactNode } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { useThemeSync } from "../tg/useThemeSync";

/**
 * The Mini App's native root. Wraps the tree in telegram-ui's <AppRoot>, which
 * auto-detects the platform (iOS HIG vs Material) and appearance (light/dark)
 * from the Telegram environment and binds the --tgui--* theme variables. The
 * BeoSand coral accent is layered on via ui/theme.css overriding the accent
 * tokens — native look, brand accent, no per-screen one-off styles.
 *
 * `useThemeSync()` keeps our custom `--tg-*` design tokens flipping in lockstep
 * with telegram-ui's appearance so a dark client never renders our text invisibly.
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  useThemeSync();
  return <AppRoot className="app-root">{children}</AppRoot>;
}
