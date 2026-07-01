import { Modal } from "./Modal";
import { RosterSection } from "./RosterSection";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import { TrainingDetailBody } from "./TrainingDetailBody";
import { WaitlistSection } from "./WaitlistSection";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface TrainingRosterModalProps {
  /** The training to show, or null to keep the modal closed (no calls). */
  trainingId: string | null;
  onClose: () => void;
  t: Translate;
}

/**
 * Detail popup for one training on the Trainings table: the joined
 * "whose training?" header (occupancy, status, court — all the API's) plus its
 * attendee list via {@link RosterSection}, so the owner can see exactly who signed
 * up for that date, including one-time drop-ins. Roster and waitlist actions call
 * the API and refresh server-owned state rather than recomputing it locally.
 */
export function TrainingRosterModal({
  trainingId,
  onClose,
  t
}: TrainingRosterModalProps): JSX.Element {
  const detail = useTrainingDetail(trainingId);
  const item = detail.data ?? null;

  return (
    <Modal open={trainingId !== null} onClose={onClose} title={t("admin.calendar.detailTitle")}>
      {detail.isPending ? (
        <p className="state">{t("admin.calendar.detailLoading")}</p>
      ) : detail.isError ? (
        <p className="state state--error" role="alert">
          {detail.error instanceof Error ? detail.error.message : t("admin.trainings.opFailed")}
        </p>
      ) : item ? (
        <div className="stack">
          <TrainingDetailBody item={item} t={t} />
          <RosterSection trainingId={item.id} t={t} />
          <WaitlistSection trainingId={item.id} groupId={item.groupId} date={item.date} t={t} />
        </div>
      ) : null}
    </Modal>
  );
}
