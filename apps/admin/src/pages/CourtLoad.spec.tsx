import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CourtLoadGrid } from "@beosand/types";

// The data hook is mocked so the page is unit-tested without the ApiClient/network.
const useCourtLoad = vi.fn();
vi.mock("../hooks/useCourtLoad", () => ({
  useCourtLoad: (...args: unknown[]) => useCourtLoad(...args)
}));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { CourtLoad } from "./CourtLoad";

const GRID: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 10,
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: [
        { hour: 8, startTime: "08:00", state: "free" },
        { hour: 9, startTime: "09:00", state: "request" }
      ]
    },
    {
      courtId: "22222222-2222-2222-2222-222222222222",
      courtNumber: 2,
      cells: [
        { hour: 8, startTime: "08:00", state: "block" },
        { hour: 9, startTime: "09:00", state: "free" }
      ]
    }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  useCourtLoad.mockReturnValue({ isPending: false, isError: false, error: null, data: GRID });
});

afterEach(cleanup);

describe("CourtLoad page", () => {
  it("renders a court row per grid row with hour column headers from the API", () => {
    render(<CourtLoad />);

    const table = screen.getByRole("table", { name: "Загрузка кортов на 2026-06-10" });
    // Hour headers come straight from the contract cells — no client-side hour math.
    expect(within(table).getByRole("columnheader", { name: "08:00" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "09:00" })).toBeTruthy();
    // One row header per court, by number.
    expect(within(table).getByRole("rowheader", { name: "№ 1" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "№ 2" })).toBeTruthy();
  });

  it("tints each cell by the API's state and names the state for screen readers", () => {
    render(<CourtLoad />);

    const free = screen.getByLabelText("Корт 1, 08:00 — Свободно");
    expect(free.className).toContain("load-cell--free");

    const request = screen.getByLabelText("Корт 1, 09:00 — Заявка");
    expect(request.className).toContain("load-cell--request");

    const block = screen.getByLabelText("Корт 2, 08:00 — Блокировка");
    expect(block.className).toContain("load-cell--block");
  });

  it("shows a loading state while the grid query is pending", () => {
    useCourtLoad.mockReturnValue({ isPending: true, isError: false, error: null, data: undefined });
    render(<CourtLoad />);
    expect(screen.getByText("Загрузка сетки…")).toBeTruthy();
  });

  it("surfaces a load error from the API without computing anything itself", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("Доступ запрещён."),
      data: undefined
    });
    render(<CourtLoad />);
    expect(screen.getByRole("alert").textContent).toContain("Доступ запрещён.");
  });

  it("shows an empty state for a date with no court rows", () => {
    useCourtLoad.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { ...GRID, rows: [] }
    });
    render(<CourtLoad />);
    expect(screen.getByText("На выбранную дату кортов нет.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
