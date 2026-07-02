import { useEffect, useMemo, useState } from "react";
import {
  COURT_DURATION_CHOICES,
  type CourtClientGrid,
  type CourtDurationHours,
  type CourtRequestPreview
} from "@beosand/types";
import { ConflictError, type CourtRequestInput } from "../api/client";
import { resolveErrorMessage } from "../api/errors";
import {
  useCourtClientGrid,
  useCourtPreview,
  useCreateCourtRequest
} from "../api/hooks";
import { useT, type TranslateFn } from "../i18n/LanguageProvider";
import { useNav } from "../router/NavProvider";
import { hapticSelection, hapticSuccess, useMainButton } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { Glyph } from "../ui/icons";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import {
  dayOfWeekFromDate,
  formatDayMonth,
  formatDurationHours,
  formatRsd,
  formatTimeRange,
  offeredDates,
  weekdayFullKey,
  weekdayShortKey
} from "../ui/format";

/** Screen sections: choose date, duration, then pick time+courts from one grid. */
export function CourtRequestScreen(): JSX.Element {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [durationHours, setDurationHours] = useState<CourtDurationHours | undefined>(undefined);
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [courtNumbers, setCourtNumbers] = useState<number[] | undefined>(undefined);
  const [readyForPreview, setReadyForPreview] = useState(false);

  const clearCourtSelection = (): void => {
    setStartTime(undefined);
    setCourtNumbers(undefined);
    setReadyForPreview(false);
  };

  if (date && durationHours && startTime && courtNumbers && courtNumbers.length > 0 && readyForPreview) {
    return (
      <CourtPreviewFlow
        slot={{ date, startTime, durationHours, courtNumbers }}
        onPickAnotherTime={() => {
          clearCourtSelection();
        }}
      />
    );
  }

  return (
    <CourtSelectionFlow
      date={date}
      durationHours={durationHours}
      startTime={startTime}
      courtNumbers={courtNumbers}
      onDatePick={(pickedDate) => {
        setDate(pickedDate);
        setDurationHours(undefined);
        clearCourtSelection();
      }}
      onDurationPick={(pickedDuration) => {
        setDurationHours(pickedDuration);
        clearCourtSelection();
      }}
      onCellPick={(cellStartTime, courtNumber) => {
        if (durationHours == null || date == null) {
          return;
        }
        setReadyForPreview(false);
        const sameStart = startTime === cellStartTime;
        if (!sameStart) {
          setStartTime(cellStartTime);
          setCourtNumbers([courtNumber]);
          return;
        }
        setCourtNumbers((previous) => {
          if (previous == null) {
            return [courtNumber];
          }
          const next = previous.includes(courtNumber)
            ? previous.filter((n) => n !== courtNumber)
            : [...previous, courtNumber];
          if (sameStart && next.length === 0) {
            setStartTime(undefined);
          }
          return next;
        });
      }}
      onContinue={() => {
        if (startTime != null && courtNumbers && courtNumbers.length > 0) {
          setStartTime(startTime);
          setCourtNumbers([...courtNumbers].sort((a, b) => a - b));
          setReadyForPreview(true);
        }
      }}
    />
  );
}

