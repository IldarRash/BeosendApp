/**
 * Home-menu glyphs for the Mini App, one per client journey.
 *
 * Inline SVGs (no icon-library dependency) drawn on a shared 24×24 grid in a
 * consistent 1.8px stroke style with `currentColor`, so each glyph inherits the
 * BeoSand coral from its `.menu-icon` chip (ui/theme.css) and adapts to light &
 * dark with the rest of the native theme. Icons are decorative — the Cell label
 * is the accessible name — so each is `aria-hidden`.
 */
import type { SVGProps } from "react";

export type IconName = "browse" | "myBookings" | "group" | "individual" | "court" | "profile";

/**
 * Small inline glyphs used inside the browse flow (not Home-menu rows): a filter
 * funnel for the filter trigger and an hourglass for the waitlist affordance.
 * Same 24×24 / 1.8px / currentColor style as the menu glyphs so they inherit the
 * surrounding text or coral color; decorative, so `aria-hidden`.
 */
export type GlyphName =
  | "filter"
  | "waitlist"
  | "accept"
  | "booked"
  | "attended"
  | "noShow"
  | "cancelled"
  | "individual"
  | "court";

function Svg(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

/** Calendar — the schedule / browse-slots journey. */
function BrowseIcon(): JSX.Element {
  return (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </Svg>
  );
}

/** Checklist clipboard — the user's own bookings. */
function MyBookingsIcon(): JSX.Element {
  return (
    <Svg>
      <rect x="5" y="4.5" width="14" height="16" rx="2.5" />
      <path d="M9 4.5a3 3 0 0 1 6 0" />
      <path d="M8.5 11l1.4 1.4 2.6-2.8M8.5 16l1.4 1.4 2.6-2.8" />
      <path d="M14.5 11h2M14.5 16h2" />
    </Svg>
  );
}

/** Three figures — the monthly group subscription. */
function GroupIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="9" cy="9" r="2.6" />
      <path d="M4 19a5 5 0 0 1 10 0" />
      <circle cx="16.5" cy="9.5" r="2" />
      <path d="M14.5 14.2A4.3 4.3 0 0 1 20 18.4" />
    </Svg>
  );
}

/** Single figure with a spark — the one-on-one individual request. */
function IndividualIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="11" cy="8" r="3" />
      <path d="M5 19a6 6 0 0 1 12 0" />
      <path d="M18.5 4.5v3M17 6h3" />
    </Svg>
  );
}

/** A volleyball court divided by a net — court rental. */
function CourtIcon(): JSX.Element {
  return (
    <Svg>
      <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
      <path d="M12 6v12" />
      <path d="M3.5 12h17" strokeDasharray="2 2.4" />
    </Svg>
  );
}

/** Person in a circle — profile & language. */
function ProfileIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M6.8 18a5.4 5.4 0 0 1 10.4 0" />
    </Svg>
  );
}

/** Funnel — opens the slot filter sheet. */
function FilterIcon(): JSX.Element {
  return (
    <Svg>
      <path d="M4 5.5h16l-6.2 7.4v5.1l-3.6 1.5v-6.6L4 5.5Z" />
    </Svg>
  );
}

/** Hourglass — the waitlist affordance on a full slot. */
function WaitlistIcon(): JSX.Element {
  return (
    <Svg>
      <path d="M7 4h10M7 20h10" />
      <path d="M8 4c0 4 8 4 8 8s-8 4-8 8" />
      <path d="M16 4c0 4-8 4-8 8s8 4 8 8" />
    </Svg>
  );
}

const ICONS: Record<IconName, () => JSX.Element> = {
  browse: BrowseIcon,
  myBookings: MyBookingsIcon,
  group: GroupIcon,
  individual: IndividualIcon,
  court: CourtIcon,
  profile: ProfileIcon
};

/** Check inside a ring — the waitlist accept ("confirm the freed seat") affordance. */
function AcceptIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-5" />
    </Svg>
  );
}

/**
 * Booking-status glyphs for the My-bookings chips (S5). Each pairs with its chip
 * text + color so the status is conveyed by icon + label + tone, never color
 * alone. Tone is calm: a finished session is a neutral fact, not an alert.
 */
/** A bookmark — an upcoming, confirmed booking ("you're in"). */
function BookedIcon(): JSX.Element {
  return (
    <Svg>
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

/** A check — the session was attended. */
function AttendedIcon(): JSX.Element {
  return (
    <Svg>
      <path d="M5 12.5l4 4 10-10.5" />
    </Svg>
  );
}

/** A dash in a circle — a no-show (didn't happen), neutral not alarming. */
function NoShowIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </Svg>
  );
}

/** A cross in a circle — a cancelled booking. */
function CancelledIcon(): JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </Svg>
  );
}

const GLYPHS: Record<GlyphName, () => JSX.Element> = {
  filter: FilterIcon,
  waitlist: WaitlistIcon,
  accept: AcceptIcon,
  booked: BookedIcon,
  attended: AttendedIcon,
  noShow: NoShowIcon,
  cancelled: CancelledIcon,
  // The one-on-one figure reused bare (no coral chip) inside the soft
  // "trainer-unavailable" badge on the individual-request result (S8).
  individual: IndividualIcon,
  // The court figure reused bare (no coral chip) inside the calm "slot taken"
  // badge on the court-request flow (S9).
  court: CourtIcon
};

/**
 * Render a menu glyph by name wrapped in its coral chip. The wrapper carries the
 * tint + sizing (`.menu-icon`); the glyph inherits the coral via `currentColor`.
 */
export function MenuIcon({ name }: { name: IconName }): JSX.Element {
  const Glyph = ICONS[name];
  return (
    <span className="menu-icon">
      <Glyph />
    </span>
  );
}

/**
 * Render a bare browse-flow glyph (no coral chip wrapper) at 20×20, inheriting the
 * current text/icon color from its context. Used inside buttons and the waitlist
 * pill where the surrounding control owns the color.
 */
export function Glyph({ name }: { name: GlyphName }): JSX.Element {
  const G = GLYPHS[name];
  return (
    <span className="glyph" aria-hidden="true">
      <G />
    </span>
  );
}
