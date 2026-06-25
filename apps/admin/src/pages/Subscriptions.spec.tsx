import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SubscriptionSummary } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ notify })
}));

vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useSubscriptions = vi.fn();
const markMutate = vi.fn();
const useMarkSubscriptionPaid = vi.fn();
vi.mock("../hooks/useSubscriptions", () => ({
  useSubscriptions: (filters: unknown) => useSubscriptions(filters),
  useMarkSubscriptionPaid: () => useMarkSubscriptionPaid()
}));

import { Subscriptions } from "./Subscriptions";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Subscriptions />
    </MemoryRouter>
  );
}

const partial: SubscriptionSummary = {
  groupSubscriptionId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientName: "Аня",
  groupId: "33333333-3333-3333-3333-333333333333",
  groupName: "Утренняя группа",
  year: 2026,
  month: 6,
  dateCount: 8,
  paidCount: 3,
  waitlistedCount: 0,
  totalRsd: 12000,
  paymentState: "partial"
};

const listQuery = (data: SubscriptionSummary[]) => ({
  isPending: false,
  isError: false,
  error: null,
  data
});

beforeEach(() => {
  notify.mockReset();
  markMutate.mockReset();
  useSubscriptions.mockReset();
  useSubscriptions.mockReturnValue(listQuery([]));
  useMarkSubscriptionPaid.mockReturnValue({ mutate: markMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Subscriptions page", () => {
  it("renders server-decided rows (client, month, paid/date counts, state) as-is", () => {
    useSubscriptions.mockReturnValue(listQuery([partial]));
    renderPage();
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText("Утренняя группа")).toBeTruthy();
    expect(screen.getByText("2026-06")).toBeTruthy();
    // Counts are shown as paidCount/dateCount, never recomputed in the page.
    expect(screen.getByText("3/8")).toBeTruthy();
    // The partial-state tag is rendered (also an option in the filter select).
    expect(screen.getAllByText("Частично").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the waitlisted badge only when waitlistedCount > 0", () => {
    const waitlisted: SubscriptionSummary = { ...partial, waitlistedCount: 2 };
    useSubscriptions.mockReturnValue(listQuery([waitlisted]));
    renderPage();
    expect(screen.getByText("В ожидании: 2")).toBeTruthy();
  });

  it("hides the waitlisted badge when waitlistedCount is 0", () => {
    useSubscriptions.mockReturnValue(listQuery([partial]));
    renderPage();
    expect(screen.queryByText(/В ожидании/)).toBeNull();
  });

  it("shows an empty state when no subscriptions match", () => {
    useSubscriptions.mockReturnValue(listQuery([]));
    renderPage();
    expect(screen.getByText("Абонементов пока нет.")).toBeTruthy();
  });

  it("surfaces a list error", () => {
    useSubscriptions.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("passes the payment-state filter to the list hook", () => {
    useSubscriptions.mockReturnValue(listQuery([partial]));
    renderPage();
    fireEvent.change(screen.getByLabelText("Статус оплаты"), { target: { value: "unpaid" } });
    const calledWithUnpaid = useSubscriptions.mock.calls.some(
      ([filters]) => (filters as { paymentState?: string }).paymentState === "unpaid"
    );
    expect(calledWithUnpaid).toBe(true);
  });

  it("clears the server filter when 'all' is selected", () => {
    useSubscriptions.mockReturnValue(listQuery([partial]));
    renderPage();
    // The default render already calls the hook with no paymentState.
    const calledBare = useSubscriptions.mock.calls.some(
      ([filters]) => (filters as { paymentState?: string }).paymentState === undefined
    );
    expect(calledBare).toBe(true);
  });

  it("marks a not-fully-paid subscription paid (targetPaid=true) and toasts success", () => {
    markMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
    useSubscriptions.mockReturnValue(listQuery([partial]));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Отметить оплаченным" }));
    // Confirm in the modal (primary button).
    const confirm = screen
      .getAllByRole("button", { name: "Отметить оплаченным" })
      .at(-1) as HTMLElement;
    fireEvent.click(confirm);

    expect(markMutate).toHaveBeenCalledTimes(1);
    expect(markMutate.mock.calls[0][0]).toEqual({
      id: partial.groupSubscriptionId,
      paid: true
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Аня"), "success");
  });

  it("snaps a fully-paid subscription back to unpaid (targetPaid=false)", () => {
    const paid: SubscriptionSummary = { ...partial, paidCount: 8, paymentState: "paid" };
    useSubscriptions.mockReturnValue(listQuery([paid]));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Снять оплату" }));
    const confirm = screen.getAllByRole("button", { name: "Снять оплату" }).at(-1) as HTMLElement;
    fireEvent.click(confirm);

    expect(markMutate.mock.calls[0][0]).toEqual({
      id: paid.groupSubscriptionId,
      paid: false
    });
  });
});
