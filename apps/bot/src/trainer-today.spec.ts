import { describe, expect, it, vi } from "vitest";
import type { Booking, TrainerTodayItem, TrainingRoster } from "@beosand/types";
import { NAV_ACTIONS } from "./menu";
import type { MenuReplyCtx } from "./navigation";
import { getStaticCatalog } from "@beosand/i18n";
import {
  attendData,
  handleMarkAttendance,
  handleTrainerRoster,
  handleTrainerToday,
  handleTrainerUpcoming,
  parseAttend,
  parseRoster,
  renderRosterText,
  renderTodayText,
  renderUpcomingText,
  rosterData,
  rosterKeyboard,
  todayKeyboard,
  TRAINER_ACTIONS,
  type TrainerTodayApi
} from "./trainer-today";

const ru = getStaticCatalog("ru");
const TODAY_HEADER = ru["bot.trainer.todayHeader"];
const UPCOMING_HEADER = ru["bot.trainer.upcomingHeader"];
const NO_UPCOMING_TEXT = ru["bot.trainer.noUpcoming"];
const NO_TODAY_TRAININGS_TEXT = ru["bot.trainer.noToday"];
const NOT_TRAINER_TEXT = ru["bot.trainer.notTrainer"];
const EMPTY_ROSTER_TEXT = ru["bot.trainer.emptyRoster"];

const TRAINING_ID = "11111111-1111-1111-1111-111111111111";
const BOOKING_ID = "33333333-3333-3333-3333-333333333333";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function todayItem(over: Partial<TrainerTodayItem> = {}): TrainerTodayItem {
  return {
    trainingId: TRAINING_ID,
    date: "2026-06-03",
    dayOfWeek: 3,
    startTime: "18:00",
    endTime: "19:30",
    levelName: "Начинающий",
    status: "open",
    bookedCount: 4,
    capacity: 8,
    ...over
  };
}

function roster(over: Partial<TrainingRoster> = {}): TrainingRoster {
  return {
    trainingId: TRAINING_ID,
    date: "2026-06-03",
    startTime: "18:00",
    endTime: "19:30",
    levelName: "Начинающий",
    participants: [
      {
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        clientName: "Иван",
        telegramPhotoUrl: null,
        bookingStatus: "booked",
        bookingType: "single",
        groupSubscriptionId: null
      }
    ],
    ...over
  };
}

const booking: Booking = {
  id: BOOKING_ID,
  clientId: CLIENT_ID,
  trainingId: TRAINING_ID,
  type: "single",
  groupSubscriptionId: null,
  createdAt: "2026-06-03T10:00:00.000Z",
  status: "attended",
  source: "telegram",
  paymentStatus: "unpaid",
  paidAt: null,
  paidBy: null
};

function callbacksOf(keyboard: { inline_keyboard: unknown[][] }): (string | undefined)[] {
  return keyboard.inline_keyboard
    .flat()
    .map((b) =>
      typeof b === "object" && b !== null && "callback_data" in b
        ? (b as { callback_data: string }).callback_data
        : undefined
    );
}

describe("roster callback data", () => {
  it("round-trips the trainingId and stays under Telegram's 64-byte cap", () => {
    const data = rosterData(TRAINING_ID);
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(parseRoster(data)).toBe(TRAINING_ID);
  });

  it("ignores non-roster callbacks", () => {
    expect(parseRoster("book:start:abc")).toBeUndefined();
    expect(parseRoster(undefined)).toBeUndefined();
  });
});

describe("attend callback data", () => {
  it("round-trips the bookingId + status and stays under 64 bytes", () => {
    for (const status of ["attended", "no_show"] as const) {
      const data = attendData(BOOKING_ID, status);
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
      expect(parseAttend(data)).toEqual({ bookingId: BOOKING_ID, status });
    }
  });

  it("rejects non-attend callbacks and unknown statuses", () => {
    expect(parseAttend(rosterData(TRAINING_ID))).toBeUndefined();
    expect(parseAttend(`${TRAINER_ACTIONS.attendPrefix}${BOOKING_ID}:maybe`)).toBeUndefined();
    expect(parseAttend(undefined)).toBeUndefined();
  });
});

describe("renderTodayText", () => {
  it("shows the empty line when there are no trainings", () => {
    expect(renderTodayText(ru, [])).toBe(NO_TODAY_TRAININGS_TEXT);
  });

  it("renders a header and a headcount line per training", () => {
    const text = renderTodayText(ru, [todayItem()]);
    expect(text).toContain(TODAY_HEADER);
    expect(text).toContain("4/8");
  });
});

describe("todayKeyboard", () => {
  it("gives each training a roster button, then the back/home footer", () => {
    const callbacks = callbacksOf(todayKeyboard(ru, [todayItem()]));
    expect(callbacks).toContain(rosterData(TRAINING_ID));
    expect(callbacks.slice(-2)).toEqual([NAV_ACTIONS.back, NAV_ACTIONS.home]);
  });
});

