import { useState } from "react";
import type { WaitlistAdminItem } from "@beosand/types";
import { Button } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { useGroups } from "../hooks/useGroups";
import {
  usePromoteWaitlistEntry,
  useRemoveWaitlistEntry,
  useTrainingWaitlist
} from "../hooks/useWaitlist";
import {
  MoveGroupModal,
  SwapModal,
  waitlistErrorText,
  waitlistStatusLabel
} from "./WaitlistModals";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface WaitlistSectionProps {
  /** The training whose waitlist to load. */
  trainingId: string;
  /**
   * The training's group id — the waitlist is a group-training-only surface, so the
   * section renders nothing when this is null (individual training).
   */
  groupId: string | null;
  /** The training's date (yyyy-mm-dd), used to derive the move-group month. */
  date: string;
  t: Translate;
}

/** Parse the year/month a move-group transfer should target from the date string. */
function monthFromDate(date: string): { year: number; month: number } {
  const [year, month] = date.split("-");
  return { year: Number.parseInt(year, 10), month: Number.parseInt(month, 10) };
}

/**
 * The waitlist queue for one group training, shown directly under its roster. Only
 * GROUP trainings have a waitlist, so the section renders nothing for an individual
 * training (`groupId === null`). Fetches via {@link useTrainingWaitlist}
 * (GET /waitlist/training/:id) and renders the validated rows with the four
 * moderation actions (promote / swap / move-group / remove). Pure interaction
 * layer: every seat/capacity/credit decision is the server's — this view picks a
 * target and surfaces the API's verbatim error without recomputing anything.
 */
export function WaitlistSection({
  trainingId,
  groupId,
  date,
  t
}: WaitlistSectionProps): JSX.Element | null {
  const { notify } = useToast();
  const waitlist = useTrainingWaitlist(groupId !== null ? trainingId : null);
  const groups = useGroups();

  const promote = usePromoteWaitlistEntry();
  const remove = useRemoveWaitlistEntry();

  const [promoteTarget, setPromoteTarget] = useState<WaitlistAdminItem | null>(null);
  const [swapTarget, setSwapTarget] = useState<WaitlistAdminItem | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WaitlistAdminItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<WaitlistAdminItem | null>(null);

  // Individual trainings never enter the waitlist flow — render nothing.
  if (groupId === null) {
    return null;
  }

  function submitPromote(): void {
    if (!promoteTarget) return;
    const name = promoteTarget.clientName;
    promote.mutate(promoteTarget.id, {
      onSuccess: () => {
        notify(t("admin.waitlist.promoted", { client: name }), "success");
        setPromoteTarget(null);
      },
      onError: (error) => notify(waitlistErrorText(error, t), "error")
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
      onError: (error) => notify(waitlistErrorText(error, t), "error")
    });
  }

  const columns: Column<WaitlistAdminItem>[] = [
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
          {waitlistStatusLabel(r.status, t)}
        </span>
      )
    },
    {
      key: "actions",
      header: t("admin.waitlist.colActions"),
      render: (r) => (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
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

  const rows = waitlist.data ?? [];
  const fromGroup = (groups.data ?? []).find((g) => g.id === groupId) ?? null;
  const { year, month } = monthFromDate(date);

  return (
    <section className="stack" aria-label={t("admin.waitlist.sectionLabel")}>
      <h3>{t("admin.waitlist.sectionHeading", { count: rows.length })}</h3>
      {waitlist.isPending ? (
        <p className="state">{t("admin.waitlist.loading")}</p>
      ) : waitlist.isError ? (
        <p className="state state--error" role="alert">
          {waitlistErrorText(waitlist.error, t)}
        </p>
      ) : (
        <DataTable
          caption={t("admin.waitlist.caption")}
          columns={columns}
          rows={rows}
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
            <Button
              variant="ghost"
              onClick={() => setPromoteTarget(null)}
              disabled={promote.isPending}
            >
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
            {waitlistErrorText(promote.error, t)}
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
            <Button
              variant="ghost"
              onClick={() => setRemoveTarget(null)}
              disabled={remove.isPending}
            >
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
            {waitlistErrorText(remove.error, t)}
          </p>
        ) : null}
      </Modal>

      {moveTarget && fromGroup ? (
        <MoveGroupModal
          target={moveTarget}
          fromGroup={fromGroup}
          groups={groups.data ?? []}
          year={year}
          month={month}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}
    </section>
  );
}
