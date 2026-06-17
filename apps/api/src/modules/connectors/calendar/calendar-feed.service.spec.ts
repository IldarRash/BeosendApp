import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import type { CalendarFeedItem } from "../../trainings/trainings.repository";
import { CalendarFeedService } from "./calendar-feed.service";
import { signFeedToken } from "./calendar-token";

const SECRET = "feed-secret-0123456789abcdef";

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    CALENDAR_FEED_SECRET: SECRET,
    PUBLIC_BASE_URL: "https://book.beosand.test",
    ...over
  } as unknown as Env;
}

const item = (over: Partial<CalendarFeedItem> = {}): CalendarFeedItem => ({
  trainingId: "11111111-1111-1111-1111-111111111111",
  date: "2026-07-15",
  startTime: "18:00",
  endTime: "19:30",
  levelName: "Начинающие",
  groupName: "Группа A",
  trainerName: "Иван",
  courtNumber: 3,
  ...over
});

interface Stubs {
  trainerItems: CalendarFeedItem[];
  clientItems: CalendarFeedItem[];
  trainerVersion?: number;
  clientVersion?: number;
}

function buildService(stubs: Stubs, env: Env = makeEnv()): CalendarFeedService {
  const trainings = {
    listUpcomingForTrainerFeed: vi.fn(async () => stubs.trainerItems),
    listUpcomingForClientFeed: vi.fn(async () => stubs.clientItems)
  };
  const clients = {
    findCalendarFeedVersion: vi.fn(async () => stubs.clientVersion)
  };
  const trainers = {
    findCalendarFeedVersion: vi.fn(async () => stubs.trainerVersion)
  };
  return new CalendarFeedService(
    env,
    trainings as never,
    clients as never,
    trainers as never
  );
}

describe("CalendarFeedService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a VEVENT per upcoming training with Belgrade DTSTART/DTEND", async () => {
    const service = buildService({
      trainerItems: [item(), item({ trainingId: "22222222-2222-2222-2222-222222222222" })],
      clientItems: [],
      trainerVersion: 1
    });
    const token = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);

    const ics = await service.renderFeed("trainer", "t-1", token);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    // 18:00 Belgrade (summer, CEST) renders as the literal wall-clock with TZID.
    expect(ics).toContain("DTSTART;TZID=Europe/Belgrade:20260715T180000");
    expect(ics).toContain("DTEND;TZID=Europe/Belgrade:20260715T193000");
    expect(ics).toContain("SUMMARY:Начинающие • Иван");
    expect(ics).toContain("LOCATION:Корт 3");
  });

  it("uses a stable UID per training id", async () => {
    const service = buildService({
      trainerItems: [item()],
      clientItems: [],
      trainerVersion: 1
    });
    const token = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);

    const ics = await service.renderFeed("trainer", "t-1", token);

    expect(ics).toContain("UID:training-11111111-1111-1111-1111-111111111111-trainer@beosand");
  });

  it("produces a valid empty VCALENDAR when there are no upcoming trainings", async () => {
    const service = buildService({ trainerItems: [], clientItems: [], clientVersion: 1 });
    const token = signFeedToken({ sub: "client", id: "c-1", v: 1 }, SECRET);

    const ics = await service.renderFeed("client", "c-1", token);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("renders a winter (CET) wall-clock correctly", async () => {
    const service = buildService({
      trainerItems: [item({ date: "2026-01-15", startTime: "09:00", endTime: "10:00" })],
      clientItems: [],
      trainerVersion: 1
    });
    const token = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);

    const ics = await service.renderFeed("trainer", "t-1", token);

    expect(ics).toContain("DTSTART;TZID=Europe/Belgrade:20260115T090000");
    expect(ics).toContain("DTEND;TZID=Europe/Belgrade:20260115T100000");
  });

  it("401s on a token whose version no longer matches the subject (rotated)", async () => {
    const service = buildService({
      trainerItems: [item()],
      clientItems: [],
      trainerVersion: 2 // subject rotated to v2
    });
    const oldToken = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);

    await expect(service.renderFeed("trainer", "t-1", oldToken)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("401s on a token signed with the wrong secret", async () => {
    const service = buildService({ trainerItems: [], clientItems: [], trainerVersion: 1 });
    const forged = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, "wrong-secret-value");

    await expect(service.renderFeed("trainer", "t-1", forged)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("401s when the subject in the token does not match the route subject", async () => {
    const service = buildService({ trainerItems: [], clientItems: [], clientVersion: 1 });
    const token = signFeedToken({ sub: "trainer", id: "c-1", v: 1 }, SECRET);

    await expect(service.renderFeed("client", "c-1", token)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("401s when the connector is not configured (no secret)", async () => {
    const service = buildService(
      { trainerItems: [], clientItems: [], trainerVersion: 1 },
      makeEnv({ CALENDAR_FEED_SECRET: undefined })
    );
    const token = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);

    await expect(service.renderFeed("trainer", "t-1", token)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(service.isEnabled()).toBe(false);
  });
});
