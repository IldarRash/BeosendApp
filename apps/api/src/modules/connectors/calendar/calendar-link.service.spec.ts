import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { CalendarFeedService } from "./calendar-feed.service";
import { CalendarLinkService } from "./calendar-link.service";
import { verifyFeedToken } from "./calendar-token";

const SECRET = "feed-secret-0123456789abcdef";
const ADMIN = 999;
const NON_ADMIN = 12;

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    CALENDAR_FEED_SECRET: SECRET,
    PUBLIC_BASE_URL: "https://book.beosand.test",
    ADMIN_TELEGRAM_IDS: [String(ADMIN)],
    ...over
  } as unknown as Env;
}

function build(
  env: Env,
  version: number | undefined
) {
  const feed = new CalendarFeedService(env, {} as never, {} as never, {} as never);
  vi.spyOn(feed, "currentVersion").mockResolvedValue(version);
  const clients = {
    bumpCalendarFeedVersion: vi.fn(async () => 2)
  };
  const trainers = { bumpCalendarFeedVersion: vi.fn(async () => 2) };
  const service = new CalendarLinkService(env, feed, clients as never, trainers as never);
  return { service, clients, trainers };
}

describe("CalendarLinkService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds a signed link for an admin", async () => {
    const { service } = build(makeEnv(), 1);
    const link = await service.buildLink(ADMIN, "trainer", "11111111-1111-1111-1111-111111111111");

    expect(link.subject).toBe("trainer");
    expect(link.url).toContain(
      "https://book.beosand.test/connectors/calendar/trainer/11111111-1111-1111-1111-111111111111.ics?token="
    );
    const token = new URL(link.url).searchParams.get("token") ?? "";
    expect(verifyFeedToken(token, SECRET)).toEqual({
      sub: "trainer",
      id: "11111111-1111-1111-1111-111111111111",
      v: 1
    });
  });

  it("forbids a non-admin from building a link", async () => {
    const { service } = build(makeEnv(), 1);
    await expect(service.buildLink(NON_ADMIN, "trainer", "t-1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("409s when the connector is not configured", async () => {
    const { service } = build(makeEnv({ CALENDAR_FEED_SECRET: undefined }), 1);
    await expect(service.buildLink(ADMIN, "trainer", "t-1")).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("404s when the subject does not exist", async () => {
    const { service } = build(makeEnv(), undefined);
    await expect(service.buildLink(ADMIN, "client", "missing")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("rotate bumps the version and returns a link at the new version (admin only)", async () => {
    const { service, trainers } = build(makeEnv(), 1);
    const link = await service.rotate(ADMIN, "trainer", "11111111-1111-1111-1111-111111111111");

    expect(trainers.bumpCalendarFeedVersion).toHaveBeenCalledOnce();
    const token = new URL(link.url).searchParams.get("token") ?? "";
    expect(verifyFeedToken(token, SECRET)?.v).toBe(2);
  });

  it("forbids a non-admin from rotating", async () => {
    const { service } = build(makeEnv(), 1);
    await expect(service.rotate(NON_ADMIN, "trainer", "t-1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
