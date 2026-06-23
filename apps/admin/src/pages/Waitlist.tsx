import { useMemo, useState, type FormEvent } from "react";
import type {
  Group,
  GroupWaitlistQuery,
  RosterParticipant,
  TransferGroupResult,
  WaitlistAdminItem,
  WaitlistStatus
} from "@beosand/types";
import { ConflictError } from "../api/client";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { NumberField, SelectField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useGroups } from "../hooks/useGroups";
import { useRoster } from "../hooks/useRoster";
import { useTransferGroupMember } from "../hooks/useGroupMembers";
import {
  useGroupWaitlist,
  usePromoteWaitlistEntry,
  useRemoveWaitlistEntry,
  useSwapWaitlistEntry
} from "../hooks/useWaitlist";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for a waitlist entry status the API returns (never recomputed here). */
function statusLabel(status: WaitlistStatus, t: Translate): string {
  return t(`admin.waitlist.status.${status}`);
}

/**
 * Human-readable error from a failed query/mutation. A 409 (training filled
 * meanwhile, or the entry/booking already changed) is expected here — show one
 * localized line and let the refetch reconcile the queue; other errors surface the
 * API's text verbatim.
 */
function errorText(error: unknown, t: Translate): string {
  if (error instanceof ConflictError) {
    return t("admin.waitlist.conflict");
  }
  return error instanceof Error ? error.message : t("admin.waitlist.opFailed");
}

/** Month options 1..12 with localized names (reuses the trainings month catalog). */
function monthOptions(t: Translate): SelectOption[] {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: t(`admin.trainings.month.${i + 1}`)
  }));
}

/**
 * Waitlist — the admin queue of clients waiting on a group's trainings for a
 * month, with the four moderation actions (promote / swap / remove / move group).
 * An interaction layer only: every seat/capacity/credit decision is the server's;
 * the page picks a group + month, renders the validated queue, and surfaces the
 * API's verbatim error (a full training → 409) without ever recomputing seats.
 */
