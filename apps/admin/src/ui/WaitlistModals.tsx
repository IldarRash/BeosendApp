import { useState, type FormEvent } from "react";
import type {
  Group,
  RosterParticipant,
  TransferGroupResult,
  WaitlistAdminItem,
  WaitlistStatus
} from "@beosand/types";
import { ConflictError } from "../api/client";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { SelectField, type SelectOption } from "./Field";
import { useToast } from "./Toast";
import { useT } from "../i18n/LanguageProvider";
import { useRoster } from "../hooks/useRoster";
import { useTransferGroupMember } from "../hooks/useGroupMembers";
import { useSwapWaitlistEntry } from "../hooks/useWaitlist";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for a waitlist entry status the API returns (never recomputed here). */
export function waitlistStatusLabel(status: WaitlistStatus, t: Translate): string {
  return t(`admin.waitlist.status.${status}`);
}

/**
 * Human-readable error from a failed waitlist query/mutation. A 409 (training
 * filled meanwhile, or the entry/booking already changed) is expected here — show
 * one localized line and let the refetch reconcile the queue; other errors surface
 * the API's text verbatim.
 */
export function waitlistErrorText(error: unknown, t: Translate): string {
  if (error instanceof ConflictError) {
    return t("admin.waitlist.conflict");
  }
  return error instanceof Error ? error.message : t("admin.waitlist.opFailed");
}

interface SwapModalProps {
  target: WaitlistAdminItem | null;
  onClose: () => void;
}

/**
 * Swap a waitlist entry ahead of one of the training's booked clients. The roster
 * (reusing the shared getRoster read) is the source of bookings to replace; the
 * admin picks one and the server cancels it, promotes the entry, and re-queues the
 * displaced holder. The console renders the API's verbatim error (e.g. the seat
 * already changed → 409) and computes nothing.
 */
export function SwapModal({ target, onClose }: SwapModalProps): JSX.Element {
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
        onError: (error) => notify(waitlistErrorText(error, t), "error")
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
              {waitlistErrorText(roster.error, t)}
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
              {waitlistErrorText(swap.error, t)}
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
export function MoveGroupModal({
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
        onError: (error) => notify(waitlistErrorText(error, t), "error")
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
            {waitlistErrorText(transfer.error, t)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
