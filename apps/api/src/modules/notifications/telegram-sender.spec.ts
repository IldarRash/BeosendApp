import type { Env } from "@beosand/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramSender } from "./telegram-sender";

const SECRET_TOKEN = "123456:SUPER-SECRET-BOT-TOKEN";

const env = {
  TELEGRAM_BOT_TOKEN: SECRET_TOKEN
} as unknown as Env;

/** Build a minimal `fetch` Response double. */
function response(
  init: { ok: boolean; status?: number; body?: unknown }
): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 400),
    json: async () => init.body ?? {}
  } as unknown as Response;
}

describe("TelegramSender", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sender: TelegramSender;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sender = new TelegramSender(env);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the Bot API sendMessage URL with the chat id and text", async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));

    await sender.sendMessage(555, "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${SECRET_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const payload = JSON.parse(init.body as string) as { chat_id: number; text: string };
    expect(payload.chat_id).toBe(555);
    expect(payload.text).toBe("hello");
  });

  it("resolves silently on an OK response (no throw)", async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));
    await expect(sender.sendMessage(1, "ok")).resolves.toBeUndefined();
  });

  // Security invariant: the bot token lives only in the request URL and must
  // never appear in a thrown error (which the service logs verbatim).
  it("throws on a non-OK response WITHOUT leaking the token or the URL", async () => {
    fetchMock.mockResolvedValue(
      response({ ok: false, status: 403, body: { description: "Forbidden: bot was blocked" } })
    );

    let caught: unknown;
    try {
      await sender.sendMessage(555, "boom");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain(SECRET_TOKEN);
    expect(message).not.toContain("api.telegram.org");
    // The status/description are surfaced so the failure is diagnosable.
    expect(message).toContain("403");
    expect(message).toContain("Forbidden: bot was blocked");
    expect(message).toContain("555");
  });

  it("tolerates a non-JSON error body and still hides the token", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      }
    } as unknown as Response);

    await expect(sender.sendMessage(7, "x")).rejects.toThrow();
    const message = await sender.sendMessage(7, "x").catch((e: Error) => e.message);
    expect(message).not.toContain(SECRET_TOKEN);
  });
});
