import type { HomeMenuSection } from "../screens/HomeScreen";
import type { IconName } from "../ui/icons";

/**
 * The Mini App's route table — a local UI concern, NOT a domain contract, so it
 * lives here and never in `@beosand/types`. Navigation is a tiny typed in-memory
 * stack (no router library: Telegram Mini Apps have no browser URL/history bar —
 * back-navigation is the native BackButton — and the surface is a shallow
 * hub-and-spoke). A closed union of route ids makes an unknown route a *type
 * error* rather than a runtime 404.
 */

/** Every reachable client route. `home` is the stack root; the rest are pushable. */
export type RouteId =
  | "home"
  | "schedule"
  | "my-bookings"
  | "group"
  | "individual"
  | "court"
  | "calendar"
  | "profile";

/** The pushable sub-screens (everything except the `home` root). */
export type SubRouteId = Exclude<RouteId, "home">;

/**
 * One Home-menu journey: its route id, the leading coral icon, and the i18n keys
 * for its label + one-line hint. This is the single source of truth for the menu
 * and the deep-link map, so the two can never drift.
 */
interface MenuEntry {
  id: SubRouteId;
  icon: IconName;
  labelKey: string;
  hintKey: string;
}

/**
 * The client journeys, grouped for visual rhythm. The list is statically the client
 * journeys — there is no role branch and no admin/trainer entry by construction (the
 * held token is `scope:"client"`).
 *
 * The Trainings section leads with a single "Расписание тренировок" tile: a month
 * calendar of bookable sessions (its day view enters the booking flow). Single
 * booking and waitlist are deliberately NOT menu entries — they are reached from
 * inside that schedule day view, not the Home hub.
 */
const MENU_GROUPS: ReadonlyArray<{ headerKey: string; items: ReadonlyArray<MenuEntry> }> = [
  {
    headerKey: "miniapp.home.sectionTrainings",
    items: [
      {
        id: "schedule",
        icon: "schedule",
        labelKey: "miniapp.home.schedule",
        hintKey: "miniapp.home.scheduleHint"
      },
      {
        id: "my-bookings",
        icon: "myBookings",
        labelKey: "miniapp.home.myBookings",
        hintKey: "miniapp.home.myBookingsHint"
      },
      { id: "group", icon: "group", labelKey: "miniapp.home.group", hintKey: "miniapp.home.groupHint" },
      {
        id: "individual",
        icon: "individual",
        labelKey: "miniapp.home.individual",
        hintKey: "miniapp.home.individualHint"
      }
    ]
  },
  {
    headerKey: "miniapp.home.sectionCourts",
    items: [
      { id: "court", icon: "court", labelKey: "miniapp.home.court", hintKey: "miniapp.home.courtHint" },
      {
        id: "calendar",
        icon: "calendar",
        labelKey: "miniapp.home.calendar",
        hintKey: "miniapp.home.calendarHint"
      }
    ]
  },
  {
    headerKey: "miniapp.home.sectionAccount",
    items: [
      { id: "profile", icon: "profile", labelKey: "miniapp.home.profile", hintKey: "miniapp.home.profileHint" }
    ]
  }
];

/**
 * The Home menu, shaped for the presentational {@link HomeScreen} (which takes the
 * route id as a bare `string` so it never imports this union — a clean
 * design/wiring seam). Built from {@link MENU_GROUPS} so the menu and the
 * deep-link map share one source.
 */
export const HOME_SECTIONS: ReadonlyArray<HomeMenuSection> = MENU_GROUPS.map((group) => ({
  headerKey: group.headerKey,
  items: group.items.map((item) => ({
    routeId: item.id,
    icon: item.icon,
    labelKey: item.labelKey,
    hintKey: item.hintKey
  }))
}));

/** Every valid route id, for narrowing a bare string from the presentational HomeScreen. */
const ROUTE_IDS: ReadonlySet<RouteId> = new Set<RouteId>([
  "home",
  "schedule",
  "my-bookings",
  "group",
  "individual",
  "court",
  "calendar",
  "profile"
]);

/**
 * Narrow a bare string (HomeScreen reports the tapped row's route id as a `string`
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
 *   browse                 → schedule      (legacy "записаться" deep link → the
 *                                           schedule calendar, its replacement)
 *   schedule               → schedule
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
  // The old "записаться" deep link lands on the schedule calendar (browse's replacement).
  browse: "schedule",
  schedule: "schedule",
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
