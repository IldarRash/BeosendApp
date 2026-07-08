import { useEffect, useMemo, useState } from "react";
import type {
  BroadcastAudience,
  BroadcastPreview,
  BroadcastTemplate,
  BroadcastTemplateVariable,
  BroadcastType,
  DayOfWeek,
  SlotCard
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { SelectField, NumberField, TextField } from "../ui/Field";
import { StatCard } from "../ui/StatCard";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useLevels } from "../hooks/useLevels";
import {
  useBroadcastPreview,
  useBroadcastTemplateVariables,
  useBroadcastTemplates,
  useCreateBroadcastTemplate,
  useSendBroadcast,
  useUpdateBroadcastTemplate
} from "../hooks/useBroadcasts";
import { formatRsd } from "../lib/format";

const DEFAULT_TEMPLATE_ID = "__default__";
const NEW_TEMPLATE_ID = "__new__";

/** Catalog key for a broadcast type. The server owns the composed message text. */
const TYPE_KEY: Record<BroadcastType, string> = {
  today: "admin.broadcasts.typeToday",
  tomorrow: "admin.broadcasts.typeTomorrow",
  week: "admin.broadcasts.typeWeek",
  "freed-up": "admin.broadcasts.typeFreedUp"
};

/** The audience selector kinds, kept separate from the API union so the screen can
 * hold a partial selection (e.g. "level" chosen before a level is picked). */
type AudienceKind = BroadcastAudience["kind"];

const AUDIENCE_KEY: Record<AudienceKind, string> = {
  all: "admin.broadcasts.audAll",
  level: "admin.broadcasts.audLevel",
  active: "admin.broadcasts.audActive",
  lapsed: "admin.broadcasts.audLapsed"
};

interface TemplateFormState {
  name: string;
  bodyTemplate: string;
  slotLineTemplate: string;
  emptyBodyTemplate: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  bodyTemplate: "",
  slotLineTemplate: "",
  emptyBodyTemplate: ""
};

/**
 * Build the API audience union from the picker selection. Returns `null` while the
 * selection is incomplete (a "level"/"active"/"lapsed" kind without its extra
 * value) so the preview stays gated until a valid segment exists. The browser does
 * no segmentation math - it only assembles the chosen segment descriptor.
 */
function buildAudience(
  kind: AudienceKind,
  levelId: string,
  days: number | null
): BroadcastAudience | null {
  switch (kind) {
    case "all":
      return { kind: "all" };
    case "level":
      return levelId ? { kind: "level", levelId } : null;
    case "active":
      return days !== null ? { kind: "active", days } : null;
    case "lapsed":
      return days !== null ? { kind: "lapsed", days } : null;
    default:
      return null;
  }
}

function formFromTemplate(template: BroadcastTemplate): TemplateFormState {
  return {
    name: template.name,
    bodyTemplate: template.bodyTemplate,
    slotLineTemplate: template.slotLineTemplate,
    emptyBodyTemplate: template.emptyBodyTemplate
  };
}

function trimmedTemplateForm(form: TemplateFormState): TemplateFormState {
  return {
    name: form.name.trim(),
    bodyTemplate: form.bodyTemplate.trim(),
    slotLineTemplate: form.slotLineTemplate.trim(),
    emptyBodyTemplate: form.emptyBodyTemplate.trim()
  };
}

/**
 * M4 - Broadcasts: compose a free-slot broadcast, preview the API-decided recipient
 * count and composed message, then send. The preview always renders before the
 * send action; recipient counts and message text come only from the API.
 */
