import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type {
  Client,
  CourtClientGrid,
  CourtRequest,
  CourtRequestPreview,
  MiniappMe
} from "@beosand/types";
import { ConflictError } from "../api/client";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { NavProvider } from "../router/NavProvider";
import { offeredDates } from "../ui/format";
import { CourtRequestScreen } from "./CourtRequestScreen";

/** The first date pill the strip offers (today). */
const FIRST_DATE = offeredDates()[0];

const ME: MiniappMe = { telegramId: 42, name: "Anna", username: "anya", language: "ru" };

const ONBOARDED: Client = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Anna",
  telegramId: 42,
  telegramUsername: "anya",
  telegramPhotoUrl: null,
  levelId: null,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: "2026-06-05T10:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

const COURT_GRID: CourtClientGrid = {
  date: "2026-06-10",
  durationHours: 1,
  workingHours: {
    date: "2026-06-10",
    openTime: "07:00",
    closeTime: "22:00",
    source: "fallback"
  },
  rows: [
    {
      courtNumber: 1,
      cells: [
        { startTime: "08:00", endTime: "09:00", state: "free" },
        { startTime: "09:00", endTime: "10:00", state: "free" },
        { startTime: "10:00", endTime: "11:00", state: "unavailable" }
      ]
    },
    {
      courtNumber: 2,
      cells: [
        { startTime: "08:00", endTime: "09:00", state: "unavailable" },
        { startTime: "09:00", endTime: "10:00", state: "free" },
        { startTime: "10:00", endTime: "11:00", state: "free" }
      ]
    },
    {
      courtNumber: 3,
      cells: [
        { startTime: "08:00", endTime: "09:00", state: "free" },
        { startTime: "09:00", endTime: "10:00", state: "unavailable" },
        { startTime: "10:00", endTime: "11:00", state: "unavailable" }
      ]
    }
  ]
};

const PREVIEW: CourtRequestPreview = {
  date: "2026-06-10",
  startTime: "08:00",
  endTime: "09:00",
  durationHours: 1,
  priceRsd: 6000,
  courtCount: 2,
  courtNumbers: [1, 3],
  available: true
};

const COURT_REQUEST: CourtRequest = {
  id: "99999999-9999-9999-9999-999999999999",
  clientId: ONBOARDED.id,
  date: "2026-06-10",
  startTime: "08:00",
  durationHours: 1,
  priceRsd: 6000,
  status: "pending",
  courtCount: 2,
  courtNumbers: [],
  createdAt: "2026-06-05T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null
};

interface FakeApi {
  getMe: ReturnType<typeof vi.fn>;
  getClientByTelegramId: ReturnType<typeof vi.fn>;
  getCourtClientGrid: ReturnType<typeof vi.fn>;
  previewCourtRequest: ReturnType<typeof vi.fn>;
  createCourtRequest: ReturnType<typeof vi.fn>;
}

let api: FakeApi;

function makeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    getMe: vi.fn().mockReturnValue(ME),
    getClientByTelegramId: vi.fn().mockResolvedValue(ONBOARDED),
    getCourtClientGrid: vi.fn().mockResolvedValue(COURT_GRID),
    previewCourtRequest: vi.fn().mockResolvedValue(PREVIEW),
    createCourtRequest: vi.fn().mockResolvedValue(COURT_REQUEST),
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
          <NavProvider initial="court">
            <CourtRequestScreen />
          </NavProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

async function chooseDateAndDuration(): Promise<void> {
  const [dateStrip] = await screen.findAllByRole("group");
  fireEvent.click(dateStrip.querySelectorAll("button")[0]);

  const durationChoices = await screen.findAllByRole("radio");
  fireEvent.click(durationChoices[0]);
}

async function openGrid(): Promise<void> {
  await chooseDateAndDuration();

  await screen.findByRole("grid");
}

function continueToPreview(): void {
  fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
}

function courtLabel(courtNumber: number, startTime: string): string {
  return `Корт ${courtNumber} ${startTime}`;
}

function takenCourtLabel(courtNumber: number, startTime: string): string {
  return `Корт ${courtNumber} занят ${startTime}`;
}

