import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, ClientRecord, TrainingScheduleSlot } from "@beosand/types";
import { WeekExperience, addLocalDays, mondayOf } from "./WeekExperience";

const nav = { current: "home", canPop: false, push: vi.fn(), pop: vi.fn(), selectTab: vi.fn() };
const openConfirm = vi.fn();
const closeConfirm = vi.fn();
const flow = {
  activeSubView: null as JSX.Element | null,
  isOpen: false,
  close: closeConfirm,
  openConfirm
};
let backHandler: (() => void) | undefined;
const hooks = { records: {} as Record<string, unknown>, schedule: {} as Record<string, unknown> };

vi.mock("../api/hooks", () => ({
  useClientRecords: () => hooks.records,
  useLevels: () => ({ data: [], isLoading: false }),
  useTrainingSchedule: () => hooks.schedule
}));
vi.mock("../i18n/LanguageProvider", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(",")}` : key
}));
vi.mock("../router/NavProvider", () => ({ useNav: () => nav }));
vi.mock("../tg/buttons", () => ({
  hapticSelection: vi.fn(),
  useBackButton: vi.fn((_visible: boolean, onBack: () => void) => {
    backHandler = onBack;
  })
}));
vi.mock("../screens/useSlotBookingFlow", () => ({ useSlotBookingFlow: () => flow }));
vi.mock("../ui/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/format")>();
  return { ...actual, todayLocalDate: () => "2026-09-23" };
});

const CLIENT: Client = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Anna",
  telegramId: 42,
  telegramUsername: null,
  telegramPhotoUrl: null,
  gender: "female",
  levelId: null,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};
const RECORD: ClientRecord = {
  id: "court:11111111-1111-4111-8111-111111111111",
  kind: "court",
  entityId: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  date: "2026-09-23",
  startTime: "18:00",
  endTime: "19:00",
  title: null,
  trainerName: null,
  trainingKind: null,
  levelName: null,
  trainingId: null,
  bookingId: null,
  groupSubscriptionId: null,
  courtNumbers: [],
  courtCount: 1,
  priceRsd: 1500,
  waitlistPosition: null,
  reason: { code: "unavailable", comment: "No indoor court" },
  actor: null,
  canCancel: false,
  nextAction: "wait"
};
const SLOT: TrainingScheduleSlot = {
  trainingId: "22222222-2222-4222-8222-222222222222",
  date: "2026-09-23",
  dayOfWeek: 3,
  startTime: "19:00",
  endTime: "20:30",
  groupName: "Group",
  trainerName: "Coach",
  levelName: "Intermediate",
  freeSeats: 2,
  priceSingleRsd: 1500,
  trainingContextLabel: "Technique",
  trainingStatus: "open",
  bookable: true
};

function page(items: ClientRecord[], hasNextPage = false) {
  return {
    data: { pages: [{ items }] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn()
  };
}

describe("WeekExperience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.current = "home";
    nav.canPop = false;
    flow.activeSubView = null;
    flow.isOpen = false;
    backHandler = undefined;
    hooks.records = page([RECORD]);
    hooks.schedule = { data: [SLOT], isLoading: false, isError: false, error: null };
  });

  it("keeps pending records visibly pending with their reason and next action", () => {
    render(<WeekExperience client={CLIENT} />);
    expect(screen.getByText("miniapp.records.status.pending")).toBeTruthy();
    expect(
      screen.getByText(
        "miniapp.records.reason:miniapp.records.reasonCode.unavailable: No indoor court"
      )
    ).toBeTruthy();
    expect(screen.getByText("miniapp.records.next.wait")).toBeTruthy();
  });

  it("opens the schedule as the calendar route and tabs replace the current route", () => {
    render(<WeekExperience client={CLIENT} />);
    fireEvent.click(screen.getByText("miniapp.week.tab.schedule"));
    expect(nav.selectTab).toHaveBeenCalledWith("calendar");
    fireEvent.click(screen.getByText("miniapp.week.tab.profile"));
    expect(nav.selectTab).toHaveBeenCalledWith("profile");
  });

  it("shows an explicit load-more action when the paged week is incomplete", () => {
    const records = page([RECORD], true);
    hooks.records = records;
    render(<WeekExperience client={CLIENT} />);
    fireEvent.click(screen.getByText("miniapp.records.loadMore"));
    expect(records.fetchNextPage).toHaveBeenCalledOnce();
  });

  it("withholds a new booking action until the selected schedule date is covered by records pagination", () => {
    const records = page([RECORD], true);
    hooks.records = records;
    nav.current = "calendar";
    nav.canPop = true;
    render(<WeekExperience client={CLIENT} />);
    expect(screen.getByText("miniapp.week.schedulePartialTitle")).toBeTruthy();
    expect(screen.queryByText("miniapp.browse.seats:2")).toBeNull();
    fireEvent.click(screen.getByText("miniapp.records.loadMore"));
    expect(records.fetchNextPage).toHaveBeenCalledOnce();
  });

  it("does not offer a second booking action for an active training, but keeps a full row actionable for server waitlisting", () => {
    hooks.records = page([
      {
        ...RECORD,
        id: "booking:22222222-2222-4222-8222-222222222222",
        kind: "booking",
        status: "confirmed",
        trainingId: SLOT.trainingId,
        bookingId: SLOT.trainingId
      }
    ]);
    hooks.schedule = {
      data: [
        { ...SLOT },
        {
          ...SLOT,
          trainingId: "33333333-3333-4333-8333-333333333333",
          trainingStatus: "full",
          bookable: false,
          freeSeats: 0
        }
      ],
      isLoading: false,
      isError: false,
      error: null
    };
    nav.current = "calendar";
    nav.canPop = true;
    render(<WeekExperience client={CLIENT} />);
    expect(screen.getByText("miniapp.records.status.confirmed")).toBeTruthy();
    fireEvent.click(screen.getByText("miniapp.calendar.fullWaitlist"));
    expect(openConfirm).toHaveBeenCalledWith(expect.objectContaining({ trainingStatus: "full" }));
  });

  it("uses native Back to close booking confirmation before changing the route", () => {
    flow.isOpen = true;
    flow.activeSubView = <div>confirmation</div>;
    render(<WeekExperience client={CLIENT} />);
    backHandler?.();
    expect(closeConfirm).toHaveBeenCalledOnce();
    expect(nav.pop).not.toHaveBeenCalled();
  });

  it("builds a Monday-first week across a month boundary", () => {
    expect(mondayOf("2026-03-01")).toBe("2026-02-23");
    expect(addLocalDays("2026-02-23", 6)).toBe("2026-03-01");
  });
});
