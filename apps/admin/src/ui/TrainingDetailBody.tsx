import type { TrainingCalendarItem, TrainingStatus } from "@beosand/types";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for a training status the API returns (never recomputed here). */
export function statusLabel(status: TrainingStatus, t: Translate): string {
  return t(`admin.trainings.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

/** Status-tag tone for the detail popup (open = ok, cancelled = warn). */
export function statusTone(status: TrainingStatus): string {
  if (status === "open") return "tag--ok";
  if (status === "cancelled") return "tag--warn";
  return "";
}

/**
 * The definition-list body of a training-detail popup. A shared `ui/` primitive so
 * both the calendar detail modal and the Trainings-table roster modal render the
 * exact same "whose training?" block. Pure presentation — every value (occupancy,
 * status, court) is the API's, never recomputed here.
 */
export function TrainingDetailBody({
  item,
  t
}: {
  item: TrainingCalendarItem;
  t: Translate;
}): JSX.Element {
  // An individual (1-on-1) training is group-less with an owning client; label it
  // as such and surface the client, rather than the generic "one-off".
  const isIndividual = item.groupId === null && item.clientId !== null;
  const groupValue = item.groupName
    ? item.groupName
    : isIndividual
      ? t("admin.trainings.individual")
      : t("admin.trainings.oneOff");

  return (
    <dl className="detail-list">
      <div className="detail-list__row">
        <dt>{t("admin.trainings.colGroup")}</dt>
        <dd>{groupValue}</dd>
      </div>
      {isIndividual ? (
        <div className="detail-list__row">
          <dt>{t("admin.trainings.individualClient")}</dt>
          <dd>{item.clientName ?? "—"}</dd>
        </div>
      ) : null}
      <div className="detail-list__row">
        <dt>{t("admin.trainings.colTrainer")}</dt>
        <dd>{item.trainerName}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.calendar.detailDate")}</dt>
        <dd>{item.date}</dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.trainings.colTime")}</dt>
        <dd>
          {item.startTime}–{item.endTime}
        </dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.trainings.colOccupancy")}</dt>
        <dd>
          {item.bookedCount} / {item.capacity}
        </dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.trainings.colStatus")}</dt>
        <dd>
          <span className={`tag ${statusTone(item.status)}`}>{statusLabel(item.status, t)}</span>
        </dd>
      </div>
      <div className="detail-list__row">
        <dt>{t("admin.calendar.detailCourt")}</dt>
        <dd>{item.courtNumber === null ? "—" : t("admin.trainings.courtOption", { number: item.courtNumber })}</dd>
      </div>
    </dl>
  );
}
