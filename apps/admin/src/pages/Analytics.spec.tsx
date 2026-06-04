import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  AnalyticsRangeQuery,
  AnalyticsSummary,
  BroadcastEffectiveness,
  CancellationStats,
  ClientActivity,
  FillRate,
  NoShowStats,
  PopularSlot,
  TrainerLoad
} from "@beosand/types";

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// The summary + per-report hooks are mocked so the page is unit-tested without the
// ApiClient/network. We capture the range each report hook receives to assert the
// date filter drives the queries.
const useAnalyticsSummary = vi.fn();
vi.mock("../hooks/useAnalyticsSummary", () => ({
  useAnalyticsSummary: () => useAnalyticsSummary()
}));

const usePopularSlots = vi.fn();
const useFillRate = vi.fn();
const useTrainerLoad = vi.fn();
const useCancellations = vi.fn();
const useNoShows = vi.fn();
const useClientActivity = vi.fn();
const useBroadcastEffectiveness = vi.fn();
vi.mock("../hooks/useAnalyticsReports", () => ({
  usePopularSlots: (range: AnalyticsRangeQuery | null) => usePopularSlots(range),
  useFillRate: (range: AnalyticsRangeQuery | null) => useFillRate(range),
  useTrainerLoad: (range: AnalyticsRangeQuery | null) => useTrainerLoad(range),
  useCancellations: (range: AnalyticsRangeQuery | null) => useCancellations(range),
  useNoShows: (range: AnalyticsRangeQuery | null) => useNoShows(range),
  useClientActivity: (range: AnalyticsRangeQuery | null) => useClientActivity(range),
  useBroadcastEffectiveness: (range: AnalyticsRangeQuery | null) =>
    useBroadcastEffectiveness(range)
}));

import { Analytics } from "./Analytics";

const SUMMARY: AnalyticsSummary = {
  from: "2026-05-01",
  to: "2026-05-31",
  totalBookings: 120,
  averageFillRate: 0.75,
  cancellationRate: 0.1,
  noShowRate: 0.05,
  activeClients: 42,
  topSlot: { dayOfWeek: 1, startTime: "18:00", bookingsCount: 30 },
  attributedBookings: 9
};

const POPULAR: PopularSlot[] = [
  { dayOfWeek: 1, startTime: "18:00", bookingsCount: 30 },
  { dayOfWeek: 3, startTime: "19:00", bookingsCount: 21 }
];

const FILL_RATE: FillRate = {
  trainingsCount: 12,
  totalCapacity: 144,
  totalBooked: 108,
  averageFillRate: 0.75
};

const TRAINER_LOAD: TrainerLoad[] = [
  {
    trainerId: "11111111-1111-1111-1111-111111111111",
    trainerName: "Иван",
    sessionsCount: 8,
    participantsCount: 64
  }
];

const CANCELLATIONS: CancellationStats = {
  totalBookings: 120,
  cancelledCount: 12,
  cancellationRate: 0.1
};

const NO_SHOWS: NoShowStats = {
  resolvedCount: 100,
  attendedCount: 95,
  noShowCount: 5,
  noShowRate: 0.05
};

const CLIENT_ACTIVITY: ClientActivity = {
  activeClients: 42,
  bookingClients: 38,
  totalBookings: 120
};

const BROADCAST_EFFECTIVENESS: BroadcastEffectiveness = {
  broadcastsCount: 4,
  recipientsCount: 200,
  attributedBookings: 9,
  attributionWindowHours: 24
};

function ok<T>(data: T) {
  return { isPending: false, isError: false, error: null, data };
}

function setHappyPath(): void {
  useAnalyticsSummary.mockReturnValue(ok(SUMMARY));
  usePopularSlots.mockReturnValue(ok(POPULAR));
  useFillRate.mockReturnValue(ok(FILL_RATE));
  useTrainerLoad.mockReturnValue(ok(TRAINER_LOAD));
  useCancellations.mockReturnValue(ok(CANCELLATIONS));
  useNoShows.mockReturnValue(ok(NO_SHOWS));
  useClientActivity.mockReturnValue(ok(CLIENT_ACTIVITY));
  useBroadcastEffectiveness.mockReturnValue(ok(BROADCAST_EFFECTIVENESS));
}

