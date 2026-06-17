import { describe, expect, it } from "vitest";
import { signFeedToken, verifyFeedToken } from "./calendar-token";

const SECRET = "0123456789abcdef-feed-secret";

describe("calendar feed token", () => {
  it("round-trips a valid token", () => {
    const token = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);
    expect(verifyFeedToken(token, SECRET)).toEqual({ sub: "trainer", id: "t-1", v: 1 });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signFeedToken({ sub: "client", id: "c-1", v: 1 }, SECRET);
    expect(verifyFeedToken(token, "another-secret-value-xyz")).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signFeedToken({ sub: "client", id: "c-1", v: 1 }, SECRET);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "client", id: "c-2", v: 1 }), "utf8").toString(
      "base64url"
    );
    expect(verifyFeedToken(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyFeedToken("", SECRET)).toBeNull();
    expect(verifyFeedToken("noseparator", SECRET)).toBeNull();
    expect(verifyFeedToken(".sig", SECRET)).toBeNull();
    expect(verifyFeedToken("body.", SECRET)).toBeNull();
  });

  it("surfaces the version so rotation can invalidate an old token", () => {
    // A token minted at v1 still verifies structurally, but its decoded version (1)
    // no longer matches a subject rotated to v2 — the feed service rejects on that.
    const old = signFeedToken({ sub: "trainer", id: "t-1", v: 1 }, SECRET);
    const fresh = signFeedToken({ sub: "trainer", id: "t-1", v: 2 }, SECRET);

    expect(verifyFeedToken(old, SECRET)?.v).toBe(1);
    expect(verifyFeedToken(fresh, SECRET)?.v).toBe(2);
    expect(old).not.toEqual(fresh);
  });
});
