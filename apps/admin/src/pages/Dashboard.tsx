import type { AnalyticsSummary } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { StatCard } from "../ui/StatCard";
import { useT } from "../i18n/LanguageProvider";
import { useAnalyticsSummary } from "../hooks/useAnalyticsSummary";
import { useHealth } from "../hooks/useHealth";

function HealthBadge(): JSX.Element {
  const t = useT();
  const health = useHealth();
  if (health.isLoading) {
    return (
      <span className="health">
        <span className="dot" /> {t("admin.dashboard.apiChecking")}
      </span>
    );
  }
  if (health.data) {
    return (
      <span className="health">
        <span className="dot dot--ok" /> {t("admin.dashboard.apiOk", { service: health.data.service })}
      </span>
    );
  }
  return (
    <span className="health">
      <span className="dot dot--down" /> {t("admin.dashboard.apiDown")}
    </span>
  );
}

/** Format a server-decided 0..1 ratio as a percentage. No domain math — pure display. */
function formatPercentRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function SummaryCards({ summary }: { summary: AnalyticsSummary }): JSX.Element {
  const t = useT();
  return (
    <section className="grid">
      <StatCard
        label={t("admin.dashboard.card.bookings")}
        value={summary.totalBookings.toLocaleString("ru-RU")}
        hint={`${summary.from} — ${summary.to}`}
      />
      <StatCard
        label={t("admin.dashboard.card.fillRate")}
        value={formatPercentRatio(summary.averageFillRate)}
        hint={t("admin.dashboard.card.fillRateHint")}
      />
      <StatCard
        label={t("admin.dashboard.card.activeClients")}
        value={summary.activeClients.toLocaleString("ru-RU")}
      />
      <StatCard
        label={t("admin.dashboard.card.cancellations")}
        value={formatPercentRatio(summary.cancellationRate)}
        hint={t("admin.dashboard.card.cancellationsHint")}
      />
      <StatCard
        label={t("admin.dashboard.card.noShows")}
        value={formatPercentRatio(summary.noShowRate)}
        hint={t("admin.dashboard.card.noShowsHint")}
      />
      <StatCard
        label={t("admin.dashboard.card.topSlot")}
        value={summary.topSlot ? `${summary.topSlot.startTime}` : "—"}
        hint={
          summary.topSlot
            ? t("admin.dashboard.card.topSlotHint", { count: summary.topSlot.bookingsCount })
            : t("admin.dashboard.card.topSlotEmpty")
        }
      />
    </section>
  );
}

export function Dashboard(): JSX.Element {
  const t = useT();
  const summary = useAnalyticsSummary();

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.dashboard.title")}</h1>
          <p>{t("admin.dashboard.lead")}</p>
        </div>
        <HealthBadge />
      </header>

      {summary.isLoading ? (
        <p className="state state--loading">{t("admin.dashboard.loading")}</p>
      ) : summary.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.dashboard.error")}
        </p>
      ) : summary.data ? (
        <SummaryCards summary={summary.data} />
      ) : null}
    </AppShell>
  );
}
