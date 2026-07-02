import { describe, expect, it } from "vitest";
import { sanitizeForRequestLog, sanitizeSelectedHeaders } from "./request-log-sanitizer";

describe("request log sanitizer", () => {
  it("masks sensitive keys case-insensitively and recursively", () => {
    expect(
      sanitizeForRequestLog({
        email: "client@example.test",
        phone: "+38160123456",
        clientName: "Ana",
        telegramId: 123,
        username: "ana",
        note: "private note",
        initData: "query_id=raw&hash=raw",
        webhookUrl: "https://user:pass@example.test/hook?token=raw",
        Authorization: "Bearer raw",
        detailed: true,
        page: 2,
        status: "open",
        nested: {
          adminSession: "session.jwt",
          photoUrl: "https://example.test/avatar.jpg",
          apiKey: "raw-key",
          value: 42
        },
        list: [{ refresh_token: "token" }, { ok: true }]
      })
    ).toEqual({
      email: "[masked]",
      phone: "[masked]",
      clientName: "[masked]",
      telegramId: "[masked]",
      username: "[masked]",
      note: "[masked]",
      initData: "[masked]",
      webhookUrl: "[masked]",
      Authorization: "[masked]",
      detailed: true,
      page: 2,
      status: "open",
      nested: {
        adminSession: "[masked]",
        photoUrl: "[masked]",
        apiKey: "[masked]",
        value: 42
      },
      list: [{ refresh_token: "[masked]" }, { ok: true }]
    });
  });

  it("sanitizes selected headers and never exposes bearer tokens or cookies", () => {
    expect(
      sanitizeSelectedHeaders({
        Authorization: "Bearer raw",
        Cookie: "adminSession=raw",
        "content-type": "application/json",
        "x-telegram-id": "111",
        "x-client-telegram-photo-url": "https://example.test/avatar.jpg",
        referer: "https://admin.example.test/settings?token=raw&jwt=raw",
        "x-unselected": "ignored"
      })
    ).toEqual({
      "content-type": "application/json",
      "x-telegram-id": "[masked]",
      "x-client-telegram-photo-url": "[masked]",
      authorization: "[masked]",
      cookie: "[masked]"
    });
  });

  it("caps arrays, object keys, strings, and depth", () => {
    const manyKeys = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`k${index}`, index])
    );

    expect(
      sanitizeForRequestLog({
        list: Array.from({ length: 22 }, (_, index) => index),
        message: "a".repeat(1_025),
        manyKeys,
        nested: { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } }
      })
    ).toEqual({
      list: [...Array.from({ length: 20 }, (_, index) => index), "[truncated]"],
      message: `${"a".repeat(1_024)}[truncated]`,
      manyKeys: {
        ...Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, index])),
        "[truncated]": "[truncated]"
      },
      nested: { a: { b: { c: { d: { e: "[max-depth]" } } } } }
    });
  });
});
