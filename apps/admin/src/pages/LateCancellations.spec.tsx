import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LateCancellationLiability } from "@beosand/types";

vi.mock("../ui/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify: vi.fn() }) }));

const usePolicy = vi.fn();
const updatePolicy = vi.fn();
const useLiabilities = vi.fn();
const markStandalone = vi.fn();
vi.mock("../hooks/useLateCancellations", () => ({
  useLateCancellationPolicy: () => usePolicy(),
  useUpdateLateCancellationPolicy: () => updatePolicy(),
  useLateCancellationLiabilities: (query: unknown) => useLiabilities(query),
  useMarkStandaloneLateCancellationPaid: () => markStandalone()
}));

import { LateCancellations } from "./LateCancellations";

const liability: LateCancellationLiability = {
  id: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  trainingId: "44444444-4444-4444-8444-444444444444",
  groupSubscriptionId: null,
  trainerId: "55555555-5555-4555-8555-555555555555",
  clientName: "Аня",
  trainingLabel: "Утренняя группа",
  trainingDate: "2026-10-20",
  trainingStartTime: "18:00",
  trainingEndTime: "19:30",
  trainerName: "Мила",
  cancelledAt: "2026-10-19T16:00:00.000Z",
  confirmedAt: "2026-10-19T16:00:00.000Z",
  policyHours: 24,
  policyVersion: 1,
  cutoffAt: "2026-10-19T18:00:00.000Z",
  amountRsd: 1500,
  amountSource: "group-single-price",
  billingKind: "single",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null,
  createdAt: "2026-10-19T16:00:00.000Z"
};

function renderPage(): void {
  render(<MemoryRouter><LateCancellations /></MemoryRouter>);
}

beforeEach(() => {
  usePolicy.mockReset(); updatePolicy.mockReset(); useLiabilities.mockReset(); markStandalone.mockReset();
  usePolicy.mockReturnValue({ isLoading: false, isError: false, data: { enabled: false, hours: null, version: 1, effectiveFrom: null, updatedAt: null, updatedBy: null } });
  updatePolicy.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useLiabilities.mockReturnValue({ isLoading: false, isError: false, isFetching: false, data: { items: [liability], total: 1, hasMore: false, nextOffset: null }, refetch: vi.fn() });
  markStandalone.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(cleanup);

describe("LateCancellations page", () => {
  it("renders server-projected liability data without deriving the amount or status", () => {
    renderPage();
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText(/1\s*500 RSD/)).toBeTruthy();
    expect(screen.getAllByText("Не оплачено").length).toBeGreaterThanOrEqual(2);
  });

  it("passes the selected API payment filter and resets pagination", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Статус оплаты"), { target: { value: "paid" } });
    expect(useLiabilities.mock.calls.at(-1)?.[0]).toMatchObject({ paymentStatus: "paid", offset: 0, limit: 30 });
  });

  it("routes subscription-backed liabilities to batch payment instead of exposing a standalone toggle", () => {
    useLiabilities.mockReturnValue({ isLoading: false, isError: false, isFetching: false, data: { items: [{ ...liability, billingKind: "subscription", groupSubscriptionId: "66666666-6666-4666-8666-666666666666" }], total: 1, hasMore: false, nextOffset: null }, refetch: vi.fn() });
    renderPage();
    expect(screen.getByRole("link", { name: "Открыть абонементы" }).getAttribute("href")).toBe("/subscriptions");
    expect(screen.queryByText("Отметить оплаченной")).toBeNull();
  });

  it("uses the server next offset and resets it when the filter changes", () => {
    useLiabilities.mockReturnValue({ isLoading: false, isError: false, isFetching: false,
      data: { items: [liability], total: 60, hasMore: true, nextOffset: 30 }, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(useLiabilities.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 30, limit: 30 });
    fireEvent.change(screen.getByLabelText("Тип оплаты"), { target: { value: "single" } });
    expect(useLiabilities.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, billingKind: "single" });
  });

  it("does not overwrite a policy that failed to load", () => {
    usePolicy.mockReturnValue({ isLoading: false, isError: true, error: new Error("Unavailable"), data: undefined });
    renderPage();
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Unavailable");
  });

  it("updates standalone payment only after the manager confirms the exact row", () => {
    const mutate = vi.fn();
    markStandalone.mockReturnValue({ mutate, isPending: false });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отметить оплаченной" }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(mutate).toHaveBeenCalledWith({ id: liability.id, paid: true }, expect.any(Object));
  });
});
