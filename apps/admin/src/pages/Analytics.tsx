import { useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  AcquisitionMetric,
  AnalyticsRangeQuery,
  AnalyticsSummary,
  BroadcastEffectiveness,
  BusinessAnalytics,
  CancellationStats,
  ClientActivity,
  FillRate,
  NoShowStats,
  PopularSlot,
  PopularTraining,
  TrainerLoad
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { StatCard } from "../ui/StatCard";
import { DataTable, type Column } from "../ui/DataTable";
import { DateRangeFilter, type DateRange } from "../ui/DateRangeFilter";
import { useT } from "../i18n/LanguageProvider";
import { useAnalyticsSummary } from "../hooks/useAnalyticsSummary";
import { formatRsd } from "../lib/format";
import {
  useBroadcastEffectiveness,
  useBusinessAnalytics,
  useCancellations,
  useClientActivity,
  useFillRate,
  useNoShows,
  usePopularSlots,
  useTrainerLoad
} from "../hooks/useAnalyticsReports";

type Translate = (key: string, params?: Record<string, string | number>) => string;

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
  const t = useT();
  return (
    <section className="stack" aria-labelledby={`report-${slug(title)}`}>
      <h2 id={`report-${slug(title)}`}>{title}</h2>
      {query.isPending ? (
        <p className="state state--loading">{t("admin.analytics.loading")}</p>
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

function popularColumns(t: Translate): Column<PopularSlot>[] {
  return [
    { key: "day", header: t("admin.analytics.popular.colDay"), render: (row) => t(`admin.day.short.${row.dayOfWeek}`) },
    { key: "time", header: t("admin.analytics.popular.colTime"), render: (row) => row.startTime, numeric: true },
    {
      key: "bookings",
      header: t("admin.analytics.popular.colBookings"),
      render: (row) => formatCount(row.bookingsCount),
      numeric: true
    }
  ];
}

function trainerColumns(t: Translate): Column<TrainerLoad>[] {
  return [
    { key: "name", header: t("admin.analytics.trainerLoad.colTrainer"), render: (row) => row.trainerName },
    {
      key: "sessions",
      header: t("admin.analytics.trainerLoad.colSessions"),
      render: (row) => formatCount(row.sessionsCount),
      numeric: true
    },
    {
      key: "participants",
      header: t("admin.analytics.trainerLoad.colParticipants"),
      render: (row) => formatCount(row.participantsCount),
      numeric: true
    }
  ];
}

function acquisitionColumns(t: Translate): Column<AcquisitionMetric>[] {
  return [
    {
      key: "entry",
      header: t("admin.analytics.acquisition.colEntry"),
      render: (row) => t(`admin.analytics.acquisition.entry.${row.entryPoint}`)
    },
    {
      key: "source",
      header: t("admin.analytics.acquisition.colSource"),
      render: (row) => row.source
    },
    {
      key: "campaign",
      header: t("admin.analytics.acquisition.colCampaign"),
      render: (row) => row.campaign ?? "—"
    },
    {
      key: "launches",
      header: t("admin.analytics.acquisition.colLaunches"),
      render: (row) => formatCount(row.launches),
      numeric: true
    },
    {
      key: "started",
      header: t("admin.analytics.acquisition.colStarted"),
      render: (row) => formatCount(row.startedConversions),
      numeric: true
    },
    {
      key: "successful",
      header: t("admin.analytics.acquisition.colSuccessful"),
      render: (row) => formatCount(row.successfulConversions),
      numeric: true
    },
    {
      key: "conversion",
      header: t("admin.analytics.acquisition.colConversion"),
      render: (row) => formatPercentRatio(row.conversionRate),
      numeric: true
    }
  ];
}

function popularTrainingColumns(t: Translate): Column<PopularTraining>[] {
  return [
    {
      key: "offering",
      header: t("admin.analytics.offerings.colOffering"),
      render: (row) => row.groupName
    },
    {
      key: "level",
      header: t("admin.analytics.offerings.colLevel"),
      render: (row) => row.levelName ?? "—"
    },
    {
      key: "trainer",
      header: t("admin.analytics.offerings.colTrainer"),
      render: (row) => row.trainerName
    },
    {
      key: "sessions",
      header: t("admin.analytics.offerings.colSessions"),
      render: (row) => formatCount(row.sessionsCount),
      numeric: true
    },
    {
      key: "bookings",
      header: t("admin.analytics.offerings.colBookings"),
      render: (row) => formatCount(row.bookingsCount),
      numeric: true
    },
    {
      key: "clients",
      header: t("admin.analytics.offerings.colClients"),
      render: (row) => formatCount(row.uniqueClients),
      numeric: true
    },
    {
      key: "fill",
      header: t("admin.analytics.offerings.colFill"),
      render: (row) => formatPercentRatio(row.fillRate),
      numeric: true
    }
  ];
}

function BusinessOverview({ data }: { data: BusinessAnalytics }): JSX.Element {
  const t = useT();
  return (
    <div className="stack">
      <section className="metric-strip" aria-label={t("admin.analytics.business.moneyLabel")}>
        <StatCard
          label={t("admin.analytics.business.paidTraining")}
          value={formatRsd(data.revenue.paidTrainingRevenueRsd)}
        />
        <StatCard
          label={t("admin.analytics.business.confirmedCourtValue")}
          value={formatRsd(data.revenue.confirmedCourtValueRsd)}
          hint={t("admin.analytics.business.confirmedNotPaid")}
        />
        <StatCard
          label={t("admin.analytics.business.outstandingTraining")}
          value={formatRsd(data.revenue.outstandingTrainingValueRsd)}
        />
        <StatCard
          label={t("admin.analytics.business.avgCourtValue")}
          value={formatRsd(data.revenue.averageConfirmedCourtValueRsd)}
        />
      </section>

      <section className="metric-strip" aria-label={t("admin.analytics.business.demandLabel")}>
        <StatCard
          label={t("admin.analytics.business.trainingBookings")}
          value={formatCount(data.demand.trainingBookings)}
        />
        <StatCard
          label={t("admin.analytics.business.trainingClients")}
          value={formatCount(data.demand.trainingClients)}
        />
        <StatCard
          label={t("admin.analytics.business.returningRate")}
          value={formatPercentRatio(data.demand.returningClientRate)}
          hint={t("admin.analytics.business.returningClients", {
            count: data.demand.returningClients
          })}
        />
        <StatCard
          label={t("admin.analytics.business.newClients")}
          value={formatCount(data.demand.newClients)}
        />
      </section>

      <section className="metric-strip" aria-label={t("admin.analytics.business.courtLabel")}>
        <StatCard
          label={t("admin.analytics.business.courtRequests")}
          value={formatCount(data.court.requestsCount)}
        />
        <StatCard
          label={t("admin.analytics.business.courtConfirmation")}
          value={formatPercentRatio(data.court.confirmationRate)}
          hint={t("admin.analytics.business.confirmedRequests", {
            count: data.court.confirmedRequests
          })}
        />
        <StatCard
          label={t("admin.analytics.business.confirmedCourtHours")}
          value={data.court.confirmedCourtHours.toLocaleString("ru-RU", {
            maximumFractionDigits: 1
          })}
        />
        <StatCard
          label={t("admin.analytics.business.unpricedBookings")}
          value={formatCount(data.revenue.unpricedTrainingBookings)}
          hint={t("admin.analytics.business.pricedBookings", {
            count: data.revenue.pricedTrainingBookings
          })}
        />
      </section>

      <p className="state state--empty">{t("admin.analytics.business.provenance")}</p>
    </div>
  );
}

function SummaryCards({ summary }: { summary: AnalyticsSummary }): JSX.Element {
  const t = useT();
  return (
    <section className="metric-strip" aria-label={t("admin.analytics.summaryLabel")}>
      <StatCard
        label={t("admin.analytics.card.bookings")}
        value={formatCount(summary.totalBookings)}
        hint={`${summary.from} — ${summary.to}`}
      />
      <StatCard
        label={t("admin.analytics.card.fillRate")}
        value={formatPercentRatio(summary.averageFillRate)}
        hint={t("admin.analytics.card.fillRateHint")}
      />
      <StatCard label={t("admin.analytics.card.activeClients")} value={formatCount(summary.activeClients)} />
      <StatCard
        label={t("admin.analytics.card.cancellations")}
        value={formatPercentRatio(summary.cancellationRate)}
        hint={t("admin.analytics.card.cancellationsHint")}
      />
      <StatCard
        label={t("admin.analytics.card.noShows")}
        value={formatPercentRatio(summary.noShowRate)}
        hint={t("admin.analytics.card.noShowsHint")}
      />
      <StatCard
        label={t("admin.analytics.card.fromBroadcasts")}
        value={formatCount(summary.attributedBookings)}
        hint={t("admin.analytics.card.fromBroadcastsHint")}
      />
    </section>
  );
}

function FillRateCards({ data }: { data: FillRate }): JSX.Element {
  const t = useT();
  return (
    <div className="metric-strip">
      <StatCard label={t("admin.analytics.fill.avg")} value={formatPercentRatio(data.averageFillRate)} />
      <StatCard label={t("admin.analytics.fill.trainings")} value={formatCount(data.trainingsCount)} />
      <StatCard label={t("admin.analytics.fill.totalSeats")} value={formatCount(data.totalCapacity)} />
      <StatCard label={t("admin.analytics.fill.booked")} value={formatCount(data.totalBooked)} />
    </div>
  );
}

function CancellationCards({ data }: { data: CancellationStats }): JSX.Element {
  const t = useT();
  return (
    <div className="metric-strip">
      <StatCard label={t("admin.analytics.cancellations.rate")} value={formatPercentRatio(data.cancellationRate)} />
      <StatCard label={t("admin.analytics.cancellations.cancelled")} value={formatCount(data.cancelledCount)} />
      <StatCard label={t("admin.analytics.cancellations.total")} value={formatCount(data.totalBookings)} />
    </div>
  );
}

function NoShowCards({ data }: { data: NoShowStats }): JSX.Element {
  const t = useT();
  return (
    <div className="metric-strip">
      <StatCard label={t("admin.analytics.noShows.rate")} value={formatPercentRatio(data.noShowRate)} />
      <StatCard label={t("admin.analytics.noShows.count")} value={formatCount(data.noShowCount)} />
      <StatCard label={t("admin.analytics.noShows.attended")} value={formatCount(data.attendedCount)} />
      <StatCard
        label={t("admin.analytics.noShows.resolved")}
        value={formatCount(data.resolvedCount)}
        hint={t("admin.analytics.noShows.resolvedHint")}
      />
    </div>
  );
}

function ClientActivityCards({ data }: { data: ClientActivity }): JSX.Element {
  const t = useT();
  return (
    <div className="metric-strip">
      <StatCard label={t("admin.analytics.clientActivity.active")} value={formatCount(data.activeClients)} />
      <StatCard label={t("admin.analytics.clientActivity.booking")} value={formatCount(data.bookingClients)} />
      <StatCard label={t("admin.analytics.clientActivity.total")} value={formatCount(data.totalBookings)} />
    </div>
  );
}

function BroadcastEffectivenessCards({ data }: { data: BroadcastEffectiveness }): JSX.Element {
  const t = useT();
  return (
    <div className="metric-strip">
      <StatCard label={t("admin.analytics.broadcastEff.broadcasts")} value={formatCount(data.broadcastsCount)} />
      <StatCard label={t("admin.analytics.broadcastEff.recipients")} value={formatCount(data.recipientsCount)} />
      <StatCard
        label={t("admin.analytics.broadcastEff.attributed")}
        value={formatCount(data.attributedBookings)}
        hint={t("admin.analytics.broadcastEff.attributedHint", { hours: data.attributionWindowHours })}
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
  const t = useT();
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
  const business = useBusinessAnalytics(range);

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.analytics.title")}</h1>
          <p>{t("admin.analytics.lead")}</p>
        </div>
      </header>

      <section className="workspace" aria-label={t("admin.analytics.rangeLegend")}>
        <div className="workspace__bar">
          <DateRangeFilter value={draft} onChange={setDraft} legend={t("admin.analytics.rangeLegend")} />
        </div>

        <div className="workspace__body stack">
      <section className="stack" aria-labelledby="report-summary">
        <h2 id="report-summary">{t("admin.analytics.summaryHeading")}</h2>
        {summary.isPending ? (
          <p className="state state--loading">{t("admin.analytics.summaryLoading")}</p>
        ) : summary.isError ? (
          <p className="state state--error" role="alert">
            {summary.error?.message ?? t("admin.analytics.summaryError")}
          </p>
        ) : summary.data ? (
          <SummaryCards summary={summary.data} />
        ) : null}
      </section>

      {range === null ? (
        <p className="state state--empty">{t("admin.analytics.pickRange")}</p>
      ) : (
        <>
          <ReportSection
            title={t("admin.analytics.business.title")}
            query={business}
            errorLabel={t("admin.analytics.business.error")}
          >
            {(data) => <BusinessOverview data={data} />}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.acquisition.title")}
            query={business}
            errorLabel={t("admin.analytics.business.error")}
          >
            {(data) => (
              <div className="stack">
                <p className="state state--empty">
                  {t("admin.analytics.acquisition.forwardOnly")}
                </p>
                <DataTable
                  columns={acquisitionColumns(t)}
                  rows={data.acquisition}
                  rowKey={(row) =>
                    `${row.entryPoint}:${row.source}:${row.campaign ?? "none"}`
                  }
                  caption={t("admin.analytics.acquisition.caption")}
                  emptyLabel={t("admin.analytics.acquisition.empty")}
                />
              </div>
            )}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.offerings.title")}
            query={business}
            errorLabel={t("admin.analytics.business.error")}
          >
            {(data) => (
              <DataTable
                columns={popularTrainingColumns(t)}
                rows={data.popularTrainings}
                rowKey={(row) => row.offeringKey}
                caption={t("admin.analytics.offerings.caption")}
                emptyLabel={t("admin.analytics.offerings.empty")}
              />
            )}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.popular.title")}
            query={popular}
            errorLabel={t("admin.analytics.popular.error")}
          >
            {(rows) => (
              <DataTable
                columns={popularColumns(t)}
                rows={rows}
                rowKey={(row) => `${row.dayOfWeek}-${row.startTime}`}
                caption={t("admin.analytics.popular.caption")}
                emptyLabel={t("admin.analytics.popular.empty")}
              />
            )}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.fill.title")}
            query={fillRate}
            errorLabel={t("admin.analytics.fill.error")}
          >
            {(data) => <FillRateCards data={data} />}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.trainerLoad.title")}
            query={trainerLoad}
            errorLabel={t("admin.analytics.trainerLoad.error")}
          >
            {(rows) => (
              <DataTable
                columns={trainerColumns(t)}
                rows={rows}
                rowKey={(row) => row.trainerId}
                caption={t("admin.analytics.trainerLoad.caption")}
                emptyLabel={t("admin.analytics.trainerLoad.empty")}
              />
            )}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.cancellations.title")}
            query={cancellations}
            errorLabel={t("admin.analytics.cancellations.error")}
          >
            {(data) => <CancellationCards data={data} />}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.noShows.title")}
            query={noShows}
            errorLabel={t("admin.analytics.noShows.error")}
          >
            {(data) => <NoShowCards data={data} />}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.clientActivity.title")}
            query={clientActivity}
            errorLabel={t("admin.analytics.clientActivity.error")}
          >
            {(data) => <ClientActivityCards data={data} />}
          </ReportSection>

          <ReportSection
            title={t("admin.analytics.broadcastEff.title")}
            query={broadcastEffectiveness}
            errorLabel={t("admin.analytics.broadcastEff.error")}
          >
            {(data) => <BroadcastEffectivenessCards data={data} />}
          </ReportSection>
        </>
      )}
        </div>
      </section>
    </AppShell>
  );
}
