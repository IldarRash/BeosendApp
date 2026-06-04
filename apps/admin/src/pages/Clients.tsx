import { useMemo, useState } from "react";
import type { Client, EntityStatus, Level, OnboardClientInput } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { NumberField, SelectField, TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useClientByTelegram, useOnboardClient } from "../hooks/useClients";
import { useLevels } from "../hooks/useLevels";

const STATUS_LABEL: Record<EntityStatus, string> = {
  active: "Активен",
  inactive: "Неактивен"
};

/**
 * M2 — Клиенты: look a client up by Telegram id and onboard a new one. The API
 * owns identity and idempotency; this screen only collects input and renders the
 * validated record it gets back. No domain logic here.
 */
export function Clients(): JSX.Element {
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
          <h1>Клиенты</h1>
          <p>Поиск клиента по Telegram ID и регистрация нового.</p>
        </div>
      </header>

      <div className="stack">
        <section className="stack" aria-labelledby="lookup-heading">
          <h2 id="lookup-heading">Поиск клиента</h2>
          <form className="cluster" onSubmit={handleLookup}>
            <NumberField
              label="Telegram ID"
              value={draftId}
              onValueChange={setDraftId}
              hint="Числовой идентификатор пользователя Telegram."
            />
            <Button type="submit" disabled={draftId === null || lookup.isFetching}>
              {lookup.isFetching ? "Поиск…" : "Найти"}
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
  if (lookupId === null) {
    return null;
  }
  if (isFetching) {
    return <p className="state state--loading">Загрузка…</p>;
  }
  if (isError) {
    return (
      <p className="state state--error" role="alert">
        Не удалось выполнить поиск: {error?.message}
      </p>
    );
  }
  if (client === null) {
    return (
      <p className="state state--loading" role="status">
        Клиент с Telegram ID {lookupId} не найден. Зарегистрируйте его ниже.
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
  const levelName = client.levelId
    ? (levels.find((level) => level.id === client.levelId)?.name ?? "—")
    : "Не указан";

  return (
    <dl className="card" role="group" aria-label="Карточка клиента">
      <div>
        <dt className="card__label">Имя</dt>
        <dd className="card__value">{client.name}</dd>
      </div>
      <div>
        <dt className="card__label">Telegram ID</dt>
        <dd>
          <code>{client.telegramId}</code>
        </dd>
      </div>
      <div>
        <dt className="card__label">Username</dt>
        <dd>
          {client.telegramUsername ? <code>@{client.telegramUsername}</code> : "—"}
        </dd>
      </div>
      <div>
        <dt className="card__label">Уровень</dt>
        <dd>{levelName}</dd>
      </div>
      <div>
        <dt className="card__label">Статус</dt>
        <dd>
          <span className={`tag ${client.status === "active" ? "tag--ok" : "tag--warn"}`}>
            {STATUS_LABEL[client.status]}
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
  const toast = useToast();
  const onboard = useOnboardClient();

  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [levelId, setLevelId] = useState<string>(NO_LEVEL);

  const levelOptions = useMemo(
    () => [
      { value: NO_LEVEL, label: "Без уровня" },
      ...levels.map((level) => ({ value: level.id, label: level.name }))
    ],
    [levels]
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
        toast.notify(`Клиент сохранён: ${client.name}`, "success");
      }
    });
  }

  return (
    <section className="stack" aria-labelledby="onboard-heading">
      <h2 id="onboard-heading">Регистрация клиента</h2>
      <p className="state state--loading">
        Регистрация идемпотентна по Telegram ID: повторная отправка вернёт существующего клиента.
      </p>
      <form className="form" onSubmit={handleSubmit}>
        <NumberField
          label="Telegram ID"
          value={telegramId}
          onValueChange={setTelegramId}
          required
        />
        <TextField
          label="Имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          hint="Необязательно, без символа @."
          autoComplete="off"
        />
        <SelectField
          label="Уровень"
          value={levelId}
          onChange={(event) => setLevelId(event.target.value)}
          options={levelOptions}
          disabled={levelsLoading}
          hint="Необязательно."
        />
        {onboard.error ? (
          <p className="state state--error" role="alert">
            {onboard.error.message}
          </p>
        ) : null}
        <div className="cluster">
          <Button type="submit" disabled={onboard.isPending}>
            {onboard.isPending ? "Сохранение…" : "Зарегистрировать"}
          </Button>
        </div>
      </form>
    </section>
  );
}