/** Drive the two date inputs so the page resolves a complete range. */
function pickRange(from: string, to: string): void {
  fireEvent.change(screen.getByLabelText("С"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("По"), { target: { value: to } });
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyPath();
});

afterEach(cleanup);

describe("Analytics page", () => {
  it("gates report hooks on a complete range and re-queries when the range changes", () => {
    render(<Analytics />);

    // Before any date is set, each report hook is called with a null range (no fetch)
    // and the page prompts for a period instead of rendering report sections.
    expect(usePopularSlots).toHaveBeenLastCalledWith(null);
    expect(useFillRate).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Выберите период (обе даты), чтобы построить отчёты.")).toBeTruthy();

    // Setting both bounds resolves the range and feeds every report hook.
    pickRange("2026-05-01", "2026-05-31");
    const expected: AnalyticsRangeQuery = { from: "2026-05-01", to: "2026-05-31" };
    expect(usePopularSlots).toHaveBeenLastCalledWith(expected);
    expect(useFillRate).toHaveBeenLastCalledWith(expected);
    expect(useTrainerLoad).toHaveBeenLastCalledWith(expected);
    expect(useBroadcastEffectiveness).toHaveBeenLastCalledWith(expected);

    // Changing the range re-queries with the new bounds.
    pickRange("2026-04-01", "2026-04-30");
    expect(usePopularSlots).toHaveBeenLastCalledWith({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("renders a tabular report's rows from the API (no client aggregation)", () => {
    render(<Analytics />);
    pickRange("2026-05-01", "2026-05-31");

    const table = screen.getByRole("table", {
      name: "Популярные слоты по числу бронирований"
    });
    // Header cells from the columns, scoped for screen readers.
    expect(within(table).getByRole("columnheader", { name: "День" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Бронирований" })).toBeTruthy();
    // A row rendered straight from the contract: Monday slot, 30 bookings.
    expect(within(table).getByText("Пн")).toBeTruthy();
    expect(within(table).getByText("18:00")).toBeTruthy();
    expect(within(table).getByText("30")).toBeTruthy();
  });

  it("renders the trainer-load table and the headline summary cards", () => {
    render(<Analytics />);
    pickRange("2026-05-01", "2026-05-31");

    const trainers = screen.getByRole("table", {
      name: "Нагрузка тренеров: тренировки и участники"
    });
    expect(within(trainers).getByText("Иван")).toBeTruthy();
    expect(within(trainers).getByText("64")).toBeTruthy();

    // Summary renders even before a range is chosen (its own 30-day endpoint).
    const summary = screen.getByRole("region", { name: "Сводка за период" });
    // 0..1 ratios shown as percentages; counts grouped.
    expect(within(summary).getByText("75%")).toBeTruthy();
    expect(within(summary).getByText("120")).toBeTruthy();
  });

  it("shows one report's own error without blanking the other reports", () => {
    useTrainerLoad.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("Доступ запрещён."),
      data: undefined
    });
    render(<Analytics />);
    pickRange("2026-05-01", "2026-05-31");

    // The failing trainer-load section surfaces its own error…
    expect(screen.getByRole("alert").textContent).toContain("Доступ запрещён.");
    // …while a sibling report (popular slots) still renders its table.
    expect(
      screen.getByRole("table", { name: "Популярные слоты по числу бронирований" })
    ).toBeTruthy();
  });

  it("shows a per-section loading state while a report is pending", () => {
    useFillRate.mockReturnValue({
      isPending: true,
      isError: false,
      error: null,
      data: undefined
    });
    render(<Analytics />);
    pickRange("2026-05-01", "2026-05-31");

    expect(screen.getAllByText("Загрузка…").length).toBeGreaterThan(0);
    // Other sections are unaffected.
    expect(screen.getByText("Иван")).toBeTruthy();
  });
});
