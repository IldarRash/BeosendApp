import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AdjustBonusCreditsInput,
  Client,
  EntityStatus,
  Level,
  ListClientsQuery,
  OnboardClientInput,
  UpdateClientInput
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { NumberField, SelectField, TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import {
  useAdjustBonusCredits,
  useClientsList,
  useOnboardClient,
  useUpdateClient
} from "../hooks/useClients";
import { useLevels } from "../hooks/useLevels";
import { formatDateTime } from "../lib/format";

type StatusFilter = EntityStatus | "all";

/**
 * M2 — Клиенты: the full client roster with a name/@tag search, plus onboarding
 * of a new client. The API owns identity, search normalization, and the admin
 * gate; this screen only collects the filters and renders the validated rows. No
 * domain logic or client-side filtering here.
 */
export function Clients(): JSX.Element {
  const t = useT();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [bonusClient, setBonusClient] = useState<Client | null>(null);

  // Debounce the search so typing doesn't fire a request per keystroke; the
  // server does the actual matching against name + @username.
  const debouncedSearch = useDebounced(search.trim(), 250);

  const levels = useLevels();
  const filters: ListClientsQuery = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {})
  };
  const clients = useClientsList(filters);

  const levelName = useMemo(() => {
    const byId = new Map((levels.data ?? []).map((level) => [level.id, level.name]));
    return (levelId: string | null): string =>
      levelId === null ? t("admin.clients.levelUnset") : (byId.get(levelId) ?? "—");
  }, [levels.data, t]);

  const columns: Column<Client>[] = [
    { key: "name", header: t("admin.clients.cardName"), render: (c) => c.name },
    {
      key: "tag",
      header: t("admin.clients.cardUsername"),
      render: (c) => (c.telegramUsername ? <code>@{c.telegramUsername}</code> : "—")
    },
    {
      key: "telegram",
      header: t("admin.clients.cardTelegramId"),
      render: (c) => <code>{c.telegramId}</code>
    },
    { key: "level", header: t("admin.clients.cardLevel"), render: (c) => levelName(c.levelId) },
    {
      key: "status",
      header: t("admin.clients.cardStatus"),
      render: (c) => (
        <span className={`tag ${c.status === "active" ? "tag--ok" : "tag--warn"}`}>
          {c.status === "active" ? t("admin.status.active") : t("admin.status.inactive")}
        </span>
      )
    },
    {
      key: "consent",
      header: t("admin.clients.cardConsent"),
      render: (c) =>
        c.consentGivenAt ? formatDateTime(c.consentGivenAt) : t("admin.clients.consentNone")
    },
    {
      key: "bonus",
      header: t("admin.clients.cardBonus"),
      numeric: true,
      render: (c) => (
        <span className={c.bonusTrainingCredits > 0 ? "tag tag--info" : "tag tag--muted"}>
          {c.bonusTrainingCredits}
        </span>
      )
    },
    {
      key: "actions",
      header: "",
      render: (c) => (
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <Button
            variant="ghost"
            onClick={() => setBonusClient(c)}
            aria-label={t("admin.clients.bonusAria", { name: c.name })}
          >
            {t("admin.clients.bonusAction")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setEditClient(c)}
            aria-label={t("admin.clients.editAria", { name: c.name })}
          >
            {t("admin.action.edit")}
          </Button>
        </div>
      )
    }
  ];

  const statusOptions = [
    { value: "all", label: t("admin.clients.statusAll") },
    { value: "active", label: t("admin.status.active") },
    { value: "inactive", label: t("admin.status.inactive") }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.clients.title")}</h1>
          <p>{t("admin.clients.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <section className="stack" aria-labelledby="clients-list-heading">
          <h2 id="clients-list-heading">{t("admin.clients.listHeading")}</h2>
          <div className="cluster">
            <TextField
              type="search"
              label={t("admin.clients.searchLabel")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              hint={t("admin.clients.searchHint")}
              autoComplete="off"
            />
            <SelectField
              label={t("admin.clients.statusFilter")}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              options={statusOptions}
            />
          </div>

          {clients.isPending ? (
            <p className="state state--loading">{t("admin.clients.loading")}</p>
          ) : clients.isError ? (
            <p className="state state--error" role="alert">
              {t("admin.clients.listError", { message: clients.error.message })}
            </p>
          ) : (
            <DataTable
              caption={t("admin.clients.listCaption")}
              columns={columns}
              rows={clients.data}
              rowKey={(c) => c.id}
              emptyLabel={t("admin.clients.empty")}
            />
          )}
        </section>

        <OnboardForm levels={levels.data ?? []} levelsLoading={levels.isLoading} />
      </div>

      <EditClientModal
        client={editClient}
        levels={levels.data ?? []}
        levelsLoading={levels.isLoading}
        onClose={() => setEditClient(null)}
      />

      <AdjustBonusModal client={bonusClient} onClose={() => setBonusClient(null)} />
    </AppShell>
  );
}

interface AdjustBonusModalProps {
  client: Client | null;
  onClose: () => void;
}

/**
 * Adjust a client's bonus-training balance by a signed delta (+credit / -debit)
 * with an optional reason. The balance is server-managed: the API owns the
 * non-negative floor (a debit past zero is rejected and the error rendered) and
 * the audit trail — the console only collects the delta/reason and shows the
 * server's updated balance. A zero delta is disabled (no-op).
 */
function AdjustBonusModal({ client, onClose }: AdjustBonusModalProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const adjust = useAdjustBonusCredits();

  const [delta, setDelta] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  // Re-seed (clear delta/reason + stale error) whenever a different client opens.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (client && seededFor !== client.id) {
    setSeededFor(client.id);
    setDelta(null);
    setReason("");
    adjust.reset();
  }
  if (!client && seededFor !== null) {
    setSeededFor(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!client || delta === null || delta === 0) return;
    const trimmedReason = reason.trim();
    const input: AdjustBonusCreditsInput = {
      delta,
      ...(trimmedReason ? { reason: trimmedReason } : {})
    };
    adjust.mutate(
      { clientId: client.id, input },
      {
        onSuccess: (updated) => {
          notify(
            t("admin.clients.bonusAdjusted", {
              name: updated.name,
              balance: updated.bonusTrainingCredits
            }),
            "success"
          );
          onClose();
        }
      }
    );
  }

  const canSubmit = delta !== null && delta !== 0 && !adjust.isPending;

  return (
    <Modal
      open={client !== null}
      onClose={onClose}
      title={t("admin.clients.bonusTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={adjust.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="client-bonus-form" disabled={!canSubmit}>
            {adjust.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      {client ? (
        <form
          id="client-bonus-form"
          onSubmit={handleSubmit}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <p className="state">
            {t("admin.clients.bonusCurrent", {
              name: client.name,
              balance: client.bonusTrainingCredits
            })}
          </p>
          <NumberField
            label={t("admin.clients.bonusDelta")}
            value={delta}
            onValueChange={setDelta}
            hint={t("admin.clients.bonusDeltaHint")}
          />
          <TextField
            label={t("admin.clients.bonusReason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint={t("admin.clients.bonusReasonHint")}
            maxLength={200}
            autoComplete="off"
          />
          {adjust.isError ? (
            <p className="state state--error" role="alert">
              {adjust.error.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}

/** Debounce a value: returns the latest value only after `delayMs` of quiet. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
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
      levelId: levelId === NO_LEVEL ? null : levelId,
      // The contract now requires explicit consent (`consentAccepted: true`) before
      // the server stamps `consentGivenAt`. An admin registering a client here affirms
      // it on the client's behalf, mirroring the bot's own onboarding flow.
      consentAccepted: true
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

interface EditClientModalProps {
  client: Client | null;
  levels: Level[];
  levelsLoading: boolean;
  onClose: () => void;
}

/** Editable client fields held in the form before submit. */
interface ClientFormState {
  name: string;
  levelId: string;
  phone: string;
  note: string;
}

function formFromClient(client: Client): ClientFormState {
  return {
    name: client.name,
    levelId: client.levelId ?? NO_LEVEL,
    phone: client.phone ?? "",
    note: client.note ?? ""
  };
}

/**
 * Edit a client's profile (name/level/phone/note). The API owns validation and the
 * admin gate; this modal only collects the editable fields. An emptied phone/note is
 * sent as null to clear it, and the "no level" option maps to levelId: null. Identity
 * (telegramId/source/language) is never editable here.
 */
function EditClientModal({ client, levels, levelsLoading, onClose }: EditClientModalProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const update = useUpdateClient();

  const [form, setForm] = useState<ClientFormState>(() =>
    client ? formFromClient(client) : { name: "", levelId: NO_LEVEL, phone: "", note: "" }
  );

  // Re-seed the form (and clear any stale error) whenever a different client opens.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (client && seededFor !== client.id) {
    setSeededFor(client.id);
    setForm(formFromClient(client));
    update.reset();
  }

  const levelOptions = useMemo(
    () => [
      { value: NO_LEVEL, label: t("admin.clients.noLevel") },
      ...levels.map((level) => ({ value: level.id, label: level.name }))
    ],
    [levels, t]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!client) return;
    const trimmedPhone = form.phone.trim();
    const trimmedNote = form.note.trim();
    const input: UpdateClientInput = {
      name: form.name.trim(),
      levelId: form.levelId === NO_LEVEL ? null : form.levelId,
      phone: trimmedPhone === "" ? null : trimmedPhone,
      note: trimmedNote === "" ? null : trimmedNote
    };
    update.mutate(
      { id: client.id, input },
      {
        onSuccess: (updated) => {
          notify(t("admin.clients.updated", { name: updated.name }), "success");
          onClose();
        }
      }
    );
  }

  return (
    <Modal
      open={client !== null}
      onClose={onClose}
      title={t("admin.clients.editTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="client-edit-form" disabled={update.isPending}>
            {update.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form
        id="client-edit-form"
        onSubmit={handleSubmit}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <TextField
          label={t("admin.field.personName")}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
          autoComplete="off"
        />
        <SelectField
          label={t("admin.field.level")}
          value={form.levelId}
          onChange={(event) => setForm({ ...form, levelId: event.target.value })}
          options={levelOptions}
          disabled={levelsLoading}
        />
        <TextField
          label={t("admin.field.phone")}
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
          autoComplete="off"
        />
        <TextField
          label={t("admin.field.note")}
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          autoComplete="off"
        />
        {update.isError ? (
          <p className="state state--error" role="alert">
            {update.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
