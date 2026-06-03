import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok,
        status,
        json: async () => Promise.resolve(body)
      } as Response)
    )
  );
}

describe("ApiClient.health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid /health response", async () => {
    mockFetchOnce({ status: "ok", service: "beosand-api" });
    const result = await new ApiClient("http://api.test").health();
    expect(result).toEqual({ status: "ok", service: "beosand-api" });
  });

  it("rejects a malformed /health response (contract enforced)", async () => {
    mockFetchOnce({ status: "degraded" });
    await expect(new ApiClient("http://api.test").health()).rejects.toThrow();
  });

  it("throws on a non-2xx response", async () => {
    mockFetchOnce({}, false, 503);
    await expect(new ApiClient("http://api.test").health()).rejects.toThrow(/503/);
  });
});
