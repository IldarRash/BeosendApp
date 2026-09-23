import { dayOfMonth, monthWeeks, shiftMonth } from "@beosand/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage, useT } from "../i18n/LanguageProvider";
import { todayLocalDate } from "../ui/format";
import "./schedule-date-sheet.css";

const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const cursorFor = (value: string) => {
  const d = dateAtNoon(value);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};
const intlLocale = (locale: string) => (locale === "sr" ? "sr-Latn" : locale);
export function formatScheduleDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(dateAtNoon(value));
}
function Icon({ name }: { name: "close" | "previous" | "next" | "calendar" }) {
  const body =
    name === "close" ? (
      <path d="M6 6l12 12M18 6 6 18" />
    ) : name === "previous" ? (
      <path d="m14 6-6 6 6 6" />
    ) : name === "next" ? (
      <path d="m10 6 6 6-6 6" />
    ) : (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      </>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}
export function CalendarGlyph() {
  return <Icon name="calendar" />;
}
export function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
export function ScheduleDateSheet({
  open,
  date,
  minimumDate,
  onClose,
  onDate
}: {
  open: boolean;
  date: string;
  minimumDate: string;
  onClose: () => void;
  onDate: (date: string) => void;
}) {
  const t = useT(),
    { locale } = useLanguage(),
    dialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const [cursor, setCursor] = useState(() => cursorFor(date));
  useEffect(() => {
    const node = dialog.current;
    if (!node || !open) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      if (node.open) node.close();
      document.body.style.overflow = previous;
      returnFocus.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open) setCursor(cursorFor(date));
  }, [open, date]);
  const close = () => onClose();
  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month), [cursor]);
  const label = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric"
  }).format(new Date(cursor.year, cursor.month - 1, 1));
  const today = todayLocalDate();
  const prev = shiftMonth(cursor.year, cursor.month, -1);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" }).format(
      new Date(2026, 5, 1 + i)
    )
  );
  return (
    <dialog
      ref={dialog}
      className="schedule-date-sheet"
      aria-labelledby="schedule-date-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = (e.currentTarget as HTMLDialogElement).getBoundingClientRect();
        if (
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        )
          close();
      }}
    >
      <div className="schedule-date-sheet__panel">
        <header>
          <strong id="schedule-date-title">{t("miniapp.week.datePickerTitle")}</strong>
          <button type="button" aria-label={t("miniapp.week.datePickerClose")} onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="schedule-date-sheet__month">
          <button
            type="button"
            aria-label={t("miniapp.week.datePickerPrevious")}
            disabled={
              `${prev.year}-${String(prev.month).padStart(2, "0")}-01` <
              minimumDate.slice(0, 7) + "-01"
            }
            onClick={() => setCursor(prev)}
          >
            <Icon name="previous" />
          </button>
          <h2>{label}</h2>
          <button
            type="button"
            aria-label={t("miniapp.week.datePickerNext")}
            onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="schedule-date-sheet__weekdays">
          {weekdays.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="schedule-date-sheet__days">
          {weeks.flat().map((day, i) =>
            day ? (
              <button
                key={day}
                type="button"
                disabled={day < minimumDate}
                className={`${day === date ? "is-selected " : ""}${day === today ? "is-today" : ""}`}
                aria-label={new Intl.DateTimeFormat(intlLocale(locale), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric"
                }).format(dateAtNoon(day))}
                aria-current={day === today ? "date" : undefined}
                aria-pressed={day === date}
                onClick={() => {
                  onDate(day);
                  close();
                }}
              >
                {dayOfMonth(day)}
              </button>
            ) : (
              <span key={i} />
            )
          )}
        </div>
        <button
          type="button"
          className="schedule-date-sheet__today"
          disabled={today < minimumDate}
          onClick={() => {
            onDate(today);
            close();
          }}
        >
          {t("miniapp.week.today")}
        </button>
      </div>
    </dialog>
  );
}
