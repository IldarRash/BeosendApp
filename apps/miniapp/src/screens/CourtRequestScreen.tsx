import { useEffect, useMemo, useState } from "react";
import type {
  CourtAvailability,
  CourtDurationHours,
  CourtRequestPreview,
  SlotAvailability
} from "@beosand/types";
import { ConflictError, type CourtRequestInput } from "../api/client";
import { resolveErrorMessage } from "../api/errors";
import { useCourtAvailability, useCourtPreview, useCreateCourtRequest } from "../api/hooks";
import { useT, type TranslateFn } from "../i18n/LanguageProvider";
import { useNav } from "../router/NavProvider";
import { hapticSelection, hapticSuccess, useMainButton } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { Glyph } from "../ui/icons";
import { OptionList, type Option } from "../ui/OptionList";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import {
  dayOfWeekFromDate,
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  offeredDates,
  weekdayFullKey,
  weekdayShortKey
} from "../ui/format";

/**
 * The court-rental request journey (S9). One screen, five derived steps:
 *
 *   date     → pick a day from the offered window (.datestrip / .dchip)
 *   time     → pick an offerable start (.timegrid / .tcell; each shows a free COUNT)
 *   duration → pick 1 / 1.5 / 2 hours (OptionList)
 *   preview  → review the SERVER's price + availability, then submit (.sumrow)
 *   pending  → the created request (pending; NO court assigned, role="status")
 *
 * Interaction layer only: the client requests a TIME + DURATION and NEVER sees or
 * chooses a court number — the contracts carry no court id, and none is rendered at
 * any step. The 6-courts-per-hour limit is server-enforced and already reflected in
 * the offered times. The price is the server's `preview.priceRsd`, shown read-only;
 * the client never sends or computes a price.
 */
export function CourtRequestScreen(): JSX.Element {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [durationHours, setDurationHours] = useState<CourtDurationHours | undefined>(undefined);

  if (date && startTime && durationHours) {
    return (
      <CourtPreviewFlow
        slot={{ date, startTime, durationHours }}
        onPickAnotherTime={() => {
          setStartTime(undefined);
          setDurationHours(undefined);
        }}
      />
    );
  }

  if (date && startTime) {
    return (
      <DurationStep
        date={date}
        startTime={startTime}
        onPick={(value) => {
          hapticSelection();
          setDurationHours(value);
        }}
      />
    );
  }

  if (date) {
    return (
      <TimeStep
        date={date}
        onPick={(time) => {
          hapticSelection();
          setStartTime(time);
        }}
      />
    );
  }

  return (
    <DateStep
      onPick={(picked) => {
        hapticSelection();
        setDate(picked);
      }}
    />
  );
}

