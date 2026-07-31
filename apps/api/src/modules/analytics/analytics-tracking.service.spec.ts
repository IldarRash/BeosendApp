import { describe, expect, it, vi } from "vitest";
import { AnalyticsTrackingRepository } from "./analytics-tracking.repository";
import {
  AnalyticsTrackingService,
  normalizeStartParam
} from "./analytics-tracking.service";

describe("analytics acquisition tracking", () => {
  it("normalises a campaign link without retaining the raw parameter", () => {
    expect(normalizeStartParam("court__instagram__summer-bio")).toEqual({
      entryPoint: "court",
      source: "instagram",
      campaign: "summer-bio"
    });
  });

  it("classifies existing training links and rejects unsafe tokens", () => {
    expect(normalizeStartParam("calendar")).toEqual({
      entryPoint: "training",
      source: "telegram",
      campaign: null
    });
    expect(normalizeStartParam("court__../../secret__x")).toEqual({
      entryPoint: "court",
      source: "telegram",
      campaign: "x"
    });
  });

  it("stores only the normalised non-identifying bucket", async () => {
    const createSession = vi
      .fn()
      .mockResolvedValue("11111111-1111-4111-8111-111111111111");
    const service = new AnalyticsTrackingService({
      createSession
    } as unknown as AnalyticsTrackingRepository);

    await service.recordLaunch("group__newsletter__july");

    expect(createSession).toHaveBeenCalledWith({
      entryPoint: "training",
      source: "newsletter",
      campaign: "july"
    });
  });
});
