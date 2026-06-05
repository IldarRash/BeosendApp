import type { ReactNode } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";

/**
 * The Mini App's native root. Wraps the tree in telegram-ui's <AppRoot>, which
 * auto-detects the platform (iOS HIG vs Material) and appearance (light/dark)
 * from the Telegram environment and binds the --tgui--* theme variables. The
 * BeoSand coral accent is layered on via ui/theme.css overriding the accent
 * tokens — native look, brand accent, no per-screen one-off styles.
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return <AppRoot className="app-root">{children}</AppRoot>;
}