export function Waitlist(): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const now = new Date();

  const groups = useGroups();
  const [groupId, setGroupId] = useState("");
  const [year, setYear] = useState<number | null>(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const query: GroupWaitlistQuery | null =
    groupId !== "" && year !== null
      ? { groupId, year, month: Number.parseInt(month, 10) }
      : null;
  const waitlist = useGroupWaitlist(query);

  const promote = usePromoteWaitlistEntry();
  const remove = useRemoveWaitlistEntry();

  // Per-row modals: confirm-promote, swap-picker, confirm-remove, move-group.
  const [promoteTarget, setPromoteTarget] = useState<WaitlistAdminItem | null>(null);
  const [swapTarget, setSwapTarget] = useState<WaitlistAdminItem | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WaitlistAdminItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<WaitlistAdminItem | null>(null);

  const groupOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: t("admin.waitlist.pickGroup") },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data, t]
  );

  function submitPromote(): void {
    if (!promoteTarget) return;
    const name = promoteTarget.clientName;
    promote.mutate(promoteTarget.id, {
      onSuccess: () => {
        notify(t("admin.waitlist.promoted", { client: name }), "success");
        setPromoteTarget(null);
      },
      onError: (error) => notify(errorText(error, t), "error")
    });
  }

  function submitRemove(): void {
    if (!removeTarget) return;
    const name = removeTarget.clientName;
    remove.mutate(removeTarget.id, {
      onSuccess: () => {
        notify(t("admin.waitlist.removed", { client: name }), "success");
        setRemoveTarget(null);
      },
      onError: (error) => notify(errorText(error, t), "error")
    });
  }

  const columns: Column<WaitlistAdminItem>[] = [
    { key: "date", header: t("admin.waitlist.colDate"), render: (r) => r.date },
    {
      key: "time",
      header: t("admin.waitlist.colTime"),
      render: (r) => `${r.startTime}–${r.endTime}`
    },
    { key: "client", header: t("admin.waitlist.colClient"), render: (r) => r.clientName },
    {
      key: "position",
      header: t("admin.waitlist.colPosition"),
      numeric: true,
      render: (r) => r.position
    },
    {
      key: "status",
      header: t("admin.waitlist.colStatus"),
      render: (r) => (
        <span className={r.status === "waiting" ? "tag" : "tag tag--info"}>
          {statusLabel(r.status, t)}
        </span>
      )
    },
    {
      key: "actions",
      header: t("admin.waitlist.colActions"),
      render: (r) => (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            onClick={() => {
              promote.reset();
              setPromoteTarget(r);
            }}
            aria-label={t("admin.waitlist.promoteAria", { client: r.clientName })}
          >
            {t("admin.waitlist.promote")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSwapTarget(r)}
            aria-label={t("admin.waitlist.swapAria", { client: r.clientName })}
          >
            {t("admin.waitlist.swap")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMoveTarget(r)}
            aria-label={t("admin.waitlist.moveAria", { client: r.clientName })}
          >
            {t("admin.waitlist.move")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              remove.reset();
              setRemoveTarget(r);
            }}
            aria-label={t("admin.waitlist.removeAria", { client: r.clientName })}
          >
            {t("admin.waitlist.remove")}
          </Button>
        </div>
      )
    }
  ];

  const selectedGroup = (groups.data ?? []).find((g) => g.id === groupId) ?? null;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.waitlist.title")}</h1>
          <p>{t("admin.waitlist.lead")}</p>
        </div>
      </header>

      <form
        aria-label={t("admin.waitlist.filterLabel")}
        onSubmit={(e) => e.preventDefault()}
        style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <SelectField
          label={t("admin.field.group")}
          options={groupOptions}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        />
        <NumberField
          label={t("admin.trainings.fieldYear")}
          value={year}
          onValueChange={setYear}
        />
        <SelectField
          label={t("admin.trainings.fieldMonth")}
          options={monthOptions(t)}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </form>

      {query === null ? (
        <p className="state">{t("admin.waitlist.pickFilter")}</p>
      ) : waitlist.isPending ? (
        <p className="state">{t("admin.waitlist.loading")}</p>
      ) : waitlist.isError ? (
        <p className="state state--error" role="alert">
          {errorText(waitlist.error, t)}
        </p>
      ) : (
        <DataTable
          caption={t("admin.waitlist.caption")}
          columns={columns}
          rows={waitlist.data}
          rowKey={(r) => r.id}
          emptyLabel={t("admin.waitlist.empty")}
        />
      )}

      <Modal
        open={promoteTarget !== null}
        onClose={() => setPromoteTarget(null)}
        title={t("admin.waitlist.promoteTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoteTarget(null)} disabled={promote.isPending}>
              {t("admin.action.cancel")}
            </Button>
            <Button variant="primary" disabled={promote.isPending} onClick={submitPromote}>
              {promote.isPending ? t("admin.waitlist.promoting") : t("admin.waitlist.promote")}
            </Button>
          </>
        }
      >
        {promoteTarget ? (
          <p>
            {t("admin.waitlist.promotePrompt", {
              client: promoteTarget.clientName,
              date: promoteTarget.date,
              start: promoteTarget.startTime,
              end: promoteTarget.endTime
            })}
          </p>
        ) : null}
        {promote.isError ? (
          <p className="state state--error" role="alert">
            {errorText(promote.error, t)}
          </p>
        ) : null}
      </Modal>

      <SwapModal target={swapTarget} onClose={() => setSwapTarget(null)} />

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={t("admin.waitlist.removeTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)} disabled={remove.isPending}>
              {t("admin.action.cancel")}
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={submitRemove}>
              {remove.isPending ? t("admin.waitlist.removing") : t("admin.waitlist.removeConfirm")}
            </Button>
          </>
        }
      >
        {removeTarget ? (
          <p>{t("admin.waitlist.removePrompt", { client: removeTarget.clientName })}</p>
        ) : null}
        {remove.isError ? (
          <p className="state state--error" role="alert">
            {errorText(remove.error, t)}
          </p>
        ) : null}
      </Modal>

      {moveTarget && selectedGroup ? (
        <MoveGroupModal
          target={moveTarget}
          fromGroup={selectedGroup}
          groups={groups.data ?? []}
          year={query?.year ?? now.getFullYear()}
          month={query?.month ?? now.getMonth() + 1}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}
    </AppShell>
  );
}

interface SwapModalProps {
  target: WaitlistAdminItem | null;
  onClose: () => void;
}

/**
 * Swap a waitlist entry ahead of one of the training's booked clients. The roster
 * (reusing the shared getRoster read + RosterList) is the source of bookings to
 * replace; the admin picks one and the server cancels it, promotes the entry, and
 * re-queues the displaced holder. The console renders the API's verbatim error
 * (e.g. the seat already changed → 409) and computes nothing.
 */
function SwapModal({ target, onClose }: SwapModalProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const swap = useSwapWaitlistEntry();
  const roster = useRoster(target?.trainingId ?? null);
  const [replacesBookingId, setReplacesBookingId] = useState<string | null>(null);

  // Reset the picked booking + any stale error whenever a different entry opens.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (target && seededFor !== target.id) {
    setSeededFor(target.id);
    setReplacesBookingId(null);
    swap.reset();
  }
  if (!target && seededFor !== null) {
    setSeededFor(null);
  }

  function submit(): void {
    if (!target || replacesBookingId === null) return;
    const client = target.clientName;
    swap.mutate(
      { entryId: target.id, replacesBookingId },
      {
        onSuccess: () => {
          notify(t("admin.waitlist.swapped", { client }), "success");
          onClose();
        },
        onError: (error) => notify(errorText(error, t), "error")
      }
    );
  }

  // Only booked seats can be displaced; the server re-checks, this just guides the pick.
  const replaceable = (roster.data?.participants ?? []).filter((p) => p.bookingStatus === "booked");

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={
        target
          ? t("admin.waitlist.swapTitleNamed", { client: target.clientName })
          : t("admin.waitlist.swapTitle")
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={swap.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={replacesBookingId === null || swap.isPending}
            onClick={submit}
          >
            {swap.isPending ? t("admin.waitlist.swapping") : t("admin.waitlist.swap")}
          </Button>
        </>
      }
    >
      {target ? (
        <div className="stack">
          <p>
            {t("admin.waitlist.swapPrompt", {
              client: target.clientName,
              date: target.date,
              start: target.startTime,
              end: target.endTime
            })}
          </p>
          {roster.isPending ? (
            <p className="state">{t("admin.waitlist.rosterLoading")}</p>
          ) : roster.isError ? (
            <p className="state state--error" role="alert">
              {errorText(roster.error, t)}
            </p>
          ) : replaceable.length === 0 ? (
            <p className="state" role="status">
              {t("admin.waitlist.rosterEmpty")}
            </p>
          ) : (
            <fieldset className="stack">
              <legend>{t("admin.waitlist.swapPickLegend")}</legend>
              {replaceable.map((p: RosterParticipant) => (
                <label key={p.bookingId} className="cluster">
                  <input
                    type="radio"
                    name="swap-replace"
                    value={p.bookingId}
                    checked={replacesBookingId === p.bookingId}
                    onChange={() => setReplacesBookingId(p.bookingId)}
                  />
                  {p.clientName}
                </label>
              ))}
            </fieldset>
          )}
          {swap.isError ? (
            <p className="state state--error" role="alert">
              {errorText(swap.error, t)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

interface MoveGroupModalProps {
  target: WaitlistAdminItem;
  fromGroup: Group;
  groups: Group[];
  year: number;
  month: number;
  onClose: () => void;
}

/**
 * Move the waitlisted client to another group for the selected month, reusing the
 * shared transfer-group flow (POST /bookings/transfer-group). The target select
 * excludes the source group; the API owns all booking/capacity math — this modal
 * only collects the target and renders the server's per-date result.
 */
function MoveGroupModal({
  target,
  fromGroup,
  groups,
  year,
  month,
  onClose
}: MoveGroupModalProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const transfer = useTransferGroupMember();
  const [toGroupId, setToGroupId] = useState("");

  const targetOptions: SelectOption[] = [
    { value: "", label: t("admin.waitlist.movePickGroup") },
    ...groups
      .filter((g) => g.id !== fromGroup.id)
      .map((g) => ({ value: g.id, label: g.name }))
  ];

  function handleConfirm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (toGroupId === "") return;
    transfer.mutate(
      { clientId: target.clientId, fromGroupId: fromGroup.id, toGroupId, year, month },
      {
        onSuccess: (result: TransferGroupResult) => {
          notify(
            t("admin.waitlist.moved", {
              moved: result.movedDates.length,
              cancelled: result.cancelledDates.length,
              skipped: result.skippedDates.length
            }),
            "success"
          );
          onClose();
        },
        onError: (error) => notify(errorText(error, t), "error")
      }
    );
  }

  const canConfirm = toGroupId !== "" && !transfer.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.waitlist.moveTitle", { client: target.clientName })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={transfer.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="waitlist-move-form" disabled={!canConfirm}>
            {transfer.isPending ? t("admin.waitlist.moving") : t("admin.waitlist.move")}
          </Button>
        </>
      }
    >
      <form
        id="waitlist-move-form"
        onSubmit={handleConfirm}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <p>
          {t("admin.waitlist.moveFrom")} <strong>{fromGroup.name}</strong>
        </p>
        <SelectField
          label={t("admin.waitlist.moveTarget")}
          options={targetOptions}
          value={toGroupId}
          onChange={(e) => setToGroupId(e.target.value)}
        />
        {transfer.isError ? (
          <p className="field__error" role="alert">
            {errorText(transfer.error, t)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
