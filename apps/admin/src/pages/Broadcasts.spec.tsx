import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  Broadcast,
  BroadcastPreview,
  BroadcastTemplate,
  BroadcastTemplateVariable,
  Level
} from "@beosand/types";
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
const useBroadcastTemplates = vi.fn();
const useBroadcastTemplateVariables = vi.fn();
const useCreateBroadcastTemplate = vi.fn();
const useUpdateBroadcastTemplate = vi.fn();
const useSendBroadcast = vi.fn();
const sendMutate = vi.fn();
const createTemplateMutate = vi.fn();
const updateTemplateMutate = vi.fn();
vi.mock("../hooks/useBroadcasts", () => ({
  useBroadcastPreview: (...args: unknown[]) => useBroadcastPreview(...args),
  useBroadcastTemplates: (...args: unknown[]) => useBroadcastTemplates(...args),
  useBroadcastTemplateVariables: (...args: unknown[]) => useBroadcastTemplateVariables(...args),
  useCreateBroadcastTemplate: () => useCreateBroadcastTemplate(),
  useUpdateBroadcastTemplate: () => useUpdateBroadcastTemplate(),
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

const templateNameLabel = /Название шаблона|admin\.broadcasts\.templateName/;
const templateBodyLabel = /Основной текст|admin\.broadcasts\.templateBody/;
const templateSlotLineLabel = /Строка слота|admin\.broadcasts\.templateSlotLine/;
const templateEmptyLabel =
  /Текст без свободных слотов|admin\.broadcasts\.templateEmpty/;

function getTemplateSelect(): HTMLElement {
  return screen.getByRole("combobox", { name: "Шаблон" });
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
      trainerName: "Анна",
      groupName: "Beach Start",
      levelName: "Начинающий",
      freeSeats: 3,
      priceSingleRsd: 1500
    }
  ]
};

const sampleTemplate: BroadcastTemplate = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Weekend push",
  broadcastType: "today",
  status: "active",
  bodyTemplate: "Body {groupName}",
  slotLineTemplate: "{date} {startTime} {groupName}",
  emptyBodyTemplate: "No slots",
  version: 2,
  createdAt: "2026-06-04T09:00:00.000Z",
  updatedAt: "2026-06-04T09:30:00.000Z",
  updatedBy: 1
};

const sampleVariables: BroadcastTemplateVariable[] = [
  {
    key: "groupName",
    placeholder: "{groupName}",
    label: "Group name",
    description: "Full group name resolved by the server.",
    example: "Beach Start",
    valueType: "string"
  },
  {
    key: "freeSeats",
    placeholder: "{freeSeats}",
    label: "Free seats",
    description: "Server-computed remaining capacity.",
    example: "3",
    valueType: "integer"
  }
];

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
  createTemplateMutate.mockReset();
  updateTemplateMutate.mockReset();
  useLevels.mockReturnValue({ isLoading: false, isError: false, data: sampleLevels });
  useBroadcastTemplates.mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: [sampleTemplate]
  });
  useBroadcastTemplateVariables.mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: sampleVariables
  });
  useCreateBroadcastTemplate.mockReturnValue({
    mutate: createTemplateMutate,
    isPending: false,
    error: null
  });
  useUpdateBroadcastTemplate.mockReturnValue({
    mutate: updateTemplateMutate,
    isPending: false,
    error: null
  });
  useBroadcastPreview.mockReturnValue({
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    data: samplePreview
  });
  useSendBroadcast.mockReturnValue({ mutate: sendMutate, isPending: false, error: null });
});

afterEach(cleanup);

