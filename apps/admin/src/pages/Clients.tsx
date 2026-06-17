import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
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
import { useClientsList, useOnboardClient, useUpdateClient } from "../hooks/useClients";
import { useLevels } from "../hooks/useLevels";

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
      key: "actions",
      header: "",
      render: (c) => (
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
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
    </AppShell>
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
