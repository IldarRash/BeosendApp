import { useRef, useState } from "react";
import type { CourtRequestStatus, MyCourtRequestItem } from "@beosand/types";
import { useCancelCourtRequest, useMyCourtRequestDetail } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSuccess, hapticWarning, useMainButton } from "../tg/buttons";
import { CourtCancelSheet } from "./CourtCancelSheet";
import { CourtVenueMap } from "./CourtVenueMap";
import { FallbackButton } from "./FallbackButton";
import { formatDayMonth, formatDurationHours, formatRsd, formatTimeRange } from "./format";
import { ErrorState, LoadingState } from "./StateView";

interface CourtDetailViewProps {
  requestId: string;
  onBack: () => void;
}

type ChipVariant = "co" | "ok" | "warn" | "muted";

/** Server-backed detail for one of the caller's court rentals. */
export function CourtDetailView({ requestId, onBack }: CourtDetailViewProps): JSX.Element {
  const t = useT();
  const detail = useMyCourtRequestDetail(requestId);
  const cancel = useCancelCourtRequest();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelInFlight = useRef(false);

  useMainButton({ text: t("miniapp.courtDetail.back"), onClick: onBack });

  if (detail.isLoading) {
    return <div className="screen screen__center"><LoadingState /></div>;
  }
  if (detail.error instanceof Error) {
    return <div className="screen screen__center"><ErrorState message={detail.error.message} /><FallbackButton text={t("miniapp.courtDetail.back")} onClick={onBack} /></div>;
  }
  if (!detail.data) {
    return <div className="screen screen__center"><ErrorState message={t("miniapp.calendar.errorBody")} /><FallbackButton text={t("miniapp.courtDetail.back")} onClick={onBack} /></div>;
  }

  const cancelError = resolveErrorMessage(cancel.error, t, "miniapp.myBookings.cancelConflict");
  const openCancel = (): void => {
    if (!detail.data!.canCancel) return;
    hapticWarning();
    cancel.reset();
    setConfirmingCancel(true);
  };
  const confirmCancel = (): void => {
    if (!detail.data!.canCancel || cancelInFlight.current) return;
    cancelInFlight.current = true;
    cancel.mutate(detail.data!.id, {
      onSuccess: () => {
        hapticSuccess();
        setConfirmingCancel(false);
        void detail.refetch();
      },
      onSettled: () => { cancelInFlight.current = false; }
    });
  };

  return (
    <div className="screen">
      <CourtDetailContent detail={detail.data} onCancel={openCancel} />
      <FallbackButton text={t("miniapp.courtDetail.back")} onClick={onBack} />
      <CourtCancelSheet
        item={confirmingCancel ? detail.data : null}
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

/** Pure court-rental content, exported for fixture visual QA and focused rendering tests. */
export function CourtDetailContent({
  detail,
  onCancel
}: {
  detail: MyCourtRequestItem;
  onCancel: () => void;
}): JSX.Element {
  const t = useT();
  const statusLabel = t(courtStatusKey(detail.status));
  // The API redacts non-confirmed assignments. Keep that presentation boundary here
  // too so a stale/legacy terminal response cannot light a venue court on this screen.
  const visibleCourtNumbers = detail.status === "confirmed" ? detail.courtNumbers : [];
  const unassignedLabel =
    detail.status === "pending"
      ? t("miniapp.courtDetail.unassigned")
      : t("miniapp.courtDetail.noAssignment");

  return <>
    <div className="tg-sech" style={{ padding: "0 0 7px" }}>{t("miniapp.courtDetail.title")}</div>
    <div className="card">
      <DetailRow label={t("miniapp.courtDetail.date")} value={formatDayMonth(detail.date)} />
      <DetailRow label={t("miniapp.courtDetail.time")} value={formatTimeRange(detail.startTime, detail.endTime)} />
      <DetailRow label={t("miniapp.courtDetail.duration")} value={t("miniapp.court.durationHours", { hours: formatDurationHours(detail.durationHours) })} />
      <DetailRow label={t("miniapp.courtDetail.count")} value={t("miniapp.myBookings.courtCount", { count: detail.courtCount })} />
      <DetailRow label={t("miniapp.courtDetail.price")} value={t("miniapp.records.price", { price: formatRsd(detail.priceRsd) })} />
      <div className="sumrow">
        <span className="sumrow__k">{t("miniapp.courtDetail.status")}</span>
        <span className="sumrow__v"><span className={`schip schip--${courtVariant(detail.status)}`}><span className="dot" aria-hidden="true" />{statusLabel}</span></span>
      </div>
      {visibleCourtNumbers.length > 0 ? <DetailRow label={t("miniapp.courtDetail.assignedCourts")} value={visibleCourtNumbers.join(", ")} /> : null}
      {detail.canCancel ? <div className="sumrow"><button type="button" className="tg-sbtn" onClick={onCancel} aria-label={t("miniapp.records.cancelCourtAction")}>{t("miniapp.records.cancelCourtAction")}</button></div> : null}
    </div>
    <CourtVenueMap
      courtNumbers={visibleCourtNumbers}
      statusLabel={statusLabel}
      labels={{
        title: t("miniapp.courtDetail.mapTitle"),
        lockers: t("miniapp.courtDetail.lockers"),
        entrance: t("miniapp.courtDetail.entrance"),
        yourCourt: t("miniapp.courtDetail.yourCourt"),
        otherCourts: t("miniapp.courtDetail.otherCourts"),
        unassigned: unassignedLabel,
        court: (number) => t("miniapp.courtDetail.court", { number })
      }}
    />
  </>;
}

function DetailRow({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="sumrow"><span className="sumrow__k">{label}</span><span className="sumrow__v">{value}</span></div>;
}

function courtVariant(status: CourtRequestStatus): ChipVariant {
  if (status === "confirmed") return "ok";
  if (status === "rejected" || status === "cancelled") return "muted";
  return "co";
}

function courtStatusKey(status: CourtRequestStatus): string {
  return `miniapp.calendar.courtStatus.${status}`;
}
