/**
 * Console routes. Each domain gets a path now; M1–M4 flip `live` to true as the
 * screen lands. `/login` is public; everything else sits behind RequireAuth.
 *
 * `labelKey` is an admin catalog key resolved through the active locale at render
 * time (AppShell), so the nav follows the language switch.
 */
export interface NavItem {
  path: string;
  labelKey: string;
  live: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", labelKey: "admin.nav.overview", live: true },
  { path: "/groups", labelKey: "admin.nav.groups", live: true },
  { path: "/trainings", labelKey: "admin.nav.trainings", live: true },
  { path: "/trainers", labelKey: "admin.nav.trainers", live: true },
  { path: "/levels", labelKey: "admin.nav.levels", live: true },
  { path: "/attendance", labelKey: "admin.nav.attendance", live: true },
  { path: "/clients", labelKey: "admin.nav.clients", live: true },
  { path: "/court-requests", labelKey: "admin.nav.courtRequests", live: true },
  { path: "/court-blocks", labelKey: "admin.nav.courtBlocks", live: true },
  { path: "/court-load", labelKey: "admin.nav.courtLoad", live: true },
  { path: "/broadcasts", labelKey: "admin.nav.broadcasts", live: true },
  { path: "/analytics", labelKey: "admin.nav.analytics", live: true },
  { path: "/labels", labelKey: "admin.nav.labels", live: true }
] as const;

export const LOGIN_PATH = "/login";
