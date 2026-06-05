import { useState } from "react";
import { Cell, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { IndividualRequestResult, Trainer } from "@beosand/types";
import { useRequestIndividual, useTrainers } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT, type TranslateFn } from "../i18n/LanguageProvider";
import { useNav } from "../router/NavProvider";
import { hapticSelection, hapticSuccess, useMainButton } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { SecondaryButton } from "../ui/SecondaryButton";
import { Glyph, MenuIcon } from "../ui/icons";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";

/**
 * The individual-training-request journey (S8). One screen, three local sub-states:
 *
 *   list    → pick an active trainer
 *   confirm → review the trainer, then "Запросить тренировку" (notification-only)
 *   result  → the server's IndividualRequestResult
 *               delivered:true  → calm success (the trainer was DM'd)
 *               delivered:false → calm soft "trainer unavailable" state (a 200, NOT an error)
 *
 * Interaction layer only: every value rendered is the API's. No booking is created —
 * the request is a notification to the trainer. The caller's identity is supplied by
 * the client from the verified session (the body Telegram id), never user input, and
 * the server re-derives the requester and rejects a mismatch. The trainer's telegramId
 * is NEVER rendered.
 *
 * The native BackButton is owned by the shell and pops the whole route; in-screen
 * "back to list" steps are local state transitions. There is exactly one native
 * MainButton per actionable sub-state (none on the bare list).
 */
export function TrainerRequestScreen(): JSX.Element {
  const trainers = useTrainers();
  const [selected, setSelected] = useState<Trainer | null>(null);

  if (selected) {
    return <TrainerFlow trainer={selected} onBackToList={() => setSelected(null)} />;
  }

  return (
    <TrainerList
      trainers={trainers.data}
      isLoading={trainers.isLoading}
      errorMessage={trainers.error instanceof Error ? trainers.error.message : undefined}
      onPick={(trainer) => {
        hapticSelection();
        setSelected(trainer);
      }}
    />
  );
}

/** The trainer list sub-state: one tappable card per active trainer (no MainButton). */
function TrainerList({
  trainers,
  isLoading,
  errorMessage,
  onPick
}: {
  trainers: Trainer[] | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onPick: (trainer: Trainer) => void;
}): JSX.Element {
  const t = useT();

  if (isLoading) {
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }
  // A malformed GET /trainers response is rejected by the contract in the ApiClient and
  // surfaces here as an error — never silently rendered.
  if (errorMessage !== undefined || trainers === undefined) {
    return (
      <div className="screen screen__center">
        <ErrorState message={errorMessage} />
      </div>
    );
  }

  // The endpoint returns trainers; defensive filter keeps the list to active ones.
  const active = trainers.filter((trainer) => trainer.status === "active");
  if (active.length === 0) {
    return (
      <div className="screen screen__center">
        <EmptyState titleKey="miniapp.individual.none" bodyKey="miniapp.individual.noneBody" />
      </div>
    );
  }

  return (
    <div className="screen">
      <List>
        <Section header={t("miniapp.individual.listTitle")}>
          {active.map((trainer) => (
            <TrainerCard key={trainer.id} trainer={trainer} onPick={() => onPick(trainer)} />
          ))}
        </Section>
      </List>
    </div>
  );
}

/** One trainer as a native multiline Cell: coral chip, name, neutral type pill, chevron. */
function TrainerCard({ trainer, onPick }: { trainer: Trainer; onPick: () => void }): JSX.Element {
  const t = useT();
  const typeLabel = trainerTypeLabel(trainer.type, t);

  return (
    <Cell
      Component="button"
      type="button"
      className="trainer-card"
      multiline
      onClick={onPick}
      aria-label={`${trainer.name}. ${typeLabel}. ${t("miniapp.individual.openAria")}`}
      before={<MenuIcon name="individual" />}
      subtitle={<span className="trainer-type">{typeLabel}</span>}
      after={
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      }
    >
      {trainer.name}
    </Cell>
  );
}

/**
 * The confirm → result flow for a chosen trainer. Holds the confirm/result step via
 * the mutation state; the write is {@link useRequestIndividual}.
 */
