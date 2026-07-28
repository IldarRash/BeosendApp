import { useMemo, useState } from "react";
import type { BroadcastAudience, BroadcastAutomation, BroadcastAutomationPreview, BroadcastAutomationRunDetail, BroadcastType, Locale, RetryBroadcastAutomationFailuresResult } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DayOfWeekPicker } from "../ui/DayOfWeekPicker";
import { SelectField, TextAreaField, TextField, TimeField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useT } from "../i18n/LanguageProvider";
import { useLevels } from "../hooks/useLevels";
import { useAutomationActions, useBroadcastAutomationRun, useBroadcastAutomationRuns, useBroadcastAutomations } from "../hooks/useBroadcastAutomations";
import { useBroadcastPreview, useBroadcastTemplates, useSendBroadcast } from "../hooks/useBroadcasts";

type Draft = Pick<BroadcastAutomation, "name" | "trigger" | "audience" | "message">;
const LOCALES: Locale[] = ["ru", "sr", "en"];

function initialDraft(): Draft {
  return { name: "", trigger: { kind: "scheduled", recurrence: "daily", time: "10:00", trainingWindow: "tomorrow" }, audience: { levelIds: [], activity: "active" }, message: { bodies: { ru: "" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" } };
}

export function Broadcasts(): JSX.Element {
  const t = useT();
  const levels = useLevels();
  const automations = useBroadcastAutomations();
  const runs = useBroadcastAutomationRuns();
  const actions = useAutomationActions();
  const [selected, setSelected] = useState<BroadcastAutomation | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [preview, setPreview] = useState<BroadcastAutomationPreview | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [retryResult, setRetryResult] = useState<RetryBroadcastAutomationFailuresResult | null>(null);
  const selectedRun = useBroadcastAutomationRun(runId);
  const levelOptions = useMemo(() => levels.data ?? [], [levels.data]);
  const valid = draft.name.trim() !== "" && draft.audience.levelIds.length > 0 && Boolean(draft.message.bodies[draft.message.defaultLanguage]);

  const edit = (automation: BroadcastAutomation) => { setSelected(automation); setDraft({ name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message }); setPreview(null); };
  const newAutomation = () => { setSelected(null); setDraft(initialDraft()); setPreview(null); };
  const save = async () => {
    if (!valid) return;
    const saved = selected
      ? await actions.update.mutateAsync({ id: selected.id, input: { ...draft, expectedVersion: selected.version } })
      : await actions.create.mutateAsync(draft);
    setSelected(saved); setDraft({ name: saved.name, trigger: saved.trigger, audience: saved.audience, message: saved.message }); setPreview(null);
  };
  const requestPreview = async () => { if (selected) setPreview(await actions.preview.mutateAsync({ id: selected.id, version: selected.version })); };
  const enable = async () => { if (selected && preview) { const next = await actions.enable.mutateAsync({ id: selected.id, input: { expectedVersion: selected.version, previewToken: preview.previewToken } }); setSelected(next); } };

  return <AppShell>
    <header className="page-head"><div><h1>{t("admin.broadcasts.builderTitle")}</h1><p>{t("admin.broadcasts.builderLead")}</p></div><Button variant="primary" onClick={newAutomation}>{t("admin.broadcasts.newAutomation")}</Button></header>
    <section className="workspace broadcast-builder" aria-label={t("admin.broadcasts.automationList")}>
      <div className="workspace__bar"><h2>{t("admin.broadcasts.automationList")}</h2></div>
      {automations.isLoading ? <p className="state state--loading">{t("admin.broadcasts.loading")}</p> : automations.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.loadFailed", { message: automations.error.message })}</p> : <AutomationTable items={automations.data?.items ?? []} onEdit={edit} onToggle={(a) => a.enabled ? actions.disable.mutate({ id: a.id, version: a.version }) : edit(a)} />}
    </section>
    <section className="workspace broadcast-builder" aria-label={t("admin.broadcasts.editorTitle")}>
      <div className="workspace__bar"><div><h2>{t("admin.broadcasts.editorTitle")}</h2><p>{selected ? t("admin.broadcasts.version", { version: selected.version }) : t("admin.broadcasts.newDisabled")}</p></div></div>
      <div className="workspace__body broadcast-builder__grid"><AutomationEditor draft={draft} levels={levelOptions} levelsLoading={levels.isLoading} onChange={(next) => { setDraft(next); setPreview(null); }} />
        <aside className="stack" aria-label={t("admin.broadcasts.previewTitle")}>
          <div className="cluster"><Button variant="primary" onClick={() => void save()} disabled={!valid || actions.create.isPending || actions.update.isPending}>{t("admin.broadcasts.saveDraft")}</Button><Button variant="ghost" onClick={() => void requestPreview()} disabled={!selected || actions.preview.isPending}>{t("admin.broadcasts.preview")}</Button>{selected?.enabled ? <Button variant="ghost" onClick={() => actions.disable.mutate({ id: selected.id, version: selected.version })}>{t("admin.broadcasts.disable")}</Button> : <Button variant="primary" onClick={() => void enable()} disabled={!preview || preview.version !== selected?.version}>{t("admin.broadcasts.enable")}</Button>}</div>
          {actions.update.isError || actions.create.isError || actions.enable.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.saveFailed", { message: (actions.update.error ?? actions.create.error ?? actions.enable.error)?.message ?? "" })}</p> : null}
          <Preview preview={preview} loading={actions.preview.isPending} />
        </aside>
      </div>
    </section>
    <section className="workspace" aria-label={t("admin.broadcasts.historyTitle")}><div className="workspace__bar"><h2>{t("admin.broadcasts.historyTitle")}</h2></div>{runs.isLoading ? <p className="state state--loading">{t("admin.broadcasts.loading")}</p> : runs.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.loadFailed", { message: runs.error.message })}</p> : <History items={runs.data?.items ?? []} onOpen={(id) => { setRunId(id); setAmbiguous(false); setRetryResult(null); }} />}</section>
    <LegacyManualSend levels={levelOptions} />
    <RunDetail detail={selectedRun.data} loading={selectedRun.isLoading} error={selectedRun.error} onClose={() => setRunId(null)} onOpenRun={(id) => { setRunId(id); setAmbiguous(false); setRetryResult(null); }} onRetry={() => { if (!runId) return; void actions.retry.mutateAsync({ runId, input: ambiguous ? { includeAmbiguous: true, acknowledgeAmbiguous: true } : { includeAmbiguous: false } }).then(setRetryResult).catch(() => undefined); }} retrying={actions.retry.isPending} retryResult={retryResult} retryError={actions.retry.error} ambiguous={ambiguous} onAmbiguous={setAmbiguous} />
  </AppShell>;
}

function AutomationTable({ items, onEdit, onToggle }: { items: BroadcastAutomation[]; onEdit: (a: BroadcastAutomation) => void; onToggle: (a: BroadcastAutomation) => void }): JSX.Element {
  const t = useT(); const columns: Column<BroadcastAutomation>[] = [
    { key: "name", header: t("admin.broadcasts.name"), render: (a) => a.name },
    { key: "trigger", header: t("admin.broadcasts.trigger"), render: (a) => a.trigger.kind === "scheduled" ? `${a.trigger.recurrence} · ${a.trigger.time}` : a.trigger.kind },
    { key: "status", header: t("admin.broadcasts.status"), render: (a) => <span className={a.enabled ? "status status--ok" : "status"}>{a.enabled ? t("admin.broadcasts.enabled") : t("admin.broadcasts.disabled")}</span> },
    { key: "actions", header: t("admin.broadcasts.actions"), render: (a) => <div className="cluster"><Button variant="ghost" onClick={() => onEdit(a)}>{t("admin.action.edit")}</Button><Button variant="ghost" onClick={() => onToggle(a)}>{a.enabled ? t("admin.broadcasts.disable") : t("admin.broadcasts.editToEnable")}</Button></div> }
  ]; return <DataTable caption={t("admin.broadcasts.automationList")} columns={columns} rows={items} rowKey={(a) => a.id} emptyLabel={t("admin.broadcasts.empty")} />;
}

function AutomationEditor({ draft, levels, levelsLoading, onChange }: { draft: Draft; levels: Array<{ id: string; name: string }>; levelsLoading: boolean; onChange: (draft: Draft) => void }): JSX.Element {
  const t = useT(); const scheduled = draft.trigger.kind === "scheduled";
  const scheduledTrigger = draft.trigger as Extract<BroadcastAutomation["trigger"], { kind: "scheduled" }>;
  const updateMessage = (part: Partial<Draft["message"]>) => onChange({ ...draft, message: { ...draft.message, ...part } });
  const toggleLevel = (id: string) => onChange({ ...draft, audience: { ...draft.audience, levelIds: draft.audience.levelIds.includes(id) ? draft.audience.levelIds.filter((x) => x !== id) : [...draft.audience.levelIds, id] } });
  return <form className="form" onSubmit={(event) => event.preventDefault()}>
    <TextField label={t("admin.broadcasts.name")} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
    <SelectField label={t("admin.broadcasts.trigger")} value={draft.trigger.kind} onChange={(e) => { const kind = e.target.value; onChange({ ...draft, trigger: kind === "scheduled" ? { kind, recurrence: "daily", time: "10:00", trainingWindow: "tomorrow" } : { kind: kind as "training-created" | "training-time-changed" | "freed-place" } }); }} options={[{ value: "scheduled", label: t("admin.broadcasts.triggerScheduled") }, { value: "training-created", label: t("admin.broadcasts.triggerCreated") }, { value: "training-time-changed", label: t("admin.broadcasts.triggerChanged") }, { value: "freed-place", label: t("admin.broadcasts.triggerFreed") }]} />
    {scheduled ? <><SelectField label={t("admin.broadcasts.recurrence")} value={scheduledTrigger.recurrence} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, recurrence: e.target.value as "one-time" | "daily" | "weekly", ...(e.target.value === "weekly" ? { weekdays: [] } : {}), ...(e.target.value === "one-time" ? { date: "" } : {}) } })} options={[{ value: "one-time", label: t("admin.broadcasts.once") }, { value: "daily", label: t("admin.broadcasts.daily") }, { value: "weekly", label: t("admin.broadcasts.weekly") }]} /><TimeField label={t("admin.broadcasts.time")} value={scheduledTrigger.time} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, time: e.target.value } })} />{scheduledTrigger.recurrence === "weekly" ? <DayOfWeekPicker label={t("admin.broadcasts.weekdays")} value={scheduledTrigger.weekdays ?? []} onChange={(weekdays) => onChange({ ...draft, trigger: { ...scheduledTrigger, weekdays } })} /> : null}{scheduledTrigger.recurrence === "one-time" ? <TextField type="date" label={t("admin.broadcasts.date")} value={scheduledTrigger.date ?? ""} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, date: e.target.value } })} /> : null}<SelectField label={t("admin.broadcasts.window")} value={scheduledTrigger.trainingWindow} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, trainingWindow: e.target.value as "today" | "tomorrow" | "week" } })} options={[{ value: "today", label: t("admin.broadcasts.typeToday") }, { value: "tomorrow", label: t("admin.broadcasts.typeTomorrow") }, { value: "week", label: t("admin.broadcasts.typeWeek") }]} /></> : <p className="field__hint">{t("admin.broadcasts.eventDelay")}</p>}
    <fieldset className="field"><legend className="field__label">{t("admin.broadcasts.levels")}</legend>{levelsLoading ? t("admin.broadcasts.loading") : levels.map((level) => <label key={level.id} className="check"><input type="checkbox" checked={draft.audience.levelIds.includes(level.id)} onChange={() => toggleLevel(level.id)} /> {level.name}</label>)}</fieldset>
    <SelectField label={t("admin.broadcasts.activity")} hint={t("admin.broadcasts.activityHint")} value={draft.audience.activity} onChange={(e) => onChange({ ...draft, audience: { ...draft.audience, activity: e.target.value as "active" | "inactive" } })} options={[{ value: "active", label: t("admin.broadcasts.activityActive") }, { value: "inactive", label: t("admin.broadcasts.activityInactive") }]} />
    <SelectField label={t("admin.broadcasts.output")} value={draft.message.outputMode} onChange={(e) => updateMessage({ outputMode: e.target.value as "per-training" | "digest", ctaMode: e.target.value === "digest" ? "none" : draft.message.ctaMode })} options={[{ value: "per-training", label: t("admin.broadcasts.perTraining") }, { value: "digest", label: t("admin.broadcasts.digest") }]} />
    <SelectField label={t("admin.broadcasts.cta")} value={draft.message.ctaMode} disabled={draft.message.outputMode === "digest"} onChange={(e) => updateMessage({ ctaMode: e.target.value as "none" | "booking" })} options={[{ value: "none", label: t("admin.broadcasts.ctaNone") }, { value: "booking", label: t("admin.broadcasts.ctaBooking") }]} />
    <SelectField label={t("admin.broadcasts.defaultLanguage")} value={draft.message.defaultLanguage} onChange={(e) => updateMessage({ defaultLanguage: e.target.value as Locale })} options={LOCALES.map((locale) => ({ value: locale, label: locale.toUpperCase() }))} />
    {LOCALES.map((locale) => <TextAreaField key={locale} label={`${t("admin.broadcasts.message")} · ${locale.toUpperCase()}`} value={draft.message.bodies[locale] ?? ""} onChange={(e) => updateMessage({ bodies: { ...draft.message.bodies, [locale]: e.target.value } })} rows={4} hint={locale === draft.message.defaultLanguage ? t("admin.broadcasts.defaultRequired") : undefined} />)}
  </form>;
}

