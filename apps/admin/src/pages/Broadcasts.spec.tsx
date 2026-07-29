import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BroadcastAutomation, BroadcastAutomationPreview, BroadcastAutomationRunDetail, BroadcastTemplate, Level } from "@beosand/types";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_LOCALE, getStaticCatalog, t } from "@beosand/i18n";

vi.mock("../ui/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useLevels = vi.fn();
vi.mock("../hooks/useLevels", () => ({ useLevels: () => useLevels() }));
const automations = vi.fn(); const runs = vi.fn(); const run = vi.fn(); const actions = vi.fn();
vi.mock("../hooks/useBroadcastAutomations", () => ({
  useBroadcastAutomations: () => automations(), useBroadcastAutomationRuns: () => runs(),
  useBroadcastAutomationRun: (id: string | null) => run(id), useAutomationActions: () => actions()
}));
const useBroadcastPreview = vi.fn(); const useBroadcastTemplates = vi.fn(); const useSendBroadcast = vi.fn();
vi.mock("../hooks/useBroadcasts", () => ({
  useBroadcastPreview: (...args: unknown[]) => useBroadcastPreview(...args),
  useBroadcastTemplates: (...args: unknown[]) => useBroadcastTemplates(...args),
  useSendBroadcast: () => useSendBroadcast()
}));

import { Broadcasts } from "./Broadcasts";

const catalog = getStaticCatalog(DEFAULT_LOCALE);
const tr = (key: string, params?: Record<string, string | number>) => t(catalog, key, params);
const ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const level: Level = { id: ID, name: "Beginner", status: "active" };
const template: BroadcastTemplate = { id: "33333333-3333-4333-8333-333333333333", name: "Existing", broadcastType: "tomorrow", status: "active", bodyTemplate: "x", slotLineTemplate: "x", emptyBodyTemplate: "x", version: 2, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", updatedBy: 1 };
const automation: BroadcastAutomation = { id: ID, name: "Tomorrow", enabled: false, trigger: { kind: "scheduled", recurrence: "daily", time: "10:00", trainingWindow: "tomorrow" }, audience: { filters: [{ dimension: "level", levelIds: [ID] }, { dimension: "activity", value: "active" }, { dimension: "gender", value: "unspecified" }] }, message: { bodies: { ru: "Здравствуйте" }, defaultLanguage: "ru", outputMode: "per-training", ctaMode: "booking" }, version: 3, createdBy: 1, updatedBy: 1, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };
const preview: BroadcastAutomationPreview = { automationId: ID, version: 3, previewToken: "preview-token-is-long-enough", trainings: [], renderedItems: [{ trainingIds: [ID], requestedLanguage: "ru", resolvedLanguage: "ru", usedFallback: false, text: "Server rendered", ctaMode: "booking", bookingTrainingId: ID }], recipientCount: 1, selectedLanguages: ["ru"], fallbackLanguages: [], warnings: [] };
const runDetail: BroadcastAutomationRunDetail = {
  run: { id: RUN_ID, automationId: ID, automationVersion: 3, triggerKind: "scheduled", sourceEventId: null, scheduledFor: null, dueAt: "2026-07-01T00:00:00.000Z", status: "completed", skipReason: null, originalRunId: "33333333-3333-4333-8333-333333333333", configSnapshot: { name: automation.name, trigger: automation.trigger, audience: automation.audience, message: automation.message }, counts: { selectedTrainings: 1, includedTrainings: 1, skippedTrainings: 0, recipients: 1, attempted: 1, sent: 1, failed: 0, ambiguous: 0, skippedDeliveries: 0 }, createdAt: "2026-07-01T00:00:00.000Z", startedAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-01T00:01:00.000Z" },
  items: [{ id: "44444444-4444-4444-8444-444444444444", runId: RUN_ID, ordinal: 1, outputMode: "per-training", ctaMode: "booking", itemSnapshot: { trainingIds: [ID], requestedLanguage: "ru", resolvedLanguage: "sr", usedFallback: true, text: "Saved message", ctaMode: "booking", bookingTrainingId: ID }, createdAt: "2026-07-01T00:00:00.000Z" }],
  trainings: [{ id: "55555555-5555-4555-8555-555555555555", runId: RUN_ID, runItemId: "44444444-4444-4444-8444-444444444444", trainingId: ID, outcome: "skipped", skipReason: "training-ineligible", trainingSnapshot: { trainingId: ID, date: "2026-07-02", startTime: "10:00", endTime: "11:00", groupName: "Morning", levelName: "Beginner", trainerName: "Ana", freeSeats: 2, priceSingleRsd: 1500 }, createdAt: "2026-07-01T00:00:00.000Z" }],
  deliveries: [{ id: "66666666-6666-4666-8666-666666666666", runId: RUN_ID, runItemId: "44444444-4444-4444-8444-444444444444", clientId: ID, telegramId: 123, requestedLanguage: "ru", resolvedLanguage: "sr", outcome: "ambiguous", skipReason: "retry-not-eligible", retryOfDeliveryId: "77777777-7777-4777-8777-777777777777", rootDeliveryId: "77777777-7777-4777-8777-777777777777", isAutomatic: true, payloadSnapshot: { trainingIds: [ID], requestedLanguage: "ru", resolvedLanguage: "sr", usedFallback: true, text: "Delivery payload", ctaMode: "booking", bookingTrainingId: ID }, attemptedAt: "2026-07-01T00:00:00.000Z", completedAt: null, diagnostic: "Telegram timeout" }, { id: "88888888-8888-4888-8888-888888888888", runId: RUN_ID, runItemId: "44444444-4444-4444-8444-444444444444", clientId: ID, telegramId: 456, requestedLanguage: "ru", resolvedLanguage: "ru", outcome: "failed", skipReason: null, retryOfDeliveryId: null, rootDeliveryId: "88888888-8888-4888-8888-888888888888", isAutomatic: true, payloadSnapshot: { trainingIds: [ID], requestedLanguage: "ru", resolvedLanguage: "ru", usedFallback: false, text: "Failed delivery payload", ctaMode: "booking", bookingTrainingId: ID }, attemptedAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-01T00:00:01.000Z", diagnostic: "Telegram rejected" }]
};
const create = vi.fn(); const update = vi.fn(); const previewMutation = vi.fn(); const enable = vi.fn(); const retry = vi.fn(); const send = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function renderPage() { render(<MemoryRouter><Broadcasts /></MemoryRouter>); }

beforeEach(() => {
  useLevels.mockReturnValue({ data: [level], isLoading: false });
  automations.mockReturnValue({ data: { items: [automation], nextCursor: null }, isLoading: false, isError: false });
  runs.mockReturnValue({ data: { pages: [{ items: [{ id: RUN_ID, triggerKind: "scheduled", status: "completed", counts: { sent: 1, failed: 1, ambiguous: 1 }, createdAt: "2026-07-01T00:00:00.000Z" }], nextCursor: null }] }, isLoading: false, isError: false, hasNextPage: false });
  run.mockReturnValue({ data: undefined, isLoading: false });
  actions.mockReturnValue({ create: { mutateAsync: create, isPending: false, isError: false }, update: { mutateAsync: update, isPending: false, isError: false }, preview: { mutateAsync: previewMutation, isPending: false }, enable: { mutateAsync: enable, isPending: false, isError: false }, disable: { mutate: vi.fn() }, retry: { mutateAsync: retry, isPending: false, error: null } });
  useBroadcastTemplates.mockReturnValue({ data: [template], isLoading: false, isError: false });
  useBroadcastPreview.mockReturnValue({ data: { type: "tomorrow", text: "Legacy server preview", recipientsCount: 2, previewToken: "preview-token", slots: [] }, isLoading: false, isFetching: false, isError: false });
  useSendBroadcast.mockReturnValue({ mutate: send, isPending: false, isError: false });
  create.mockReset(); update.mockReset(); previewMutation.mockReset(); enable.mockReset(); retry.mockReset(); send.mockReset();
});
afterEach(cleanup);

describe("Broadcast automation builder", () => {
  it("keeps enable preview-token gated and sends the preview-bound version", async () => {
    enable.mockResolvedValueOnce({ ...automation, enabled: true });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.edit") }));
    expect(screen.getByRole("button", { name: tr("admin.broadcasts.enable") }).hasAttribute("disabled")).toBe(true);
    previewMutation.mockResolvedValueOnce(preview);
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    await waitFor(() => expect(screen.getByText("Server rendered")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.enable") }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith({ id: ID, input: { expectedVersion: 3, previewToken: preview.previewToken } }));
  });

  it("renders a stale-version enable error returned by the server", () => {
    actions.mockReturnValue({ create: { mutateAsync: create, isPending: false, isError: false }, update: { mutateAsync: update, isPending: false, isError: false }, preview: { mutateAsync: previewMutation, isPending: false }, enable: { mutateAsync: enable, isPending: false, isError: true, error: new Error("stale version") }, disable: { mutate: vi.fn() }, retry: { mutate: retry } });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("stale version");
  });

  it("collects scheduled weekly/date forms, event trigger, and prevents a digest booking CTA", () => {
    renderPage();
    const trigger = screen.getByLabelText(tr("admin.broadcasts.trigger"));
    fireEvent.change(trigger, { target: { value: "scheduled" } });
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.recurrence")), { target: { value: "weekly" } });
    expect(screen.getByLabelText(tr("admin.broadcasts.weekdays"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.recurrence")), { target: { value: "one-time" } });
    expect(screen.getByLabelText(tr("admin.broadcasts.date"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.output")), { target: { value: "digest" } });
    expect(screen.getByLabelText(tr("admin.broadcasts.cta")).hasAttribute("disabled")).toBe(true);
    fireEvent.change(trigger, { target: { value: "freed-place" } });
    expect(screen.getByText(tr("admin.broadcasts.eventDelay"))).toBeTruthy();
  });

  it("renders migrated audience definitions accessibly and supports every unique filter dimension", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.edit") }));

    expect(screen.getByRole("group", { name: tr("admin.broadcasts.audience") })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: level.name })).toBeTruthy();
    expect((screen.getByLabelText(tr("admin.broadcasts.genderChoice")) as HTMLSelectElement).value).toBe("unspecified");

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: tr("admin.broadcasts.removeFilter") })[0]!);
    }

    const addLevels = screen.getByRole("button", { name: tr("admin.broadcasts.addLevels") });
    const addActivity = screen.getByRole("button", { name: tr("admin.broadcasts.addActivity") });
    const addGender = screen.getByRole("button", { name: tr("admin.broadcasts.addGender") });
    expect((addLevels as HTMLButtonElement).disabled).toBe(false);
    expect((addActivity as HTMLButtonElement).disabled).toBe(false);
    expect((addGender as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(addActivity);
    expect(screen.getByText(tr("admin.broadcasts.activityHint"))).toBeTruthy();
    fireEvent.click(addGender);
    expect(screen.queryByText(tr("admin.broadcasts.genderInclusiveWarning"))).toBeNull();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.genderChoice")), { target: { value: "male" } });
    expect(screen.getByText(tr("admin.broadcasts.genderInclusiveWarning"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.genderChoice")), { target: { value: "female" } });
    expect(screen.getByText(tr("admin.broadcasts.genderInclusiveWarning"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.genderChoice")), { target: { value: "unspecified" } });
    expect(screen.queryByText(tr("admin.broadcasts.genderInclusiveWarning"))).toBeNull();

    fireEvent.click(addLevels);
    expect(screen.getByText(tr("admin.broadcasts.levelRequired"))).toBeTruthy();
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.saveDraft") }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: level.name }));
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.saveDraft") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("invalidates the preview and disables its actions when audience state changes", async () => {
    previewMutation.mockResolvedValue(preview);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.edit") }));
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    await waitFor(() => expect(screen.getByText("Server rendered")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: level.name }));
    expect(screen.queryByText("Server rendered")).toBeNull();
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.preview") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires saving audience and draft changes before previewing or enabling again", async () => {
    const saved = { ...automation, name: "Edited tomorrow", version: 4 };
    const savedPreview = { ...preview, version: saved.version, previewToken: "saved-preview-token-is-long-enough", renderedItems: [{ ...preview.renderedItems[0]!, text: "Saved version preview" }] };
    previewMutation.mockResolvedValueOnce(preview).mockResolvedValueOnce(savedPreview);
    update.mockResolvedValueOnce(saved);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.edit") }));
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    await waitFor(() => expect(screen.getByText("Server rendered")).toBeTruthy());
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.name")), { target: { value: saved.name } });
    expect(screen.queryByText("Server rendered")).toBeNull();
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.preview") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.saveDraft") }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: ID, input: expect.objectContaining({ expectedVersion: 3, name: saved.name }) }));
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.preview") }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    await waitFor(() => expect(screen.getByText("Saved version preview")).toBeTruthy());
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: level.name }));
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.preview") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores an in-flight preview after the draft, selected automation, or saved version changes", async () => {
    const other = { ...automation, id: "99999999-9999-4999-8999-999999999999", name: "Other", version: 8 };
    const later = deferred<BroadcastAutomationPreview>();
    const saved = { ...automation, name: "Updated", version: 4 };
    automations.mockReturnValue({ data: { items: [automation, other], nextCursor: null }, isLoading: false, isError: false });
    previewMutation.mockReturnValue(later.promise);
    update.mockResolvedValueOnce(saved);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: tr("admin.action.edit") })[0]!);
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.name")), { target: { value: "Draft edit" } });
    later.resolve(preview);
    await waitFor(() => expect(screen.queryByText("Server rendered")).toBeNull());
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);

    const selectionPreview = deferred<BroadcastAutomationPreview>();
    previewMutation.mockReturnValueOnce(selectionPreview.promise);
    fireEvent.click(screen.getAllByRole("button", { name: tr("admin.action.edit") })[0]!);
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    fireEvent.click(screen.getAllByRole("button", { name: tr("admin.action.edit") })[1]!);
    selectionPreview.resolve(preview);
    await waitFor(() => expect(screen.queryByText("Server rendered")).toBeNull());
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);

    const versionPreview = deferred<BroadcastAutomationPreview>();
    previewMutation.mockReturnValueOnce(versionPreview.promise);
    fireEvent.click(screen.getAllByRole("button", { name: tr("admin.action.edit") })[0]!);
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.preview") }));
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.name")), { target: { value: saved.name } });
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.saveDraft") }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    versionPreview.resolve(preview);
    await waitFor(() => expect(screen.queryByText("Server rendered")).toBeNull());
    expect((screen.getByRole("button", { name: tr("admin.broadcasts.enable") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports audience completeness independently from invalid draft fields", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.edit") }));
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.name")), { target: { value: "" } });
    fireEvent.change(screen.getAllByRole("textbox").find((input) => input.tagName === "TEXTAREA")!, { target: { value: "" } });
    expect(screen.getByText(tr("admin.broadcasts.audienceReady"))).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: level.name }));
    expect(screen.getByText(tr("admin.broadcasts.audienceIncomplete"))).toBeTruthy();
  });

  it("renders persisted run evidence and only retries ambiguous deliveries after explicit acknowledgement", async () => {
    run.mockReturnValue({ data: runDetail, isLoading: false, error: null });
    retry.mockResolvedValue({ run: runDetail.run, selectedDeliveryCount: 2 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: tr("admin.action.view") }));
    expect(screen.getByText("Saved message")).toBeTruthy();
    expect(screen.getByText("Delivery payload")).toBeTruthy();
    expect(screen.getByText("training-ineligible")).toBeTruthy();
    expect(screen.getByText("Telegram timeout")).toBeTruthy();
    expect(screen.getByText(/77777777-7777-4777-8777-777777777777/)).toBeTruthy();
    expect(screen.getByRole("button", { name: tr("admin.broadcasts.openOriginalRun") })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: tr("admin.broadcasts.retrySelect") }));
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.retry") }));
    await waitFor(() => expect(retry).toHaveBeenLastCalledWith({ runId: RUN_ID, input: { deliveryIds: ["88888888-8888-4888-8888-888888888888"], includeAmbiguous: false } }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2"));
    fireEvent.click(screen.getByRole("checkbox", { name: tr("admin.broadcasts.retryAmbiguous") }));
    expect(screen.getByText(tr("admin.broadcasts.duplicateWarning"))).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: tr("admin.broadcasts.retrySelect") })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("checkbox", { name: tr("admin.broadcasts.retrySelect") })[0]!);
    await waitFor(() => expect((screen.getAllByRole("checkbox", { name: tr("admin.broadcasts.retrySelect") })[0] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.retry") }));
    await waitFor(() => expect(retry).toHaveBeenLastCalledWith({ runId: RUN_ID, input: { deliveryIds: ["88888888-8888-4888-8888-888888888888", "66666666-6666-4666-8666-666666666666"], includeAmbiguous: true, acknowledgeAmbiguous: true } }));
  });

  it("keeps legacy selection, server preview and manual send, without legacy creation or auto-switch controls", () => {
    renderPage();
    expect(screen.getByRole("option", { name: tr("admin.broadcasts.templateOption", { name: template.name, version: template.version }) })).toBeTruthy();
    expect(screen.getByText("Legacy server preview")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("admin.broadcasts.templateField")), { target: { value: template.id } });
    fireEvent.click(screen.getByRole("button", { name: tr("admin.broadcasts.send") }));
    expect(send).toHaveBeenCalledWith({ type: "tomorrow", audience: { kind: "all" }, templateId: template.id, previewToken: "preview-token" });
    expect(screen.queryByText(/create template|edit template|automatic notifications/i)).toBeNull();
  });
});
