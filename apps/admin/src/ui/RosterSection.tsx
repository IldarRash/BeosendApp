import { useState } from "react";
import type { RosterParticipant } from "@beosand/types";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useCancelRosterParticipant, useRoster } from "../hooks/useRoster";
import { RosterList } from "./RosterList";
import { useToast } from "./Toast";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface RosterSectionProps {
  /** The training whose attendees to load, or null to stay idle (no call). */
  trainingId: string | null;
  t: Translate;
}

function canRemoveParticipant(participant: RosterParticipant): boolean {
  return participant.bookingStatus === "booked" || participant.bookingStatus === "pending";
}

function rosterErrorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.roster.removeFailed");
}

/**
 * The attendee list for one training session, with its own load/error states.
 * Fetches the roster (GET /trainings/:id/roster) via {@link useRoster} and renders
 * the validated participants through the shared {@link RosterList} — name, the
 * server's booking status, and a drop-in/subscription badge, plus a headcount and
 * an empty state. Pure interaction layer: every value is the API's, computed
 * nowhere here. Reused by the Trainings detail view and the calendar detail modal.
 */
export function RosterSection({ trainingId, t }: RosterSectionProps): JSX.Element {
  const { notify } = useToast();
  const roster = useRoster(trainingId);
  const remove = useCancelRosterParticipant();
  const [removeTarget, setRemoveTarget] = useState<RosterParticipant | null>(null);

  function openRemove(participant: RosterParticipant): void {
    remove.reset();
    setRemoveTarget(participant);
  }

  function closeRemove(): void {
    setRemoveTarget(null);
  }

  function submitRemove(): void {
    if (!removeTarget || !roster.data) return;
    const name = removeTarget.clientName;
    remove.mutate(
      { bookingId: removeTarget.bookingId },
      {
        onSuccess: () => {
          notify(t("admin.roster.removed", { client: name }), "success");
          closeRemove();
        },
        onError: (error) => notify(rosterErrorText(error, t), "error")
      }
    );
  }

  const participants = roster.data?.participants ?? [];
  const hasRemoveActions = participants.some(canRemoveParticipant);

  return (
    <section className="stack" aria-label={t("admin.roster.openLabel")}>
      <h3>{t("admin.roster.heading")}</h3>
      {roster.isPending ? (
        <p className="state">{t("admin.roster.loading")}</p>
      ) : roster.isError ? (
        <p className="state state--error" role="alert">
          {roster.error instanceof Error ? roster.error.message : t("admin.roster.loading")}
        </p>
      ) : (
        <>
          <p className="state">{t("admin.roster.count", { count: roster.data.participants.length })}</p>
          <RosterList
            participants={roster.data.participants}
            t={t}
            caption={t("admin.roster.caption")}
            emptyLabel={t("admin.roster.empty")}
            actions={
              hasRemoveActions
                ? {
                    header: t("admin.roster.colActions"),
                    render: (participant) =>
                      canRemoveParticipant(participant) ? (
                        <Button
                          variant="danger"
                          className="btn--sm"
                          onClick={() => openRemove(participant)}
                          aria-label={t("admin.roster.removeAria", {
                            client: participant.clientName
                          })}
                        >
                          {t("admin.roster.remove")}
                        </Button>
                      ) : null
                  }
                : undefined
            }
          />
        </>
      )}
      <Modal
        open={removeTarget !== null}
        onClose={closeRemove}
        title={t("admin.roster.removeTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={closeRemove} disabled={remove.isPending}>
              {t("admin.action.cancel")}
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={submitRemove}>
              {remove.isPending ? t("admin.roster.removing") : t("admin.roster.removeConfirm")}
            </Button>
          </>
        }
      >
        {removeTarget && roster.data ? (
          <p>
            {t("admin.roster.removePrompt", {
              client: removeTarget.clientName,
              date: roster.data.date,
              start: roster.data.startTime,
              end: roster.data.endTime
            })}
          </p>
        ) : null}
        {remove.isError ? (
          <p className="state state--error" role="alert">
            {rosterErrorText(remove.error, t)}
          </p>
        ) : null}
      </Modal>
    </section>
  );
}
