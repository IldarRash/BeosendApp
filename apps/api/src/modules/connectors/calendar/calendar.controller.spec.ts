import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CalendarController } from "./calendar.controller";
import type { CalendarFeedService } from "./calendar-feed.service";
import type { CalendarLinkService } from "./calendar-link.service";

const VALID_ID = "11111111-1111-1111-1111-111111111111";

/** A chainable response double capturing status/headers/body. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  const state: { code?: number; body?: string } = {};
  const res = {
    status(code: number) {
      state.code = code;
      return res;
    },
    header(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    send(body: string) {
      state.body = body;
      return res;
    }
  };
  return { res, headers, state };
}

function build(feedOver: Partial<CalendarFeedService> = {}, linkOver: Partial<CalendarLinkService> = {}) {
  const feed = {
    renderFeed: vi.fn(async () => "BEGIN:VCALENDAR\nEND:VCALENDAR"),
    ...feedOver
  } as unknown as CalendarFeedService;
  const links = {
    buildLink: vi.fn(),
    rotate: vi.fn(),
    ...linkOver
  } as unknown as CalendarLinkService;
  return { controller: new CalendarController(feed, links), feed, links };
}

describe("CalendarController", () => {
  it("serves the feed as text/calendar on a valid request", async () => {
    const { controller, feed } = build();
    const { res, headers, state } = fakeResponse();

    await controller.ics("trainer", VALID_ID, "sometoken", res as never);

    expect(feed.renderFeed).toHaveBeenCalledWith("trainer", VALID_ID, "sometoken");
    expect(headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
    expect(state.code).toBe(200);
    expect(state.body).toContain("BEGIN:VCALENDAR");
  });

  it("propagates the service's 401 on a bad token", async () => {
    const { controller } = build({
      renderFeed: vi.fn(async () => {
        throw new UnauthorizedException("Invalid calendar feed token");
      })
    });
    const { res } = fakeResponse();

    await expect(controller.ics("trainer", VALID_ID, "bad", res as never)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("400s on a missing token", async () => {
    const { controller } = build();
    const { res } = fakeResponse();

    await expect(controller.ics("trainer", VALID_ID, undefined, res as never)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("400s on an unknown subject", async () => {
    const { controller } = build();
    const { res } = fakeResponse();

    await expect(controller.ics("nope", VALID_ID, "t", res as never)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("400s on a non-uuid id", async () => {
    const { controller } = build();
    const { res } = fakeResponse();

    await expect(controller.ics("trainer", "not-a-uuid", "t", res as never)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("delegates link to the admin-gated service with the actor id", () => {
    const buildLink = vi.fn();
    const { controller } = build({}, { buildLink });
    controller.link("999", "trainer", VALID_ID);
    expect(buildLink).toHaveBeenCalledWith(999, "trainer", VALID_ID);
  });

  it("400s the link endpoint on a missing admin header", () => {
    const { controller } = build();
    expect(() => controller.link(undefined, "trainer", VALID_ID)).toThrow(BadRequestException);
  });
});
