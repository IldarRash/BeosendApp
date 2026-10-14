import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { BookingCancellationPreview, BookingCancellationResult, ClientTrainingDetail } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { LateCancellationConfirmationRequiredError } from "../api/client";
import { TrainingDetailView } from "./TrainingDetailView";

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";
const TRAINING_ID = "22222222-2222-2222-2222-222222222222";

const DETAIL: ClientTrainingDetail = {
  trainingId: TRAINING_ID,
  date: "2026-11-15",
  dayOfWeek: 0,
  startTime: "18:00",
  endTime: "19:30",
  trainingContextLabel: "Вечерняя группа",
  description: null,
  trainerName: "Иван",
  levelName: "Начинающий",
  courtNumber: null,
  bookingStatus: "booked",
  trainingStatus: "open",
  viewerRelation: "booked",
  bookingId: BOOKING_ID,
  groupSubscriptionId: null,
  canCancel: true,
  exportEligible: true,
  waitlistPosition: null,
  participants: { trainingId: TRAINING_ID, participantCount: 0, participants: [], waitlistCount: 0, waitlist: [] }
};

function liablePreview(overrides: Partial<BookingCancellationPreview> = {}): BookingCancellationPreview {
  return {
    kind: "liable",
    bookingId: BOOKING_ID,
    trainingId: TRAINING_ID,
    trainingStartsAt: "2026-11-15T17:00:00.000Z",
    trainingLabel: DETAIL.trainingContextLabel,
    trainerName: DETAIL.trainerName,
    date: DETAIL.date,
    startTime: DETAIL.startTime,
    endTime: DETAIL.endTime,
    cancellable: true,
    policyHours: 24,
    policyVersion: 1,
    cutoffAt: "2026-11-14T17:00:00.000Z",
    amountRsd: 1850,
    billingKind: "single",
    paymentStatus: "unpaid",
    confirmationToken: "preview-token-1",
    confirmationExpiresAt: "2026-11-15T16:30:00.000Z",
    ...overrides
  } as BookingCancellationPreview;
}

let api: Record<string, ReturnType<typeof vi.fn>>;

vi.mock("../api/ApiProvider", () => ({
  useApiClient: () => api,
  useApi: () => ({ client: api, status: "ready", error: null })
}));
vi.mock("../tg/buttons", () => ({
  useMainButton: () => {},
  hapticSelection: () => {},
  hapticSuccess: () => {},
  hapticWarning: () => {}
}));

function makeApi() {
  return {
    getMe: vi.fn(() => ({ telegramId: 42, name: "Аня", username: "anya", language: "ru" })),
    getClientTrainingDetail: vi.fn().mockResolvedValue(DETAIL),
    getBookingCancellationPreview: vi.fn().mockResolvedValue(liablePreview()),
    cancelBooking: vi.fn().mockResolvedValue({} as BookingCancellationResult)
  };
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <AppRoot>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <TrainingDetailView trainingId={TRAINING_ID} onBack={vi.fn()} />
        </LanguageProvider>
      </QueryClientProvider>
    </AppRoot>
  );
}

async function openCancelSheet() {
  fireEvent.click(await screen.findByRole("button", { name: "Отменить запись" }));
  return screen.findByRole("dialog");
}

function cancelButton(dialog: HTMLElement): HTMLButtonElement {
  return within(dialog).getByRole("button", { name: "Отменить запись" }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrainingDetailView cancellation", () => {
  it("keeps confirmation disabled while the preview loads or fails, then shows the server amount, policy and localized payment state", async () => {
    let resolvePreview: ((preview: BookingCancellationPreview) => void) | undefined;
    api = makeApi();
    api.getBookingCancellationPreview.mockImplementation(
      () => new Promise<BookingCancellationPreview>((resolve) => { resolvePreview = resolve; })
    );
    renderDetail();

    const dialog = await openCancelSheet();
    expect(within(dialog).getByText("Проверяем условия отмены…")).toBeTruthy();
    expect(cancelButton(dialog).disabled).toBe(true);

    resolvePreview?.(liablePreview({ paymentStatus: "unpaid", amountRsd: 1850, policyHours: 24 }));
    await waitFor(() => expect(within(dialog).getByText(/менее чем за 24 ч.*1 850 RSD \(Не оплачено\)/)).toBeTruthy());
    expect(cancelButton(dialog).disabled).toBe(false);
  });

  it("surfaces a preview error and keeps confirmation unavailable", async () => {
    api = makeApi();
    api.getBookingCancellationPreview.mockRejectedValueOnce(new Error("Предпросмотр больше недоступен."));
    renderDetail();

    const dialog = await openCancelSheet();
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Предпросмотр больше недоступен.");
    expect(cancelButton(dialog).disabled).toBe(true);
  });

  it("posts the preview token once, then requires an explicit confirmation using the fresh 409 preview", async () => {
    const freshPreview = liablePreview({ confirmationToken: "preview-token-2", amountRsd: 2200, paymentStatus: "paid" });
    api = makeApi();
    api.cancelBooking.mockRejectedValueOnce(new LateCancellationConfirmationRequiredError(freshPreview));
    renderDetail();

    const dialog = await openCancelSheet();
    await waitFor(() => expect(cancelButton(dialog).disabled).toBe(false));
    fireEvent.click(cancelButton(dialog));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith(BOOKING_ID, "preview-token-1"));
    await waitFor(() => expect(within(dialog).getByText(/2 200 RSD \(Оплачено\)/)).toBeTruthy());
    expect(api.cancelBooking).toHaveBeenCalledTimes(1);

    fireEvent.click(cancelButton(dialog));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenLastCalledWith(BOOKING_ID, "preview-token-2"));
  });

  it("disables confirmation during submission so repeated taps create one cancellation request", async () => {
    let resolveCancel: ((result: BookingCancellationResult) => void) | undefined;
    api = makeApi();
    api.cancelBooking.mockImplementation(
      () => new Promise<BookingCancellationResult>((resolve) => { resolveCancel = resolve; })
    );
    renderDetail();

    const dialog = await openCancelSheet();
    await waitFor(() => expect(cancelButton(dialog).disabled).toBe(false));
    fireEvent.click(cancelButton(dialog));
    fireEvent.click(cancelButton(dialog));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledTimes(1));
    expect(cancelButton(dialog).disabled).toBe(true);
    resolveCancel?.({} as BookingCancellationResult);
  });
});
