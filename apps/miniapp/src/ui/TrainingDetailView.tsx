import { useMemo, useState } from "react";
import type { BookingStatus, ClientTrainingDetail, MyBookingItem } from "@beosand/types";
import { useCancelBooking, useClientTrainingDetail } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess, hapticWarning, useMainButton } from "../tg/buttons";
import { buildGoogleCalendarTrainingUrl } from "./google-calendar-link";
import { CancelSheet } from "./CancelSheet";
import { FallbackButton } from "./FallbackButton";
import { formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";
import { ParticipantsRow } from "./ParticipantsRow";
import { ErrorState, LoadingState } from "./StateView";

interface TrainingDetailViewProps {
  trainingId: string;
  onBack: () => void;
}

type ChipVariant = "co" | "ok" | "warn" | "muted";

export function TrainingDetailView({ trainingId, onBack }: TrainingDetailViewProps): JSX.Element {
  const t = useT();
  const detail = useClientTrainingDetail(trainingId);
  const cancel = useCancelBooking();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useMainButton({
    text: t("miniapp.calendar.backToAgenda"),
    onClick: onBack
  });

  if (detail.isLoading) {
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }

  if (detail.error instanceof Error) {
    return (
      <div className="screen screen__center">
        <ErrorState message={detail.error.message} />
        <FallbackButton text={t("miniapp.calendar.backToAgenda")} onClick={onBack} />
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="screen screen__center">
        <ErrorState message={t("miniapp.calendar.errorBody")} />
        <FallbackButton text={t("miniapp.calendar.backToAgenda")} onClick={onBack} />
      </div>
    );
  }

  const cancelItem = toBookingItem(detail.data);
  const cancelError = resolveErrorMessage(cancel.error, t, "miniapp.myBookings.cancelConflict");

  const openCancel = (): void => {
    if (!cancelItem) {
      return;
    }
    hapticWarning();
    cancel.reset();
    setConfirmingCancel(true);
  };

  const confirmCancel = (): void => {
    if (!cancelItem) {
      return;
    }
    cancel.mutate(cancelItem.bookingId, {
      onSuccess: () => {
        hapticSuccess();
        setConfirmingCancel(false);
        void detail.refetch();
      }
    });
  };

  return (
    <div className="screen">
      <TrainingDetailContent detail={detail.data} onCancel={openCancel} />
      <FallbackButton text={t("miniapp.calendar.backToAgenda")} onClick={onBack} />
      <CancelSheet
        item={confirmingCancel ? cancelItem : null}
        onOpenChange={(open) => {
          if (!open && !cancel.isPending) {
            setConfirmingCancel(false);
            cancel.reset();
          }
        }}
        onConfirm={confirmCancel}
        submitting={cancel.isPending}
        errorMessage={cancelError}
      />
    </div>
  );
}

function TrainingDetailContent({
  detail,
  onCancel
}: {
  detail: ClientTrainingDetail;
  onCancel: () => void;
}): JSX.Element {
  const t = useT();
  const statusLabel = relationStatusLabel(detail, t);
  const variant = relationVariant(detail);
  const timeRange = formatTimeRange(detail.startTime, detail.endTime);
  const dateLine = `${t(weekdayFullKey(detail.dayOfWeek))}, ${formatDayMonth(detail.date)}`;
  const googleCalendarUrl = useMemo(
    () =>
      buildGoogleCalendarTrainingUrl({
        title: t("miniapp.calendar.googleTitle", { level: detail.levelName }),
        date: detail.date,
        startTime: detail.startTime,
        endTime: detail.endTime,
        details: [
          t("miniapp.calendar.googleDetailTrainer", { trainer: detail.trainerName }),
          t("miniapp.calendar.googleDetailLevel", { level: detail.levelName }),
          t("miniapp.calendar.googleDetailStatus", { status: statusLabel })
        ].join("\n"),
        location: t("miniapp.calendar.googleLocation")
      }),
    [
      detail.date,
      detail.endTime,
      detail.levelName,
      detail.startTime,
      detail.trainerName,
      statusLabel,
      t
    ]
  );

  const openGoogleCalendar = (): void => {
    hapticSelection();
    window.open(googleCalendarUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="tg-sech" style={{ padding: "0 0 7px" }}>
        {t("miniapp.calendar.trainingDetailTitle")}
      </div>

      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.calendar.kindTraining")}</span>
          <span className="sumrow__v">{detail.trainingContextLabel}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
          <span className="sumrow__v">{dateLine}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
          <span className="sumrow__v">{timeRange}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.trainerLabel")}</span>
          <span className="sumrow__v">{detail.trainerName}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.levelLabel")}</span>
          <span className="sumrow__v">{detail.levelName}</span>
        </div>
        {detail.courtNumber != null ? (
          <div className="sumrow">
            <span className="sumrow__k">{t("miniapp.calendar.kindCourt")}</span>
            <span className="sumrow__v">#{detail.courtNumber}</span>
          </div>
        ) : null}
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.calendar.statusLabel")}</span>
          <span className="sumrow__v">
            <span className={`schip schip--${variant}`}>
              <span className="dot" aria-hidden="true" />
              {statusLabel}
            </span>
          </span>
        </div>
        {detail.waitlistPosition != null ? (
          <div className="sumrow">
            <span className="sumrow__k">{t("miniapp.calendar.kindWaitlist")}</span>
            <span className="sumrow__v">
              {t("miniapp.myBookings.waitlistPosition", {
                position: detail.waitlistPosition
              })}
            </span>
          </div>
        ) : null}
        {detail.description ? (
          <div className="sumrow">
            <span className="sumrow__k">{t("miniapp.calendar.trainingDetailTitle")}</span>
            <span className="sumrow__v">{detail.description}</span>
          </div>
        ) : null}
        {detail.exportEligible ? (
          <div className="sumrow">
            <button
              type="button"
              className="tg-sbtn"
              onClick={openGoogleCalendar}
              aria-label={t("miniapp.calendar.googleAddAria")}
            >
              {t("miniapp.calendar.googleAdd")}
            </button>
          </div>
        ) : null}
        {detail.canCancel && detail.bookingId ? (
          <div className="sumrow">
            <button
              type="button"
              className="tg-sbtn"
              onClick={onCancel}
              aria-label={t("miniapp.myBookings.cancelAria")}
            >
              {t("miniapp.myBookings.cancelConfirm")}
            </button>
          </div>
        ) : null}
      </div>

      <ParticipantsRow
        members={detail.participants.participants}
        count={detail.participants.participantCount}
        title={t("miniapp.training.roster.title")}
        emptyLabel={t("miniapp.training.roster.empty")}
      />
      {detail.participants.waitlistCount > 0 ? (
        <ParticipantsRow
          members={detail.participants.waitlist}
          count={detail.participants.waitlistCount}
          title={t("miniapp.training.waitlist.title")}
          emptyLabel={t("miniapp.training.roster.empty")}
        />
      ) : null}
    </>
  );
}

function toBookingItem(detail: ClientTrainingDetail): MyBookingItem | null {
  if (!detail.bookingId || !detail.bookingStatus) {
    return null;
  }
  return {
    bookingId: detail.bookingId,
    trainingId: detail.trainingId,
    groupSubscriptionId: detail.groupSubscriptionId,
    date: detail.date,
    dayOfWeek: detail.dayOfWeek,
    startTime: detail.startTime,
    endTime: detail.endTime,
    trainingContextLabel: detail.trainingContextLabel,
    trainerName: detail.trainerName,
    levelName: detail.levelName,
    bookingStatus: detail.bookingStatus,
    trainingStatus: detail.trainingStatus,
    canCancel: detail.canCancel
  };
}

function relationStatusLabel(
  detail: ClientTrainingDetail,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (detail.bookingStatus) {
    return t(bookingStatusKey(detail.bookingStatus));
  }
  if (detail.viewerRelation === "waitlisted") {
    return t("miniapp.calendar.kindWaitlist");
  }
  if (detail.trainingStatus === "full") {
    return t("miniapp.calendar.fullWaitlist");
  }
  return t("miniapp.calendar.kindAvailable");
}

function relationVariant(detail: ClientTrainingDetail): ChipVariant {
  if (!detail.bookingStatus) {
    return detail.viewerRelation === "waitlisted" || detail.trainingStatus === "full"
      ? "warn"
      : "muted";
  }
  return bookingVariant(detail.bookingStatus);
}

function bookingVariant(status: BookingStatus): ChipVariant {
  switch (status) {
    case "attended":
      return "ok";
    case "pending":
    case "no_show":
      return "warn";
    case "cancelled":
      return "muted";
    default:
      return "co";
  }
}

function bookingStatusKey(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "miniapp.myBookings.status.pending";
    case "attended":
      return "miniapp.myBookings.status.attended";
    case "no_show":
      return "miniapp.myBookings.status.noShow";
    case "cancelled":
      return "miniapp.myBookings.status.cancelled";
    default:
      return "miniapp.myBookings.status.booked";
  }
}