function Preview({ preview, loading }: { preview: BroadcastAutomationPreview | null; loading: boolean }): JSX.Element { const t = useT(); if (loading) return <p className="state state--loading">{t("admin.broadcasts.previewing")}</p>; if (!preview) return <p className="field__hint">{t("admin.broadcasts.previewHint")}</p>; return <article className="card"><h3>{t("admin.broadcasts.previewTitle")}</h3><p>{t("admin.broadcasts.recipients", { count: preview.recipientCount })}</p>{preview.warnings.map((warning) => <p key={warning} className="state state--warning">{warning}</p>)}{preview.renderedItems.map((item, index) => <pre key={index} className="broadcast-preview__text">{item.text}</pre>)}</article>; }

/**
 * The legacy sender deliberately exposes only persisted templates and the existing
 * preview/send endpoints. It never creates or edits a legacy definition: the API
 * still owns audience resolution, composition and send-time checks.
 */
function LegacyManualSend({ levels }: { levels: Array<{ id: string; name: string }> }): JSX.Element {
  const t = useT();
  const [type, setType] = useState<BroadcastType>("tomorrow");
  const [audienceKind, setAudienceKind] = useState<BroadcastAudience["kind"]>("all");
  const [levelId, setLevelId] = useState("");
  const [days, setDays] = useState("7");
  const [templateId, setTemplateId] = useState("");
  const templates = useBroadcastTemplates(type);
  const send = useSendBroadcast();
  const audience: BroadcastAudience | null = audienceKind === "all"
    ? { kind: "all" }
    : audienceKind === "level"
      ? levelId ? { kind: "level", levelId } : null
      : Number.isInteger(Number(days)) && Number(days) > 0
        ? { kind: audienceKind, days: Number(days) }
        : null;
  const preview = useBroadcastPreview(type, audience, templateId || null);
  const templateOptions = [{ value: "", label: t("admin.broadcasts.templateDefault") }, ...(templates.data ?? []).map((template) => ({ value: template.id, label: t("admin.broadcasts.templateOption", { name: template.name, version: template.version }) }))];
  const typeOptions = (["today", "tomorrow", "week", "freed-up"] as BroadcastType[]).map((value) => ({ value, label: t({ today: "admin.broadcasts.typeToday", tomorrow: "admin.broadcasts.typeTomorrow", week: "admin.broadcasts.typeWeek", "freed-up": "admin.broadcasts.typeFreedUp" }[value]) }));
  const sendLegacy = () => {
    if (!audience || !preview.data) return;
    send.mutate({ type, audience, ...(templateId ? { templateId, previewToken: preview.data.previewToken } : {}) });
  };
  return <section className="workspace" aria-label={t("admin.broadcasts.legacyTitle")}>
    <div className="workspace__bar"><div><h2>{t("admin.broadcasts.legacyTitle")}</h2><p>{t("admin.broadcasts.legacyLead")}</p></div></div>
    <div className="workspace__body broadcast-builder__grid"><form className="form" onSubmit={(event) => event.preventDefault()}>
      <SelectField label={t("admin.broadcasts.fieldType")} value={type} onChange={(event) => { setType(event.target.value as BroadcastType); setTemplateId(""); }} options={typeOptions} />
      <SelectField label={t("admin.broadcasts.templateField")} value={templateId} onChange={(event) => setTemplateId(event.target.value)} options={templateOptions} hint={templates.isLoading ? t("admin.broadcasts.templatesLoading") : undefined} />
      {templates.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.templatesError", { message: templates.error.message })}</p> : null}
      <SelectField label={t("admin.broadcasts.fieldAudience")} value={audienceKind} onChange={(event) => setAudienceKind(event.target.value as BroadcastAudience["kind"])} options={[{ value: "all", label: t("admin.broadcasts.audAll") }, { value: "level", label: t("admin.broadcasts.audLevel") }, { value: "active", label: t("admin.broadcasts.audActive") }, { value: "lapsed", label: t("admin.broadcasts.audLapsed") }]} />
      {audienceKind === "level" ? <SelectField label={t("admin.broadcasts.fieldLevel")} value={levelId} onChange={(event) => setLevelId(event.target.value)} options={[{ value: "", label: t("admin.broadcasts.pickLevel") }, ...levels.map((level) => ({ value: level.id, label: level.name }))]} /> : null}
      {audienceKind === "active" || audienceKind === "lapsed" ? <TextField type="number" min="1" label={t("admin.broadcasts.fieldDays")} value={days} onChange={(event) => setDays(event.target.value)} /> : null}
    </form><aside className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
      {!audience ? <p className="state state--loading">{t("admin.broadcasts.completeAudience")}</p> : preview.isLoading ? <p className="state state--loading">{t("admin.broadcasts.calculating")}</p> : preview.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.calcError", { message: preview.error.message })}</p> : preview.data ? <article className="card"><span className="card__label">{t("admin.broadcasts.cardRecipients")}: {preview.data.recipientsCount}</span><p className="broadcast-preview__text" style={{ whiteSpace: "pre-wrap" }}>{preview.data.text}</p></article> : null}
      <Button variant="primary" onClick={sendLegacy} disabled={!audience || !preview.data || preview.isFetching || send.isPending}>{send.isPending ? t("admin.broadcasts.sending") : t("admin.broadcasts.send")}</Button>
      {send.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.sendFailed", { message: send.error.message })}</p> : null}
    </aside></div>
  </section>;
}

function History({ items, onOpen }: { items: Array<{ id: string; triggerKind: string; status: string; counts: { sent: number; failed: number; ambiguous: number }; createdAt: string }>; onOpen: (id: string) => void }): JSX.Element { const t = useT(); const columns: Column<(typeof items)[number]>[] = [{ key: "when", header: t("admin.broadcasts.when"), render: (row) => new Date(row.createdAt).toLocaleString() }, { key: "trigger", header: t("admin.broadcasts.trigger"), render: (row) => row.triggerKind }, { key: "status", header: t("admin.broadcasts.status"), render: (row) => row.status }, { key: "results", header: t("admin.broadcasts.results"), render: (row) => `${row.counts.sent}/${row.counts.failed}/${row.counts.ambiguous}` }, { key: "open", header: t("admin.broadcasts.actions"), render: (row) => <Button variant="ghost" onClick={() => onOpen(row.id)}>{t("admin.action.view")}</Button> }]; return <DataTable caption={t("admin.broadcasts.historyTitle")} columns={columns} rows={items} rowKey={(row) => row.id} emptyLabel={t("admin.broadcasts.historyEmpty")} />; }

function RunDetail({ detail, loading, error, onClose, onOpenRun, onRetry, retrying, retryResult, retryError, ambiguous, onAmbiguous }: { detail: BroadcastAutomationRunDetail | undefined; loading: boolean; error: Error | null; onClose: () => void; onOpenRun: (id: string) => void; onRetry: () => void; retrying: boolean; retryResult: RetryBroadcastAutomationFailuresResult | null; retryError: Error | null; ambiguous: boolean; onAmbiguous: (value: boolean) => void }): JSX.Element | null {
  const t = useT();
  if (!detail && !loading && !error) return null;
  if (loading) return <Modal open onClose={onClose} title={t("admin.broadcasts.runDetail")}><p className="state state--loading">{t("admin.broadcasts.loading")}</p></Modal>;
  if (error || !detail) return <Modal open onClose={onClose} title={t("admin.broadcasts.runDetail")}><p className="state state--error" role="alert">{t("admin.broadcasts.loadFailed", { message: error?.message ?? "" })}</p></Modal>;

  const itemColumns: Column<BroadcastAutomationRunDetail["items"][number]>[] = [
    { key: "ordinal", header: t("admin.broadcasts.item"), render: (item) => item.ordinal, numeric: true },
    { key: "text", header: t("admin.broadcasts.itemText"), render: (item) => <pre className="broadcast-preview__text">{item.itemSnapshot.text}</pre> },
    { key: "cta", header: t("admin.broadcasts.cta"), render: (item) => `${item.ctaMode}${item.itemSnapshot.bookingTrainingId ? ` · ${t("admin.broadcasts.bookingTraining")}: ${item.itemSnapshot.bookingTrainingId}` : ""}` },
    { key: "language", header: t("admin.broadcasts.language"), render: (item) => `${item.itemSnapshot.requestedLanguage} → ${item.itemSnapshot.resolvedLanguage}${item.itemSnapshot.usedFallback ? ` · ${t("admin.broadcasts.fallback")}` : ""}` }
  ];
  const trainingColumns: Column<BroadcastAutomationRunDetail["trainings"][number]>[] = [
    { key: "training", header: t("admin.broadcasts.training"), render: (row) => `${row.trainingSnapshot.date} ${row.trainingSnapshot.startTime} · ${row.trainingSnapshot.groupName} · ${row.trainingSnapshot.levelName}` },
    { key: "outcome", header: t("admin.broadcasts.outcome"), render: (row) => row.outcome },
    { key: "skip", header: t("admin.broadcasts.skipReason"), render: (row) => row.skipReason ?? "—" },
    { key: "seats", header: t("admin.broadcasts.freeSeats"), render: (row) => row.trainingSnapshot.freeSeats, numeric: true }
  ];
  const deliveryColumns: Column<BroadcastAutomationRunDetail["deliveries"][number]>[] = [
    { key: "outcome", header: t("admin.broadcasts.outcome"), render: (row) => row.outcome },
    { key: "language", header: t("admin.broadcasts.language"), render: (row) => `${row.requestedLanguage} → ${row.resolvedLanguage}` },
    { key: "payload", header: t("admin.broadcasts.payload"), render: (row) => <pre className="broadcast-preview__text">{row.payloadSnapshot.text}</pre> },
    { key: "diagnostic", header: t("admin.broadcasts.diagnostic"), render: (row) => row.diagnostic ?? t("admin.broadcasts.noDiagnostic") },
    { key: "retry", header: t("admin.broadcasts.retryLink"), render: (row) => row.retryOfDeliveryId ? `${t("admin.broadcasts.retryOfDelivery")}: ${row.retryOfDeliveryId}` : "—" }
  ];

  return <Modal open onClose={onClose} title={t("admin.broadcasts.runDetail")}><div className="stack">
    <div className="card"><p>{t("admin.broadcasts.results")}: {detail.run.counts.sent}/{detail.run.counts.failed}/{detail.run.counts.ambiguous}</p><p>{t("admin.broadcasts.status")}: {detail.run.status}</p>{detail.run.skipReason ? <p>{t("admin.broadcasts.skipReason")}: {detail.run.skipReason}</p> : null}{detail.run.originalRunId ? <p><Button variant="ghost" onClick={() => onOpenRun(detail.run.originalRunId!)}>{t("admin.broadcasts.openOriginalRun")}</Button></p> : null}</div>
    <section><h3>{t("admin.broadcasts.detailItems")}</h3><DataTable caption={t("admin.broadcasts.detailItems")} columns={itemColumns} rows={detail.items} rowKey={(item) => item.id} emptyLabel={t("admin.broadcasts.detailItemsEmpty")} /></section>
    <section><h3>{t("admin.broadcasts.detailTrainings")}</h3><DataTable caption={t("admin.broadcasts.detailTrainings")} columns={trainingColumns} rows={detail.trainings} rowKey={(row) => row.id} emptyLabel={t("admin.broadcasts.detailTrainingsEmpty")} /></section>
    <section><h3>{t("admin.broadcasts.detailDeliveries")}</h3><DataTable caption={t("admin.broadcasts.detailDeliveries")} columns={deliveryColumns} rows={detail.deliveries} rowKey={(row) => row.id} emptyLabel={t("admin.broadcasts.detailDeliveriesEmpty")} /></section>
    {retryResult ? <p className="state state--ok" role="status">{t("admin.broadcasts.retrySucceeded", { count: retryResult.selectedDeliveryCount })}</p> : null}{retryError ? <p className="state state--error" role="alert">{t("admin.broadcasts.retryFailed", { message: retryError.message })}</p> : null}
    <p className="field__hint">{t("admin.broadcasts.retryHint")}</p><label className="check"><input type="checkbox" checked={ambiguous} onChange={(e) => onAmbiguous(e.target.checked)} /> {t("admin.broadcasts.retryAmbiguous")}</label>{ambiguous ? <p className="state state--warning">{t("admin.broadcasts.duplicateWarning")}</p> : null}<Button variant="primary" onClick={onRetry} disabled={retrying}>{retrying ? t("admin.broadcasts.retrying") : t("admin.broadcasts.retry")}</Button>
  </div></Modal>;
}
