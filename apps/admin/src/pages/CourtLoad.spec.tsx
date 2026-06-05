import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CourtLoadGrid, CourtRequestAdminView } from "@beosand/types";

// The data hooks are mocked so the page is unit-tested without the ApiClient/network.
const useCourtLoad = vi.fn();
vi.mock("../hooks/useCourtLoad", () => ({
  useCourtLoad: (...args: unknown[]) => useCourtLoad(...args)
}));

const useCourtRequestDetail = vi.fn();
vi.mock("../hooks/useCourtRequests", () => ({
  useCourtRequestDetail: (...args: unknown[]) => useCourtRequestDetail(...args)
}));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { CourtLoad } from "./CourtLoad";

const REQUEST_ID = "33333333-3333-3333-3333-333333333333";

const GRID: CourtLoadGrid = {
  date: "2026-06-10",
  openHour: 8,
  closeHour: 9,
  rows: [
    {
      courtId: "11111111-1111-1111-1111-111111111111",
      courtNumber: 1,
      cells: [
        { startTime: "08:00", state: "free", requestId: null },
        { startTime: "08:30", state: "request", requestId: REQUEST_ID }
      ]
    },
    {
      courtId: "22222222-2222-2222-2222-222222222222",
      courtNumber: 2,
      cells: [
        { startTime: "08:00", state: "block", requestId: null },
        { startTime: "08:30", state: "free", requestId: null }
      ]
    }
  ]
};

const DETAIL: CourtRequestAdminView = {
  id: REQUEST_ID,
  clientId: "44444444-4444-4444-4444-444444444444",
  date: "2026-06-10",
  startTime: "09:00",
  endTime: "10:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "confirmed",
  courtId: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-06-01T10:00:00.000Z",
  decidedAt: "2026-06-02T10:00:00.000Z",
  decidedBy: 555,
  clientName: "Анна Петрова",
  clientTelegramId: 987654321
};

beforeEach(() => {
  vi.clearAllMocks();
  useCourtLoad.mockReturnValue({ isPending: false, isError: false, error: null, data: GRID });
  useCourtRequestDetail.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: DETAIL
  });
});

afterEach(cleanup);

describe("CourtLoad page", () => {
  it("renders a court row per grid row with 30-min slot column headers from the API", () => {
    render(<CourtLoad />);

    const table = screen.getByRole("table", { name: "Загрузка кортов на 2026-06-10" });
    // Slot headers come straight from the contract cells — no client-side slot math.
    expect(within(table).getByRole("columnheader", { name: "08:00" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "08:30" })).toBeTruthy();
    // One row header per court, by number.
    expect(within(table).getByRole("rowheader", { name: "№ 1" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "№ 2" })).toBeTruthy();
  });

  it("tints each cell by the API's state and names the state for screen readers", () => {
    render(<CourtLoad />);

    const free = screen.getByLabelText("Корт 1, 08:00 — Свободно");
    expect(free.className).toContain("load-cell--free");

    // A request cell is an actionable button that opens the booking detail.
    const request = screen.getByLabelText("Корт 1, 08:30 — Заявка. Открыть детали брони.");
    expect(request.tagName).toBe("BUTTON");
    expect(request.className).toContain("load-cell--request");

    const block = screen.getByLabelText("Корт 2, 08:00 — Блокировка");
    expect(block.className).toContain("load-cell--block");
  });

  it("only makes request cells clickable; free and block cells are inert", () => {
    render(<CourtLoad />);
    expect(screen.getByLabelText("Корт 1, 08:00 — Свободно").tagName).toBe("SPAN");
    expect(screen.getByLabelText("Корт 2, 08:00 — Блокировка").tagName).toBe("SPAN");
  });

  it("opens the booking detail with the API-decided values when a request cell is clicked", () => {
    render(<CourtLoad />);

    fireEvent.click(screen.getByLabelText("Корт 1, 08:30 — Заявка. Открыть детали брони."));

    // The detail hook is asked for exactly the clicked cell's request id.
    expect(useCourtRequestDetail).toHaveBeenLastCalledWith(REQUEST_ID);
    const dialog = screen.getByRole("dialog", { name: "Детали брони" });
    expect(within(dialog).getByText("Анна Петрова")).toBeTruthy();
    expect(within(dialog).getByText("987654321")).toBeTruthy();
    expect(within(dialog).getByText("2 000 RSD")).toBeTruthy();
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
