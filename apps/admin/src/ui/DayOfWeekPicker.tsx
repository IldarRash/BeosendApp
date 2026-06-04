import { useId } from "react";
import type { DayOfWeek } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";

/** Mon–Sun, ISO order (1 = Monday … 7 = Sunday); labels come from the catalog. */
const DAY_VALUES: readonly DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];

interface DayOfWeekPickerProps {
  /** Label rendered above the toggle group. */
  label: string;
  /** Currently selected ISO weekdays. */
  value: readonly DayOfWeek[];
  /** Emits the next selection (ISO order, de-duplicated). */
  onChange: (value: DayOfWeek[]) => void;
  /** Validation message rendered below the group. */
  error?: string;
}

/**
 * Multi-select weekday picker returning the contract's `dayOfWeek` values
 * (1=Пн … 7=Вс). A labelled group of toggle buttons — keyboard- and
 * screen-reader-accessible (`aria-pressed`), warm-sand styled via theme tokens.
 * It carries no domain logic; the API validates the day set.
 */
export function DayOfWeekPicker({
  label,
  value,
  onChange,
  error
}: DayOfWeekPickerProps): JSX.Element {
  const t = useT();
  const groupId = useId();
  const errorId = `${groupId}-error`;
  const selected = new Set<DayOfWeek>(value);

  const toggle = (day: DayOfWeek): void => {
    const next = new Set(selected);
    if (next.has(day)) {
      next.delete(day);
    } else {
      next.add(day);
    }
    onChange(DAY_VALUES.filter((d) => next.has(d)));
  };

  return (
    <div className="field">
      <span className="field__label" id={groupId}>
        {label}
      </span>
      <div
        className="day-picker"
        role="group"
        aria-labelledby={groupId}
        aria-describedby={error ? errorId : undefined}
      >
        {DAY_VALUES.map((day) => {
          const isOn = selected.has(day);
          return (
            <button
              key={day}
              type="button"
              className={isOn ? "day-picker__day day-picker__day--on" : "day-picker__day"}
              aria-pressed={isOn}
              aria-label={t(`admin.day.full.${day}`)}
              onClick={() => toggle(day)}
            >
              {t(`admin.day.short.${day}`)}
            </button>
          );
        })}
      </div>
      {error ? (
        <span id={errorId} className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
