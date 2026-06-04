import type { AnalyticsSummary } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { StatCard } from "../ui/StatCard";
import { useAnalyticsSummary } from "../hooks/useAnalyticsSummary";
import { useHealth } from "../hooks/useHealth";

function HealthBadge(): JSX.Element {
  const health = useHealth();
  if (health.isLoading) {
    return (
      <span className="health">
        <span className="dot" /> API: проверка…
      </span>
    );
  }
  if (health.data) {
    return (
      <span className="health">
        <span className="dot dot--ok" /> API: ok · {health.data.service}
      </span>
    );
  }
  return (
    <span className="health">
      <span className="dot dot--down" /> API: недоступен
    </span>
  );
}

/** Format a server-decided 0..1 ratio as a percentage. No domain math — pure display. */
function formatPercentRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function SummaryCards({ summary }: { summary: AnalyticsSummary }): JSX.Element {
  return (
    <section className="grid">
      <StatCard
        label="Бронирований"
        value={summary.totalBookings.toLocaleString("ru-RU")}
        hint={`${summary.from} — ${summary.to}`}
      />
      <StatCard label="Заполненность" value={formatPercentRatio(summary.averageFillRate)} hint="в среднем" />
      <StatCard label="Активные клиенты" value={summary.activeClients.toLocaleString("ru-RU")} />
      <StatCard label="Отмены" value={formatPercentRatio(summary.cancellationRate)} hint="доля" />
      <StatCard label="Неявки" value={formatPercentRatio(summary.noShowRate)} hint="доля" />
      <StatCard
        label="Топ-слот"
        value={summary.topSlot ? `${summary.topSlot.startTime}` : "—"}
        hint={summary.topSlot ? `${summary.topSlot.bookingsCount} брон.` : "нет данных"}
      />
    </section>
  );
}

export function Dashboard(): JSX.Element {
  const summary = useAnalyticsSummary();

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Сводка за последние 30 дней. Все цифры считаются на сервере; консоль их только показывает.</p>
        </div>
        <HealthBadge />
      </header>

      {summary.isLoading ? (
        <p className="state state--loading">Загрузка сводки…</p>
      ) : summary.isError ? (
        <p className="state state--error" role="alert">
          Не удалось загрузить сводку.
        </p>
      ) : summary.data ? (
        <SummaryCards summary={summary.data} />
      ) : null}
    </AppShell>
  );
}
