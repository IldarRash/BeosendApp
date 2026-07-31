import { useMemo, useRef, useState } from "react";
import {
  broadcastAutomationAudienceSchema,
  createBroadcastAutomationSchema,
  type BroadcastAudience,
  type BroadcastAutomation,
  type BroadcastAutomationAudienceFilter,
  type BroadcastAutomationPreview,
  type BroadcastAutomationRunDetail,
  type BroadcastType,
  type ListBroadcastAutomationRunsQuery,
  type Locale,
  type RetryBroadcastAutomationFailuresResult
} from "@beosand/types";
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
type HistoryFilters = Omit<ListBroadcastAutomationRunsQuery, "cursor" | "limit">;
const LOCALES: Locale[] = ["ru", "sr", "en"];

function initialDraft(): Draft {
  return { name: "", trigger: { kind: "scheduled", recurrence: "daily", time: "10:00", trainingWindow: "tomorrow" }, audience: { filters: [] }, message: { bodies: { ru: "" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "none" } };
}

function draftFromAutomation(automation: BroadcastAutomation): Draft {
  return { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message };
}

function isSavedDraft(draft: Draft, automation: BroadcastAutomation | null): boolean {
  return automation !== null && JSON.stringify(draft) === JSON.stringify(draftFromAutomation(automation));
}

export function Broadcasts(): JSX.Element {
  const t = useT();
  const levels = useLevels();
  const automations = useBroadcastAutomations();
  const actions = useAutomationActions();
  const [selected, setSelected] = useState<BroadcastAutomation | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [preview, setPreview] = useState<BroadcastAutomationPreview | null>(null);
  const [previewFor, setPreviewFor] = useState<{ automationId: string; version: number } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const previewRequest = useRef(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [retryResult, setRetryResult] = useState<RetryBroadcastAutomationFailuresResult | null>(null);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({});
  const runs = useBroadcastAutomationRuns(historyFilters);
  const selectedRun = useBroadcastAutomationRun(runId);
  const levelOptions = useMemo(() => levels.data ?? [], [levels.data]);
  const valid = createBroadcastAutomationSchema.safeParse(draft).success;
  const draftIsSaved = isSavedDraft(draft, selected);
  const previewMatchesSavedDraft = Boolean(selected && draftIsSaved && preview && previewFor?.automationId === selected.id && previewFor.version === selected.version && preview.version === selected.version);
  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewFor(null);
    setPreviewPending(false);
  };

  const edit = (automation: BroadcastAutomation) => { invalidatePreview(); setSelected(automation); setDraft(draftFromAutomation(automation)); };
  const newAutomation = () => { invalidatePreview(); setSelected(null); setDraft(initialDraft()); };
  const save = async () => {
    if (!valid) return;
    invalidatePreview();
    const saved = selected
      ? await actions.update.mutateAsync({ id: selected.id, input: { ...draft, expectedVersion: selected.version } })
      : await actions.create.mutateAsync(draft);
    setSelected(saved); setDraft(draftFromAutomation(saved));
  };
  const requestPreview = async () => {
    if (!selected || !draftIsSaved) return;
    const request = ++previewRequest.current;
    const automationId = selected.id;
    const version = selected.version;
    setPreview(null);
    setPreviewFor(null);
    setPreviewPending(true);
    try {
      const nextPreview = await actions.preview.mutateAsync({ id: automationId, version });
      if (previewRequest.current === request) {
        setPreview(nextPreview);
        setPreviewFor({ automationId, version });
      }
    } finally {
      if (previewRequest.current === request) setPreviewPending(false);
    }
  };
  const enable = async () => {
    if (!selected || !preview || !previewMatchesSavedDraft) return;
    const next = await actions.enable.mutateAsync({ id: selected.id, input: { expectedVersion: selected.version, previewToken: preview.previewToken } });
    invalidatePreview();
    setSelected(next);
    setDraft(draftFromAutomation(next));
  };

  return <AppShell>
    <header className="page-head"><div><h1>{t("admin.broadcasts.builderTitle")}</h1><p>{t("admin.broadcasts.builderLead")}</p></div><Button variant="primary" onClick={newAutomation}>{t("admin.broadcasts.newAutomation")}</Button></header>
    <section className="workspace broadcast-builder" aria-label={t("admin.broadcasts.automationList")}>
      <div className="workspace__bar"><h2>{t("admin.broadcasts.automationList")}</h2></div>
      {automations.isLoading ? <p className="state state--loading">{t("admin.broadcasts.loading")}</p> : automations.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.loadFailed", { message: automations.error.message })}</p> : <AutomationTable items={automations.data?.items ?? []} onEdit={edit} onToggle={(a) => a.enabled ? actions.disable.mutate({ id: a.id, version: a.version }) : edit(a)} />}
    </section>
    <section className="workspace broadcast-builder" aria-label={t("admin.broadcasts.editorTitle")}>
      <div className="workspace__bar"><div><h2>{t("admin.broadcasts.editorTitle")}</h2><p>{selected ? t("admin.broadcasts.version", { version: selected.version }) : t("admin.broadcasts.newDisabled")}</p></div></div>
      <div className="workspace__body broadcast-builder__grid"><AutomationEditor draft={draft} levels={levelOptions} levelsLoading={levels.isLoading} onChange={(next) => { invalidatePreview(); setDraft(next); }} />
        <aside className="stack" aria-label={t("admin.broadcasts.previewTitle")}>
          <div className="cluster"><Button variant="primary" onClick={() => void save()} disabled={!valid || actions.create.isPending || actions.update.isPending}>{t("admin.broadcasts.saveDraft")}</Button><Button variant="ghost" onClick={() => void requestPreview()} disabled={!selected || !draftIsSaved || previewPending}>{t("admin.broadcasts.preview")}</Button>{selected?.enabled ? <Button variant="ghost" onClick={() => actions.disable.mutate({ id: selected.id, version: selected.version })}>{t("admin.broadcasts.disable")}</Button> : <Button variant="primary" onClick={() => void enable()} disabled={!previewMatchesSavedDraft}>{t("admin.broadcasts.enable")}</Button>}</div>
          {actions.update.isError || actions.create.isError || actions.enable.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.saveFailed", { message: (actions.update.error ?? actions.create.error ?? actions.enable.error)?.message ?? "" })}</p> : null}
          <Preview preview={preview} loading={previewPending} />
        </aside>
      </div>
    </section>
    <section className="workspace" aria-label={t("admin.broadcasts.historyTitle")}><div className="workspace__bar"><h2>{t("admin.broadcasts.historyTitle")}</h2></div><HistoryFilters filters={historyFilters} automations={automations.data?.items ?? []} onChange={setHistoryFilters} />{runs.isLoading ? <p className="state state--loading">{t("admin.broadcasts.loading")}</p> : runs.isError ? <p className="state state--error" role="alert">{t("admin.broadcasts.loadFailed", { message: runs.error.message })}</p> : <><History items={runs.data?.pages.flatMap((page) => page.items) ?? []} onOpen={(id) => { setRunId(id); setAmbiguous(false); setSelectedDeliveryIds([]); setRetryResult(null); }} />{runs.hasNextPage ? <Button variant="ghost" onClick={() => void runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>{runs.isFetchingNextPage ? t("admin.broadcasts.loading") : t("admin.broadcasts.loadMore")}</Button> : null}</>}</section>
    <LegacyManualSend levels={levelOptions} />
    <RunDetail detail={selectedRun.data} loading={selectedRun.isLoading} error={selectedRun.error} onClose={() => setRunId(null)} onOpenRun={(id) => { setRunId(id); setAmbiguous(false); setSelectedDeliveryIds([]); setRetryResult(null); }} onRetry={() => { if (!runId) return; void actions.retry.mutateAsync({ runId, input: { deliveryIds: selectedDeliveryIds, includeAmbiguous: ambiguous, ...(ambiguous ? { acknowledgeAmbiguous: true as const } : {}) } }).then(setRetryResult).catch(() => undefined); }} retrying={actions.retry.isPending} retryResult={retryResult} retryError={actions.retry.error} ambiguous={ambiguous} onAmbiguous={(value) => { setAmbiguous(value); if (!value && selectedRun.data) setSelectedDeliveryIds((ids) => ids.filter((id) => selectedRun.data?.deliveries.some((delivery) => delivery.id === id && delivery.outcome === "failed"))); }} selectedDeliveryIds={selectedDeliveryIds} onToggleDelivery={(id) => setSelectedDeliveryIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])} />
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
  const filterFor = <TDimension extends BroadcastAutomationAudienceFilter["dimension"]>(dimension: TDimension) =>
    draft.audience.filters.find((filter): filter is Extract<BroadcastAutomationAudienceFilter, { dimension: TDimension }> => filter.dimension === dimension);
  const updateAudience = (filters: BroadcastAutomationAudienceFilter[]) => onChange({ ...draft, audience: { filters } });
  const addFilter = (filter: BroadcastAutomationAudienceFilter) => updateAudience([...draft.audience.filters, filter]);
  const removeFilter = (dimension: BroadcastAutomationAudienceFilter["dimension"]) => updateAudience(draft.audience.filters.filter((filter) => filter.dimension !== dimension));
  const levelFilter = filterFor("level");
  const activityFilter = filterFor("activity");
  const genderFilter = filterFor("gender");
  const toggleLevel = (id: string) => {
    if (!levelFilter) return;
    const levelIds = levelFilter.levelIds.includes(id)
      ? levelFilter.levelIds.filter((value) => value !== id)
      : [...levelFilter.levelIds, id];
    updateAudience(draft.audience.filters.map((filter) => filter.dimension === "level" ? { dimension: "level", levelIds } : filter));
  };
  return <form className="form" onSubmit={(event) => event.preventDefault()}>
    <TextField label={t("admin.broadcasts.name")} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
    <SelectField label={t("admin.broadcasts.trigger")} value={draft.trigger.kind} onChange={(e) => { const kind = e.target.value; onChange({ ...draft, trigger: kind === "scheduled" ? { kind, recurrence: "daily", time: "10:00", trainingWindow: "tomorrow" } : { kind: kind as "training-created" | "training-time-changed" | "freed-place" } }); }} options={[{ value: "scheduled", label: t("admin.broadcasts.triggerScheduled") }, { value: "training-created", label: t("admin.broadcasts.triggerCreated") }, { value: "training-time-changed", label: t("admin.broadcasts.triggerChanged") }, { value: "freed-place", label: t("admin.broadcasts.triggerFreed") }]} />
    {scheduled ? <><SelectField label={t("admin.broadcasts.recurrence")} value={scheduledTrigger.recurrence} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, recurrence: e.target.value as "one-time" | "daily" | "weekly", ...(e.target.value === "weekly" ? { weekdays: [] } : {}), ...(e.target.value === "one-time" ? { date: "" } : {}) } })} options={[{ value: "one-time", label: t("admin.broadcasts.once") }, { value: "daily", label: t("admin.broadcasts.daily") }, { value: "weekly", label: t("admin.broadcasts.weekly") }]} /><TimeField label={t("admin.broadcasts.time")} value={scheduledTrigger.time} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, time: e.target.value } })} />{scheduledTrigger.recurrence === "weekly" ? <DayOfWeekPicker label={t("admin.broadcasts.weekdays")} value={scheduledTrigger.weekdays ?? []} onChange={(weekdays) => onChange({ ...draft, trigger: { ...scheduledTrigger, weekdays } })} /> : null}{scheduledTrigger.recurrence === "one-time" ? <TextField type="date" label={t("admin.broadcasts.date")} value={scheduledTrigger.date ?? ""} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, date: e.target.value } })} /> : null}<SelectField label={t("admin.broadcasts.window")} value={scheduledTrigger.trainingWindow} onChange={(e) => onChange({ ...draft, trigger: { ...scheduledTrigger, trainingWindow: e.target.value as "today" | "tomorrow" | "week" } })} options={[{ value: "today", label: t("admin.broadcasts.typeToday") }, { value: "tomorrow", label: t("admin.broadcasts.typeTomorrow") }, { value: "week", label: t("admin.broadcasts.typeWeek") }]} /></> : <p className="field__hint">{t("admin.broadcasts.eventDelay")}</p>}
    <fieldset className="field" aria-describedby="broadcast-audience-hint">
      <legend className="field__label">{t("admin.broadcasts.audience")}</legend>
      <span id="broadcast-audience-hint" className="field__hint">{t("admin.broadcasts.audienceHint")}</span>
      <div className="cluster">
        <Button type="button" variant="ghost" disabled={Boolean(levelFilter)} onClick={() => addFilter({ dimension: "level", levelIds: [] })}>{t("admin.broadcasts.addLevels")}</Button>
        <Button type="button" variant="ghost" disabled={Boolean(activityFilter)} onClick={() => addFilter({ dimension: "activity", value: "active" })}>{t("admin.broadcasts.addActivity")}</Button>
        <Button type="button" variant="ghost" disabled={Boolean(genderFilter)} onClick={() => addFilter({ dimension: "gender", value: "unspecified" })}>{t("admin.broadcasts.addGender")}</Button>
      </div>
    </fieldset>
    {levelFilter ? <fieldset className="field"><legend className="field__label">{t("admin.broadcasts.levels")}</legend><Button type="button" variant="ghost" onClick={() => removeFilter("level")}>{t("admin.broadcasts.removeFilter")}</Button>{levelsLoading ? <p className="field__hint">{t("admin.broadcasts.loading")}</p> : levels.map((level) => <label key={level.id} className="check"><input type="checkbox" checked={levelFilter.levelIds.includes(level.id)} onChange={() => toggleLevel(level.id)} /> {level.name}</label>)}{levelFilter.levelIds.length === 0 ? <p className="field__error" role="status">{t("admin.broadcasts.levelRequired")}</p> : null}</fieldset> : null}
    {activityFilter ? <fieldset className="field"><legend className="field__label">{t("admin.broadcasts.activity")}</legend><p className="field__hint">{t("admin.broadcasts.activityHint")}</p><label className="check"><input type="radio" name="broadcast-activity" checked={activityFilter.value === "active"} onChange={() => updateAudience(draft.audience.filters.map((filter) => filter.dimension === "activity" ? { dimension: "activity", value: "active" } : filter))} /> {t("admin.broadcasts.activityActive")}</label><label className="check"><input type="radio" name="broadcast-activity" checked={activityFilter.value === "inactive"} onChange={() => updateAudience(draft.audience.filters.map((filter) => filter.dimension === "activity" ? { dimension: "activity", value: "inactive" } : filter))} /> {t("admin.broadcasts.activityInactive")}</label><Button type="button" variant="ghost" onClick={() => removeFilter("activity")}>{t("admin.broadcasts.removeFilter")}</Button></fieldset> : null}
    {genderFilter ? <fieldset className="field"><legend className="field__label">{t("admin.broadcasts.gender")}</legend><SelectField label={t("admin.broadcasts.genderChoice")} value={genderFilter.value} onChange={(event) => updateAudience(draft.audience.filters.map((filter) => filter.dimension === "gender" ? { dimension: "gender", value: event.target.value as "male" | "female" | "unspecified" } : filter))} options={[{ value: "male", label: t("admin.broadcasts.genderMale") }, { value: "female", label: t("admin.broadcasts.genderFemale") }, { value: "unspecified", label: t("admin.broadcasts.genderUnspecified") }]} />{genderFilter.value === "male" || genderFilter.value === "female" ? <p className="state state--warning" role="status">{t("admin.broadcasts.genderInclusiveWarning")}</p> : null}<Button type="button" variant="ghost" onClick={() => removeFilter("gender")}>{t("admin.broadcasts.removeFilter")}</Button></fieldset> : null}
    <p className="field__hint" aria-live="polite">{broadcastAutomationAudienceSchema.safeParse(draft.audience).success ? t("admin.broadcasts.audienceReady") : t("admin.broadcasts.audienceIncomplete")}</p>
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