describe("renderRosterText", () => {
  it("numbers participants and shows the outcome once marked", () => {
    const text = renderRosterText(
      ru,
      roster({
        participants: [
          {
            bookingId: BOOKING_ID,
            clientId: CLIENT_ID,
            clientName: "Иван",
            telegramPhotoUrl: null,
            bookingStatus: "attended",
            bookingType: "single",
            groupSubscriptionId: null
          }
        ]
      })
    );
    expect(text).toContain("1. Иван");
    expect(text).toContain("присутствовал");
  });

  it("shows the empty-roster line when no one is signed up", () => {
    expect(renderRosterText(ru, roster({ participants: [] }))).toContain(EMPTY_ROSTER_TEXT);
  });
});

describe("rosterKeyboard", () => {
  it("gives each participant attended + no_show buttons plus a path home", () => {
    const callbacks = callbacksOf(rosterKeyboard(ru, roster()));
    expect(callbacks).toContain(attendData(BOOKING_ID, "attended"));
    expect(callbacks).toContain(attendData(BOOKING_ID, "no_show"));
    expect(callbacks).toContain(TRAINER_ACTIONS.today);
    expect(callbacks).toContain(NAV_ACTIONS.home);
  });
});

describe("handleTrainerToday", () => {
  function fakeCtx() {
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: MenuReplyCtx = { reply, from: { id: 777 } };
    return { ctx, reply };
  }

  it("lists the trainer's today trainings", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn().mockResolvedValue([todayItem()]),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const { ctx, reply } = fakeCtx();
    await handleTrainerToday(ctx, api, ru, 777);
    expect(api.getTrainerToday).toHaveBeenCalledWith(777);
    expect(reply.mock.calls[0][0]).toContain(TODAY_HEADER);
  });

  it("shows the trainers-only message when the caller is not a trainer (API null)", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn().mockResolvedValue(null),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const { ctx, reply } = fakeCtx();
    await handleTrainerToday(ctx, api, ru, 777);
    expect(reply.mock.calls[0][0]).toBe(NOT_TRAINER_TEXT);
  });

  it("never calls the API without a telegram id", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleTrainerToday({ reply }, api, ru, undefined);
    expect(api.getTrainerToday).not.toHaveBeenCalled();
  });
});

describe("renderUpcomingText", () => {
  it("uses the upcoming header and a block per training", () => {
    const text = renderUpcomingText(ru, [todayItem()]);
    expect(text).toContain(UPCOMING_HEADER);
    expect(text).toContain("Начинающий");
  });

  it("shows the empty-state line when there are no upcoming trainings", () => {
    expect(renderUpcomingText(ru, [])).toBe(NO_UPCOMING_TEXT);
  });
});

describe("handleTrainerUpcoming", () => {
  it("lists the trainer's upcoming trainings", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn().mockResolvedValue([todayItem()]),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleTrainerUpcoming({ reply, from: { id: 777 } }, api, ru, 777);
    expect(api.getTrainerUpcoming).toHaveBeenCalledWith(777);
    expect(reply.mock.calls[0][0]).toContain(UPCOMING_HEADER);
  });

  it("shows the trainers-only message when the caller is not a trainer (API null)", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn().mockResolvedValue(null),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleTrainerUpcoming({ reply, from: { id: 777 } }, api, ru, 777);
    expect(reply.mock.calls[0][0]).toBe(NOT_TRAINER_TEXT);
  });

  it("never calls the API without a telegram id", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleTrainerUpcoming({ reply }, api, ru, undefined);
    expect(api.getTrainerUpcoming).not.toHaveBeenCalled();
  });
});

describe("handleTrainerRoster", () => {
  it("fetches and renders the roster for the trainingId + caller id", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn().mockResolvedValue(roster()),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleTrainerRoster({ reply, from: { id: 777 } }, api, ru, 777, TRAINING_ID);
    expect(api.getTrainingRoster).toHaveBeenCalledWith(TRAINING_ID, 777);
    expect(reply.mock.calls[0][0]).toContain("Иван");
  });
});

describe("handleMarkAttendance", () => {
  it("forwards the mark, then re-renders the roster from the server view", async () => {
    const markAttendance = vi.fn().mockResolvedValue(booking);
    const getTrainingRoster = vi.fn().mockResolvedValue(
      roster({
        participants: [
          {
            bookingId: BOOKING_ID,
            clientId: CLIENT_ID,
            clientName: "Иван",
            telegramPhotoUrl: null,
            bookingStatus: "attended",
            bookingType: "single",
            groupSubscriptionId: null
          }
        ]
      })
    );
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster,
      markAttendance
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleMarkAttendance({ reply, from: { id: 777 } }, api, ru, 777, {
      bookingId: BOOKING_ID,
      status: "attended"
    });
    expect(markAttendance).toHaveBeenCalledWith(BOOKING_ID, "attended", 777);
    expect(getTrainingRoster).toHaveBeenCalledWith(TRAINING_ID, 777);
    expect(reply.mock.calls[0][0]).toContain("присутствовал");
  });

  it("never calls the API without a telegram id", async () => {
    const api: TrainerTodayApi = {
      getTrainerToday: vi.fn(),
      getTrainerUpcoming: vi.fn(),
      getTrainingRoster: vi.fn(),
      markAttendance: vi.fn()
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleMarkAttendance({ reply }, api, ru, undefined, {
      bookingId: BOOKING_ID,
      status: "no_show"
    });
    expect(api.markAttendance).not.toHaveBeenCalled();
  });
});
