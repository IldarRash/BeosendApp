import { useState } from "react";
import type {
  Court,
  CourtRequestAdminView,
  CourtRequestStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { formatRsd } from "../lib/format";
import { useMe } from "../hooks/useSession";
import { useCourts } from "../hooks/useCourts";
import {
  useConfirmRequest,
  useCourtRequests,
  useFreeCourts,
  useRejectRequest
} from "../hooks/useCourtRequests";

/** The moderation queues, in tab order. */
const STATUS_TABS: readonly CourtRequestStatus[] = [
  "pending",
  "confirmed",
  "rejected",
  "cancelled"
];

/** RU labels for each queue status — the server owns the value, we only label it. */
const STATUS_LABEL: Record<CourtRequestStatus, string> = {
  pending: "Ожидают",
  confirmed: "Подтверждены",
  rejected: "Отклонены",
  cancelled: "Отменены"
};

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию.";
}

/**
 * The assigned court number — shown ONLY for a confirmed request that carries a
 * courtId. A pending request has no court (courtId is null); we render "не
 * назначен" and never a number, per the court invariant. The number is resolved
 * from the courts list (the admin view carries only the courtId).
 */
function courtCell(
  request: CourtRequestAdminView,
  numberByCourtId: Map<string, number>
): string {
  if (request.status === "confirmed" && request.courtId !== null) {
    const number = numberByCourtId.get(request.courtId);
    return number !== undefined ? `№ ${number}` : "—";
  }
  return "не назначен";
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
          notify(`Заявка подтверждена для ${toConfirm.clientName}.`, "success");
          closeConfirm();
        },
        // A 409 (slot filled meanwhile) arrives as a thrown Error; surface the
        // server's message and let the invalidation refetch the free courts.
        onError: (error) => notify(errorText(error), "error")
      }
    );
  }

  function rejectRequest(request: CourtRequestAdminView): void {
    if (decidedBy === null) return;
    reject.mutate(
      { id: request.id, input: { decidedBy } },
      {
        onSuccess: () => notify(`Заявка отклонена для ${request.clientName}.`, "success"),
        onError: (error) => notify(errorText(error), "error")
      }
    );
  }

  const columns: Column<CourtRequestAdminView>[] = [
    { key: "client", header: "Клиент", render: (r) => r.clientName },
    {
      key: "telegram",
      header: "Telegram ID",
      render: (r) => <code>{r.clientTelegramId}</code>
    },
    { key: "date", header: "Дата", render: (r) => r.date },
    { key: "time", header: "Время", render: (r) => `${r.startTime}–${r.endTime}` },
    {
      key: "duration",
      header: "Длит.",
      numeric: true,
      render: (r) => `${r.durationHours} ч`
    },
    { key: "price", header: "Цена", numeric: true, render: (r) => formatRsd(r.priceRsd) },
    { key: "court", header: "Корт", render: (r) => courtCell(r, numberByCourtId) },
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
              Подтвердить
            </Button>
            <Button
              variant="danger"
              disabled={decidedBy === null || reject.isPending}
              onClick={() => rejectRequest(r)}
            >
              Отклонить
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Заявки на корты</h1>
          <p>Модерация заявок: подтверждение с выбором корта или отклонение.</p>
        </div>
      </header>

      <div className="stack">
        <div role="tablist" aria-label="Статус заявок" className="cluster">
          {STATUS_TABS.map((tab) => {
            const selected = tab === status;
            return (
              <Button
                key={tab}
                role="tab"
                id={`court-tab-${tab}`}
                aria-selected={selected}
                aria-controls="court-requests-panel"
                variant={selected ? "primary" : "ghost"}
                onClick={() => setStatus(tab)}
              >
                {STATUS_LABEL[tab]}
              </Button>
            );
          })}
        </div>

        <div
          id="court-requests-panel"
          role="tabpanel"
          aria-labelledby={`court-tab-${status}`}
        >
          {requests.isPending ? (
            <p className="state">Загрузка заявок…</p>
          ) : requests.isError ? (
            <p className="state state--error" role="alert">
              {errorText(requests.error)}
            </p>
          ) : (
            <DataTable
              caption={`Заявки на корты: ${STATUS_LABEL[status]}`}
              columns={columns}
              rows={requests.data}
              rowKey={(r) => r.id}
              emptyLabel="В этой очереди заявок нет."
            />
          )}
        </div>
      </div>

      <Modal
        open={toConfirm !== null}
        onClose={closeConfirm}
        title={
          toConfirm
            ? `Подтвердить заявку — ${toConfirm.clientName}`
            : "Подтвердить заявку"
        }
        footer={
          <div className="cluster">
            <Button variant="ghost" onClick={closeConfirm}>
              Отмена
            </Button>
            <Button
              variant="primary"
              disabled={pickedCourtId === null || decidedBy === null || confirm.isPending}
              onClick={submitConfirm}
            >
              Подтвердить
            </Button>
          </div>
        }
      >
        {toConfirm ? (
          <div className="stack">
            <p>
              {toConfirm.date}, {toConfirm.startTime}–{toConfirm.endTime} ·{" "}
              {toConfirm.durationHours} ч · {formatRsd(toConfirm.priceRsd)}
            </p>
            {freeCourts.isPending ? (
              <p className="state">Загрузка свободных кортов…</p>
            ) : freeCourts.isError ? (
              <p className="state state--error" role="alert">
                {errorText(freeCourts.error)}
              </p>
            ) : freeCourts.data.length === 0 ? (
              <p className="state" role="status">
                Нет свободных кортов на это время.
              </p>
            ) : (
              <fieldset className="stack">
                <legend>Выберите корт</legend>
                {freeCourts.data.map((court: Court) => (
                  <label key={court.id} className="cluster">
                    <input
                      type="radio"
                      name="court-pick"
                      value={court.id}
                      checked={pickedCourtId === court.id}
                      onChange={() => setPickedCourtId(court.id)}
                    />
                    Корт № {court.number}
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