function HistoryFilters({ filters, automations, onChange }: { filters: HistoryFilters; automations: BroadcastAutomation[]; onChange: (filters: HistoryFilters) => void }): JSX.Element {
  const t = useT();
  return <div className="workspace__body"><div className="cluster" aria-label={t("admin.broadcasts.historyFilters")}>
    <SelectField label={t("admin.broadcasts.historyAutomation")} value={filters.automationId ?? ""} onChange={(event) => onChange({ ...filters, automationId: event.target.value || undefined })} options={[{ value: "", label: t("admin.broadcasts.allAutomations") }, ...automations.map((automation) => ({ value: automation.id, label: automation.name }))]} />
    <SelectField label={t("admin.broadcasts.historyTrigger")} value={filters.triggerKind ?? ""} onChange={(event) => onChange({ ...filters, triggerKind: (event.target.value || undefined) as HistoryFilters["triggerKind"] })} options={[{ value: "", label: t("admin.broadcasts.allTriggers") }, ...(["scheduled", "training-created", "training-time-changed", "freed-place", "manual-retry"] as const).map((value) => ({ value, label: value }))]} />
    <SelectField label={t("admin.broadcasts.status")} value={filters.status ?? ""} onChange={(event) => onChange({ ...filters, status: (event.target.value || undefined) as HistoryFilters["status"] })} options={[{ value: "", label: t("admin.broadcasts.allStatuses") }, ...(["pending", "processing", "completed", "skipped"] as const).map((value) => ({ value, label: value }))]} />
  </div></div>;
}