function TrainerFlow({
  trainer,
  onBackToList
}: {
  trainer: Trainer;
  onBackToList: () => void;
}): JSX.Element {
  const t = useT();
  const nav = useNav();
  const request = useRequestIndividual();

  // A delivered:false result is a 200 the screen shows calmly — it rides onSuccess
  // data, not the error channel. Only a true network/4xx/5xx becomes request.error.
  if (request.isSuccess && request.data) {
    return (
      <TrainerResult
        result={request.data}
        onHome={() => nav.pop()}
        onPickAnother={() => {
          request.reset();
          onBackToList();
        }}
      />
    );
  }

  return (
    <TrainerConfirm
      trainer={trainer}
      submitting={request.isPending}
      errorMessage={resolveErrorMessage(request.error, t)}
      onConfirm={() => {
        hapticSelection();
        request.mutate(trainer.id, {
          onSuccess: (result) => {
            if (result.delivered) {
              hapticSuccess();
            }
          }
        });
      }}
    />
  );
}

/** Confirm sub-state: trainer summary, with the "Запросить тренировку" MainButton. */
function TrainerConfirm({
  trainer,
  submitting,
  errorMessage,
  onConfirm
}: {
  trainer: Trainer;
  submitting: boolean;
  errorMessage?: string;
  onConfirm: () => void;
}): JSX.Element {
  const t = useT();
  const typeLabel = trainerTypeLabel(trainer.type, t);

  useMainButton({
    text: t("miniapp.individual.request"),
    onClick: onConfirm,
    isLoading: submitting
  });

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <List>
        <Section
          header={t("miniapp.individual.confirmTitle")}
          footer={t("miniapp.individual.confirmBody", { name: trainer.name })}
        >
          <Cell subhead={t("miniapp.booking.trainerLabel")}>{trainer.name}</Cell>
          <Cell subhead={t("miniapp.individual.typeLabel")}>
            <span className="trainer-type">{typeLabel}</span>
          </Cell>
        </Section>
      </List>

      {errorMessage && (
        <div className="confirm-error" role="alert">
          {errorMessage}
        </div>
      )}

      <FallbackButton
        text={t("miniapp.individual.request")}
        onClick={onConfirm}
        loading={submitting}
      />
    </div>
  );
}

/**
 * The result, rendered straight from {@link IndividualRequestResult}: a calm success
 * when the trainer was DM'd, or — when `delivered:false` — a calm soft "trainer
 * unavailable" state. The soft state is informational (a 200), so it is announced as a
 * `role="status"` region with a muted chip, NEVER a red `role="alert"` error.
 */
function TrainerResult({
  result,
  onHome,
  onPickAnother
}: {
  result: IndividualRequestResult;
  onHome: () => void;
  onPickAnother: () => void;
}): JSX.Element {
  if (result.delivered) {
    return <TrainerDelivered onHome={onHome} />;
  }
  return <TrainerUnavailable onHome={onHome} onPickAnother={onPickAnother} />;
}

/** Delivered-success state: the request reached the trainer. */
function TrainerDelivered({ onHome }: { onHome: () => void }): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.individual.toHome"),
    onClick: onHome
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <Placeholder
        header={t("miniapp.individual.sentTitle")}
        description={t("miniapp.individual.sentBody")}
      >
        <span className="success-badge" aria-hidden="true">
          ✓
        </span>
      </Placeholder>
      <FallbackButton text={t("miniapp.individual.toHome")} onClick={onHome} />
    </div>
  );
}

/**
 * The calm soft state for `delivered:false` (the trainer has no/unreachable Telegram
 * channel): a muted chip + header + body on a status surface — never an error. The
 * primary action returns to the list to pick another trainer.
 */
function TrainerUnavailable({
  onHome,
  onPickAnother
}: {
  onHome: () => void;
  onPickAnother: () => void;
}): JSX.Element {
  const t = useT();

  useMainButton({
    text: t("miniapp.individual.pickAnother"),
    onClick: onPickAnother
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <Placeholder
        header={t("miniapp.individual.unavailableTitle")}
        description={t("miniapp.individual.unavailableBody")}
      >
        <span className="waitlist-badge waitlist-badge--muted" aria-hidden="true">
          <Glyph name="individual" />
        </span>
      </Placeholder>
      <FallbackButton text={t("miniapp.individual.pickAnother")} onClick={onPickAnother} />
      <SecondaryButton text={t("miniapp.individual.toHome")} onClick={onHome} />
    </div>
  );
}

/** The neutral main/guest type label for a trainer; never the telegramId. */
function trainerTypeLabel(type: Trainer["type"], t: TranslateFn): string {
  return t(type === "main" ? "miniapp.individual.typeMain" : "miniapp.individual.typeGuest");
}