describe("Broadcasts composer", () => {
  it("requests the preview with the default type, all audience, and no template", () => {
    renderPage();
    const [type, audience, templateId] = useBroadcastPreview.mock.calls.at(-1) as [
      string,
      unknown,
      unknown
    ];
    expect(type).toBe("today");
    expect(audience).toEqual({ kind: "all" });
    expect(templateId).toBeNull();
  });

  it("renders the API recipient count, composed message, variables and slot metadata verbatim", () => {
    renderPage();
    expect(screen.getByText("42")).toBeTruthy();
    const previewText = screen.getByText(samplePreview.text);
    expect(previewText.textContent).toBe(samplePreview.text);
    // Slot card details come straight from the preview.
    expect(screen.getByText("Beach Start")).toBeTruthy();
    expect(screen.getByText(/Анна/)).toBeTruthy();
    expect(screen.getByText(/1[\s ]?500\s*RSD/)).toBeTruthy();
    expect(screen.getByText("{groupName}")).toBeTruthy();
    expect(screen.getByText("{freeSeats}")).toBeTruthy();
  });

  it("builds a level audience when the level kind and level are chosen", () => {
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
    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toBeNull();
  });

  it("does not send when level audience is selected without a level", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Аудитория"), { target: { value: "level" } });

    const sendButton = screen.getByRole("button", { name: "Отправить" });
    expect(sendButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(sendButton);

    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toBeNull();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it("builds an active-days audience from the days field", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Аудитория"), { target: { value: "active" } });
    fireEvent.change(screen.getByLabelText("Период, дней"), { target: { value: "30" } });
    const [, audience] = useBroadcastPreview.mock.calls.at(-1) as [string, unknown];
    expect(audience).toEqual({ kind: "active", days: 30 });
  });

  it("sends the previewed fixed broadcast with { type, audience }", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(sendMutate).toHaveBeenCalledTimes(1);
    expect(sendMutate.mock.calls[0][0]).toEqual({ type: "today", audience: { kind: "all" } });
  });

  it("passes selected templateId to preview and sends templateId with previewToken", () => {
    useBroadcastPreview.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      data: {
        ...samplePreview,
        templateId: sampleTemplate.id,
        templateVersion: 2,
        previewToken: "preview-token",
        templateVariables: sampleVariables
      }
    });

    renderPage();
    fireEvent.change(getTemplateSelect(), {
      target: { value: sampleTemplate.id }
    });

    const [, , templateId] = useBroadcastPreview.mock.calls.at(-1) as [
      string,
      unknown,
      string
    ];
    expect(templateId).toBe(sampleTemplate.id);

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(sendMutate.mock.calls[0][0]).toEqual({
      type: "today",
      audience: { kind: "all" },
      templateId: sampleTemplate.id,
      previewToken: "preview-token"
    });
  });

  it("requires a fresh preview token before templated send", () => {
    renderPage();
    fireEvent.change(getTemplateSelect(), {
      target: { value: sampleTemplate.id }
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(sendMutate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("creates a new template from the editor form", () => {
    renderPage();
    fireEvent.change(getTemplateSelect(), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText(templateNameLabel), { target: { value: "Fresh copy" } });
    fireEvent.change(screen.getByLabelText(templateBodyLabel), {
      target: { value: "Body {groupName}" }
    });
    fireEvent.change(screen.getByLabelText(templateSlotLineLabel), {
      target: { value: "{date} {startTime}" }
    });
    fireEvent.change(screen.getByLabelText(templateEmptyLabel), {
      target: { value: "No slots" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(createTemplateMutate.mock.calls[0][0]).toEqual({
      name: "Fresh copy",
      broadcastType: "today",
      bodyTemplate: "Body {groupName}",
      slotLineTemplate: "{date} {startTime}",
      emptyBodyTemplate: "No slots"
    });
  });

  it("updates an existing template from the editor form", () => {
    renderPage();
    fireEvent.change(getTemplateSelect(), {
      target: { value: sampleTemplate.id }
    });
    fireEvent.change(screen.getByLabelText(templateNameLabel), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(updateTemplateMutate.mock.calls[0][0]).toEqual({
      id: sampleTemplate.id,
      input: {
        name: "Updated",
        bodyTemplate: sampleTemplate.bodyTemplate,
        slotLineTemplate: sampleTemplate.slotLineTemplate,
        emptyBodyTemplate: sampleTemplate.emptyBodyTemplate
      }
    });
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
      isFetching: true,
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
      isFetching: true,
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
      isFetching: false,
      isError: true,
      error: new Error("nope"),
      data: undefined
    });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("nope");
  });
});
