import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Court, CourtRequestAdminView } from "@beosand/types";
import { MemoryRouter, useLocation } from "react-router-dom";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useCourtRequests = vi.fn();
const useFreeCourts = vi.fn();
const useConfirmRequest = vi.fn();
const useRejectRequest = vi.fn();
const useCancelRequest = vi.fn();
const useCourts = vi.fn();

vi.mock("../hooks/useCourtRequests", () => ({
  useCourtRequests: (...args: unknown[]) => useCourtRequests(...args),
  useFreeCourts: (...args: unknown[]) => useFreeCourts(...args),
  useConfirmRequest: () => useConfirmRequest(),
  useRejectRequest: () => useRejectRequest(),
  useCancelRequest: () => useCancelRequest()
}));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => useCourts() }));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

import { CourtRequests } from "./CourtRequests";
import { ApiClient, ConflictError } from "../api/client";

// A pending request the client picked two courts for (held, not yet confirmed).
const PENDING: CourtRequestAdminView = {
  id: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientName: "Игорь",
  clientTelegramId: 4242,
  date: "2026-06-10",
  startTime: "10:00",
  endTime: "11:00",
  durationHours: 1,
  priceRsd: 4000,
  status: "pending",
  courtCount: 2,
  courtNumbers: [3, 5],
  createdAt: "2026-06-04T08:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

// A legacy single-court bot request that picked no courts — the admin assigns one.
const PENDING_NO_PICK: CourtRequestAdminView = {
  ...PENDING,
  id: "66666666-6666-4666-8666-666666666666",
  clientName: "Олег",
  courtCount: 1,
  courtNumbers: []
};

const CONFIRMED: CourtRequestAdminView = {
  ...PENDING,
  id: "33333333-3333-3333-3333-333333333333",
  clientName: "Мария",
  status: "confirmed",
  courtCount: 1,
  courtNumbers: [3],
  decidedAt: "2026-06-04T09:00:00.000Z",
  decidedBy: 99
};

const CANCELLED_REQUEST = {
  id: CONFIRMED.id,
  clientId: CONFIRMED.clientId,
  date: CONFIRMED.date,
  startTime: CONFIRMED.startTime,
  durationHours: CONFIRMED.durationHours,
  priceRsd: CONFIRMED.priceRsd,
  status: "cancelled",
  courtCount: CONFIRMED.courtCount,
  courtNumbers: CONFIRMED.courtNumbers,
  createdAt: CONFIRMED.createdAt,
  decidedAt: "2026-06-04T10:00:00.000Z",
  decidedBy: 99
};

const FREE_COURTS: Court[] = [
  { id: "44444444-4444-4444-4444-444444444444", number: 3, status: "active" },
  { id: "55555555-5555-5555-5555-555555555555", number: 5, status: "active" },
  { id: "77777777-7777-4777-8777-777777777777", number: 6, status: "active" }
];

/** A passive (no-op) mutation result the page can call .mutate() on. */
function idleMutation(): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
}

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/court-requests"]}>
      <CourtRequests />
      <LocationProbe />
    </MemoryRouter>
  );
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockApiFetchOnce(body: unknown, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
      });
    })
  );
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCourts.mockReturnValue({ data: FREE_COURTS });
  useCourtRequests.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: [PENDING]
  });
  // Idle until a request is opened for confirmation; confirm tests override this.
  useFreeCourts.mockReturnValue({ isPending: false, isError: false, error: null, data: [] });
  useConfirmRequest.mockReturnValue(idleMutation());
  useRejectRequest.mockReturnValue(idleMutation());
  useCancelRequest.mockReturnValue(idleMutation());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CourtRequests page", () => {
  it("shows the client's requested courts and count on a pending row", () => {
    renderPage();

    const table = screen.getByRole("table");
    const row = within(table).getByText("Игорь").closest("tr") as HTMLElement;
    // The client picked courts 3 and 5; both render (the server's numbers).
    expect(within(row).getByText("№ 3, № 5")).toBeTruthy();
    // courtCount is shown too.
    expect(within(row).getByText("2")).toBeTruthy();
  });

  it("renders 'не назначен' for a pending request the client picked no courts for", () => {
    useCourtRequests.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [PENDING_NO_PICK]
    });
    renderPage();

    const table = screen.getByRole("table");
    const row = within(table).getByText("Олег").closest("tr") as HTMLElement;
    expect(within(row).getByText("не назначен")).toBeTruthy();
    expect(within(row).queryByText(/№/)).toBeNull();
  });

  it("renders the assigned court numbers for a confirmed request", () => {
    useCourtRequests.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [CONFIRMED]
    });
    renderPage();

    const table = screen.getByRole("table");
    const row = within(table).getByText("Мария").closest("tr") as HTMLElement;
    // Numbers come straight from the request's courtNumbers (server-decided).
    expect(within(row).getByText("№ 3")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Отменить заявку" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Подтвердить" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Отклонить" })).toBeNull();
  });

  it("does not render the cancel action for a pending request", () => {
    renderPage();

    const table = screen.getByRole("table");
    const row = within(table).getByText(PENDING.clientName).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Отменить заявку" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Подтвердить" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Отклонить" })).toBeTruthy();
  });

  it("opens a confirmation modal before cancelling a confirmed request", () => {
    const mutate = vi.fn();
    useCancelRequest.mockReturnValue({ ...idleMutation(), mutate });
    useCourtRequests.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [CONFIRMED]
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Отменить заявку" }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/2026-06-10/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить заявку" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ id: CONFIRMED.id });
  });

  it("navigates a request row to the court load grid with date and request id", () => {
    renderPage();

    const table = screen.getByRole("table");
    const row = within(table).getByText(PENDING.clientName).closest("tr") as HTMLElement;

    fireEvent.click(within(row).getAllByRole("button")[0]);

    expect(screen.getByLabelText("location").textContent).toBe(
      `/court-load?date=${PENDING.date}&requestId=${PENDING.id}`
    );
  });

  it("multi-selects exactly courtCount courts and confirms with the full courtIds set", () => {
    const mutate = vi.fn();
    useConfirmRequest.mockReturnValue({ ...idleMutation(), mutate });
    useFreeCourts.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: FREE_COURTS
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    const dialog = screen.getByRole("dialog");
    // Every free court the hook returns is offered.
    expect(within(dialog).getByText("Корт № 3")).toBeTruthy();
    expect(within(dialog).getByText("Корт № 5")).toBeTruthy();
    expect(within(dialog).getByText("Корт № 6")).toBeTruthy();

    // The client's held courts (3, 5) are pre-checked from the free list.
    expect((within(dialog).getByLabelText("Корт № 3") as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText("Корт № 5") as HTMLInputElement).checked).toBe(true);
    // Already at the count of 2 → a third option is disabled (no over-selection).
    expect((within(dialog).getByLabelText("Корт № 6") as HTMLInputElement).disabled).toBe(true);

    // Swap court 5 for court 6: uncheck 5 (frees a slot), then check 6.
    fireEvent.click(within(dialog).getByLabelText("Корт № 5"));
    fireEvent.click(within(dialog).getByLabelText("Корт № 6"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: PENDING.id,
      input: {
        courtIds: [
          "44444444-4444-4444-4444-444444444444",
          "77777777-7777-4777-8777-777777777777"
        ]
      }
    });
  });

  it("keeps confirm disabled until exactly courtCount courts are picked", () => {
    useConfirmRequest.mockReturnValue(idleMutation());
    // No pre-check here: the client picked no courts, so the admin must choose 2.
    useCourtRequests.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...PENDING, courtNumbers: [] }]
    });
    useFreeCourts.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: FREE_COURTS
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    const dialog = screen.getByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Подтвердить" });
    // Nothing picked → disabled.
    expect(confirmBtn).toHaveProperty("disabled", true);

    // One of two → still disabled.
    fireEvent.click(within(dialog).getByLabelText("Корт № 3"));
    expect(confirmBtn).toHaveProperty("disabled", true);

    // Two of two → enabled.
    fireEvent.click(within(dialog).getByLabelText("Корт № 5"));
    expect(confirmBtn).toHaveProperty("disabled", false);
  });

  it("surfaces a confirm conflict (409 slot filled) from the server as an error toast", () => {
    const mutate = vi.fn((_vars, opts: { onError?: (e: Error) => void }) => {
      opts.onError?.(new Error("Слот уже занят."));
    });
    useConfirmRequest.mockReturnValue({ ...idleMutation(), mutate });
    useFreeCourts.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: FREE_COURTS
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    const dialog = screen.getByRole("dialog");
    // The client's two held courts (3, 5) are pre-checked → confirm is enabled.
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));

    // The page renders the API's message via the toast; it never pre-checks availability.
    expect(notify).toHaveBeenCalledWith("Слот уже занят.", "error");
  });

  it("shows the localized conflict line for a 409 ConflictError (not the raw English text)", () => {
    const mutate = vi.fn((_vars, opts: { onError?: (e: Error) => void }) => {
      opts.onError?.(new ConflictError("This request has already been decided."));
    });
    useConfirmRequest.mockReturnValue({ ...idleMutation(), mutate });
    useFreeCourts.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: FREE_COURTS
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    const dialog = screen.getByRole("dialog");
    // Pre-checked held courts (3, 5) satisfy courtCount → confirm directly.
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));

    expect(notify).toHaveBeenCalledWith(
      "Слот уже занят или заявка обработана — список обновлён.",
      "error"
    );
  });

  it("rejects a pending request by id", () => {
    const mutate = vi.fn();
    useRejectRequest.mockReturnValue({ ...idleMutation(), mutate });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: PENDING.id
    });
  });
});

describe("ApiClient court request cancel", () => {
  it("POSTs the strict cancel body and parses the returned request", async () => {
    const calls = mockApiFetchOnce(CANCELLED_REQUEST);

    const result = await new ApiClient("http://api.test").cancelRequest(CONFIRMED.id);

    expect(calls[0]?.url).toBe(`http://api.test/court-requests/${CONFIRMED.id}/cancel`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ requestId: CONFIRMED.id });
    expect(result.status).toBe("cancelled");
    expect(result).not.toHaveProperty("clientName");
  });

  it("rejects a malformed cancel response before rendering can use it", async () => {
    mockApiFetchOnce({ ...CANCELLED_REQUEST, priceRsd: -1 });

    await expect(new ApiClient("http://api.test").cancelRequest(CONFIRMED.id)).rejects.toThrow();
  });
});
