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
 * A single horizontally-scrolling pill used in the browse filter bar: the Today
 * toggle, the "Фильтры" trigger, and the row of active-filter chips. Active chips
 * take the BeoSand coral fill; inactive chips are the native bezeled surface, so
 * the accent is reserved for engaged state. The pressed/active state is announced
 * via `aria-pressed` — never by color alone.
 */
export function Chip({ label, active, onClick, glyph, pressed, badge }: ChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={active ? "chip chip--active" : "chip"}
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
 * and any active-filter chips. A plain semantic group; the screen owns the chips
 * and their state.
 */
export function ChipBar({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="chip-bar" role="group" aria-label={label}>
      {children}
    </div>
  );
}