function CourtSelectionFlow({
  date,
  durationHours,
  startTime,
  courtNumbers,
  onDatePick,
  onDurationPick,
  onCellPick,
  onContinue
}: {
  date: string | undefined;
  durationHours: CourtDurationHours | undefined;
  startTime: string | undefined;
  courtNumbers: number[] | undefined;
  onDatePick: (date: string) => void;
  onDurationPick: (durationHours: CourtDurationHours) => void;
  onCellPick: (startTime: string, courtNumber: number) => void;
  onContinue: () => void;
}): JSX.Element {
  const t = useT();
  const grid = useCourtClientGrid(date, durationHours);
  const canContinue = startTime != null && (courtNumbers?.length ?? 0) > 0;
  const canSelectSlot = date != null && durationHours != null;

  useMainButton({
    text: t("miniapp.court.continue"),
    onClick: () => {
      if (canContinue) {
        onContinue();
      }
    },
    isEnabled: canContinue
  });

  return (
    <div className="screen">
      <DateStep
        date={date}
        onPick={onDatePick}
      />
      <div className="tg-sech">{t("miniapp.court.pickDuration")}</div>
      <div
        className="seg seg--court-duration"
        role="radiogroup"
        aria-label={t("miniapp.court.pickDuration")}
      >
        {COURT_DURATION_CHOICES.map((value) => {
          const isOn = durationHours === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isOn}
              className={isOn ? "is-on" : undefined}
              onClick={() => onDurationPick(value)}
            >
              {durationLabel(value, t)}
            </button>
          );
        })}
      </div>

      {canSelectSlot && grid.isLoading ? (
        <div className="screen__center">
          <LoadingState />
        </div>
      ) : canSelectSlot && (grid.error || grid.data === undefined) ? (
        <div className="screen__center">
          <ErrorState message={grid.error instanceof Error ? grid.error.message : undefined} />
        </div>
      ) : canSelectSlot && grid.data !== undefined ? (
        <CourtGrid
          grid={grid.data}
          selectedStart={startTime}
          selectedCourts={courtNumbers}
          onCellPick={onCellPick}
          date={date}
          durationHours={durationHours}
        />
      ) : (
        <div className="note">
          {date ? t("miniapp.court.pickDuration") : t("miniapp.court.pickDate")}
        </div>
      )}

      <div className="tg-sech" role="status" aria-live="polite">
        {canContinue
          ? t("miniapp.court.selectedCount", { count: courtNumbers?.length ?? 0 })
          : date && durationHours
            ? t("miniapp.court.pickCourtsHint")
            : date
              ? t("miniapp.court.pickDuration")
              : t("miniapp.court.pickDate")}
      </div>

      <FallbackButton
        text={t("miniapp.court.continue")}
        onClick={() => {
          if (!canContinue) {
            return;
          }
          onContinue();
        }}
        disabled={!canContinue}
      />
    </div>
  );
}

