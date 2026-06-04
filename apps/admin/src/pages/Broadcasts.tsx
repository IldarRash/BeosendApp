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
import { useLevels } from "../hooks/useLevels";
import { useBroadcastPreview, useSendBroadcast } from "../hooks/useBroadcasts";
import { formatRsd } from "../lib/format";

/** Localized broadcast-type labels. The server owns the composed message text. */
const TYPE_LABEL: Record<BroadcastType, string> = {
  today: "Сегодня",
  tomorrow: "Завтра",
  week: "На неделю",
  "freed-up": "Освободившиеся места"
};

const TYPE_OPTIONS: { value: BroadcastType; label: string }[] = [
  { value: "today", label: TYPE_LABEL.today },
  { value: "tomorrow", label: TYPE_LABEL.tomorrow },
  { value: "week", label: TYPE_LABEL.week },
  { value: "freed-up", label: TYPE_LABEL["freed-up"] }
];

/** The audience selector kinds, kept separate from the API union so the screen can
 * hold a partial selection (e.g. "level" chosen before a level is picked). */
type AudienceKind = BroadcastAudience["kind"];

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: "all", label: "Все активные клиенты" },
  { value: "level", label: "По уровню" },
  { value: "active", label: "Активные за N дней" },
  { value: "lapsed", label: "Неактивные за N дней" }
];

/** Russian short weekday labels for a server-decided dayOfWeek (1=Mon … 7=Sun). */
const WEEKDAY_LABEL: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
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

  function handleSend(): void {
    send.mutate(
      { type, audience: audience ?? undefined },
      {
        onSuccess: (broadcast) => {
          toast.notify(
            `Рассылка отправлена · охват ${broadcast.recipientsCount.toLocaleString("ru-RU")}`,
            "success"
          );
        },
        onError: (error) => {
          toast.notify(`Не удалось отправить: ${error.message}`, "error");
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
          <h1>Рассылки</h1>
          <p>Подготовьте рассылку о свободных слотах, проверьте охват и отправьте.</p>
        </div>
      </header>

      <div className="stack">
        <form className="form" aria-label="Параметры рассылки">
          <SelectField
            label="Тип рассылки"
            value={type}
            onChange={(event) => setType(event.target.value as BroadcastType)}
            options={TYPE_OPTIONS}
            hint="Сервер составляет текст сообщения по выбранному типу."
          />

          <SelectField
            label="Аудитория"
            value={audienceKind}
            onChange={(event) => {
              setAudienceKind(event.target.value as AudienceKind);
            }}
            options={AUDIENCE_OPTIONS}
            aria-controls="audience-detail"
          />

          <div id="audience-detail">
            {audienceKind === "level" ? (
              levels.isLoading ? (
                <p className="state state--loading">Загрузка уровней…</p>
              ) : levels.isError ? (
                <p className="state state--error" role="alert">
                  Не удалось загрузить уровни: {levels.error.message}
                </p>
              ) : (
                <SelectField
                  label="Уровень"
                  value={levelId}
                  onChange={(event) => setLevelId(event.target.value)}
                  options={[{ value: "", label: "Выберите уровень" }, ...levelOptions]}
                  hint="Рассылка дойдёт только до активных клиентов этого уровня."
                />
              )
            ) : null}

            {audienceKind === "active" || audienceKind === "lapsed" ? (
              <NumberField
                label="Период, дней"
                value={days}
                onValueChange={setDays}
                min={1}
                max={365}
                hint={
                  audienceKind === "active"
                    ? "Клиенты с бронированием за последние N дней."
                    : "Клиенты без бронирования за последние N дней."
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
            {send.isPending ? "Отправка…" : "Отправить"}
          </Button>
          {!hasPreview ? (
            <span className="field__hint">Сначала проверьте охват и текст рассылки.</span>
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
  if (incompleteAudience) {
    return (
      <section className="stack" aria-label="Предпросмотр рассылки">
        <p className="state state--loading">Завершите выбор аудитории, чтобы увидеть охват.</p>
      </section>
    );
  }
  if (isLoading) {
    return (
      <section className="stack" aria-label="Предпросмотр рассылки">
        <p className="state state--loading">Расчёт охвата…</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="stack" aria-label="Предпросмотр рассылки">
        <p className="state state--error" role="alert">
          Не удалось рассчитать охват: {errorMessage}
        </p>
      </section>
    );
  }
  if (!preview) {
    return (
      <section className="stack" aria-label="Предпросмотр рассылки">
        <p className="state state--loading">Предпросмотр недоступен.</p>
      </section>
    );
  }

  const slotColumns: Column<SlotCard>[] = [
    {
      key: "when",
      header: "Когда",
      render: (slot) => `${WEEKDAY_LABEL[slot.dayOfWeek]} ${slot.date}, ${slot.startTime}–${slot.endTime}`
    },
    { key: "level", header: "Уровень", render: (slot) => slot.levelName },
    { key: "trainer", header: "Тренер", render: (slot) => slot.trainerName },
    {
      key: "freeSeats",
      header: "Свободно",
      numeric: true,
      render: (slot) => slot.freeSeats.toLocaleString("ru-RU")
    },
    {
      key: "price",
      header: "Цена",
      numeric: true,
      render: (slot) => formatRsd(slot.priceSingleRsd)
    }
  ];

  return (
    <section className="stack" aria-label="Предпросмотр рассылки">
      <div className="grid">
        <StatCard
          label="Получатели"
          value={preview.recipientsCount.toLocaleString("ru-RU")}
          hint="по данным сервера"
        />
        <StatCard label="Свободных слотов" value={preview.slots.length.toLocaleString("ru-RU")} />
      </div>

      <article className="card">
        <span className="card__label">Текст сообщения</span>
        <p className="broadcast-preview__text" style={{ whiteSpace: "pre-wrap" }}>
          {preview.text}
        </p>
      </article>

      <DataTable
        caption="Слоты в рассылке"
        columns={slotColumns}
        rows={preview.slots}
        rowKey={(slot) => slot.trainingId}
        emptyLabel="В рассылке нет слотов для показа."
      />
    </section>
  );
}
