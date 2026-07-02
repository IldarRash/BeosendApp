import { useState } from "react";
import type {
  CalendarSubject,
  ConnectorId,
  ConnectorStatus,
  CreatedWebhookEndpoint,
  DomainEventType,
  NotificationChannelId,
  WebhookDelivery,
  WebhookEndpoint
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import {
  useCalendarFeedLink,
  useConnectors,
  useCsvDownload,
  useRequestLoggingSettings,
  useRotateCalendarFeed,
  useSheetsSync,
  useTestSend,
  useUpdateRequestLoggingSettings
} from "../hooks/useConnectors";
import {
  useCreateWebhook,
  useRetryDelivery,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks
} from "../hooks/useWebhooks";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** All v1 webhook event keys, offered as checkboxes when creating/editing an endpoint. */
const EVENT_KEYS: readonly DomainEventType[] = [
  "booking.created",
  "booking.declined",
  "training.cancelled",
  "court-request.confirmed",
  "court-request.rejected"
] as const;

const CHANNELS: readonly NotificationChannelId[] = ["email", "sms", "telegram"] as const;

/**
 * Connectors: the admin surface over the external-connector layer (status +
 * test-send, webhook endpoints with a one-time signing secret, the per-endpoint
 * delivery log, CSV/Sheets exports, and a calendar feed link). An interaction
 * layer only — every rendered value is validated against a `@beosand/types`
 * contract in the ApiClient; the server owns all config-gating and decisions.
 */
export function Connectors(): JSX.Element {
  const t = useT();
  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.connectors.title")}</h1>
          <p>{t("admin.connectors.lead")}</p>
        </div>
      </header>
      <StatusPanel t={t} />
      <OperationalSettingsPanel t={t} />
      <WebhooksPanel t={t} />
      <ExportsPanel t={t} />
      <CalendarPanel t={t} />
    </AppShell>
  );
}

// ── Operational settings ──────────────────────────────────────────────────────

