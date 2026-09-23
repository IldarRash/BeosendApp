/** Client-only routes. Existing Telegram deep-link prefixes remain stable. */
export type RouteId =
  | "home"
  | "my-bookings"
  | "group"
  | "individual"
  | "court"
  | "calendar"
  | "profile";
export type SubRouteId = Exclude<RouteId, "home">;
/** Every valid route id, for narrowing a bare string from external navigation input. */
const ROUTE_IDS: ReadonlySet<RouteId> = new Set<RouteId>([
  "home",
  "my-bookings",
  "group",
  "individual",
  "court",
  "calendar",
  "profile"
]);

/**
 * Narrow a bare string (external navigation may supply a bare string
 * so it never imports this union) to a {@link RouteId}, or `null` if it isn't one.
 * In practice the menu only ever emits real ids; this keeps the wiring type-safe
 * without an `as` cast.
 */
export function toRouteId(value: string): RouteId | null {
  return ROUTE_IDS.has(value as RouteId) ? (value as RouteId) : null;
}

/**
 * Deep-link prefix table: `startParam` (Telegram `startapp` payload) → the route
 * to seed on boot. The bot's notification deep links produce these.
 *
 *   home (or empty/absent) → home (default)
 *   browse                 → calendar      (legacy "записаться" deep link → the unified
 *                                           schedule, its replacement)
 *   schedule               → calendar      (legacy schedule deep link → the unified
 *                                           schedule that replaced it)
 *   mybookings             → my-bookings   (reminder + waitlist-promotion notifications)
 *   group                  → group
 *   individual             → individual
 *   court                  → court
 *   profile                → profile
 *
 * The waitlist is now auto-book + notify: there is no client "accept" screen, so a
 * promotion notification deep-links to `mybookings` like any other. Any unknown or
 * not-yet-reachable value (e.g. the unbuilt `book_<id>`) maps to Home — never throw,
 * never blank the app, never leak.
 */
const DEEP_LINK_ROUTES: Readonly<Record<string, RouteId>> = {
  home: "home",
  // The legacy "записаться" and "schedule" deep links both land on the schedule.
  browse: "calendar",
  schedule: "calendar",
  mybookings: "my-bookings",
  group: "group",
  individual: "individual",
  court: "court",
  calendar: "calendar",
  profile: "profile"
};

/** A boot deep-link target: a bare route. The navigation stack is a bare `RouteId[]`. */
export type StartTarget = { route: RouteId };

/**
 * Map a raw `startParam` to the boot {@link StartTarget}. Defensive by contract: a
 * bare known prefix opens its screen; empty/absent/unknown/not-yet-reachable (e.g. the
 * unbuilt `book_<id>`) all fall back to `home` — never throw, never blank the app.
 */
export function resolveStartTarget(startParam: string | null): StartTarget {
  return { route: resolveStartParam(startParam) };
}

/**
 * Map a raw `startParam` to the bare route to open on boot. Defensive by contract:
 * empty/absent, unknown, or not-yet-reachable (`book_<id>`) values all return `home`.
 */
export function resolveStartParam(startParam: string | null): RouteId {
  if (!startParam) {
    return "home";
  }
  const value = startParam.trim().toLowerCase();
  return DEEP_LINK_ROUTES[value] ?? "home";
}
