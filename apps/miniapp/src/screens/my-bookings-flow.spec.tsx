import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Client, ClientRecord, ClientRecordsPage, MiniappMe } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { MyBookingsScreen, RecordsView } from "./MyBookingsScreen";

const ME: MiniappMe = { telegramId: 42, name: "Anya", username: "anya", language: "ru" };
const CLIENT: Client = { id: "11111111-1111-1111-1111-111111111111", name: "Anya", telegramId: 42, telegramUsername: "anya", telegramPhotoUrl: null, gender: "female", levelId: null, source: "telegram", phone: null, email: null, note: null, language: "ru", registeredAt: "2026-06-05T10:00:00.000Z", consentGivenAt: null, status: "active", bonusTrainingCredits: 0 };
const PENDING: ClientRecord = { id: "court:22222222-2222-2222-2222-222222222222", kind: "court", entityId: "22222222-2222-2222-2222-222222222222", status: "pending", date: "2026-06-10", startTime: "18:00", endTime: "19:00", title: null, trainerName: null, trainingKind: null, levelName: null, trainingId: null, bookingId: null, groupSubscriptionId: null, courtNumbers: [], courtCount: 2, priceRsd: 6000, waitlistPosition: null, reason: null, actor: null, canCancel: false, nextAction: "wait" };
const DECLINED: ClientRecord = { ...PENDING, id: "individual-request:33333333-3333-3333-3333-333333333333", kind: "individual-request", entityId: "33333333-3333-3333-3333-333333333333", status: "declined", title: "Индивидуальная тренировка", actor: "staff", reason: { code: "staff-unavailable", comment: "Тренер заболел" }, nextAction: "choose-another" };

let api: { getMe: ReturnType<typeof vi.fn>; getClientByTelegramId: ReturnType<typeof vi.fn>; listClientRecords: ReturnType<typeof vi.fn> };
vi.mock("../api/ApiProvider", () => ({ useApiClient: () => api, useApi: () => ({ client: api, status: "ready", error: null }) }));
vi.mock("../tg/buttons", () => ({ useMainButton: () => {}, useBackButton: () => {}, hapticSelection: () => {}, hapticSuccess: () => {}, hapticWarning: () => {} }));

function page(items: ClientRecord[], hasMore = false, nextOffset: number | null = null): ClientRecordsPage { return { items, total: items.length, hasMore, nextOffset }; }
function renderScreen(): QueryClient { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<AppRoot><QueryClientProvider client={qc}><LanguageProvider><MyBookingsScreen onBrowse={() => {}} /></LanguageProvider></QueryClientProvider></AppRoot>); return qc; }

afterEach(() => cleanup());

describe("My bookings and requests", () => {
  it("renders pending and declined records with their API-owned next steps and reason", async () => {
    api = { getMe: vi.fn().mockReturnValue(ME), getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT), listClientRecords: vi.fn().mockResolvedValue(page([PENDING, DECLINED])) };
    renderScreen();
    expect(await screen.findByText("Заявка получена — ожидает подтверждения")).toBeTruthy();
    expect(screen.getByText("Заявка отклонена")).toBeTruthy();
    expect(screen.getByText("Причина: Сотрудник недоступен: Тренер заболел")).toBeTruthy();
    expect(screen.getByText("Выберите другой вариант.")).toBeTruthy();
    expect(screen.queryByText(/Выбранные корты:/)).toBeNull();
  });

  it("switches to terminal history", async () => {
    api = { getMe: vi.fn().mockReturnValue(ME), getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT), listClientRecords: vi.fn((query) => Promise.resolve(query.scope === "past" ? page([DECLINED]) : page([]))) };
    renderScreen();
    fireEvent.click(await screen.findByRole("tab", { name: "История" }));
    await waitFor(() => expect(api.listClientRecords).toHaveBeenCalledWith({ scope: "past", offset: 0, limit: 30 }));
    expect(await screen.findByText("Заявка отклонена")).toBeTruthy();
  });

  it("appends the next server page without duplicating existing records", async () => {
    const second = { ...PENDING, id: "waitlist:44444444-4444-4444-4444-444444444444", entityId: "44444444-4444-4444-4444-444444444444", kind: "waitlist" as const, status: "waitlisted" as const, title: "Mix", waitlistPosition: 2 };
    api = { getMe: vi.fn().mockReturnValue(ME), getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT), listClientRecords: vi.fn((query) => Promise.resolve(query.offset === 0 ? page([PENDING], true, 1) : page([PENDING, second]))) };
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Mix")).toBeTruthy();
    expect(screen.getAllByText("Аренда корта")).toHaveLength(1);
  });

  it("refreshes every loaded page and replaces a changed first-page status", async () => {
    let firstPageCalls = 0;
    const updated = { ...PENDING, status: "declined" as const, reason: { code: "unavailable" as const, comment: null }, nextAction: "choose-another" as const };
    const secondPageRecord = { ...PENDING, id: "waitlist:99999999-9999-9999-9999-999999999999", entityId: "99999999-9999-9999-9999-999999999999", kind: "waitlist" as const, status: "waitlisted" as const, title: "Mix" };
    api = { getMe: vi.fn().mockReturnValue(ME), getClientByTelegramId: vi.fn().mockResolvedValue(CLIENT), listClientRecords: vi.fn((query) => {
      if (query.offset === 0) return Promise.resolve(page(++firstPageCalls === 1 ? [PENDING] : [updated], true, 1));
      return Promise.resolve(page([secondPageRecord]));
    }) };
    const qc = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await waitFor(() => expect(api.listClientRecords).toHaveBeenCalledWith({ scope: "upcoming", offset: 1, limit: 30 }));
    await qc.invalidateQueries({ queryKey: ["client-records"] });
    expect(await screen.findByText("Заявка отклонена")).toBeTruthy();
    expect(screen.queryByText("Заявка получена — ожидает подтверждения")).toBeNull();
    await waitFor(() => expect(api.listClientRecords.mock.calls.filter(([query]) => query.offset === 1)).toHaveLength(2));
  });

  it("groups monthly records, shows confirmed courts, and keeps terminal cards read-only", () => {
    const confirmed = { ...PENDING, id: "court:55555555-5555-5555-5555-555555555555", entityId: "55555555-5555-5555-5555-555555555555", status: "confirmed" as const, courtNumbers: [2] };
    const declinedBooking = { ...DECLINED, id: "booking:77777777-7777-7777-7777-777777777777", entityId: "77777777-7777-7777-7777-777777777777", kind: "booking" as const, trainingId: "88888888-8888-8888-8888-888888888888", canCancel: false, groupSubscriptionId: "66666666-6666-6666-6666-666666666666" };
    const secondMonthlyBooking = { ...declinedBooking, id: "booking:99999999-9999-4999-8999-999999999999", entityId: "99999999-9999-4999-8999-999999999999", date: "2026-06-17" };
    render(<AppRoot><LanguageProvider><RecordsView items={[confirmed, declinedBooking, secondMonthlyBooking]} /></LanguageProvider></AppRoot>);
    expect(screen.getByText(/Корты: 2/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Индивидуальная тренировка/i })).toBeNull();
    const monthlyRegion = screen.getByRole("region", { name: "Индивидуальная тренировка" });
    expect(within(monthlyRegion).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
