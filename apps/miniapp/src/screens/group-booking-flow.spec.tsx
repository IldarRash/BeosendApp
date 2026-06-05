import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Booking, Client, Group, GroupBookingResult, MiniappMe } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { NavProvider } from "../router/NavProvider";
import { GroupBookingScreen } from "./GroupBookingScreen";

/**
 * S7 monthly group-booking flow tests. The screen is an interaction layer: it lists
 * groups, lets the user pick a group + month, calls createGroupBooking({clientId,
 * groupId, year, month}), and renders the server's GroupBookingResult — no price,
 * date, or capacity math here.
 *
 * Invariant under test: the result lists created bookings + skipped dates EXACTLY as
 * the server reports them (the Mini App never decides which dates exist or are
 * full). Unsafe path: the clientId sent is the caller's OWN resolved Client id (from
 * the verified session), never a client-asserted value; a malformed groups response
 * is rejected by the contract before render. The two month options are display-only;
 * the server validates.
 */

const ME: MiniappMe = { telegramId: 42, name: "Аня", username: "anya", language: "ru" };

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Аня",
  telegramId: 42,
  telegramUsername: "anya",
  levelId: null,
  source: "telegram",
  phone: null,
  note: null,
  language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z",
  status: "active"
};

const LEVEL_ID = "22222222-2222-2222-2222-222222222222";
const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
const GROUP_ID = "44444444-4444-4444-4444-444444444444";

const GROUP: Group = {
  id: GROUP_ID,
  name: "Утро Про",
  levelId: LEVEL_ID,
  daysOfWeek: [1, 3],
  startTime: "09:00",
  endTime: "10:30",
  trainerId: TRAINER_ID,
  trainerName: "Марко",
  capacity: 8,
  priceSingleRsd: 1500,
  priceMonthRsd: 12000,
  status: "active"
};

const BOOKING = (id: string): Booking => ({
  id,
  clientId: ONBOARDED.id,
  trainingId: "99999999-9999-9999-9999-999999999999",
  type: "group",
  groupSubscriptionId: "88888888-8888-8888-8888-888888888888",
  createdAt: "2026-06-05T10:00:00.000Z",
  status: "booked",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
});

const RESULT_WITH_SKIPPED: GroupBookingResult = {
  groupSubscriptionId: "88888888-8888-8888-8888-888888888888",
  created: [
    BOOKING("55555555-5555-5555-5555-555555555555"),
    BOOKING("66666666-6666-6666-6666-666666666666")
  ],
  skipped: ["2026-07-15"]
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  listGroups: ReturnType<typeof vi.fn>;
  listLevels: ReturnType<typeof vi.fn>;
  createGroupBooking: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    listGroups: vi.fn().mockResolvedValue([GROUP]),
    listLevels: vi.fn().mockResolvedValue([{ id: LEVEL_ID, name: "Про", status: "active" }]),
    createGroupBooking: vi.fn().mockResolvedValue(RESULT_WITH_SKIPPED),
    ...overrides
  };
}

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));

vi.mock("../tg/buttons", () => ({
  useMainButton: () => {},
  useBackButton: () => {},
  hapticSelection: () => {},
  hapticSuccess: () => {},
  hapticWarning: () => {}
}));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <NavProvider initial="group">
            <GroupBookingScreen />
          </NavProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GroupBookingScreen", () => {
  it("lists groups, then picks a group → month → confirm and shows the server result", async () => {
    renderScreen();

    // The group card is rendered from the validated contract: its accessible label
    // carries the server's facts — name, trainer · level, weekdays · time, and the
    // monthly price (priceMonthRsd, 12000 → "12 000 RSD / месяц"). The Mini App never
    // computes the price; it displays the server value.
    const card = await screen.findByRole("button", { name: /Утро Про/ });
    expect(card.getAttribute("aria-label")).toContain("Марко");
    expect(card.getAttribute("aria-label")).toContain("Про");
    expect(card.getAttribute("aria-label")).toContain("09:00–10:30");
    expect(card.getAttribute("aria-label")).toContain("12 000 RSD / месяц");
    fireEvent.click(card);

    // Detail shows the same server facts as labelled cells: weekdays (full), time,
    // trainer, level, and the monthly price — all from the contract, none recomputed.
    expect(await screen.findByText("Понедельник, Среда")).toBeTruthy();
    expect(screen.getByText("09:00–10:30")).toBeTruthy();
    expect(screen.getByText("Марко")).toBeTruthy();
    expect(screen.getByText("Про")).toBeTruthy();
    expect(screen.getByText("12 000 RSD / месяц")).toBeTruthy();

    // Month picker: pick the first offered month, advance, then subscribe.
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole("button", { name: "Записаться на месяц" }));
    fireEvent.click(await screen.findByRole("button", { name: "Записаться на месяц" }));

    await waitFor(() => expect(api.createGroupBooking).toHaveBeenCalledTimes(1));

    // Unsafe path: the clientId sent is the caller's OWN resolved id, never asserted,
    // and NO price is sent — money is the server's. year/month are the picker ints.
    const sent = api.createGroupBooking.mock.calls[0][0];
    expect(sent.clientId).toBe(ONBOARDED.id);
    expect(sent.groupId).toBe(GROUP_ID);
    expect(typeof sent.year).toBe("number");
    expect(typeof sent.month).toBe("number");
    expect(sent).not.toHaveProperty("price");
    expect(sent).not.toHaveProperty("priceMonthRsd");

    // The result renders the created count and the skipped date EXACTLY as the server
    // reported — never re-derived. Skipped is an informational note, not an error.
    await screen.findByText("Вы записаны на 2 тренировок");
    const skippedHeader = screen.getByText("Пропущенные даты (нет мест)");
    // The skipped date sits inside the calm informational note block (role=note),
    // shown as skipped — never rendered as a booked/created instance, never an alert.
    const note = skippedHeader.closest('[role="note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("15.07");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a 409 server message verbatim and renders no result", async () => {
    const { ConflictError } = await import("../api/client");
    api = makeApi({
      createGroupBooking: vi.fn().mockRejectedValue(new ConflictError("Месяц закрыт для записи."))
    });
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Утро Про/ }));
    const radios = await screen.findAllByRole("radio");
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole("button", { name: "Записаться на месяц" }));
    fireEvent.click(await screen.findByRole("button", { name: "Записаться на месяц" }));

    // The server message is shown verbatim in an alert; NO success result appears.
    await screen.findByText("Месяц закрыт для записи.");
    expect(screen.queryByText("Готово!")).toBeNull();
  });

  it("shows the empty state when there are no active groups", async () => {
    api = makeApi({ listGroups: vi.fn().mockResolvedValue([]) });
    renderScreen();
    await screen.findByText("Нет доступных групп");
  });
});