beforeEach(() => {
  api = makeApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CourtRequestScreen", () => {
  it("renders the availability grid for the selected date and duration", async () => {
    renderScreen();
    await openGrid();

    expect(api.getCourtClientGrid).toHaveBeenCalledWith({
      date: FIRST_DATE,
      durationHours: 1
    });
    expect(await screen.findByRole("grid")).toBeTruthy();
    expect(screen.getAllByText(/^Корт \d/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/:\d\d/).length).toBeGreaterThan(0);
  });

  it("marks unavailable cells as disabled and visually unavailable", async () => {
    renderScreen();
    await openGrid();

    const takenCell = screen.getByRole("button", {
      name: takenCourtLabel(2, "08:00")
    });
    expect((takenCell as HTMLButtonElement).disabled).toBe(true);
    expect(takenCell.className).toContain("is-unavailable");
  });

  it("supports multi-select on same start time and resets when start-time changes", async () => {
    renderScreen();
    await openGrid();

    const court1Eight = screen.getByRole("button", { name: courtLabel(1, "08:00") }) as HTMLButtonElement;
    const court3Eight = screen.getByRole("button", { name: courtLabel(3, "08:00") }) as HTMLButtonElement;
    const court2Nine = screen.getByRole("button", { name: courtLabel(2, "09:00") }) as HTMLButtonElement;

    fireEvent.click(court1Eight);
    fireEvent.click(court3Eight);

    expect(court1Eight.getAttribute("aria-pressed")).toBe("true");
    expect(court3Eight.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(court2Nine);

    await waitFor(() => {
      expect(court1Eight.getAttribute("aria-pressed")).toBe("false");
      expect(court3Eight.getAttribute("aria-pressed")).toBe("false");
      expect(court2Nine.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("passes selected courts to preview and create payloads", async () => {
    renderScreen();
    await openGrid();

    fireEvent.click(screen.getByRole("button", { name: courtLabel(1, "08:00") }));
    fireEvent.click(screen.getByRole("button", { name: courtLabel(3, "08:00") }));
    continueToPreview();

    expect(await screen.findByText("Подтверждение заявки")).toBeTruthy();
    expect(api.previewCourtRequest).toHaveBeenCalledWith({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1,
      courtNumbers: [1, 3]
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Отправить заявку" })
    );

    await waitFor(() => expect(api.createCourtRequest).toHaveBeenCalledTimes(1));
    expect(api.createCourtRequest).toHaveBeenCalledWith({
      date: FIRST_DATE,
      startTime: "08:00",
      durationHours: 1,
      courtNumbers: [1, 3]
    });
  });

  it("shows an empty grid state when the chosen day has no cells", async () => {
    api = makeApi({
      getCourtClientGrid: vi.fn().mockResolvedValue({
        ...COURT_GRID,
        rows: []
      })
    });

    renderScreen();
    await chooseDateAndDuration();

    await screen.findByText("Нет свободного времени");
  });

  it("shows preview unavailable as calm pick another time state", async () => {
    api = makeApi({
      previewCourtRequest: vi.fn().mockResolvedValue({ ...PREVIEW, available: false })
    });

    renderScreen();
    await openGrid();

    fireEvent.click(screen.getByRole("button", { name: courtLabel(1, "08:00") }));
    continueToPreview();

    const taken = await screen.findByText("Это время заняли");
    expect(taken.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Выбрать другое время"
      })
    ).toBeTruthy();
  });

  it("renders a submit 409 as calm pick another time state", async () => {
    api = makeApi({
      createCourtRequest: vi.fn().mockRejectedValue(
        new ConflictError("Это время только что заняли.")
      )
    });

    renderScreen();
    await openGrid();

    fireEvent.click(screen.getByRole("button", { name: courtLabel(1, "08:00") }));
    continueToPreview();
    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить заявку" })
    );

    const taken = await screen.findByText("Это время только что заняли.");
    expect(taken.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error state when grid load fails", async () => {
    api = makeApi({
      getCourtClientGrid: vi.fn().mockRejectedValue(new Error("boom"))
    });

    renderScreen();
    const [dateStrip] = await screen.findAllByRole("group");
    fireEvent.click(dateStrip.querySelectorAll("button")[0]);
    const durationChoices = await screen.findAllByRole("radio");
    fireEvent.click(durationChoices[0]);

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
