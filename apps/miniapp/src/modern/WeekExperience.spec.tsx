import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, ClientRecord, TrainingScheduleSlot } from "@beosand/types";
import {
  WeekExperience,
  addLocalDays,
  minimumScheduleDate,
  mondayOf,
  normalizeScheduleDate
} from "./WeekExperience";

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
let currentToday = "2026-09-23";
const FIXED_NOW = new Date("2026-09-23T12:00:00.000Z");
const hooks = {
  records: {} as Record<string, unknown>,
  schedule: {} as Record<string, unknown>,
  scheduleForQuery: undefined as
    | ((query: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
  scheduleQuery: undefined as Record<string, unknown> | undefined
};

vi.mock("../api/hooks", () => ({
  useClientRecords: () => hooks.records,
  useLevels: () => ({ data: [], isLoading: false }),
  useTrainingSchedule: (query: Record<string, unknown>) => {
    hooks.scheduleQuery = query;
    return hooks.scheduleForQuery?.(query) ?? hooks.schedule;
  }
}));
vi.mock("../i18n/LanguageProvider", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(",")}` : key,
  useLanguage: () => ({ locale: "ru" })
}));
vi.mock("../router/NavProvider", () => ({ useNav: () => nav }));
vi.mock("../tg/buttons", () => ({
  hapticSelection: vi.fn(),
  useBackButton: vi.fn((_visible: boolean, onBack: () => void) => {
    backHandler = onBack;
  })
}));
vi.mock("../screens/useSlotBookingFlow", () => ({ useSlotBookingFlow: () => flow }));
vi.mock("../screens/CalendarScreen", () => ({
  CalendarScreen: forwardRef(function CalendarScreen(
    {
      initialDate,
      onDateChange,
      onBack
    }: {
      initialDate?: string;
      onDateChange?: (date: string) => void;
      onBack?: () => void;
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({ goBack: () => onBack?.() }), [onBack]);
    return (
      <div data-testid="calendar-screen" data-initial-date={initialDate}>
        <button type="button" onClick={() => onDateChange?.("2026-10-05")}>
          select calendar date
        </button>
      </div>
    );
  })
}));
vi.mock("../ui/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/format")>();
  return { ...actual, todayLocalDate: () => currentToday };
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    vi.clearAllMocks();
    nav.current = "home";
    nav.canPop = false;
    flow.activeSubView = null;
    flow.isOpen = false;
    backHandler = undefined;
    currentToday = "2026-09-23";
    hooks.records = page([RECORD]);
    hooks.schedule = { data: [SLOT], isLoading: false, isError: false, error: null };
    hooks.scheduleForQuery = undefined;
    hooks.scheduleQuery = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
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

  it("blocks a past My Week selection before opening All Trainings", () => {
    render(<WeekExperience client={CLIENT} />);

    const pastDate = screen.getByRole("button", { name: "2026-09-21" }) as HTMLButtonElement;
    expect(pastDate.disabled).toBe(true);
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-23", to: "2026-09-23" });
    fireEvent.click(screen.getByRole("button", { name: "2026-09-21" }));
    fireEvent.click(screen.getByText("miniapp.week.allTrainings"));
    expect(nav.selectTab).toHaveBeenCalledWith("calendar");
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-23", to: "2026-09-23" });
  });

  it("opens the existing calendar from the schedule date control and keeps native Back in it", () => {
    nav.current = "calendar";
    render(<WeekExperience client={CLIENT} />);
    fireEvent.click(screen.getByText(/сентября 2026/i));
    expect(screen.getByTestId("calendar-screen")).toBeTruthy();
    expect(document.querySelector("dialog")).toBeNull();
    act(() => backHandler?.());
    expect(nav.pop).not.toHaveBeenCalled();
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-23", to: "2026-09-23" });
  });

  it("keeps schedule controls usable during loading and hides booking actions", () => {
    nav.current = "calendar";
    hooks.schedule = { data: [SLOT], isLoading: true, isError: false, error: null };
    render(<WeekExperience client={CLIENT} />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("miniapp.browse.seats:2")).toBeNull();
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".week-ui__date-rail button")[3]!);
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-24", to: "2026-09-24" });
  });

  it("keeps controls usable on an error and recovers after a future date query", () => {
    nav.current = "calendar";
    hooks.scheduleForQuery = (query) =>
      query.from === "2026-09-24"
        ? { data: [SLOT], isLoading: false, isError: false, error: null }
        : { data: [SLOT], isLoading: false, isError: true, error: new Error("bad range") };
    render(<WeekExperience client={CLIENT} />);

    expect(screen.getByRole("alert").textContent).toContain("bad range");
    expect(screen.queryByText("miniapp.browse.seats:2")).toBeNull();
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".week-ui__date-rail button")[3]!);
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-24", to: "2026-09-24" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("miniapp.browse.seats:2")).toBeTruthy();
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
    act(() => backHandler?.());
    expect(closeConfirm).toHaveBeenCalledOnce();
    expect(nav.pop).not.toHaveBeenCalled();
  });

  it("retains a future date selected in the calendar when returning to the schedule", () => {
    nav.current = "calendar";
    const view = render(<WeekExperience client={CLIENT} />);

    fireEvent.click(screen.getByText(/сентября 2026/i));
    expect(screen.getByTestId("calendar-screen").dataset.initialDate).toBe("2026-09-23");
    fireEvent.click(screen.getByText("select calendar date"));
    act(() => backHandler?.());

    expect(screen.queryByTestId("calendar-screen")).toBeNull();
    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-10-05", to: "2026-10-05" });
    expect(document.querySelector(".week-ui__date-rail .is-active")?.textContent ?? "").toContain(
      "5"
    );

    nav.current = "home";
    view.rerender(<WeekExperience client={CLIENT} />);
    expect(screen.getByRole("button", { name: "2026-09-21" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2026-09-27" })).toBeTruthy();
  });

  it("builds a Monday-first week across a month boundary", () => {
    expect(mondayOf("2026-03-01")).toBe("2026-02-23");
    expect(addLocalDays("2026-02-23", 6)).toBe("2026-03-01");
  });

  it("uses the later UTC or local calendar day as the schedule lower bound", () => {
    expect(minimumScheduleDate("2026-09-22", new Date("2026-09-23T00:05:00.000Z"))).toBe(
      "2026-09-23"
    );
    expect(minimumScheduleDate("2026-09-24", new Date("2026-09-23T23:55:00.000Z"))).toBe(
      "2026-09-24"
    );
  });

  it("normalizes a retained schedule selection when the minimum date advances", () => {
    nav.current = "calendar";
    const view = render(<WeekExperience client={CLIENT} />);
    currentToday = "2026-09-24";
    view.rerender(<WeekExperience client={CLIENT} />);

    expect(hooks.scheduleQuery).toMatchObject({ from: "2026-09-24", to: "2026-09-24" });
    expect(normalizeScheduleDate("2026-09-23", "2026-09-24")).toBe("2026-09-24");
  });
});
