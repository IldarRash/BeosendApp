import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnalyticsSummary } from "@beosand/types";

vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>
}));

vi.mock("../i18n/LanguageProvider", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params?.service ? `${key}: ${params.service}` : key
}));

let summaryState: {
  isLoading: boolean;
  isError: boolean;
  data?: AnalyticsSummary;
};

let healthState: {
  isLoading: boolean;
  data?: { service: string };
};

vi.mock("../hooks/useAnalyticsSummary", () => ({
  useAnalyticsSummary: () => summaryState
}));

vi.mock("../hooks/useHealth", () => ({
  useHealth: () => healthState
}));

import { Dashboard } from "./Dashboard";

const summary: AnalyticsSummary = {
  from: "2026-05-04",
  to: "2026-06-03",
  totalBookings: 120,
  averageFillRate: 0.75,
  cancellationRate: 0.1,
  noShowRate: 0.05,
  activeClients: 34,
  topSlot: { dayOfWeek: 3, startTime: "18:00", bookingsCount: 22 },
  attributedBookings: 9
};

beforeEach(() => {
  summaryState = { isLoading: false, isError: false, data: summary };
  healthState = { isLoading: false, data: { service: "api" } };
});

afterEach(cleanup);

describe("Dashboard", () => {
  it("renders server-provided overview figures as display values", () => {
    render(<Dashboard />);

    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByText("admin.dashboard.apiOk: api")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
    expect(screen.getByText("18:00")).toBeTruthy();
  });

  it("renders loading and error states without local fallback data", () => {
    summaryState = { isLoading: true, isError: false };
    healthState = { isLoading: true };
    const { rerender } = render(<Dashboard />);

    expect(screen.getByText("admin.dashboard.loading")).toBeTruthy();
    expect(screen.getByText("admin.dashboard.apiChecking")).toBeTruthy();

    summaryState = { isLoading: false, isError: true };
    healthState = { isLoading: false };
    rerender(<Dashboard />);

    expect(screen.getByRole("alert").textContent).toBe("admin.dashboard.error");
    expect(screen.getByText("admin.dashboard.apiDown")).toBeTruthy();
  });
});
