import type { ReactNode } from "react";
import { Glyph } from "./icons";

interface ChipProps {
  label: string;
  /** Coral-filled when true (an active filter / the engaged Today toggle). */
  active?: boolean;
  onClick: () => void;
  /** A leading glyph (e.g. the funnel on the filter trigger). */
  glyph?: "filter";
  /** Reflected to assistive tech as a toggle/pressed state. */
  pressed?: boolean;
  /** A small trailing count badge (e.g. number of active filters). */
  badge?: number;
}

/**
 * A single horizontally-scrolling pill used in the browse filter bar. Uses the
 * handoff `.chip` / `.chip.is-on` classes from theme.css. Active chips take the
 * BeoSand coral fill; inactive chips are the native bezeled surface, so the accent
 * is reserved for engaged state. The pressed/active state is announced via
 * `aria-pressed` — never by color alone.
 */
export function Chip({ label, active, onClick, glyph, pressed, badge }: ChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={active ? "chip is-on" : "chip"}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {glyph && <Glyph name={glyph} />}
      {label}
      {badge != null && badge > 0 && (
        <span className="chip__badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * The horizontal, scrollable bar that holds the Today toggle, the filter trigger,
 * and any active-filter chips. Uses the handoff `.chiprow` class.
 */
export function ChipBar({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="chiprow" role="group" aria-label={label}>
      {children}
    </div>
  );
}
