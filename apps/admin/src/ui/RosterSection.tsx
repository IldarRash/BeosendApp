import { useRoster } from "../hooks/useRoster";
import { RosterList } from "./RosterList";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface RosterSectionProps {
  /** The training whose attendees to load, or null to stay idle (no call). */
  trainingId: string | null;
  t: Translate;
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
  const roster = useRoster(trainingId);

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
          />
        </>
      )}
    </section>
  );
}