function RunDetail({ detail, loading, error, onClose, onOpenRun, onRetry, retrying, retryResult, retryError, ambiguous, onAmbiguous, selectedDeliveryIds, onToggleDelivery }: { detail: BroadcastAutomationRunDetail | undefined; loading: boolean; error: Error | null; onClose: () => void; onOpenRun: (id: string) => void; onRetry: () => void; retrying: boolean; retryResult: RetryBroadcastAutomationFailuresResult | null; retryError: Error | null; ambiguous: boolean; onAmbiguous: (value: boolean) => void; selectedDeliveryIds: string[]; onToggleDelivery: (id: string) => void }): JSX.Element | null {
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
    { key: "select", header: t("admin.broadcasts.retrySelect"), render: (row) => {
      const eligible = row.outcome === "failed" || (ambiguous && row.outcome === "ambiguous");
      return eligible ? <label className="check"><input type="checkbox" checked={selectedDeliveryIds.includes(row.id)} onChange={() => onToggleDelivery(row.id)} /> {t("admin.broadcasts.retrySelect")}</label> : "—";
    } },
    { key: "outcome", header: t("admin.broadcasts.outcome"), render: (row) => row.outcome },
    { key: "language", header: t("admin.broadcasts.language"), render: (row) => `${row.requestedLanguage} → ${row.resolvedLanguage}` },
    { key: "payload", header: t("admin.broadcasts.payload"), render: (row) => <pre className="broadcast-preview__text">{row.payloadSnapshot.text}</pre> },
    { key: "diagnostic", header: t("admin.broadcasts.diagnostic"), render: (row) => row.diagnostic ?? t("admin.broadcasts.noDiagnostic") },
    { key: "retry", header: t("admin.broadcasts.retryLink"), render: (row) => row.retryOfDeliveryId ? `${t("admin.broadcasts.retryOfDelivery")}: ${row.retryOfDeliveryId}` : "—" }
  ];

  const countRows = Object.entries(detail.run.counts).map(([label, value]) => ({ label, value }));
  return <Modal open onClose={onClose} title={t("admin.broadcasts.runDetail")}><div className="stack">
    <div className="card"><p>{t("admin.broadcasts.status")}: {detail.run.status}</p><p>{t("admin.broadcasts.version", { version: detail.run.automationVersion })}</p>{detail.run.skipReason ? <p>{t("admin.broadcasts.skipReason")}: {detail.run.skipReason}</p> : null}{detail.run.originalRunId ? <p><Button variant="ghost" onClick={() => onOpenRun(detail.run.originalRunId!)}>{t("admin.broadcasts.openOriginalRun")}</Button></p> : null}</div>
    <section><h3>{t("admin.broadcasts.runCounts")}</h3><DataTable caption={t("admin.broadcasts.runCounts")} columns={[{ key: "label", header: t("admin.broadcasts.count"), render: (row) => row.label }, { key: "value", header: t("admin.broadcasts.value"), render: (row) => row.value, numeric: true }]} rows={countRows} rowKey={(row) => row.label} emptyLabel="—" /></section>
    <section><h3>{t("admin.broadcasts.configSnapshot")}</h3><pre className="broadcast-preview__text">{JSON.stringify(detail.run.configSnapshot, null, 2)}</pre></section>
    <section><h3>{t("admin.broadcasts.detailItems")}</h3><DataTable caption={t("admin.broadcasts.detailItems")} columns={itemColumns} rows={detail.items} rowKey={(item) => item.id} emptyLabel={t("admin.broadcasts.detailItemsEmpty")} /></section>
    <section><h3>{t("admin.broadcasts.detailTrainings")}</h3><DataTable caption={t("admin.broadcasts.detailTrainings")} columns={trainingColumns} rows={detail.trainings} rowKey={(row) => row.id} emptyLabel={t("admin.broadcasts.detailTrainingsEmpty")} /></section>
    <section><h3>{t("admin.broadcasts.detailDeliveries")}</h3><DataTable caption={t("admin.broadcasts.detailDeliveries")} columns={deliveryColumns} rows={detail.deliveries} rowKey={(row) => row.id} emptyLabel={t("admin.broadcasts.detailDeliveriesEmpty")} /></section>
    {retryResult ? <p className="state state--ok" role="status">{t("admin.broadcasts.retrySucceeded", { count: retryResult.selectedDeliveryCount })} <Button variant="ghost" onClick={() => onOpenRun(retryResult.run.id)}>{t("admin.broadcasts.openRetryRun")}</Button></p> : null}{retryError ? <p className="state state--error" role="alert">{t("admin.broadcasts.retryFailed", { message: retryError.message })}</p> : null}
    <p className="field__hint">{t("admin.broadcasts.retryHint")}</p><label className="check"><input type="checkbox" checked={ambiguous} onChange={(e) => onAmbiguous(e.target.checked)} /> {t("admin.broadcasts.retryAmbiguous")}</label>{ambiguous ? <p className="state state--warning">{t("admin.broadcasts.duplicateWarning")}</p> : null}<Button variant="primary" onClick={onRetry} disabled={retrying || selectedDeliveryIds.length === 0}>{retrying ? t("admin.broadcasts.retrying") : t("admin.broadcasts.retry")}</Button>
  </div></Modal>;
}
