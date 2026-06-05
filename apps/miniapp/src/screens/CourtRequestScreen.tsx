import { useEffect, useMemo, useState } from "react";
import { Cell, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
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
 *   date     → pick a day from the offered window
 *   time     → pick an offerable start (server availability; each shows a free-court COUNT)
 *   duration → pick 1 / 1.5 / 2 hours
 *   preview  → review the SERVER's price + availability, then submit
 *   pending  → the created request (pending; NO court assigned)
 *
 * Interaction layer only: the client requests a TIME + DURATION and NEVER sees or
 * chooses a court number — the contracts carry no court id, and none is rendered at
 * any step. The 6-courts-per-hour limit is server-enforced and already reflected in
 * the offered times. The price is the server's `preview.priceRsd`, shown read-only;
 * the client never sends or computes a price. The caller's identity is supplied by
 * the ApiClient from the verified session, never user input.
 *
 * The native BackButton is owned by the shell and pops the WHOLE route; in-screen
 * "back" between steps is local state. There is exactly one native MainButton per
 * actionable step (none on the bare date/time/duration pickers).
 */
export function CourtRequestScreen(): JSX.Element {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [durationHours, setDurationHours] = useState<CourtDurationHours | undefined>(undefined);

  // The slot is complete once all three are chosen; the preview/submit step owns it.
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
      <List>
        <Section header={t("miniapp.court.pickDate")}>
          <div className="court-rail" role="group" aria-label={t("miniapp.court.pickDate")}>
            {dates.map((date) => {
              const dow = dayOfWeekFromDate(date);
              const weekday = t(weekdayShortKey(dow));
              const dayMonth = formatDayMonth(date);
              return (
                <button
                  key={date}
                  type="button"
                  className="court-pill"
                  onClick={() => onPick(date)}
                  aria-label={`${t(weekdayFullKey(dow))} ${dayMonth}`}
                >
                  <span className="court-pill__weekday">{weekday}</span>
                  <span className="court-pill__day">{dayMonth}</span>
                </button>
              );
            })}
          </div>
        </Section>
      </List>
    </div>
  );
}

/**
 * Step 2 — pick an offerable start time for the chosen date. The server returns ONLY
 * offerable starts (the 6-per-hour limit already applied), each with a free-court
 * COUNT; the screen renders them verbatim and never computes availability. No MainButton.
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
  // A malformed availability response is rejected by the contract in the ApiClient and
  // surfaces here as an error — never silently rendered, and never as a court id.
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
      <List>
        <Section header={t("miniapp.court.pickTime")}>
          <div className="court-rail" role="group" aria-label={t("miniapp.court.pickTime")}>
            {slots.map((slot) => (
              <TimePill key={slot.startTime} slot={slot} onPick={() => onPick(slot.startTime)} />
            ))}
          </div>
        </Section>
      </List>
    </div>
  );
}

/** One offerable start time with its free-court COUNT chip (never a court number). */
function TimePill({ slot, onPick }: { slot: SlotAvailability; onPick: () => void }): JSX.Element {
  const t = useT();
  const countLabel = t("miniapp.court.freeCount", { count: slot.freeCourts });
  return (
    <button
      type="button"
      className="court-pill court-pill--time"
      onClick={onPick}
      aria-label={`${slot.startTime}, ${countLabel}`}
    >
      <span>{slot.startTime}</span>
      <span className="court-count">{countLabel}</span>
    </button>
  );
}

/**
 * Step 3 — pick a duration (1 / 1.5 / 2 hours). The chosen date + start time are echoed
 * as a summary; the OptionList selection IS the action (no MainButton).
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
      <List>
        <Section header={t("miniapp.court.pickDuration")}>
          <Cell subhead={t("miniapp.booking.dateLabel")}>
            {`${t(weekdayFullKey(dow))}, ${formatDayMonth(date)}`}
          </Cell>
          <Cell subhead={t("miniapp.booking.timeLabel")}>{startTime}</Cell>
        </Section>
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
      </List>
    </div>
  );
}

/**
 * Step 4/5 — fetch the server preview for the chosen slot, then submit. The preview
 * runs once per slot (re-run when the slot changes via the key). The price shown is the
 * server's; the client computes nothing. On success the request is created (pending),
 * and the pending state shows NO court number.
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

  // Fetch the preview once per slot as a side effect (never in render): re-run only
  // when the slot changes via its key. `reset()`/`mutate()` are stable react-query
  // handles, so the effect is keyed solely by the slot identity.
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

  // The slot filled meanwhile: a calm "pick another time" state, never a red error.
  if (!preview.data.available) {
    return <CourtUnavailable onPickAnotherTime={onPickAnotherTime} />;
  }

  // A 409 on submit means the slot was just taken: reuse the calm "pick another time"
  // state rather than treating it as a generic failure.
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

/** The price-preview confirm step, rendered straight from the server's CourtRequestPreview. */
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
      <List>
        <Section header={t("miniapp.court.previewTitle")} footer={t("miniapp.court.previewBody")}>
          <Cell subhead={t("miniapp.booking.dateLabel")}>
            {`${t(weekdayFullKey(dow))}, ${formatDayMonth(preview.date)}`}
          </Cell>
          <Cell subhead={t("miniapp.booking.timeLabel")}>
            {formatTimeRange(preview.startTime, preview.endTime)}
          </Cell>
          <Cell subhead={t("miniapp.court.durationLabel")}>{durationLabel(preview.durationHours, t)}</Cell>
          <Cell subhead={t("miniapp.booking.priceLabel")} className="confirm-price">
            {t("miniapp.browse.price", { price: formatRsd(preview.priceRsd) })}
          </Cell>
        </Section>
      </List>

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
 * shown (none is assigned — `courtId` is null and is never rendered). Calm `role=status`.
 */
function CourtPending({ onHome }: { onHome: () => void }): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.court.toHome"),
    onClick: onHome
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <Placeholder
        header={t("miniapp.court.sentTitle")}
        description={t("miniapp.court.sentBody")}
      >
        <span className="success-badge" aria-hidden="true">
          ✓
        </span>
      </Placeholder>
      <FallbackButton text={t("miniapp.court.toHome")} onClick={onHome} />
    </div>
  );
}

/**
 * The calm "slot taken meanwhile" state (preview unavailable, or a submit 409): an
 * informational status, never a red error. The primary action returns to the time step.
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
      <Placeholder
        header={t("miniapp.court.unavailableTitle")}
        description={message || t("miniapp.court.unavailableBody")}
      >
        <span className="waitlist-badge waitlist-badge--muted" aria-hidden="true">
          <Glyph name="court" />
        </span>
      </Placeholder>
      <FallbackButton text={t("miniapp.court.pickAnotherTime")} onClick={onPickAnotherTime} />
    </div>
  );
}

/** The three offerable court durations, in display order. */
const DURATION_CHOICES: readonly CourtDurationHours[] = [1, 1.5, 2];

/** The catalog key for a court duration label — the single 1/1.5/2 → key mapping. */
function durationKey(duration: CourtDurationHours): string {
  if (duration === 1) {
    return "miniapp.court.duration1";
  }
  if (duration === 1.5) {
    return "miniapp.court.duration1_5";
  }
  return "miniapp.court.duration2";
}

/** The localized label for a court duration; display only, the value comes from the API. */
function durationLabel(duration: CourtDurationHours, t: TranslateFn): string {
  return t(durationKey(duration));
}
