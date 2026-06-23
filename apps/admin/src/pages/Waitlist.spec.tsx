import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Group, TrainingRoster, WaitlistAdminItem } from "@beosand/types";
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

const useGroups = vi.fn();
vi.mock("../hooks/useGroups", () => ({ useGroups: () => useGroups() }));

const useRoster = vi.fn();
vi.mock("../hooks/useRoster", () => ({ useRoster: (id: string | null) => useRoster(id) }));

const useTransferGroupMember = vi.fn();
vi.mock("../hooks/useGroupMembers", () => ({
  useTransferGroupMember: () => useTransferGroupMember()
}));

const useGroupWaitlist = vi.fn();
const usePromoteWaitlistEntry = vi.fn();
const useRemoveWaitlistEntry = vi.fn();
const useSwapWaitlistEntry = vi.fn();
vi.mock("../hooks/useWaitlist", () => ({
  useGroupWaitlist: (q: unknown) => useGroupWaitlist(q),
  usePromoteWaitlistEntry: () => usePromoteWaitlistEntry(),
  useRemoveWaitlistEntry: () => useRemoveWaitlistEntry(),
  useSwapWaitlistEntry: () => useSwapWaitlistEntry()
}));

import { Waitlist } from "./Waitlist";

const GROUP_ID = "11111111-1111-1111-1111-111111111111";
const TRAINING_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "33333333-3333-3333-3333-333333333333";

const GROUP: Group = {
  id: GROUP_ID,
  name: "Утренняя группа",
  levelId: "44444444-4444-4444-4444-444444444444",
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "55555555-5555-5555-5555-555555555555",
  trainerName: "Анна",
  courtId: null,
  courtNumber: null,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 9000,
  status: "active"
};

const ENTRY: WaitlistAdminItem = {
  id: "66666666-6666-4666-8666-666666666666",
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  position: 1,
  groupSubscriptionId: null,
  status: "waiting",
  addedAt: "2026-06-01T00:00:00.000Z",
  notifiedAt: null,
  clientName: "Аня",
  date: "2026-06-10",
  startTime: "18:00",
  endTime: "19:30",
  trainingStatus: "full",
  groupName: "Утренняя группа"
};

const ROSTER: TrainingRoster = {
  trainingId: TRAINING_ID,
  date: "2026-06-10",
  startTime: "18:00",
  endTime: "19:30",
  levelName: "Начальный",
  participants: [
    {
      bookingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      clientName: "Игорь",
      bookingStatus: "booked",
      bookingType: "single",
      groupSubscriptionId: null
    }
  ]
};

/** A passive (no-op) mutation result the page can call .reset()/.mutate() on. */
function idleMutation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

/** A settled list query the page reads (isPending/isError/data). */
function listQuery(data: WaitlistAdminItem[]): Record<string, unknown> {
  return { isPending: false, isError: false, error: null, data };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <Waitlist />
    </MemoryRouter>
  );
}

/** Pick the only group so the queue query becomes enabled and the table renders. */
function selectGroup(): void {
  fireEvent.change(screen.getByLabelText("Группа"), { target: { value: GROUP_ID } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useGroups.mockReturnValue({ data: [GROUP], isLoading: false, isError: false });
  useGroupWaitlist.mockReturnValue(listQuery([ENTRY]));
  usePromoteWaitlistEntry.mockReturnValue(idleMutation());
  useRemoveWaitlistEntry.mockReturnValue(idleMutation());
  useSwapWaitlistEntry.mockReturnValue(idleMutation());
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: ROSTER });
  useTransferGroupMember.mockReturnValue(idleMutation());
});

afterEach(cleanup);

describe("Waitlist page", () => {
  it("prompts to pick a filter before a group is selected", () => {
    renderPage();
    expect(
      screen.getByText("Выберите группу и месяц, чтобы увидеть лист ожидания.")
    ).toBeTruthy();
    // No queue is fetched until a group is chosen.
    const lastArg = useGroupWaitlist.mock.calls.at(-1)?.[0];
    expect(lastArg).toBeNull();
  });

  it("renders the validated queue rows once a group is selected", () => {
    renderPage();
    selectGroup();
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText("2026-06-10")).toBeTruthy();
    expect(screen.getByText("18:00–19:30")).toBeTruthy();
    // The queue query is enabled with the selected group + current year/month.
    const lastArg = useGroupWaitlist.mock.calls.at(-1)?.[0] as { groupId: string } | null;
    expect(lastArg?.groupId).toBe(GROUP_ID);
  });

  it("promotes an entry from the confirm dialog", () => {
    const mutate = vi.fn((_id, opts: { onSuccess: () => void }) => opts.onSuccess());
    usePromoteWaitlistEntry.mockReturnValue(idleMutation({ mutate }));
    renderPage();
    selectGroup();

    fireEvent.click(screen.getByRole("button", { name: "Записать клиента Аня из листа ожидания" }));
    const dialog = screen.getByRole("dialog", { name: "Записать из листа ожидания" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(ENTRY.id);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Аня"), "success");
  });

  it("swaps an entry ahead of a booked roster member", () => {
    const mutate = vi.fn((_args, opts: { onSuccess: () => void }) => opts.onSuccess());
    useSwapWaitlistEntry.mockReturnValue(idleMutation({ mutate }));
    renderPage();
    selectGroup();

    fireEvent.click(screen.getByRole("button", { name: "Заменить участника клиентом Аня" }));
    const dialog = screen.getByRole("dialog", { name: "Заменить участника на Аня" });
    // The roster member is offered as a radio option; pick Игорь, then confirm.
    fireEvent.click(within(dialog).getByLabelText("Игорь"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Заменить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      entryId: ENTRY.id,
      replacesBookingId: ROSTER.participants[0].bookingId
    });
  });

  it("removes an entry from the confirm dialog", () => {
    const mutate = vi.fn((_id, opts: { onSuccess: () => void }) => opts.onSuccess());
    useRemoveWaitlistEntry.mockReturnValue(idleMutation({ mutate }));
    renderPage();
    selectGroup();

    fireEvent.click(screen.getByRole("button", { name: "Убрать клиента Аня из листа ожидания" }));
    const dialog = screen.getByRole("dialog", { name: "Убрать из листа ожидания" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Убрать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(ENTRY.id);
  });

  it("surfaces a queue load error", () => {
    useGroupWaitlist.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    renderPage();
    selectGroup();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
