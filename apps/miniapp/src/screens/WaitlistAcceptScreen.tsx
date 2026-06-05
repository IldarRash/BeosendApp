import { ConflictError } from "../api/client";
import { useAcceptWaitlist } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSuccess } from "../tg/buttons";
import { ErrorState } from "../ui/StateView";
import { WaitlistAcceptView } from "../ui/WaitlistAcceptView";

interface WaitlistAcceptScreenProps {
  /** The waitlist entry id from the `waitlist_<entryId>` deep link (uuid-validated). */
  entryId: string;
  /** Leave toward Home (pops the accept screen off the stack — wired by the shell). */
  onHome: () => void;
}

/**
 * The waitlist-accept journey (S6) reached by the `startapp=waitlist_<entryId>` deep
 * link when a seat frees and the bot pushes a promotion. Owns the accept write and
 * maps its outcomes onto the presentational {@link WaitlistAcceptView}:
 *
 *   - in flight              → the prompt with the MainButton loader
 *   - success (Booking)      → the booked state (NO court/availability math here —
 *                              the server promoted the entry and we render the result)
 *   - ConflictError (409)    → the calm "window closed / seat re-taken" state, the
 *                              server message verbatim, and NO booking (the invariant:
 *                              accept never over-books)
 *   - any other Error        → the shared ErrorState
 *
 * Interaction layer only: it calls {@link useAcceptWaitlist} (which carries the
 * verified session; the server re-checks ownership, the window, and capacity) and
 * renders the outcome. The entry id is uuid-validated at the deep-link seam before it
 * ever reaches here.
 */
export function WaitlistAcceptScreen({ entryId, onHome }: WaitlistAcceptScreenProps): JSX.Element {
  const t = useT();
  const accept = useAcceptWaitlist();

  const conflict = accept.error instanceof ConflictError;
  // A hard (non-conflict) failure is a broken request, not a closed window — show the
  // shared error surface with a path Home rather than the calm "window closed" copy.
  const hardError = accept.isError && !conflict;

  if (hardError) {
    const message = accept.error instanceof Error ? accept.error.message : undefined;
    return (
      <div className="screen screen__center">
        <ErrorState message={message} />
      </div>
    );
  }

  const errorMessage = conflict
    ? (accept.error as ConflictError).message || t("miniapp.waitlist.expiredBody")
    : undefined;

  return (
    <WaitlistAcceptView
      onAccept={() =>
        accept.mutate(entryId, {
          onSuccess: () => hapticSuccess()
        })
      }
      submitting={accept.isPending}
      accepted={accept.isSuccess}
      conflict={conflict}
      errorMessage={errorMessage}
      onHome={onHome}
    />
  );
}
