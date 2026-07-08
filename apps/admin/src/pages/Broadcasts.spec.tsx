import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Broadcast, BroadcastPreview, Level } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ notify })
}));

// AppShell pulls session hooks/router context we don't exercise here.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useLevels = vi.fn();
vi.mock("../hooks/useLevels", () => ({
  useLevels: () => useLevels()
}));

const useBroadcastPreview = vi.fn();
const useSendBroadcast = vi.fn();
const sendMutate = vi.fn();
vi.mock("../hooks/useBroadcasts", () => ({
  useBroadcastPreview: (...args: unknown[]) => useBroadcastPreview(...args),
  useSendBroadcast: () => useSendBroadcast()
}));

import { Broadcasts } from "./Broadcasts";

function renderPage(): void {
  render(
    <MemoryRouter>
      <Broadcasts />
    </MemoryRouter>
  );
}

const sampleLevels: Level[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Начинающий", status: "active" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Продвинутый", status: "active" }
];

const samplePreview: BroadcastPreview = {
  type: "today",
  text: "Свободные места сегодня!",
  recipientsCount: 42,
  slots: [
    {
      trainingId: "33333333-3333-3333-3333-333333333333",
      date: "2026-06-04",
      dayOfWeek: 4,
      startTime: "18:00",
      endTime: "19:30",
      groupName: "Evening group",
      trainerName: "Анна",
      levelName: "Начинающий",
      freeSeats: 3,
      priceSingleRsd: 1500
    }
  ]
};

const sentBroadcast: Broadcast = {
  id: "44444444-4444-4444-4444-444444444444",
  type: "today",
  payload: "Свободные места сегодня!",
  createdBy: 1,
  sentAt: "2026-06-04T10:00:00.000Z",
  recipientsCount: 42
};

beforeEach(() => {
  notify.mockReset();
  sendMutate.mockReset();
  useLevels.mockReturnValue({ isLoading: false, isError: false, data: sampleLevels });
  // Default: a successful preview exists.
  useBroadcastPreview.mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: samplePreview
  });
  useSendBroadcast.mockReturnValue({ mutate: sendMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Broadcasts composer", () => {
  it("requests the preview with the default type and an 'all' audience", () => {
    renderPage();
    // type "today", audience kind "all" by default.
    const [type, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(type).toBe("today");
    expect(audience).toEqual({ kind: "all" });
  });

  it("renders the API recipient count and composed message verbatim", () => {
    renderPage();
    expect(screen.getByText("42")).toBeTruthy();
    const previewText = screen.getByText(samplePreview.text);
    expect(previewText.textContent).toBe(samplePreview.text);
    // Slot card details come straight from the preview.
    expect(screen.getByText(/Анна/)).toBeTruthy();
    expect(screen.getByText("Evening group")).toBeTruthy();
    expect(screen.getByText(/1[\s ]?500\s*RSD/)).toBeTruthy();
  });

  it("builds a level audience when the level kind + level are chosen", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Аудитория"), { target: { value: "level" } });
    fireEvent.change(screen.getByLabelText("Уровень"), {
      target: { value: sampleLevels[1].id }
    });
    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toEqual({ kind: "level", levelId: sampleLevels[1].id });
  });

  it("gates the preview (null audience) until a level is picked", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Аудитория"), { target: { value: "level" } });
    // Level kind chosen but no level selected yet ⇒ audience must be null.
    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toBeNull();
  });

  it("builds an active-days audience from the days field", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Аудитория"), { target: { value: "active" } });
    fireEvent.change(screen.getByLabelText("Период, дней"), { target: { value: "30" } });
    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toEqual({ kind: "active", days: 30 });
  });

  it("sends the previewed broadcast with { type, audience }", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(sendMutate).toHaveBeenCalledTimes(1);
    expect(sendMutate.mock.calls[0][0]).toEqual({ type: "today", audience: { kind: "all" } });
  });

  it("toasts the persisted recipients reached on a successful send", () => {
    sendMutate.mockImplementation(
      (_input, opts?: { onSuccess?: (b: Broadcast) => void }) => opts?.onSuccess?.(sentBroadcast)
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("42");
    expect(notify.mock.calls[0][1]).toBe("success");
  });

  it("surfaces a send error via a toast", () => {
    sendMutate.mockImplementation(
      (_input, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("boom"))
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("boom");
    expect(notify.mock.calls[0][1]).toBe("error");
  });

  it("disables send until a preview exists", () => {
    useBroadcastPreview.mockReturnValue({
      isLoading: true,
      isError: false,
      error: null,
      data: undefined
    });
    renderPage();
    const sendButton = screen.getByRole("button", { name: "Отправить" });
    expect(sendButton.hasAttribute("disabled")).toBe(true);
  });

  it("shows a loading state while the preview is computing", () => {
    useBroadcastPreview.mockReturnValue({
      isLoading: true,
      isError: false,
      error: null,
      data: undefined
    });
    renderPage();
    expect(screen.getByText("Расчёт охвата…")).toBeTruthy();
  });

  it("surfaces a preview error", () => {
    useBroadcastPreview.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("nope"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("nope");
  });
});
