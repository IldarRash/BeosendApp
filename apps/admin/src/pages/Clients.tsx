import { useMemo, useState } from "react";
import type { Client, EntityStatus, Level, OnboardClientInput } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { NumberField, SelectField, TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useClientByTelegram, useOnboardClient } from "../hooks/useClients";
import { useLevels } from "../hooks/useLevels";

/**
 * M2 — Клиенты: look a client up by Telegram id and onboard a new one. The API
 * owns identity and idempotency; this screen only collects input and renders the
 * validated record it gets back. No domain logic here.
 */
export function Clients(): JSX.Element {
  const t = useT();
  const [draftId, setDraftId] = useState<number | null>(null);
  const [lookupId, setLookupId] = useState<number | null>(null);

  const levels = useLevels();
  const lookup = useClientByTelegram(lookupId);

  function handleLookup(event: React.FormEvent): void {
    event.preventDefault();
    setLookupId(draftId);
  }

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.clients.title")}</h1>
          <p>{t("admin.clients.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <section className="stack" aria-labelledby="lookup-heading">
          <h2 id="lookup-heading">{t("admin.clients.lookupHeading")}</h2>
          <form className="cluster" onSubmit={handleLookup}>
            <NumberField
              label={t("admin.field.telegramId")}
              value={draftId}
              onValueChange={setDraftId}
              hint={t("admin.clients.telegramHint")}
            />
            <Button type="submit" disabled={draftId === null || lookup.isFetching}>
              {lookup.isFetching ? t("admin.action.searching") : t("admin.action.find")}
            </Button>
          </form>

          <LookupResult
            lookupId={lookupId}
            isFetching={lookup.isFetching}
            isError={lookup.isError}
            error={lookup.error ?? null}
            client={lookup.data ?? null}
            levels={levels.data ?? []}
          />
        </section>

        <OnboardForm levels={levels.data ?? []} levelsLoading={levels.isLoading} />
      </div>
    </AppShell>
  );
}

interface LookupResultProps {
  lookupId: number | null;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  client: Client | null;
  levels: Level[];
}

/** Renders the lookup outcome: idle / loading / error / found card / not-found. */
function LookupResult({
  lookupId,
  isFetching,
  isError,
  error,
  client,
  levels
}: LookupResultProps): JSX.Element | null {
  const t = useT();
  if (lookupId === null) {
    return null;
  }
  if (isFetching) {
    return <p className="state state--loading">{t("admin.clients.loading")}</p>;
  }
  if (isError) {
    return (
      <p className="state state--error" role="alert">
        {t("admin.clients.lookupError", { message: error?.message ?? "" })}
      </p>
    );
  }
  if (client === null) {
    return (
      <p className="state state--loading" role="status">
        {t("admin.clients.notFound", { id: lookupId })}
      </p>
    );
  }
  return <ClientCard client={client} levels={levels} />;
}

interface ClientCardProps {
  client: Client;
  levels: Level[];
}

/** Read-only card for a found client. Renders only fields the contract exposes. */
function ClientCard({ client, levels }: ClientCardProps): JSX.Element {
  const t = useT();
  const statusLabel = (status: EntityStatus): string =>
    status === "active" ? t("admin.status.active") : t("admin.status.inactive");
  const levelName = client.levelId
    ? (levels.find((level) => level.id === client.levelId)?.name ?? "—")
    : t("admin.clients.levelUnset");

  return (
    <dl className="card" role="group" aria-label={t("admin.clients.cardLabel")}>
      <div>
        <dt className="card__label">{t("admin.clients.cardName")}</dt>
        <dd className="card__value">{client.name}</dd>
      </div>
      <div>
        <dt className="card__label">{t("admin.clients.cardTelegramId")}</dt>
        <dd>
          <code>{client.telegramId}</code>
        </dd>
      </div>
      <div>
        <dt className="card__label">{t("admin.clients.cardUsername")}</dt>
        <dd>
          {client.telegramUsername ? <code>@{client.telegramUsername}</code> : "—"}
        </dd>
      </div>
      <div>
        <dt className="card__label">{t("admin.clients.cardLevel")}</dt>
        <dd>{levelName}</dd>
      </div>
      <div>
        <dt className="card__label">{t("admin.clients.cardStatus")}</dt>
        <dd>
          <span className={`tag ${client.status === "active" ? "tag--ok" : "tag--warn"}`}>
            {statusLabel(client.status)}
          </span>
        </dd>
      </div>
    </dl>
  );
}

interface OnboardFormProps {
  levels: Level[];
  levelsLoading: boolean;
}

const NO_LEVEL = "";

/** Register (or idempotently re-register) a client. Server owns all validation. */
function OnboardForm({ levels, levelsLoading }: OnboardFormProps): JSX.Element {
  const t = useT();
  const toast = useToast();
  const onboard = useOnboardClient();

  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [levelId, setLevelId] = useState<string>(NO_LEVEL);

  const levelOptions = useMemo(
    () => [
      { value: NO_LEVEL, label: t("admin.clients.noLevel") },
      ...levels.map((level) => ({ value: level.id, label: level.name }))
    ],
    [levels, t]
  );

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const input: OnboardClientInput = {
      telegramId: telegramId ?? 0,
      name,
      telegramUsername: trimmedUsername === "" ? null : trimmedUsername,
      levelId: levelId === NO_LEVEL ? null : levelId
    };
    onboard.mutate(input, {
      onSuccess: (client) => {
        toast.notify(t("admin.clients.saved", { name: client.name }), "success");
      }
    });
  }

  return (
    <section className="stack" aria-labelledby="onboard-heading">
      <h2 id="onboard-heading">{t("admin.clients.onboardHeading")}</h2>
      <p className="state state--loading">{t("admin.clients.onboardLead")}</p>
      <form className="form" onSubmit={handleSubmit}>
        <NumberField
          label={t("admin.field.telegramId")}
          value={telegramId}
          onValueChange={setTelegramId}
          required
        />
        <TextField
          label={t("admin.field.personName")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          label={t("admin.field.username")}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          hint={t("admin.clients.usernameHint")}
          autoComplete="off"
        />
        <SelectField
          label={t("admin.field.level")}
          value={levelId}
          onChange={(event) => setLevelId(event.target.value)}
          options={levelOptions}
          disabled={levelsLoading}
          hint={t("admin.clients.levelHint")}
        />
        {onboard.error ? (
          <p className="state state--error" role="alert">
            {onboard.error.message}
          </p>
        ) : null}
        <div className="cluster">
          <Button type="submit" disabled={onboard.isPending}>
            {onboard.isPending ? t("admin.action.saving") : t("admin.clients.register")}
          </Button>
        </div>
      </form>
    </section>
  );
}
