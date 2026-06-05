/**
 * Console routes. Each domain gets a path now; M1–M4 flip `live` to true as the
 * screen lands. `/login` is public; everything else sits behind RequireAuth.
 *
 * `labelKey` is an admin catalog key resolved through the active locale at render
 * time (AppShell), so the nav follows the language switch.
 */
/** The three sidebar sections the nav items are grouped under. */
export type NavGroup = "schedule" | "courts" | "comms";

export interface NavItem {
  path: string;
  labelKey: string;
  live: boolean;
  group: NavGroup;
  iconKey: string;
}

/** Catalog key for each group's section label, in render order. */
export const NAV_GROUPS: readonly { group: NavGroup; labelKey: string }[] = [
  { group: "schedule", labelKey: "admin.nav.groupSchedule" },
  { group: "courts", labelKey: "admin.nav.groupCourts" },
  { group: "comms", labelKey: "admin.nav.groupComms" }
] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", labelKey: "admin.nav.overview", live: true, group: "schedule", iconKey: "overview" },
  { path: "/groups", labelKey: "admin.nav.groups", live: true, group: "schedule", iconKey: "groups" },
  { path: "/trainings", labelKey: "admin.nav.trainings", live: true, group: "schedule", iconKey: "trainings" },
  { path: "/trainers", labelKey: "admin.nav.trainers", live: true, group: "schedule", iconKey: "trainers" },
  { path: "/levels", labelKey: "admin.nav.levels", live: true, group: "schedule", iconKey: "levels" },
  { path: "/attendance", labelKey: "admin.nav.attendance", live: true, group: "schedule", iconKey: "attendance" },
  { path: "/clients", labelKey: "admin.nav.clients", live: true, group: "schedule", iconKey: "clients" },
  { path: "/court-requests", labelKey: "admin.nav.courtRequests", live: true, group: "courts", iconKey: "courtRequests" },
  { path: "/court-blocks", labelKey: "admin.nav.courtBlocks", live: true, group: "courts", iconKey: "courtBlocks" },
  { path: "/court-load", labelKey: "admin.nav.courtLoad", live: true, group: "courts", iconKey: "courtLoad" },
  { path: "/broadcasts", labelKey: "admin.nav.broadcasts", live: true, group: "comms", iconKey: "broadcasts" },
  { path: "/analytics", labelKey: "admin.nav.analytics", live: true, group: "comms", iconKey: "analytics" },
  { path: "/labels", labelKey: "admin.nav.labels", live: true, group: "comms", iconKey: "labels" }
] as const;

export const LOGIN_PATH = "/login";
