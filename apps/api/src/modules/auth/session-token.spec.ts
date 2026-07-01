import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "./session-token";

const SESSION_SECRET = "session-secret-at-least-16-chars";

describe("session-token client identity claims", () => {
  it("round-trips optional client display identity claims", () => {
    const token = signSessionToken(
      {
        sub: 1234,
        name: "Bea",
        scope: "client",
        username: "bea",
        photoUrl: "https://t.me/i/userpic/320/bea.jpg"
      },
      SESSION_SECRET,
      1_000_000
    );

    expect(verifySessionToken(token, SESSION_SECRET, 1_000_060)).toMatchObject({
      sub: 1234,
      name: "Bea",
      scope: "client",
      username: "bea",
      photoUrl: "https://t.me/i/userpic/320/bea.jpg"
    });
  });

  it("keeps admin token behavior unchanged when optional display claims are absent", () => {
    const token = signSessionToken(
      { sub: 4242, name: "Ada", scope: "admin" },
      SESSION_SECRET,
      1_000_000
    );

    expect(verifySessionToken(token, SESSION_SECRET, 1_000_060)).toMatchObject({
      sub: 4242,
      name: "Ada",
      scope: "admin"
    });
  });
});