function OperationalSettingsPanel({ t }: { t: Translate }): JSX.Element {
  const toast = useToast();
  const requestLogging = useRequestLoggingSettings();
  const updateRequestLogging = useUpdateRequestLoggingSettings();
  const detailed = requestLogging.data?.detailed ?? false;

  function handleRequestLoggingChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const nextDetailed = event.currentTarget.checked;
    updateRequestLogging.mutate(
      { detailed: nextDetailed },
      {
        onSuccess: (settings) =>
          toast.notify(
            settings.detailed
              ? t("admin.connectors.requestLogging.savedDetailed")
              : t("admin.connectors.requestLogging.savedOrdinary"),
            "success"
          ),
        onError: (error) => toast.notify(error.message, "error")
      }
    );
  }

  return (
    <section className="stack" aria-labelledby="connectors-operational-settings">
      <div>
        <h2 id="connectors-operational-settings">
          {t("admin.connectors.operational.title")}
        </h2>
        <p className="field__hint">{t("admin.connectors.operational.lead")}</p>
      </div>
      {requestLogging.isLoading ? (
        <p className="state state--loading">{t("admin.connectors.requestLogging.loading")}</p>
      ) : requestLogging.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.connectors.requestLogging.error", {
            message: requestLogging.error.message
          })}
        </p>
      ) : (
        <div className="form">
          <label className="cluster">
            <input
              type="checkbox"
              checked={detailed}
              disabled={updateRequestLogging.isPending}
              onChange={handleRequestLoggingChange}
            />
            <span className="field__label">
              {t("admin.connectors.requestLogging.label")}
            </span>
          </label>
          <p className="field__hint">{t("admin.connectors.requestLogging.hint")}</p>
          <div className="cluster" aria-live="polite">
            <span>{t("admin.connectors.requestLogging.current")}</span>
            <span className={detailed ? "tag tag--warn" : "tag tag--muted"}>
              {detailed
                ? t("admin.connectors.requestLogging.detailed")
                : t("admin.connectors.requestLogging.ordinary")}
            </span>
            {updateRequestLogging.isPending ? (
              <span className="state">{t("admin.connectors.requestLogging.saving")}</span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Status + test-send ────────────────────────────────────────────────────────

function StatusPanel({ t }: { t: Translate }): JSX.Element {
  const connectors = useConnectors();

  return (
    <section className="stack" aria-labelledby="connectors-status">
      <h2 id="connectors-status">{t("admin.connectors.status.title")}</h2>
      {connectors.isLoading ? (
        <p className="state state--loading">{t("admin.connectors.status.loading")}</p>
      ) : connectors.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.connectors.status.error", { message: connectors.error.message })}
        </p>
      ) : (
        <DataTable
          caption={t("admin.connectors.status.caption")}
          columns={statusColumns(t)}
          rows={connectors.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel={t("admin.connectors.status.empty")}
        />
      )}
      <TestSendForm t={t} />
    </section>
  );
}

function statusColumns(t: Translate): Column<ConnectorStatus>[] {
  return [
    {
      key: "id",
      header: t("admin.connectors.status.colConnector"),
      render: (row) => t(connectorLabelKey(row.id))
    },
    {
      key: "configured",
      header: t("admin.connectors.status.colConfigured"),
      render: (row) =>
        row.configured ? (
          <span className="tag tag--ok">{t("admin.connectors.badge.configured")}</span>
        ) : (
          <span className="tag tag--muted">{t("admin.connectors.badge.unconfigured")}</span>
        )
    },
    {
      key: "enabled",
      header: t("admin.connectors.status.colEnabled"),
      render: (row) =>
        row.enabled ? (
          <span className="tag tag--ok">{t("admin.connectors.badge.enabled")}</span>
        ) : (
          <span className="tag tag--warn">{t("admin.connectors.badge.disabled")}</span>
        )
    }
  ];
}

function connectorLabelKey(id: ConnectorId): string {
  return `admin.connectors.id.${id}`;
}

function TestSendForm({ t }: { t: Translate }): JSX.Element {
  const toast = useToast();
  const testSend = useTestSend();
  const [channel, setChannel] = useState<NotificationChannelId>("email");
  const [to, setTo] = useState("");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const target = to.trim();
    if (target.length === 0) {
      return;
    }
    testSend.mutate(
      { channel, to: target },
      {
        onSuccess: (result) =>
          toast.notify(
            result.ok
              ? t("admin.connectors.testSend.ok", { channel: t(`admin.connectors.channel.${channel}`) })
              : t("admin.connectors.testSend.failed"),
            result.ok ? "success" : "error"
          ),
        onError: (error) => toast.notify(error.message, "error")
      }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="form" aria-label={t("admin.connectors.testSend.title")}>
      <h3>{t("admin.connectors.testSend.title")}</h3>
      <p className="field__hint">{t("admin.connectors.testSend.lead")}</p>
      <SelectField
        label={t("admin.connectors.testSend.channelLabel")}
        value={channel}
        onChange={(event) => setChannel(event.target.value as NotificationChannelId)}
        options={CHANNELS.map((value) => ({
          value,
          label: t(`admin.connectors.channel.${value}`)
        }))}
      />
      <TextField
        label={t("admin.connectors.testSend.toLabel")}
        value={to}
        onChange={(event) => setTo(event.target.value)}
        autoComplete="off"
        hint={t("admin.connectors.testSend.toHint")}
      />
      <div className="cluster">
        <Button type="submit" disabled={testSend.isPending || to.trim().length === 0}>
          {testSend.isPending
            ? t("admin.connectors.testSend.sending")
            : t("admin.connectors.testSend.send")}
        </Button>
      </div>
    </form>
  );
}

// ── Webhook endpoints + delivery log ──────────────────────────────────────────

type WebhookEditor =
  | { mode: "create" }
  | { mode: "edit"; endpoint: WebhookEndpoint }
  | null;

function WebhooksPanel({ t }: { t: Translate }): JSX.Element {
  const webhooks = useWebhooks();
  const [editor, setEditor] = useState<WebhookEditor>(null);
  const [secret, setSecret] = useState<CreatedWebhookEndpoint | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);

  const columns: Column<WebhookEndpoint>[] = [
    { key: "url", header: t("admin.connectors.webhooks.colUrl"), render: (row) => <code>{row.url}</code> },
    {
      key: "events",
      header: t("admin.connectors.webhooks.colEvents"),
      render: (row) => row.events.map((e) => t(`admin.connectors.event.${e}`)).join(", ")
    },
    {
      key: "status",
      header: t("admin.connectors.webhooks.colStatus"),
      render: (row) =>
        row.status === "active" ? (
          <span className="tag tag--ok">{t("admin.status.active")}</span>
        ) : (
          <span className="tag tag--muted">{t("admin.status.inactive")}</span>
        )
    },
    {
      key: "actions",
      header: t("admin.connectors.webhooks.colActions"),
      render: (row) => (
        <div className="cluster">
          <Button variant="ghost" onClick={() => setEditor({ mode: "edit", endpoint: row })}>
            {t("admin.action.edit")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setOpenLog(openLog === row.id ? null : row.id)}
            aria-expanded={openLog === row.id}
          >
            {t("admin.connectors.webhooks.deliveries")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <section className="stack" aria-labelledby="connectors-webhooks">
      <div className="section-head">
        <h2 id="connectors-webhooks">{t("admin.connectors.webhooks.title")}</h2>
        <Button onClick={() => setEditor({ mode: "create" })}>
          {t("admin.connectors.webhooks.new")}
        </Button>
      </div>
      {webhooks.isLoading ? (
        <p className="state state--loading">{t("admin.connectors.webhooks.loading")}</p>
      ) : webhooks.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.connectors.webhooks.error", { message: webhooks.error.message })}
        </p>
      ) : (
        <DataTable
          caption={t("admin.connectors.webhooks.caption")}
          columns={columns}
          rows={webhooks.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel={t("admin.connectors.webhooks.empty")}
        />
      )}

      {openLog ? <DeliveryLog t={t} endpointId={openLog} /> : null}

      {editor ? (
        <WebhookEditorModal
          t={t}
          state={editor}
          onClose={() => setEditor(null)}
          onCreated={(created) => setSecret(created)}
        />
      ) : null}

      {secret ? <SecretModal t={t} endpoint={secret} onClose={() => setSecret(null)} /> : null}
    </section>
  );
}

function DeliveryLog({ t, endpointId }: { t: Translate; endpointId: string }): JSX.Element {
  const deliveries = useWebhookDeliveries(endpointId);
  const retry = useRetryDelivery(endpointId);
  const toast = useToast();

  const columns: Column<WebhookDelivery>[] = [
    {
      key: "event",
      header: t("admin.connectors.deliveries.colEvent"),
      render: (row) => t(`admin.connectors.event.${row.eventType}`)
    },
    {
      key: "status",
      header: t("admin.connectors.deliveries.colStatus"),
      render: (row) => <DeliveryStatus t={t} status={row.status} />
    },
    {
      key: "attempts",
      header: t("admin.connectors.deliveries.colAttempts"),
      render: (row) => row.attempts,
      numeric: true
    },
    {
      key: "response",
      header: t("admin.connectors.deliveries.colResponse"),
      render: (row) => (row.responseStatus !== null ? row.responseStatus : "—"),
      numeric: true
    },
    {
      key: "error",
      header: t("admin.connectors.deliveries.colError"),
      render: (row) =>
        row.lastError !== null ? <span className="mono">{row.lastError}</span> : "—"
    },
    {
      key: "actions",
      header: t("admin.connectors.deliveries.colActions"),
      render: (row) => (
        <Button
          variant="ghost"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(row.id, {
              onSuccess: () => toast.notify(t("admin.connectors.deliveries.retried"), "success"),
              onError: (error) => toast.notify(error.message, "error")
            })
          }
        >
          {t("admin.connectors.deliveries.retry")}
        </Button>
      )
    }
  ];

  return (
    <div className="card stack" aria-label={t("admin.connectors.deliveries.title")}>
      <h3>{t("admin.connectors.deliveries.title")}</h3>
      {deliveries.isLoading ? (
        <p className="state state--loading">{t("admin.connectors.deliveries.loading")}</p>
      ) : deliveries.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.connectors.deliveries.error", { message: deliveries.error.message })}
        </p>
      ) : (
        <DataTable
          caption={t("admin.connectors.deliveries.caption")}
          columns={columns}
          rows={deliveries.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel={t("admin.connectors.deliveries.empty")}
        />
      )}
    </div>
  );
}

function DeliveryStatus({
  t,
  status
}: {
  t: Translate;
  status: WebhookDelivery["status"];
}): JSX.Element {
  const cls =
    status === "delivered" ? "tag tag--ok" : status === "failed" ? "tag tag--warn" : "tag tag--info";
  return <span className={cls}>{t(`admin.connectors.deliveryStatus.${status}`)}</span>;
}

interface WebhookEditorProps {
  t: Translate;
  state: NonNullable<WebhookEditor>;
  onClose: () => void;
  onCreated: (created: CreatedWebhookEndpoint) => void;
}

function WebhookEditorModal({ t, state, onClose, onCreated }: WebhookEditorProps): JSX.Element {
  const toast = useToast();
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const isEdit = state.mode === "edit";

  const [url, setUrl] = useState(isEdit ? state.endpoint.url : "");
  const [events, setEvents] = useState<DomainEventType[]>(
    isEdit ? state.endpoint.events : []
  );
  const [status, setStatus] = useState<WebhookEndpoint["status"]>(
    isEdit ? state.endpoint.status : "active"
  );

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function toggleEvent(key: DomainEventType): void {
    setEvents((current) =>
      current.includes(key) ? current.filter((e) => e !== key) : [...current, key]
    );
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (events.length === 0) {
      return;
    }
    if (isEdit) {
      update.mutate(
        { id: state.endpoint.id, input: { events, status } },
        {
          onSuccess: () => {
            toast.notify(t("admin.connectors.webhooks.updated"), "success");
            onClose();
          }
        }
      );
    } else {
      create.mutate(
        { url: url.trim(), events },
        {
          onSuccess: (created) => {
            onClose();
            onCreated(created);
          }
        }
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isEdit ? t("admin.connectors.webhooks.editTitle") : t("admin.connectors.webhooks.createTitle")
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="webhook-form" disabled={pending || events.length === 0}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={handleSubmit} className="form">
        {isEdit ? (
          <p className="field__hint">
            <code>{state.endpoint.url}</code>
          </p>
        ) : (
          <TextField
            label={t("admin.connectors.webhooks.urlLabel")}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            autoComplete="off"
            hint={t("admin.connectors.webhooks.urlHint")}
          />
        )}
        <fieldset className="field">
          <legend className="field__label">{t("admin.connectors.webhooks.eventsLabel")}</legend>
          {EVENT_KEYS.map((key) => (
            <label key={key} className="cluster">
              <input
                type="checkbox"
                checked={events.includes(key)}
                onChange={() => toggleEvent(key)}
              />
              <span>{t(`admin.connectors.event.${key}`)}</span>
            </label>
          ))}
        </fieldset>
        {isEdit ? (
          <SelectField
            label={t("admin.field.status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as WebhookEndpoint["status"])}
            options={[
              { value: "active", label: t("admin.status.active") },
              { value: "inactive", label: t("admin.status.inactive") }
            ]}
          />
        ) : null}
        {error ? (
          <p className="state state--error" role="alert">
            {error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function SecretModal({
  t,
  endpoint,
  onClose
}: {
  t: Translate;
  endpoint: CreatedWebhookEndpoint;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpoint.secret);
      toast.notify(t("admin.connectors.secret.copied"), "success");
    } catch {
      toast.notify(t("admin.connectors.secret.copyFailed"), "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.connectors.secret.title")}
      footer={
        <Button onClick={onClose}>{t("admin.connectors.secret.done")}</Button>
      }
    >
      <div className="stack">
        <p className="state state--error" role="alert">
          {t("admin.connectors.secret.warning")}
        </p>
        <code className="mono">{endpoint.secret}</code>
        <div className="cluster">
          <Button variant="ghost" onClick={() => void copy()}>
            {t("admin.connectors.secret.copy")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Exports (CSV + Sheets) ────────────────────────────────────────────────────

function ExportsPanel({ t }: { t: Translate }): JSX.Element {
  const toast = useToast();
  const connectors = useConnectors();
  const csv = useCsvDownload();
  const sheets = useSheetsSync();

  const sheetsStatus = (connectors.data ?? []).find((c) => c.id === "google-sheets");
  const sheetsConfigured = sheetsStatus?.configured ?? false;

  function download(kind: "clients" | "bookings"): void {
    csv.mutate(kind, {
      onError: (error) => toast.notify(error.message, "error")
    });
  }

  function sync(): void {
    sheets.mutate(undefined, {
      onSuccess: () => toast.notify(t("admin.connectors.exports.synced"), "success"),
      onError: (error) => toast.notify(error.message, "error")
    });
  }

  return (
    <section className="stack" aria-labelledby="connectors-exports">
      <h2 id="connectors-exports">{t("admin.connectors.exports.title")}</h2>
      <p className="field__hint">{t("admin.connectors.exports.lead")}</p>
      <div className="cluster">
        <Button variant="ghost" disabled={csv.isPending} onClick={() => download("clients")}>
          {t("admin.connectors.exports.clients")}
        </Button>
        <Button variant="ghost" disabled={csv.isPending} onClick={() => download("bookings")}>
          {t("admin.connectors.exports.bookings")}
        </Button>
        <span title={sheetsConfigured ? undefined : t("admin.connectors.exports.sheetsDisabled")}>
          <Button disabled={!sheetsConfigured || sheets.isPending} onClick={sync}>
            {sheets.isPending
              ? t("admin.connectors.exports.syncing")
              : t("admin.connectors.exports.sheets")}
          </Button>
        </span>
      </div>
    </section>
  );
}

// ── Calendar feed link ────────────────────────────────────────────────────────

function CalendarPanel({ t }: { t: Translate }): JSX.Element {
  const toast = useToast();
  const getLink = useCalendarFeedLink();
  const rotate = useRotateCalendarFeed();
  const [subject, setSubject] = useState<CalendarSubject>("trainer");
  const [id, setId] = useState("");
  const [url, setUrl] = useState<string | null>(null);

  function fetchLink(): void {
    const value = id.trim();
    if (value.length === 0) {
      return;
    }
    getLink.mutate(
      { subject, id: value },
      {
        onSuccess: (link) => setUrl(link.url),
        onError: (error) => toast.notify(error.message, "error")
      }
    );
  }

  function rotateLink(): void {
    const value = id.trim();
    if (value.length === 0) {
      return;
    }
    rotate.mutate(
      { subject, id: value },
      {
        onSuccess: (link) => {
          setUrl(link.url);
          toast.notify(t("admin.connectors.calendar.rotated"), "success");
        },
        onError: (error) => toast.notify(error.message, "error")
      }
    );
  }

  async function copy(): Promise<void> {
    if (url === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.notify(t("admin.connectors.calendar.copied"), "success");
    } catch {
      toast.notify(t("admin.connectors.secret.copyFailed"), "error");
    }
  }

  return (
    <section className="stack" aria-labelledby="connectors-calendar">
      <h2 id="connectors-calendar">{t("admin.connectors.calendar.title")}</h2>
      <p className="field__hint">{t("admin.connectors.calendar.lead")}</p>
      <div className="form">
        <SelectField
          label={t("admin.connectors.calendar.subjectLabel")}
          value={subject}
          onChange={(event) => setSubject(event.target.value as CalendarSubject)}
          options={[
            { value: "trainer", label: t("admin.connectors.calendar.subject.trainer") },
            { value: "client", label: t("admin.connectors.calendar.subject.client") }
          ]}
        />
        <TextField
          label={t("admin.connectors.calendar.idLabel")}
          value={id}
          onChange={(event) => setId(event.target.value)}
          autoComplete="off"
          hint={t("admin.connectors.calendar.idHint")}
        />
        <div className="cluster">
          <Button disabled={getLink.isPending || id.trim().length === 0} onClick={fetchLink}>
            {t("admin.connectors.calendar.get")}
          </Button>
          <Button
            variant="ghost"
            disabled={rotate.isPending || id.trim().length === 0}
            onClick={rotateLink}
          >
            {t("admin.connectors.calendar.rotate")}
          </Button>
        </div>
        {url !== null ? (
          <div className="stack">
            <code className="mono">{url}</code>
            <div className="cluster">
              <Button variant="ghost" onClick={() => void copy()}>
                {t("admin.connectors.calendar.copy")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