/** Step 1 — pick a date from the offered window (today + next 13). No MainButton. */
function DateStep({ onPick }: { onPick: (date: string) => void }): JSX.Element {
  const t = useT();
  const dates = useMemo(() => offeredDates(), []);

  return (
    <div className="screen">
      <div className="tg-sech">{t("miniapp.court.pickDate")}</div>
      <div className="datestrip" role="group" aria-label={t("miniapp.court.pickDate")}>
        {dates.map((date) => {
          const dow = dayOfWeekFromDate(date);
          const weekday = t(weekdayShortKey(dow));
          const dayMonth = formatDayMonth(date);
          return (
            <button
              key={date}
              type="button"
              className="dchip"
              onClick={() => onPick(date)}
              aria-label={`${t(weekdayFullKey(dow))} ${dayMonth}`}
            >
              <div className="dchip__dow">{weekday}</div>
              <div className="dchip__day">{dayMonth.slice(0, 2)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Step 2 — pick an offerable start time for the chosen date. The server returns ONLY
 * offerable starts (the 6-per-hour limit already applied), each with a free-court
 * COUNT; the screen renders them verbatim and never computes availability.
 * Uses `.timegrid` / `.tcell` structure. No MainButton.
 */
function TimeStep({
  date,
  onPick
}: {
  date: string;
  onPick: (startTime: string) => void;
}): JSX.Element {
  const t = useT();
  const availability = useCourtAvailability(date);

  if (availability.isLoading) {
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }
  if (availability.error || availability.data === undefined) {
    const message =
      availability.error instanceof Error ? availability.error.message : undefined;
    return (
      <div className="screen screen__center">
        <ErrorState message={message} />
      </div>
    );
  }

  const slots: CourtAvailability["slots"] = availability.data.slots;
  if (slots.length === 0) {
    return (
      <div className="screen screen__center">
        <EmptyState titleKey="miniapp.court.noTimesTitle" bodyKey="miniapp.court.noTimesBody" />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="tg-sech">{t("miniapp.court.pickTime")}</div>
      <div className="timegrid" role="group" aria-label={t("miniapp.court.pickTime")}>
        {slots.map((slot) => (
          <TimeCell key={slot.startTime} slot={slot} onPick={() => onPick(slot.startTime)} />
        ))}
      </div>
    </div>
  );
}

/** One offerable start time with its free-court COUNT badge (never a court number). */
function TimeCell({ slot, onPick }: { slot: SlotAvailability; onPick: () => void }): JSX.Element {
  const t = useT();
  const countLabel = t("miniapp.court.freeCount", { count: slot.freeCourts });
  return (
    <button
      type="button"
      className="tcell"
      onClick={onPick}
      aria-label={`${slot.startTime}, ${countLabel}`}
    >
      <div className="tcell__t">{slot.startTime}</div>
      <div className="tcell__free">{countLabel}</div>
    </button>
  );
}

/**
 * Step 3 — pick a duration (1 / 1.5 / 2 hours). The chosen date + start time are
 * echoed as summary rows; the OptionList selection IS the action (no MainButton).
 */
function DurationStep({
  date,
  startTime,
  onPick
}: {
  date: string;
  startTime: string;
  onPick: (value: CourtDurationHours) => void;
}): JSX.Element {
  const t = useT();
  const dow = dayOfWeekFromDate(date);

  const options: ReadonlyArray<Option<number | undefined>> = DURATION_CHOICES.map((value) => ({
    value,
    label: t(durationKey(value))
  }));

  return (
    <div className="screen">
      {/* Echo of chosen date + time */}
      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
          <span className="sumrow__v">{`${t(weekdayFullKey(dow))}, ${formatDayMonth(date)}`}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
          <span className="sumrow__v">{startTime}</span>
        </div>
      </div>

      <OptionList
        name="court-duration"
        header={t("miniapp.court.pickDuration")}
        options={options}
        selected={undefined}
        onSelect={(value) => {
          if (value != null) {
            onPick(value as CourtDurationHours);
          }
        }}
      />
    </div>
  );
}

/**
 * Steps 4/5 — fetch the server preview for the chosen slot, then submit. The price
 * shown is the server's; the client computes nothing. On success the request is
 * created (pending), and the pending state shows NO court number.
 */
function CourtPreviewFlow({
  slot,
  onPickAnotherTime
}: {
  slot: CourtRequestInput;
  onPickAnotherTime: () => void;
}): JSX.Element {
  const t = useT();
  const nav = useNav();
  const preview = useCourtPreview();
  const create = useCreateCourtRequest();

  const slotKey = `${slot.date}|${slot.startTime}|${slot.durationHours}`;
  useEffect(() => {
    preview.reset();
    preview.mutate(slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  if (create.isSuccess) {
    return <CourtPending onHome={() => nav.pop()} />;
  }

  if (preview.isPending || !preview.data) {
    if (preview.error) {
      return (
        <div className="screen screen__center">
          <ErrorState message={resolveErrorMessage(preview.error, t)} />
        </div>
      );
    }
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }

  // The slot filled meanwhile: calm "pick another time" state, never a red error.
  if (!preview.data.available) {
    return <CourtUnavailable onPickAnotherTime={onPickAnotherTime} />;
  }

  // A 409 on submit: reuse the calm "pick another time" state.
  if (create.error instanceof ConflictError) {
    return <CourtUnavailable onPickAnotherTime={onPickAnotherTime} message={create.error.message} />;
  }

  return (
    <CourtPreview
      preview={preview.data}
      submitting={create.isPending}
      errorMessage={resolveErrorMessage(create.error, t)}
      onSubmit={() => {
        hapticSelection();
        create.mutate(slot, { onSuccess: () => hapticSuccess() });
      }}
    />
  );
}

/** The price-preview confirm step using `.sumrow` / `.note` structure. */
function CourtPreview({
  preview,
  submitting,
  errorMessage,
  onSubmit
}: {
  preview: CourtRequestPreview;
  submitting: boolean;
  errorMessage?: string;
  onSubmit: () => void;
}): JSX.Element {
  const t = useT();
  const dow = dayOfWeekFromDate(preview.date);

  useMainButton({
    text: t("miniapp.court.submit"),
    onClick: onSubmit,
    isLoading: submitting
  });

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <div className="tg-sech" style={{ padding: "0 0 7px" }}>
        {t("miniapp.court.previewTitle")}
      </div>

      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
          <span className="sumrow__v">{`${t(weekdayFullKey(dow))}, ${formatDayMonth(preview.date)}`}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
          <span className="sumrow__v">{formatTimeRange(preview.startTime, preview.endTime)}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.court.durationLabel")}</span>
          <span className="sumrow__v">{durationLabel(preview.durationHours, t)}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.priceLabel")}</span>
          <span className="sumrow__v sumrow__v--big">
            {t("miniapp.browse.price", { price: formatRsd(preview.priceRsd) })}
          </span>
        </div>
      </div>

      {/* Hint note */}
      <div className="note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        {t("miniapp.court.previewBody")}
      </div>

      {errorMessage && (
        <div className="confirm-error" role="alert">
          {errorMessage}
        </div>
      )}

      <FallbackButton text={t("miniapp.court.submit")} onClick={onSubmit} loading={submitting} />
    </div>
  );
}

/**
 * The pending-success state: the request reached the admin queue. NO court number is
 * shown (none is assigned). Calm `role="status"`.
 */
function CourtPending({ onHome }: { onHome: () => void }): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.court.toHome"),
    onClick: onHome
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <div className="stateview">
        <span className="success-badge" aria-hidden="true">✓</span>
        <div className="stateview__title">{t("miniapp.court.sentTitle")}</div>
        <div className="stateview__sub">{t("miniapp.court.sentBody")}</div>
      </div>
      <FallbackButton text={t("miniapp.court.toHome")} onClick={onHome} />
    </div>
  );
}

/**
 * The calm "slot taken meanwhile" state (preview unavailable, or a submit 409): an
 * informational status, never a red error. `role="status"` (not "alert").
 */
function CourtUnavailable({
  onPickAnotherTime,
  message
}: {
  onPickAnotherTime: () => void;
  message?: string;
}): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.court.pickAnotherTime"),
    onClick: onPickAnotherTime
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <div className="stateview">
        <div className="stateview__ic stateview__ic--muted" aria-hidden="true">
          <Glyph name="court" />
        </div>
        <div className="stateview__title">{t("miniapp.court.unavailableTitle")}</div>
        <div className="stateview__sub">{message || t("miniapp.court.unavailableBody")}</div>
      </div>
      <FallbackButton text={t("miniapp.court.pickAnotherTime")} onClick={onPickAnotherTime} />
    </div>
  );
}

/** The three offerable court durations, in display order. */
const DURATION_CHOICES: readonly CourtDurationHours[] = [1, 1.5, 2];

function durationKey(duration: CourtDurationHours): string {
  if (duration === 1) return "miniapp.court.duration1";
  if (duration === 1.5) return "miniapp.court.duration1_5";
  return "miniapp.court.duration2";
}

function durationLabel(duration: CourtDurationHours, t: TranslateFn): string {
  return t(durationKey(duration));
}
