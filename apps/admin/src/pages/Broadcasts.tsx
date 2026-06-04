import { useMemo, useState } from "react";
import type {
  BroadcastAudience,
  BroadcastPreview,
  BroadcastType,
  DayOfWeek,
  SlotCard
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { SelectField, NumberField } from "../ui/Field";
import { StatCard } from "../ui/StatCard";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useLevels } from "../hooks/useLevels";
import { useBroadcastPreview, useSendBroadcast } from "../hooks/useBroadcasts";
import { formatRsd } from "../lib/format";

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

/**
 * Build the API audience union from the picker selection. Returns `null` while the
 * selection is incomplete (a "level"/"active"/"lapsed" kind without its extra
 * value) so the preview stays gated until a valid segment exists. The browser does
 * no segmentation math — it only assembles the chosen segment descriptor.
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

/**
 * M4 — Рассылки: compose a free-slot broadcast, preview the API-decided recipient
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

  const audience = useMemo(
    () => buildAudience(audienceKind, levelId, days),
    [audienceKind, levelId, days]
  );

  const preview = useBroadcastPreview(type, audience);
  const send = useSendBroadcast();

  const hasPreview = preview.data !== undefined;

  const typeOptions = useMemo(
    () => (Object.keys(TYPE_KEY) as BroadcastType[]).map((value) => ({ value, label: t(TYPE_KEY[value]) })),
    [t]
  );
  const audienceOptions = useMemo(
    () => (Object.keys(AUDIENCE_KEY) as AudienceKind[]).map((value) => ({ value, label: t(AUDIENCE_KEY[value]) })),
    [t]
  );

  function handleSend(): void {
    send.mutate(
      { type, audience: audience ?? undefined },
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

      <div className="stack">
        <form className="form" aria-label={t("admin.broadcasts.paramsLabel")}>
          <SelectField
            label={t("admin.broadcasts.fieldType")}
            value={type}
            onChange={(event) => setType(event.target.value as BroadcastType)}
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

        <BroadcastPreviewPanel
          isLoading={preview.isLoading}
          isError={preview.isError}
          errorMessage={preview.error?.message}
          incompleteAudience={audience === null}
          preview={preview.data}
        />

        <div className="cluster">
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!hasPreview || send.isPending}
            aria-disabled={!hasPreview || send.isPending}
          >
            {send.isPending ? t("admin.broadcasts.sending") : t("admin.broadcasts.send")}
          </Button>
          {!hasPreview ? (
            <span className="field__hint">{t("admin.broadcasts.previewFirst")}</span>
          ) : null}
        </div>
      </div>
    </AppShell>
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
 * here — every figure comes from {@link BroadcastPreview}.
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
      <div className="grid">
        <StatCard
          label={t("admin.broadcasts.cardRecipients")}
          value={preview.recipientsCount.toLocaleString("ru-RU")}
          hint={t("admin.broadcasts.cardRecipientsHint")}
        />
        <StatCard
          label={t("admin.broadcasts.cardFreeSlots")}
          value={preview.slots.length.toLocaleString("ru-RU")}
        />
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