export function Broadcasts(): JSX.Element {
  const t = useT();
  const toast = useToast();
  const levels = useLevels();
  const [type, setType] = useState<BroadcastType>("today");
  const [audienceKind, setAudienceKind] = useState<AudienceKind>("all");
  const [levelId, setLevelId] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);

  const templates = useBroadcastTemplates(type);
  const variables = useBroadcastTemplateVariables(type);
  const createTemplate = useCreateBroadcastTemplate();
  const updateTemplate = useUpdateBroadcastTemplate();

  const selectedTemplate = useMemo(
    () => templates.data?.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates.data]
  );
  const selectedTemplateIdForApi =
    selectedTemplateId !== DEFAULT_TEMPLATE_ID && selectedTemplateId !== NEW_TEMPLATE_ID
      ? selectedTemplateId
      : null;

  useEffect(() => {
    if (selectedTemplate) {
      setTemplateForm(formFromTemplate(selectedTemplate));
      return;
    }
    if (selectedTemplateId === NEW_TEMPLATE_ID) {
      setTemplateForm(EMPTY_TEMPLATE_FORM);
    }
  }, [selectedTemplate, selectedTemplateId]);

  const audience = useMemo(
    () => buildAudience(audienceKind, levelId, days),
    [audienceKind, levelId, days]
  );

  const preview = useBroadcastPreview(type, audience, selectedTemplateIdForApi);
  const send = useSendBroadcast();

  const hasPreview = audience !== null && preview.data !== undefined;

  const typeOptions = useMemo(
    () =>
      (Object.keys(TYPE_KEY) as BroadcastType[]).map((value) => ({
        value,
        label: t(TYPE_KEY[value])
      })),
    [t]
  );
  const audienceOptions = useMemo(
    () =>
      (Object.keys(AUDIENCE_KEY) as AudienceKind[]).map((value) => ({
        value,
        label: t(AUDIENCE_KEY[value])
      })),
    [t]
  );

  function handleTypeChange(nextType: BroadcastType): void {
    setType(nextType);
    setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
    setTemplateForm(EMPTY_TEMPLATE_FORM);
  }

  function handleTemplateSave(): void {
    const input = { ...trimmedTemplateForm(templateForm), broadcastType: type };
    if (selectedTemplateIdForApi) {
      updateTemplate.mutate(
        {
          id: selectedTemplateIdForApi,
          input: {
            name: input.name,
            bodyTemplate: input.bodyTemplate,
            slotLineTemplate: input.slotLineTemplate,
            emptyBodyTemplate: input.emptyBodyTemplate
          }
        },
        {
          onSuccess: (template) => {
            setTemplateForm(formFromTemplate(template));
            toast.notify(t("admin.broadcasts.templateSaved"), "success");
          },
          onError: (error) =>
            toast.notify(t("admin.broadcasts.templateSaveFailed", { message: error.message }), "error")
        }
      );
      return;
    }
    createTemplate.mutate(input, {
      onSuccess: (template) => {
        setSelectedTemplateId(template.id);
        setTemplateForm(formFromTemplate(template));
        toast.notify(t("admin.broadcasts.templateCreated"), "success");
      },
      onError: (error) =>
        toast.notify(t("admin.broadcasts.templateSaveFailed", { message: error.message }), "error")
    });
  }

  function handleTemplateArchive(): void {
    if (!selectedTemplateIdForApi) return;
    updateTemplate.mutate(
      { id: selectedTemplateIdForApi, input: { status: "inactive" } },
      {
        onSuccess: () => {
          setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
          setTemplateForm(EMPTY_TEMPLATE_FORM);
          toast.notify(t("admin.broadcasts.templateArchived"), "success");
        },
        onError: (error) =>
          toast.notify(t("admin.broadcasts.templateSaveFailed", { message: error.message }), "error")
      }
    );
  }

  function handleSend(): void {
    if (audience === null) {
      toast.notify(t("admin.broadcasts.completeAudience"), "error");
      return;
    }
    const previewToken = preview.data?.previewToken;
    if (selectedTemplateIdForApi && !previewToken) {
      toast.notify(t("admin.broadcasts.previewTokenMissing"), "error");
      return;
    }
    send.mutate(
      {
        type,
        audience,
        ...(selectedTemplateIdForApi
          ? { templateId: selectedTemplateIdForApi, previewToken }
          : {})
      },
      {
        onSuccess: (broadcast) => {
          toast.notify(
            t("admin.broadcasts.sent", {
              count: broadcast.recipientsCount.toLocaleString("ru-RU")
            }),
            "success"
          );
        },
        onError: (error) => {
          toast.notify(t("admin.broadcasts.sendFailed", { message: error.message }), "error");
        }
      }
    );
  }

  const levelOptions = useMemo(
    () => (levels.data ?? []).map((level) => ({ value: level.id, label: level.name })),
    [levels.data]
  );

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.broadcasts.title")}</h1>
          <p>{t("admin.broadcasts.lead")}</p>
        </div>
      </header>

      <section className="workspace" aria-label={t("admin.broadcasts.paramsLabel")}>
        <div className="workspace__bar">
          <form className="form" aria-label={t("admin.broadcasts.paramsLabel")}>
            <SelectField
              label={t("admin.broadcasts.fieldType")}
              value={type}
              onChange={(event) => handleTypeChange(event.target.value as BroadcastType)}
              options={typeOptions}
              hint={t("admin.broadcasts.typeHint")}
            />

            <SelectField
              label={t("admin.broadcasts.fieldAudience")}
              value={audienceKind}
              onChange={(event) => {
                setAudienceKind(event.target.value as AudienceKind);
              }}
              options={audienceOptions}
              aria-controls="audience-detail"
            />

            <div id="audience-detail">
              {audienceKind === "level" ? (
                levels.isLoading ? (
                  <p className="state state--loading">{t("admin.broadcasts.levelsLoading")}</p>
                ) : levels.isError ? (
                  <p className="state state--error" role="alert">
                    {t("admin.broadcasts.levelsError", { message: levels.error.message })}
                  </p>
                ) : (
                  <SelectField
                    label={t("admin.broadcasts.fieldLevel")}
                    value={levelId}
                    onChange={(event) => setLevelId(event.target.value)}
                    options={[{ value: "", label: t("admin.broadcasts.pickLevel") }, ...levelOptions]}
                    hint={t("admin.broadcasts.levelHint")}
                  />
                )
              ) : null}

              {audienceKind === "active" || audienceKind === "lapsed" ? (
                <NumberField
                  label={t("admin.broadcasts.fieldDays")}
                  value={days}
                  onValueChange={setDays}
                  min={1}
                  max={365}
                  hint={
                    audienceKind === "active"
                      ? t("admin.broadcasts.daysActiveHint")
                      : t("admin.broadcasts.daysLapsedHint")
                  }
                />
              ) : null}
            </div>
          </form>
        </div>

        <div className="workspace__body stack">
          <BroadcastTemplatePanel
            templates={templates.data ?? []}
            templatesLoading={templates.isLoading}
            templatesError={templates.isError ? templates.error.message : null}
            variables={variables.data ?? preview.data?.templateVariables ?? []}
            variablesLoading={variables.isLoading}
            variablesError={variables.isError ? variables.error.message : null}
            selectedTemplateId={selectedTemplateId}
            selectedTemplate={selectedTemplate}
            form={templateForm}
            isSaving={createTemplate.isPending || updateTemplate.isPending}
            onSelectedTemplateIdChange={setSelectedTemplateId}
            onFormChange={setTemplateForm}
            onSave={handleTemplateSave}
            onArchive={handleTemplateArchive}
          />

          <BroadcastPreviewPanel
            isLoading={preview.isLoading || preview.isFetching}
            isError={preview.isError}
            errorMessage={preview.error?.message}
            incompleteAudience={audience === null}
            preview={preview.data}
          />

          <div className="cluster">
            <Button
              variant="primary"
              onClick={handleSend}
              disabled={audience === null || !hasPreview || preview.isFetching || send.isPending}
              aria-disabled={audience === null || !hasPreview || preview.isFetching || send.isPending}
            >
              {send.isPending ? t("admin.broadcasts.sending") : t("admin.broadcasts.send")}
            </Button>
            {!hasPreview ? (
              <span className="field__hint">{t("admin.broadcasts.previewFirst")}</span>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

interface BroadcastTemplatePanelProps {
  templates: BroadcastTemplate[];
  templatesLoading: boolean;
  templatesError: string | null;
  variables: BroadcastTemplateVariable[];
  variablesLoading: boolean;
  variablesError: string | null;
  selectedTemplateId: string;
  selectedTemplate?: BroadcastTemplate;
  form: TemplateFormState;
  isSaving: boolean;
  onSelectedTemplateIdChange: (value: string) => void;
  onFormChange: (value: TemplateFormState) => void;
  onSave: () => void;
  onArchive: () => void;
}

function BroadcastTemplatePanel({
  templates,
  templatesLoading,
  templatesError,
  variables,
  variablesLoading,
  variablesError,
  selectedTemplateId,
  selectedTemplate,
  form,
  isSaving,
  onSelectedTemplateIdChange,
  onFormChange,
  onSave,
  onArchive
}: BroadcastTemplatePanelProps): JSX.Element {
  const t = useT();
  const isEditing = selectedTemplateId !== DEFAULT_TEMPLATE_ID;
  const templateOptions = [
    { value: DEFAULT_TEMPLATE_ID, label: t("admin.broadcasts.templateDefault") },
    ...templates.map((template) => ({
      value: template.id,
      label: t("admin.broadcasts.templateOption", {
        name: template.name,
        version: template.version
      })
    })),
    { value: NEW_TEMPLATE_ID, label: t("admin.broadcasts.templateNew") }
  ];

  return (
    <article className="card" aria-label={t("admin.broadcasts.templatePanelLabel")}>
      <div className="tpl-card__head">
        <div className="tpl-card__heading">
          <h2 className="tpl-card__title">{t("admin.broadcasts.templateTitle")}</h2>
          <span className="tpl-card__key">
            {selectedTemplate
              ? t("admin.broadcasts.templateVersion", { version: selectedTemplate.version })
              : t("admin.broadcasts.templateDefaultHint")}
          </span>
        </div>
      </div>

      <SelectField
        label={t("admin.broadcasts.templateField")}
        value={selectedTemplateId}
        onChange={(event) => onSelectedTemplateIdChange(event.target.value)}
        options={templateOptions}
        hint={templatesLoading ? t("admin.broadcasts.templatesLoading") : undefined}
      />

      {templatesError ? (
        <p className="state state--error" role="alert">
          {t("admin.broadcasts.templatesError", { message: templatesError })}
        </p>
      ) : null}

      <VariableChips
        variables={variables}
        isLoading={variablesLoading}
        errorMessage={variablesError}
      />

      {isEditing ? (
        <form
          className="form"
          aria-label={t("admin.broadcasts.templateEditorLabel")}
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <TextField
            label={t("admin.broadcasts.templateName")}
            value={form.name}
            onChange={(event) => onFormChange({ ...form, name: event.target.value })}
            hint={t("admin.broadcasts.templateNameHint")}
          />

          <TemplateTextarea
            id="broadcast-template-body"
            label={t("admin.broadcasts.templateBody")}
            value={form.bodyTemplate}
            rows={5}
            onChange={(value) => onFormChange({ ...form, bodyTemplate: value })}
          />
          <TemplateTextarea
            id="broadcast-template-slot-line"
            label={t("admin.broadcasts.templateSlotLine")}
            value={form.slotLineTemplate}
            rows={3}
            onChange={(value) => onFormChange({ ...form, slotLineTemplate: value })}
          />
          <TemplateTextarea
            id="broadcast-template-empty"
            label={t("admin.broadcasts.templateEmpty")}
            value={form.emptyBodyTemplate}
            rows={3}
            onChange={(value) => onFormChange({ ...form, emptyBodyTemplate: value })}
          />

          <div className="tpl-card__actions">
            {selectedTemplate ? (
              <Button
                variant="ghost"
                onClick={onArchive}
                disabled={isSaving}
                aria-disabled={isSaving}
              >
                {t("admin.broadcasts.templateArchive")}
              </Button>
            ) : null}
            <Button variant="primary" type="submit" disabled={isSaving} aria-disabled={isSaving}>
              {isSaving ? t("admin.action.saving") : t("admin.action.save")}
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

interface TemplateTextareaProps {
  id: string;
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}

function TemplateTextarea({ id, label, value, rows, onChange }: TemplateTextareaProps): JSX.Element {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="input tpl-card__textarea"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface VariableChipsProps {
  variables: BroadcastTemplateVariable[];
  isLoading: boolean;
  errorMessage: string | null;
}

function VariableChips({ variables, isLoading, errorMessage }: VariableChipsProps): JSX.Element {
  const t = useT();
  if (isLoading) {
    return <p className="state state--loading">{t("admin.broadcasts.variablesLoading")}</p>;
  }
  if (errorMessage) {
    return (
      <p className="state state--error" role="alert">
        {t("admin.broadcasts.variablesError", { message: errorMessage })}
      </p>
    );
  }
  if (variables.length === 0) {
    return <p className="field__hint">{t("admin.broadcasts.variablesEmpty")}</p>;
  }
  return (
    <div className="tpl-chips" aria-label={t("admin.broadcasts.variablesLabel")}>
      <span className="tpl-chips__label">{t("admin.broadcasts.variablesLabel")}</span>
      {variables.map((variable) => (
        <span
          key={variable.key}
          className="tpl-chip"
          title={`${variable.label}: ${variable.description} ${t("admin.broadcasts.variableExample", {
            example: variable.example
          })}`}
        >
          {variable.placeholder}
        </span>
      ))}
    </div>
  );
}

interface BroadcastPreviewPanelProps {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  /** True when the audience selection is still incomplete (no preview requested). */
  incompleteAudience: boolean;
  preview?: BroadcastPreview;
}

/**
 * Renders the API's preview verbatim: the recipient count, composed message text,
 * and the bookable slot cards it advertises. No counts or segments are computed
 * here - every figure comes from {@link BroadcastPreview}.
 */
function BroadcastPreviewPanel({
  isLoading,
  isError,
  errorMessage,
  incompleteAudience,
  preview
}: BroadcastPreviewPanelProps): JSX.Element {
  const t = useT();
  const weekdayLabel = (day: DayOfWeek): string => t(`admin.day.short.${day}`);

  if (incompleteAudience) {
    return (
      <section className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
        <p className="state state--loading">{t("admin.broadcasts.completeAudience")}</p>
      </section>
    );
  }
  if (isLoading) {
    return (
      <section className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
        <p className="state state--loading">{t("admin.broadcasts.calculating")}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
        <p className="state state--error" role="alert">
          {t("admin.broadcasts.calcError", { message: errorMessage ?? "" })}
        </p>
      </section>
    );
  }
  if (!preview) {
    return (
      <section className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
        <p className="state state--loading">{t("admin.broadcasts.previewUnavailable")}</p>
      </section>
    );
  }

  const slotColumns: Column<SlotCard>[] = [
    {
      key: "when",
      header: t("admin.broadcasts.colWhen"),
      render: (slot) =>
        t("admin.broadcasts.slotWhen", {
          day: weekdayLabel(slot.dayOfWeek),
          date: slot.date,
          start: slot.startTime,
          end: slot.endTime
        })
    },
    { key: "group", header: t("admin.broadcasts.colGroup"), render: (slot) => slot.groupName },
    { key: "level", header: t("admin.broadcasts.colLevel"), render: (slot) => slot.levelName },
    { key: "trainer", header: t("admin.broadcasts.colTrainer"), render: (slot) => slot.trainerName },
    {
      key: "freeSeats",
      header: t("admin.broadcasts.colFreeSeats"),
      numeric: true,
      render: (slot) => slot.freeSeats.toLocaleString("ru-RU")
    },
    {
      key: "price",
      header: t("admin.broadcasts.colPrice"),
      numeric: true,
      render: (slot) => formatRsd(slot.priceSingleRsd)
    }
  ];

  return (
    <section className="stack" aria-label={t("admin.broadcasts.previewLabel")}>
      <div className="metric-strip">
        <StatCard
          label={t("admin.broadcasts.cardRecipients")}
          value={preview.recipientsCount.toLocaleString("ru-RU")}
          hint={t("admin.broadcasts.cardRecipientsHint")}
        />
        <StatCard
          label={t("admin.broadcasts.cardFreeSlots")}
          value={preview.slots.length.toLocaleString("ru-RU")}
        />
        {preview.templateVersion ? (
          <StatCard
            label={t("admin.broadcasts.cardTemplate")}
            value={String(preview.templateVersion)}
            hint={t("admin.broadcasts.cardTemplateHint")}
          />
        ) : null}
      </div>

      <article className="card">
        <span className="card__label">{t("admin.broadcasts.cardMessage")}</span>
        <p className="broadcast-preview__text" style={{ whiteSpace: "pre-wrap" }}>
          {preview.text}
        </p>
      </article>

      <DataTable
        caption={t("admin.broadcasts.slotsCaption")}
        columns={slotColumns}
        rows={preview.slots}
        rowKey={(slot) => slot.trainingId}
        emptyLabel={t("admin.broadcasts.slotsEmpty")}
      />
    </section>
  );
}
