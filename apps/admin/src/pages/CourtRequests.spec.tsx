import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Court, CourtRequestAdminView } from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useCourtRequests = vi.fn();
const useFreeCourts = vi.fn();
const useConfirmRequest = vi.fn();
const useRejectRequest = vi.fn();
const useCourts = vi.fn();
const useMe = vi.fn();

vi.mock("../hooks/useCourtRequests", () => ({
  useCourtRequests: (...args: unknown[]) => useCourtRequests(...args),
  useFreeCourts: (...args: unknown[]) => useFreeCourts(...args),
  useConfirmRequest: () => useConfirmRequest(),
  useRejectRequest: () => useRejectRequest()
}));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => useCourts() }));
vi.mock("../hooks/useSession", () => ({ useMe: () => useMe() }));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

import { CourtRequests } from "./CourtRequests";

const PENDING: CourtRequestAdminView = {
  id: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientName: "Игорь",
  clientTelegramId: 4242,
  date: "2026-06-10",
  startTime: "10:00",
  endTime: "11:00",
  durationHours: 1,
  priceRsd: 2000,
  status: "pending",
  courtId: null,
  createdAt: "2026-06-04T08:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

const CONFIRMED: CourtRequestAdminView = {
  ...PENDING,
  id: "33333333-3333-3333-3333-333333333333",
  clientName: "Мария",
  status: "confirmed",
  courtId: "44444444-4444-4444-4444-444444444444",
  decidedAt: "2026-06-04T09:00:00.000Z",
  decidedBy: 99
};

const FREE_COURTS: Court[] = [
  { id: "44444444-4444-4444-4444-444444444444", number: 3, status: "active" },
  { id: "55555555-5555-5555-5555-555555555555", number: 5, status: "active" }
];

/** A passive (no-op) mutation result the page can call .mutate() on. */
function idleMutation(): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMe.mockReturnValue({ data: { telegramId: 99, name: "Ана" } });
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
});

afterEach(cleanup);

describe("CourtRequests page", () => {
  it("never renders a court number for a pending request", () => {
    render(<CourtRequests />);

    const table = screen.getByRole("table");
    const row = within(table).getByText("Игорь").closest("tr") as HTMLElement;
    expect(within(row).getByText("не назначен")).toBeTruthy();
    // No assigned-court figure leaks for a pending row.
    expect(within(row).queryByText(/№/)).toBeNull();
  });

  it("renders the assigned court number for a confirmed request", () => {
    useCourtRequests.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [CONFIRMED]
    });
    render(<CourtRequests />);

    const table = screen.getByRole("table");
    const row = within(table).getByText("Мария").closest("tr") as HTMLElement;
    // Court 3 is resolved from the courts list via the confirmed request's courtId.
    expect(within(row).getByText("№ 3")).toBeTruthy();
  });

  it("lists only the free courts the hook returns and confirms with the picked court", () => {
    const mutate = vi.fn();
    useConfirmRequest.mockReturnValue({ ...idleMutation(), mutate });
    useFreeCourts.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: FREE_COURTS
    });
    render(<CourtRequests />);

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    const dialog = screen.getByRole("dialog");
    // Exactly the free courts from the hook are offered.
    expect(within(dialog).getByText("Корт № 3")).toBeTruthy();
    expect(within(dialog).getByText("Корт № 5")).toBeTruthy();

    fireEvent.click(within(dialog).getByLabelText("Корт № 5"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: PENDING.id,
      input: { courtId: "55555555-5555-5555-5555-555555555555", decidedBy: 99 }
    });
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
    render(<CourtRequests />);

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Корт № 3"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));

    // The page renders the API's message via the toast; it never pre-checks availability.
    expect(notify).toHaveBeenCalledWith("Слот уже занят.", "error");
  });

  it("rejects a pending request with the admin's telegram id", () => {
    const mutate = vi.fn();
    useRejectRequest.mockReturnValue({ ...idleMutation(), mutate });
    render(<CourtRequests />);

    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: PENDING.id,
      input: { decidedBy: 99 }
    });
  });
});
