import { useId } from "react";
import type { DayOfWeek } from "@beosand/types";

/** Mon–Sun, ISO order (1 = Monday … 7 = Sunday), with short RU labels. */
const DAYS: readonly { value: DayOfWeek; label: string; full: string }[] = [
  { value: 1, label: "Пн", full: "Понедельник" },
  { value: 2, label: "Вт", full: "Вторник" },
  { value: 3, label: "Ср", full: "Среда" },
  { value: 4, label: "Чт", full: "Четверг" },
  { value: 5, label: "Пт", full: "Пятница" },
  { value: 6, label: "Сб", full: "Суббота" },
  { value: 7, label: "Вс", full: "Воскресенье" }
];

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
    onChange(DAYS.filter((d) => next.has(d.value)).map((d) => d.value));
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
        {DAYS.map((day) => {
          const isOn = selected.has(day.value);
          return (
            <button
              key={day.value}
              type="button"
              className={isOn ? "day-picker__day day-picker__day--on" : "day-picker__day"}
              aria-pressed={isOn}
              aria-label={day.full}
              onClick={() => toggle(day.value)}
            >
              {day.label}
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