/** Date strip step. It stays visible so date can be changed from the same view. */
function DateStep({
  date,
  onPick
}: {
  date: string | undefined;
  onPick: (date: string) => void;
}): JSX.Element {
  const t = useT();
  const dates = useMemo(() => offeredDates(), []);
  return (
    <section>
      <div className="tg-sech">{t("miniapp.court.pickDate")}</div>
      <div className="datestrip" role="group" aria-label={t("miniapp.court.pickDate")}>
        {dates.map((candidate) => {
          const dayMonth = formatDayMonth(candidate);
          const dow = dayOfWeekFromDate(candidate);
          const label = `${t(weekdayFullKey(dow))}, ${dayMonth}`;
          return (
            <button
              key={candidate}
              type="button"
              className={`dchip ${date === candidate ? "is-on" : ""}`}
              onClick={() => onPick(candidate)}
              aria-label={label}
            >
              <div className="dchip__dow">{t(weekdayShortKey(dow))}</div>
              <div className="dchip__day">{dayMonth.slice(0, 2)}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Main interactive availability grid: one row per court, one column per 30-min start. */
function CourtGrid({
  grid,
  selectedStart,
  selectedCourts,
  onCellPick,
  date,
  durationHours
}: {
  grid: CourtClientGrid;
  selectedStart: string | undefined;
  selectedCourts: number[] | undefined;
  onCellPick: (startTime: string, courtNumber: number) => void;
  date: string;
  durationHours: CourtDurationHours;
}): JSX.Element {
  const t = useT();
  const rows = useMemo(
    () => [...grid.rows].sort((a, b) => a.courtNumber - b.courtNumber),
    [grid.rows]
  );
  const startTimes = useMemo(() => {
    const times = new Set<string>();
    for (const row of rows) {
      for (const cell of row.cells) {
        times.add(cell.startTime);
      }
    }
    return Array.from(times).sort();
  }, [rows]);
  const selectedSet = useMemo(() => new Set(selectedCourts ?? []), [selectedCourts]);

  if (rows.length === 0 || startTimes.length === 0) {
    return (
      <div className="screen__center">
        <EmptyState titleKey="miniapp.court.noTimesTitle" bodyKey="miniapp.court.noTimesBody" />
      </div>
    );
  }

  const dateLabel = `${t(weekdayFullKey(dayOfWeekFromDate(date)))}, ${formatDayMonth(date)}`;
  const durationLabelText = durationLabel(durationHours, t);
  const templateColumns = `64px repeat(${startTimes.length}, minmax(72px, 1fr))`;

  return (
    <section className="court-grid-block">
      <div className="card">
      <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
          <span className="sumrow__v">{dateLabel}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.court.durationLabel")}</span>
          <span className="sumrow__v">{durationLabelText}</span>
        </div>
      </div>

      <div className="tg-sech">{t("miniapp.court.pickCourts")}</div>
      <div className="court-grid-wrap" role="grid" aria-label={t("miniapp.court.pickCourts")}>
        <div className="court-grid" style={{ gridTemplateColumns: templateColumns }}>
          <div className="court-grid__cell court-grid__cell--head court-grid__cell--sticky-col" />
          {startTimes.map((startTime) => (
            <div
              key={`head-${startTime}`}
              className="court-grid__cell court-grid__cell--head court-grid__cell--sticky-top"
            >
              {startTime}
            </div>
          ))}

          {rows.map((row) => {
            const rowLabel = t("miniapp.court.courtN", { n: row.courtNumber });
            const rowCells = new Map<string, (typeof row.cells)[number]>(
              row.cells.map((cell) => [cell.startTime, cell])
            );

            return (
              <div key={`row-${row.courtNumber}`} style={{ display: "contents" }}>
                <div className="court-grid__cell court-grid__cell--row court-grid__cell--sticky-col">
                  {rowLabel}
                </div>
                {startTimes.map((startTime) => {
                  const cell = rowCells.get(startTime);
                  const isFree = cell?.state === "free";
                  const isSelected = selectedStart === startTime && selectedSet.has(row.courtNumber);
                  const courtLabel = t("miniapp.court.courtN", { n: row.courtNumber });
                  const takenLabel = t("miniapp.court.courtTaken", { n: row.courtNumber });
                  const label = `${isFree ? courtLabel : takenLabel} ${startTime}`;
                  return (
                    <button
                      key={`${row.courtNumber}-${startTime}`}
                      type="button"
                      role="button"
                      className={`court-grid__cell ${
                        isFree ? "is-free" : "is-unavailable"
                      } ${isSelected ? "is-selected" : ""}`}
                      disabled={!isFree}
                      aria-label={label}
                      aria-pressed={isFree ? isSelected : undefined}
                      onClick={() => {
                        if (isFree) {
                          onCellPick(startTime, row.courtNumber);
                        }
                      }}
                    >
                      {isSelected ? "\u2713" : ""}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Steps 4/5 for preview + create, preserved from the old flow.
 * Keeps server-owned price handling and calm unavailable/409 state.
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

  const slotKey = `${slot.date}|${slot.startTime}|${slot.durationHours}|${(slot.courtNumbers ?? []).join(",")}`;
  useEffect(() => {
    preview.reset();
    preview.mutate(slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  if (create.isSuccess) {
    return <CourtPending courtNumbers={create.data.courtNumbers} onHome={() => nav.pop()} />;
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

  if (!preview.data.available) {
    return <CourtUnavailable onPickAnotherTime={onPickAnotherTime} />;
  }

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
  const courtsLabel = formatCourtNumbers(preview.courtNumbers);

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
        {preview.courtNumbers.length > 0 && (
          <div className="sumrow">
            <span className="sumrow__k">
              {t("miniapp.court.courtsLabel")} ({preview.courtCount})
            </span>
            <span className="sumrow__v">{courtsLabel}</span>
          </div>
        )}
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.priceLabel")}</span>
          <span className="sumrow__v sumrow__v--big">
            {t("miniapp.browse.price", { price: formatRsd(preview.priceRsd) })}
          </span>
        </div>
      </div>

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

/** Pending state keeps server-owned court assignment hidden until confirmation. */
function CourtPending({
  courtNumbers,
  onHome
}: {
  courtNumbers: number[];
  onHome: () => void;
}): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.court.toHome"),
    onClick: onHome
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <div className="stateview">
        <span className="success-badge" aria-hidden="true">{"\u2713"}</span>
        <div className="stateview__title">{t("miniapp.court.sentTitle")}</div>
        <div className="stateview__sub">{t("miniapp.court.sentBody")}</div>
        {courtNumbers.length > 0 && (
          <div className="stateview__sub">
            {t("miniapp.court.sentCourts", { courts: formatCourtNumbers(courtNumbers) })}
          </div>
        )}
      </div>
      <FallbackButton text={t("miniapp.court.toHome")} onClick={onHome} />
    </div>
  );
}

/** Calm unavailable state after preview returns false, or 409 submit conflict. */
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

/** "{hours} ч." label for a court duration from a local value. */
function durationLabel(duration: CourtDurationHours, t: TranslateFn): string {
  return t("miniapp.court.durationHours", { hours: formatDurationHours(duration) });
}

/** Sorted, comma-joined court numbers for a summary line. */
function formatCourtNumbers(courtNumbers: number[]): string {
  return [...courtNumbers].sort((a, b) => a - b).join(", ");
}
