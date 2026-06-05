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
  | "browse"
  | "my-bookings"
  | "group"
  | "individual"
  | "court"
  | "profile"
  | "waitlist-accept";

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
 * The six client journeys, grouped for visual rhythm. The list is statically the
 * client journeys — there is no role branch and no admin/trainer entry by
 * construction (the held token is `scope:"client"`).
 *
 * Single booking (S4) and waitlist (S6) are deliberately NOT menu entries: they
 * are reached from inside the browse flow (S3), not the Home hub.
 */
const MENU_GROUPS: ReadonlyArray<{ headerKey: string; items: ReadonlyArray<MenuEntry> }> = [
  {
    headerKey: "miniapp.home.sectionTrainings",
    items: [
      { id: "browse", icon: "browse", labelKey: "miniapp.home.browse", hintKey: "miniapp.home.browseHint" },
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
    items: [{ id: "court", icon: "court", labelKey: "miniapp.home.court", hintKey: "miniapp.home.courtHint" }]
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
  "browse",
  "my-bookings",
  "group",
  "individual",
  "court",
  "profile",
  "waitlist-accept"
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
 * to seed on boot. The bot's notification deep links (S6/S10) produce these, and
 * later slices extend this same map.
 *
 *   home (or empty/absent) → home (default)
 *   browse                 → browse        ("записаться" deep link)
 *   mybookings             → my-bookings   (reminder notifications)
 *   group                  → group
 *   individual             → individual
 *   court                  → court
 *   profile                → profile
 *
 * The id-carrying `waitlist_<id>` target (S6 waitlist accept) is parsed by
 * {@link parseWaitlistAccept} into a `{ route: "waitlist-accept", entryId }` target
 * the shell seeds on boot. `book_<id>` (S4 confirm) is still not reachable — its deep
 * link maps to Home until a later slice consumes it. Any unknown/malformed value
 * (incl. a `waitlist_<id>` whose id is not a uuid) maps to Home — never throw, never
 * blank the app, never leak.
 */
const DEEP_LINK_ROUTES: Readonly<Record<string, Exclude<RouteId, "waitlist-accept">>> = {
  home: "home",
  browse: "browse",
  mybookings: "my-bookings",
  group: "group",
  individual: "individual",
  court: "court",
  profile: "profile"
};

/** The `waitlist_<entryId>` deep-link prefix (Telegram lowercases nothing for us). */
const WAITLIST_ACCEPT_PREFIX = "waitlist_";

/**
 * A boot deep-link target: a bare route, or the waitlist-accept route carrying the
 * entry id parsed from `waitlist_<entryId>`. The accept route is the ONLY id-carrying
 * target, so the navigation stack stays a bare `RouteId[]` — the shell holds the
 * entry id once (boot only) rather than threading a param through every push/pop.
 */
export type StartTarget = { route: Exclude<RouteId, "waitlist-accept"> } | {
  route: "waitlist-accept";
  entryId: string;
};

/**
 * Parse a `waitlist_<entryId>` deep link into its entry id, or `null` when the value
 * is not that prefix or the id is not a valid uuid. Defensive: a malformed id never
 * reaches the API — the shell falls back to Home instead.
 */
export function parseWaitlistAccept(startParam: string | null): string | null {
  if (!startParam) {
    return null;
  }
  const value = startParam.trim();
  if (!value.toLowerCase().startsWith(WAITLIST_ACCEPT_PREFIX)) {
    return null;
  }
  const entryId = value.slice(WAITLIST_ACCEPT_PREFIX.length);
  return UUID_RE.test(entryId) ? entryId : null;
}

/** RFC-4122 uuid shape — the same id the @beosand/types `uuid` primitive validates. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a raw `startParam` to the boot {@link StartTarget}. Defensive by contract:
 * `waitlist_<uuid>` opens the accept screen carrying the id; a bare known prefix opens
 * its screen; empty/absent/unknown/malformed (incl. a non-uuid `waitlist_` id, or the
 * still-unbuilt `book_<id>`) all fall back to `home` — never throw, never blank the app.
 */
export function resolveStartTarget(startParam: string | null): StartTarget {
  const entryId = parseWaitlistAccept(startParam);
  if (entryId) {
    return { route: "waitlist-accept", entryId };
  }
  return { route: resolveStartParam(startParam) };
}

/**
 * Map a raw `startParam` to the bare route to open on boot. Defensive by contract:
 * empty/absent, unknown, or not-yet-reachable (`book_<id>`) values all return `home`.
 * Id-carrying `waitlist_<id>` is handled by {@link resolveStartTarget} — here it falls
 * through to `home` since it isn't a bare known prefix.
 */
export function resolveStartParam(startParam: string | null): Exclude<RouteId, "waitlist-accept"> {
  if (!startParam) {
    return "home";
  }
  const value = startParam.trim().toLowerCase();
  return DEEP_LINK_ROUTES[value] ?? "home";
}
