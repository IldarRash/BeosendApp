/**
 * Minimal line-icon set for the sidebar nav and chrome. Each icon is a ~17px
 * SVG that inherits color via `stroke="currentColor"` and carries the `.ico`
 * class the theme styles (ink-500, coral when the nav item is active). Icons are
 * decorative — the adjacent label is the accessible name — so they are
 * `aria-hidden`. `navIcon(key)` looks one up by a route's `iconKey`, falling
 * back to a neutral dot so a new route never renders a blank slot.
 */
import type { ReactNode } from "react";

interface IconProps {
  children: ReactNode;
}

/** Shared SVG frame: 17px box, rounded 1.8px strokes, no fill, decorative. */
function Icon({ children }: IconProps): JSX.Element {
  return (
    <svg
      className="ico"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, JSX.Element> = {
  // Schedule group
  overview: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  groups: (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3 3 0 0 1 0 6" />
      <path d="M18 14c2 .7 3.5 2.5 3.5 5" />
    </Icon>
  ),
  trainings: (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </Icon>
  ),
  trainers: (
    <Icon>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </Icon>
  ),
  managers: (
    <Icon>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21c0-3.9 3.1-7 7-7 1 0 2 .2 2.9.5" />
      <path d="M19 13l3 1.3v2.4c0 2.2-1.3 3.6-3 4.3-1.7-.7-3-2.1-3-4.3v-2.4L19 13z" />
    </Icon>
  ),
  levels: (
    <Icon>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </Icon>
  ),
  attendance: (
    <Icon>
      <path d="M9 11l2 2 4-4" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </Icon>
  ),
  clients: (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </Icon>
  ),
  subscriptions: (
    <Icon>
      <path d="M5 3h11l3 3v15l-2.5-1.5L14 21l-2.5-1.5L9 21l-2.5-1.5L5 21V3z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  ),
  // Courts group
  courtRequests: (
    <Icon>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 11h18M12 4v14" />
    </Icon>
  ),
  courtBlocks: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Icon>
  ),
  courtLoad: (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </Icon>
  ),
  // Communications group
  broadcasts: (
    <Icon>
      <path d="M4 9v6h4l6 4V5L8 9H4z" />
      <path d="M18 8.5a4 4 0 0 1 0 7" />
    </Icon>
  ),
  analytics: (
    <Icon>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16l4-5 3 3 4-6" />
    </Icon>
  ),
  labels: (
    <Icon>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </Icon>
  ),
  notificationTemplates: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </Icon>
  ),
  connectors: (
    <Icon>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </Icon>
  ),
  // Chrome
  logout: (
    <Icon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Icon>
  ),
  close: (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
};

/** Neutral fallback so an unmapped iconKey still renders a sized, aligned glyph. */
const FALLBACK_ICON: JSX.Element = (
  <Icon>
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

/** Look up a nav/chrome icon by key; never returns undefined. */
export function navIcon(key: string): JSX.Element {
  return ICONS[key] ?? FALLBACK_ICON;
}
