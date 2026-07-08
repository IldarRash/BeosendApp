/**
 * Console routes. Each domain gets a path now; M1–M4 flip `live` to true as the
 * screen lands. `/login` is public; everything else sits behind RequireAuth.
 *
 * `labelKey` is an admin catalog key resolved through the active locale at render
 * time (AppShell), so the nav follows the language switch.
 */
/** The Dispatch Desk sidebar sections the nav items are grouped under. */
export type NavGroup = "dispatch" | "schedule" | "courts" | "clientsMoney" | "comms" | "setup";

export interface NavItem {
  path: string;
  labelKey: string;
  live: boolean;
  group: NavGroup;
  iconKey: string;
}

/** Catalog key for each group's section label, in render order. */
export const NAV_GROUPS: readonly { group: NavGroup; labelKey: string }[] = [
  { group: "dispatch", labelKey: "admin.nav.groupDispatch" },
  { group: "schedule", labelKey: "admin.nav.groupSchedule" },
  { group: "courts", labelKey: "admin.nav.groupCourts" },
  { group: "clientsMoney", labelKey: "admin.nav.groupClientsMoney" },
  { group: "comms", labelKey: "admin.nav.groupComms" },
  { group: "setup", labelKey: "admin.nav.groupSetup" }
] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", labelKey: "admin.nav.overview", live: true, group: "dispatch", iconKey: "overview" },
  { path: "/groups", labelKey: "admin.nav.groups", live: true, group: "schedule", iconKey: "groups" },
  { path: "/trainings", labelKey: "admin.nav.trainings", live: true, group: "schedule", iconKey: "trainings" },
  { path: "/trainers", labelKey: "admin.nav.trainers", live: true, group: "schedule", iconKey: "trainers" },
  { path: "/attendance", labelKey: "admin.nav.attendance", live: true, group: "schedule", iconKey: "attendance" },
  { path: "/court-requests", labelKey: "admin.nav.courtRequests", live: true, group: "courts", iconKey: "courtRequests" },
  { path: "/court-blocks", labelKey: "admin.nav.courtBlocks", live: true, group: "courts", iconKey: "courtBlocks" },
  { path: "/court-load", labelKey: "admin.nav.courtLoad", live: true, group: "courts", iconKey: "courtLoad" },
  { path: "/clients", labelKey: "admin.nav.clients", live: true, group: "clientsMoney", iconKey: "clients" },
  { path: "/subscriptions", labelKey: "admin.nav.subscriptions", live: true, group: "clientsMoney", iconKey: "subscriptions" },
  { path: "/broadcasts", labelKey: "admin.nav.broadcasts", live: true, group: "comms", iconKey: "broadcasts" },
  { path: "/analytics", labelKey: "admin.nav.analytics", live: true, group: "comms", iconKey: "analytics" },
  { path: "/labels", labelKey: "admin.nav.labels", live: true, group: "comms", iconKey: "labels" },
  { path: "/notification-templates", labelKey: "admin.nav.notificationTemplates", live: true, group: "comms", iconKey: "notificationTemplates" },
  { path: "/managers", labelKey: "admin.nav.managers", live: true, group: "setup", iconKey: "managers" },
  { path: "/levels", labelKey: "admin.nav.levels", live: true, group: "setup", iconKey: "levels" },
  { path: "/connectors", labelKey: "admin.nav.connectors", live: true, group: "setup", iconKey: "connectors" }
] as const;

export const LOGIN_PATH = "/login";
