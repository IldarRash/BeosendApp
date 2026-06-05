import { useState } from "react";
import type {
  Court,
  CourtRequestAdminView,
  CourtRequestStatus
} from "@beosand/types";
import { ConflictError } from "../api/client";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { formatRsd } from "../lib/format";
import { useMe } from "../hooks/useSession";
import { useCourts } from "../hooks/useCourts";
import {
  useConfirmRequest,
  useCourtRequests,
  useFreeCourts,
  useRejectRequest
} from "../hooks/useCourtRequests";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The moderation queues, in tab order. */
const STATUS_TABS: readonly CourtRequestStatus[] = [
  "pending",
  "confirmed",
  "rejected",
  "cancelled"
];

/** Catalog key for each queue status — the server owns the value, we only label it. */
function statusLabel(status: CourtRequestStatus, t: Translate): string {
  return t(`admin.courtRequests.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

/**
 * Human-readable error from a failed query/mutation. A 409 (slot taken meanwhile
 * or request already decided) is expected here — show one localized line and let
 * the refetch reconcile the queue/picker; other errors surface the API's text.
 */
function errorText(error: unknown, t: Translate): string {
  if (error instanceof ConflictError) {
    return t("admin.courtRequests.conflict");
  }
  return error instanceof Error ? error.message : t("admin.courtRequests.opFailed");
}

/**
 * The assigned court number — shown ONLY for a confirmed request that carries a
 * courtId. A pending request has no court (courtId is null); we render "не
 * назначен" and never a number, per the court invariant. The number is resolved
 * from the courts list (the admin view carries only the courtId).
 */
function courtCell(
  request: CourtRequestAdminView,
  numberByCourtId: Map<string, number>,
  t: Translate
): string {
  if (request.status === "confirmed" && request.courtId !== null) {
    const number = numberByCourtId.get(request.courtId);
    return number !== undefined ? t("admin.courtRequests.courtNumber", { number }) : "—";
  }
  return t("admin.courtRequests.courtUnassigned");
}

/**
 * M3 — Заявки на корты. The admin moderation queue across the four request
 * statuses (pending / confirmed / rejected / cancelled). A pending request can be
 * confirmed onto one of the courts the server reports free (never computed here),
 * or rejected. Court numbers appear only for confirmed requests and inside the
 * confirm picker; a pending row shows "не назначен". A 409 from confirm (the slot
 * filled meanwhile) is surfaced as an error — availability is never pre-checked
 * client-side.
 */
export function CourtRequests(): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const me = useMe();
  const decidedBy = me.data?.telegramId ?? null;

  const [status, setStatus] = useState<CourtRequestStatus>("pending");
  const [toConfirm, setToConfirm] = useState<CourtRequestAdminView | null>(null);
  const [pickedCourtId, setPickedCourtId] = useState<string | null>(null);

  const requests = useCourtRequests(status);
  const courts = useCourts();
  const freeCourts = useFreeCourts(toConfirm?.id ?? null);
  const confirm = useConfirmRequest();
  const reject = useRejectRequest();

  // courtId → number lookup for rendering a confirmed request's assigned court
  // (the admin view carries only the id). Empty until the courts list loads.
  const numberByCourtId = new Map<string, number>(
    (courts.data ?? []).map((c) => [c.id, c.number])
  );

  function openConfirm(request: CourtRequestAdminView): void {
    setToConfirm(request);
    setPickedCourtId(null);
  }

  function closeConfirm(): void {
    setToConfirm(null);
    setPickedCourtId(null);
  }

  function submitConfirm(): void {
    if (!toConfirm || pickedCourtId === null || decidedBy === null) return;
    confirm.mutate(
      { id: toConfirm.id, input: { courtId: pickedCourtId, decidedBy } },
      {
        onSuccess: () => {
          notify(t("admin.courtRequests.confirmed", { client: toConfirm.clientName }), "success");
          closeConfirm();
        },
        // A 409 (slot filled meanwhile, or request already decided) arrives as a
        // ConflictError; show the localized line and let the onSettled invalidation
        // refetch the queue + free-court picker so a taken court drops off here.
        onError: (error) => notify(errorText(error, t), "error")
      }
    );
  }

  function rejectRequest(request: CourtRequestAdminView): void {
    if (decidedBy === null) return;
    reject.mutate(
      { id: request.id, input: { decidedBy } },
      {
        onSuccess: () =>
          notify(t("admin.courtRequests.rejected", { client: request.clientName }), "success"),
        onError: (error) => notify(errorText(error, t), "error")
      }
    );
  }

  const columns: Column<CourtRequestAdminView>[] = [
    { key: "client", header: t("admin.courtRequests.colClient"), render: (r) => r.clientName },
    {
      key: "telegram",
      header: t("admin.courtRequests.colTelegram"),
      render: (r) => <code>{r.clientTelegramId}</code>
    },
    { key: "date", header: t("admin.courtRequests.colDate"), render: (r) => r.date },
    { key: "time", header: t("admin.courtRequests.colTime"), render: (r) => `${r.startTime}–${r.endTime}` },
    {
      key: "duration",
      header: t("admin.courtRequests.colDuration"),
      numeric: true,
      render: (r) => t("admin.courtRequests.durationHours", { hours: r.durationHours })
    },
    { key: "price", header: t("admin.courtRequests.colPrice"), numeric: true, render: (r) => formatRsd(r.priceRsd) },
    { key: "court", header: t("admin.courtRequests.colCourt"), render: (r) => courtCell(r, numberByCourtId, t) },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "pending" ? (
          <div className="cluster">
            <Button
              variant="primary"
              disabled={decidedBy === null}
              onClick={() => openConfirm(r)}
            >
              {t("admin.action.confirm")}
            </Button>
            <Button
              variant="danger"
              disabled={decidedBy === null || reject.isPending}
              onClick={() => rejectRequest(r)}
            >
              {t("admin.action.reject")}
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.courtRequests.title")}</h1>
          <p>{t("admin.courtRequests.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <div role="tablist" aria-label={t("admin.courtRequests.tabsLabel")} className="tabs">
          {STATUS_TABS.map((tab) => {
            const selected = tab === status;
            // The queue count is only fetched for the active status, so the badge
            // is shown there; other tabs label without a (potentially stale) count.
            const count = selected && requests.isSuccess ? requests.data.length : null;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`court-tab-${tab}`}
                aria-selected={selected}
                aria-controls="court-requests-panel"
                className={selected ? "tab tab--active" : "tab"}
                onClick={() => setStatus(tab)}
              >
                {statusLabel(tab, t)}
                {count !== null ? <span className="count">{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div
          id="court-requests-panel"
          role="tabpanel"
          aria-labelledby={`court-tab-${status}`}
        >
          {requests.isPending ? (
            <p className="state">{t("admin.courtRequests.loading")}</p>
          ) : requests.isError ? (
            <p className="state state--error" role="alert">
              {errorText(requests.error, t)}
            </p>
          ) : (
            <DataTable
              caption={t("admin.courtRequests.caption", { status: statusLabel(status, t) })}
              columns={columns}
              rows={requests.data}
              rowKey={(r) => r.id}
              emptyLabel={t("admin.courtRequests.empty")}
            />
          )}
        </div>
      </div>

      <Modal
        open={toConfirm !== null}
        onClose={closeConfirm}
        title={
          toConfirm
            ? t("admin.courtRequests.confirmTitleNamed", { client: toConfirm.clientName })
            : t("admin.courtRequests.confirmTitle")
        }
        footer={
          <div className="cluster">
            <Button variant="ghost" onClick={closeConfirm}>
              {t("admin.action.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={pickedCourtId === null || decidedBy === null || confirm.isPending}
              onClick={submitConfirm}
            >
              {t("admin.action.confirm")}
            </Button>
          </div>
        }
      >
        {toConfirm ? (
          <div className="stack">
            <p>
              {t("admin.courtRequests.confirmSummary", {
                date: toConfirm.date,
                start: toConfirm.startTime,
                end: toConfirm.endTime,
                hours: toConfirm.durationHours,
                price: formatRsd(toConfirm.priceRsd)
              })}
            </p>
            {freeCourts.isPending ? (
              <p className="state">{t("admin.courtRequests.freeLoading")}</p>
            ) : freeCourts.isError ? (
              <p className="state state--error" role="alert">
                {errorText(freeCourts.error, t)}
              </p>
            ) : freeCourts.data.length === 0 ? (
              <p className="state" role="status">
                {t("admin.courtRequests.noFreeCourts")}
              </p>
            ) : (
              <fieldset className="stack">
                <legend>{t("admin.courtRequests.pickCourt")}</legend>
                {freeCourts.data.map((court: Court) => (
                  <label key={court.id} className="cluster">
                    <input
                      type="radio"
                      name="court-pick"
                      value={court.id}
                      checked={pickedCourtId === court.id}
                      onChange={() => setPickedCourtId(court.id)}
                    />
                    {t("admin.courtRequests.courtOption", { number: court.number })}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}
