export interface Option<T> {
  /** A stable value identifying the option. */
  value: T;
  /** The visible label. */
  label: string;
  /** Optional secondary line shown below the label. */
  sub?: string;
  /** Optional trailing detail (e.g. price). */
  detail?: string;
}

interface OptionListProps<T> {
  /**
   * A unique radio-group name for THIS list. Required so two OptionLists on the same
   * screen (e.g. the four FilterSheet pickers) don't share one HTML radio group,
   * which would break native + assistive-tech single-select semantics.
   */
  name: string;
  header?: string;
  footer?: string;
  options: ReadonlyArray<Option<T>>;
  /** The currently selected value (compared by ===). */
  selected: T;
  onSelect: (value: T) => void;
}

/**
 * A single-select list of option rows using the handoff `.optrow` structure.
 *
 * Each row contains a visually hidden `<input type="radio">` that carries the native
 * radio semantics (role="radio", checked, name, aria-label) for assistive tech and
 * the test suite, while the custom `.optrow__radio` ring drives the visual affordance.
 * Selection is driven by a single `onClick` on the row (label element) so a tap fires
 * `onSelect` exactly once; the input is `readOnly` to prevent a second `onChange`.
 *
 * The coral radio ring is shown via CSS `.optrow.is-on .optrow__radio::after`.
 */
export function OptionList<T extends string | number | undefined>({
  name,
  header,
  footer,
  options,
  selected,
  onSelect
}: OptionListProps<T>): JSX.Element {
  return (
    <div>
      {header && <div className="tg-sech">{header}</div>}
      <div className="card">
        {options.map((option) => {
          const isSelected = option.value === selected;
          const id = `${name}-${String(option.value)}`;
          return (
            <label
              key={String(option.value)}
              htmlFor={id}
              className={isSelected ? "optrow is-on" : "optrow"}
              aria-current={isSelected || undefined}
              onClick={() => onSelect(option.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(option.value);
                }
              }}
              tabIndex={0}
            >
              {/* Visually hidden real radio input — carries role="radio", .checked, .name, aria-label */}
              <input
                id={id}
                type="radio"
                name={name}
                checked={isSelected}
                readOnly
                aria-label={option.label}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
              />
              {/* Visual coral ring (CSS drives the fill via .is-on) */}
              <span className="optrow__radio" aria-hidden="true" />
              <span className="optrow__main">
                <span className="optrow__title">{option.label}</span>
                {option.sub && <span className="optrow__sub">{option.sub}</span>}
              </span>
              {option.detail && (
                <span className="optrow__detail">{option.detail}</span>
              )}
            </label>
          );
        })}
      </div>
      {footer && <div className="tg-sech" style={{ paddingTop: 8 }}>{footer}</div>}
    </div>
  );
}
