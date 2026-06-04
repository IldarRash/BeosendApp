import { useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  AnalyticsRangeQuery,
  AnalyticsSummary,
  BroadcastEffectiveness,
  CancellationStats,
  ClientActivity,
  DayOfWeek,
  FillRate,
  NoShowStats,
  PopularSlot,
  TrainerLoad
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { StatCard } from "../ui/StatCard";
import { DataTable, type Column } from "../ui/DataTable";
import { DateRangeFilter, type DateRange } from "../ui/DateRangeFilter";
import { useAnalyticsSummary } from "../hooks/useAnalyticsSummary";
import {
  useBroadcastEffectiveness,
  useCancellations,
  useClientActivity,
  useFillRate,
  useNoShows,
  usePopularSlots,
  useTrainerLoad
} from "../hooks/useAnalyticsReports";

/** Short RU weekday labels, ISO order (1 = Mon … 7 = Sun). Display only. */
const DAY_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

/** Format a server-decided 0..1 ratio as a percentage. No domain math — pure display. */
function formatPercentRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** A whole integer with RU grouping. Display only. */
function formatCount(value: number): string {
  return value.toLocaleString("ru-RU");
}

/**
 * A report section wrapper. Owns its own loading / error / empty rendering so a
 * single failing report never blanks the rest of the dashboard. The body is only
 * rendered once the query has resolved with data.
 */
function ReportSection<Data>({
  title,
  query,
  errorLabel,
  children
}: {
  title: string;
  query: Pick<UseQueryResult<Data, Error>, "isPending" | "isError" | "error" | "data">;
  errorLabel: string;
  children: (data: Data) => JSX.Element;
}): JSX.Element {
  return (
    <section className="stack" aria-labelledby={`report-${slug(title)}`}>
      <h2 id={`report-${slug(title)}`}>{title}</h2>
      {query.isPending ? (
        <p className="state state--loading">Загрузка…</p>
      ) : query.isError ? (
        <p className="state state--error" role="alert">
          {query.error?.message ?? errorLabel}
        </p>
      ) : query.data !== undefined ? (
        children(query.data)
      ) : null}
    </section>
  );
}

/** Stable, ASCII-safe id fragment from a Russian heading. */
function slug(title: string): string {
  return encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"));
}

const POPULAR_COLUMNS: Column<PopularSlot>[] = [
  { key: "day", header: "День", render: (row) => DAY_LABELS[row.dayOfWeek] },
  { key: "time", header: "Время", render: (row) => row.startTime, numeric: true },
  {
    key: "bookings",
    header: "Бронирований",
    render: (row) => formatCount(row.bookingsCount),
    numeric: true
  }
];

const TRAINER_COLUMNS: Column<TrainerLoad>[] = [
  { key: "name", header: "Тренер", render: (row) => row.trainerName },
  {
    key: "sessions",
    header: "Тренировок",
    render: (row) => formatCount(row.sessionsCount),
    numeric: true
  },
  {
    key: "participants",
    header: "Участников",
    render: (row) => formatCount(row.participantsCount),
    numeric: true
  }
];

function SummaryCards({ summary }: { summary: AnalyticsSummary }): JSX.Element {
  return (
    <section className="grid" aria-label="Сводка за период">
      <StatCard
        label="Бронирований"
        value={formatCount(summary.totalBookings)}
        hint={`${summary.from} — ${summary.to}`}
      />
      <StatCard
        label="Заполненность"
        value={formatPercentRatio(summary.averageFillRate)}
        hint="в среднем"
      />
      <StatCard label="Активные клиенты" value={formatCount(summary.activeClients)} />
      <StatCard label="Отмены" value={formatPercentRatio(summary.cancellationRate)} hint="доля" />
      <StatCard label="Неявки" value={formatPercentRatio(summary.noShowRate)} hint="доля" />
      <StatCard
        label="От рассылок"
        value={formatCount(summary.attributedBookings)}
        hint="бронирований"
      />
    </section>
  );
}

function FillRateCards({ data }: { data: FillRate }): JSX.Element {
  return (
    <div className="grid">
      <StatCard label="Средняя заполненность" value={formatPercentRatio(data.averageFillRate)} />
      <StatCard label="Тренировок" value={formatCount(data.trainingsCount)} />
      <StatCard label="Мест всего" value={formatCount(data.totalCapacity)} />
      <StatCard label="Забронировано" value={formatCount(data.totalBooked)} />
    </div>
  );
}

function CancellationCards({ data }: { data: CancellationStats }): JSX.Element {
  return (
    <div className="grid">
      <StatCard label="Доля отмен" value={formatPercentRatio(data.cancellationRate)} />
      <StatCard label="Отменено" value={formatCount(data.cancelledCount)} />
      <StatCard label="Бронирований всего" value={formatCount(data.totalBookings)} />
    </div>
  );
}

function NoShowCards({ data }: { data: NoShowStats }): JSX.Element {
  return (
    <div className="grid">
      <StatCard label="Доля неявок" value={formatPercentRatio(data.noShowRate)} />
      <StatCard label="Неявки" value={formatCount(data.noShowCount)} />
      <StatCard label="Пришли" value={formatCount(data.attendedCount)} />
      <StatCard label="Отмечено" value={formatCount(data.resolvedCount)} hint="всего" />
    </div>
  );
}

function ClientActivityCards({ data }: { data: ClientActivity }): JSX.Element {
  return (
    <div className="grid">
      <StatCard label="Активные клиенты" value={formatCount(data.activeClients)} />
      <StatCard label="Бронировали" value={formatCount(data.bookingClients)} />
      <StatCard label="Бронирований всего" value={formatCount(data.totalBookings)} />
    </div>
  );
}

function BroadcastEffectivenessCards({ data }: { data: BroadcastEffectiveness }): JSX.Element {
  return (
    <div className="grid">
      <StatCard label="Рассылок" value={formatCount(data.broadcastsCount)} />
      <StatCard label="Получателей" value={formatCount(data.recipientsCount)} />
      <StatCard
        label="Привлечено бронирований"
        value={formatCount(data.attributedBookings)}
        hint={`окно ${data.attributionWindowHours} ч`}
      />
    </div>
  );
}

/**
 * M4 — Аналитика. A read-only reports dashboard: a date-range filter at the top
 * feeds every report hook. Each section owns its loading/error/empty state so one
 * failing report doesn't blank the page. Every figure is server-computed and
 * contract-validated in the ApiClient; the browser does no aggregation, attribution,
 * or money math (rates are server 0..1 ratios shown as percentages here).
 */
export function Analytics(): JSX.Element {
  const [draft, setDraft] = useState<DateRange>({ from: "", to: "" });

  // Both bounds must be set before any report query fires — the strict server
  // endpoints require a complete {from,to}. A complete draft is the resolved range.
  const range = useMemo<AnalyticsRangeQuery | null>(
    () => (draft.from && draft.to ? { from: draft.from, to: draft.to } : null),
    [draft.from, draft.to]
  );

  const summary = useAnalyticsSummary();
  const popular = usePopularSlots(range);
  const fillRate = useFillRate(range);
  const trainerLoad = useTrainerLoad(range);
  const cancellations = useCancellations(range);
  const noShows = useNoShows(range);
  const clientActivity = useClientActivity(range);
  const broadcastEffectiveness = useBroadcastEffectiveness(range);

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Аналитика</h1>
          <p>
            Отчёты по тренировкам, посещаемости и рассылкам за выбранный период. Все цифры считаются
            на сервере; консоль их только показывает.
          </p>
        </div>
      </header>

      <DateRangeFilter value={draft} onChange={setDraft} legend="Период отчёта" />

      <section className="stack" aria-labelledby="report-summary">
        <h2 id="report-summary">Сводка (30 дней)</h2>
        {summary.isPending ? (
          <p className="state state--loading">Загрузка сводки…</p>
        ) : summary.isError ? (
          <p className="state state--error" role="alert">
            {summary.error?.message ?? "Не удалось загрузить сводку."}
          </p>
        ) : summary.data ? (
          <SummaryCards summary={summary.data} />
        ) : null}
      </section>

      {range === null ? (
        <p className="state state--empty">
          Выберите период (обе даты), чтобы построить отчёты.
        </p>
      ) : (
        <>
          <ReportSection
            title="Популярные слоты"
            query={popular}
            errorLabel="Не удалось загрузить популярные слоты."
          >
            {(rows) => (
              <DataTable
                columns={POPULAR_COLUMNS}
                rows={rows}
                rowKey={(row) => `${row.dayOfWeek}-${row.startTime}`}
                caption="Популярные слоты по числу бронирований"
                emptyLabel="За период нет бронирований."
              />
            )}
          </ReportSection>

          <ReportSection
            title="Заполняемость"
            query={fillRate}
            errorLabel="Не удалось загрузить заполняемость."
          >
            {(data) => <FillRateCards data={data} />}
          </ReportSection>

          <ReportSection
            title="Нагрузка тренеров"
            query={trainerLoad}
            errorLabel="Не удалось загрузить нагрузку тренеров."
          >
            {(rows) => (
              <DataTable
                columns={TRAINER_COLUMNS}
                rows={rows}
                rowKey={(row) => row.trainerId}
                caption="Нагрузка тренеров: тренировки и участники"
                emptyLabel="За период нет тренировок."
              />
            )}
          </ReportSection>

          <ReportSection
            title="Отмены"
            query={cancellations}
            errorLabel="Не удалось загрузить отмены."
          >
            {(data) => <CancellationCards data={data} />}
          </ReportSection>

          <ReportSection title="Неявки" query={noShows} errorLabel="Не удалось загрузить неявки.">
            {(data) => <NoShowCards data={data} />}
          </ReportSection>

          <ReportSection
            title="Активность клиентов"
            query={clientActivity}
            errorLabel="Не удалось загрузить активность клиентов."
          >
            {(data) => <ClientActivityCards data={data} />}
          </ReportSection>

          <ReportSection
            title="Эффективность рассылок"
            query={broadcastEffectiveness}
            errorLabel="Не удалось загрузить эффективность рассылок."
          >
            {(data) => <BroadcastEffectivenessCards data={data} />}
          </ReportSection>
        </>
      )}
    </AppShell>
  );
}
