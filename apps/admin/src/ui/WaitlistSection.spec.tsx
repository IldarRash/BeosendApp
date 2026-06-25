import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Group, TrainingRoster, WaitlistAdminItem } from "@beosand/types";

// --- Mocks ---------------------------------------------------------------

const notify = vi.fn();
vi.mock("./Toast", () => ({
  useToast: () => ({ notify })
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

const useTrainingWaitlist = vi.fn();
const usePromoteWaitlistEntry = vi.fn();
const useRemoveWaitlistEntry = vi.fn();
const useSwapWaitlistEntry = vi.fn();
vi.mock("../hooks/useWaitlist", () => ({
  useTrainingWaitlist: (id: string | null) => useTrainingWaitlist(id),
  usePromoteWaitlistEntry: () => usePromoteWaitlistEntry(),
  useRemoveWaitlistEntry: () => useRemoveWaitlistEntry(),
  useSwapWaitlistEntry: () => useSwapWaitlistEntry()
}));

import { WaitlistSection } from "./WaitlistSection";
import { DEFAULT_LOCALE, getStaticCatalog, t as resolve } from "@beosand/i18n";

const STATIC_RU = getStaticCatalog(DEFAULT_LOCALE);
const t = (key: string, params?: Record<string, string | number>): string =>
  resolve(STATIC_RU, key, params);

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

function idleMutation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

function listQuery(data: WaitlistAdminItem[]): Record<string, unknown> {
  return { isPending: false, isError: false, error: null, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGroups.mockReturnValue({ data: [GROUP], isLoading: false, isError: false });
  useTrainingWaitlist.mockReturnValue(listQuery([ENTRY]));
  usePromoteWaitlistEntry.mockReturnValue(idleMutation());
  useRemoveWaitlistEntry.mockReturnValue(idleMutation());
  useSwapWaitlistEntry.mockReturnValue(idleMutation());
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: ROSTER });
  useTransferGroupMember.mockReturnValue(idleMutation());
});

afterEach(cleanup);

describe("WaitlistSection (under the roster)", () => {
  it("renders the validated waitlist rows for a group training", () => {
    render(<WaitlistSection trainingId={TRAINING_ID} groupId={GROUP_ID} date="2026-06-10" t={t} />);
    expect(screen.getByText("Аня")).toBeTruthy();
    // The heading carries the row count.
    expect(screen.getByText("Лист ожидания (1)")).toBeTruthy();
    // The training waitlist is fetched for the training id.
    expect(useTrainingWaitlist.mock.calls.at(-1)?.[0]).toBe(TRAINING_ID);
  });

  it("renders nothing and makes no call for an individual training (no groupId)", () => {
    const { container } = render(
      <WaitlistSection trainingId={TRAINING_ID} groupId={null} date="2026-06-10" t={t} />
    );
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByText("Аня")).toBeNull();
    // The waitlist query is gated off (called with null).
    expect(useTrainingWaitlist.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("promotes an entry from the confirm dialog", () => {
    const mutate = vi.fn((_id, opts: { onSuccess: () => void }) => opts.onSuccess());
    usePromoteWaitlistEntry.mockReturnValue(idleMutation({ mutate }));
    render(<WaitlistSection trainingId={TRAINING_ID} groupId={GROUP_ID} date="2026-06-10" t={t} />);

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
    render(<WaitlistSection trainingId={TRAINING_ID} groupId={GROUP_ID} date="2026-06-10" t={t} />);

    fireEvent.click(screen.getByRole("button", { name: "Заменить участника клиентом Аня" }));
    const dialog = screen.getByRole("dialog", { name: "Заменить участника на Аня" });
    fireEvent.click(within(dialog).getByLabelText("Игорь"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Заменить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      entryId: ENTRY.id,
      replacesBookingId: ROSTER.participants[0].bookingId
    });
  });

  it("surfaces a waitlist load error", () => {
    useTrainingWaitlist.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      data: undefined
    });
    render(<WaitlistSection trainingId={TRAINING_ID} groupId={GROUP_ID} date="2026-06-10" t={t} />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
