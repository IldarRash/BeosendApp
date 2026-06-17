import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { SmsChannel } from "./sms.channel";
import type { OutboundMessage } from "../ports/channel.port";

function env(over: Partial<Env> = {}): Env {
  return {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "tok-secret",
    TWILIO_FROM_NUMBER: "+15550000000",
    ...over
  } as unknown as Env;
}

const baseMsg: OutboundMessage = {
  clientId: "c1",
  phone: "+381601234567",
  text: "Запись подтверждена"
};

describe("SmsChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isEnabled", () => {
    it("is enabled when all three TWILIO_* vars are present", () => {
      expect(new SmsChannel(env()).isEnabled()).toBe(true);
    });

    it("is disabled when the auth token is missing", () => {
      expect(new SmsChannel(env({ TWILIO_AUTH_TOKEN: undefined })).isEnabled()).toBe(false);
    });

    it("is disabled when the from-number is missing", () => {
      expect(new SmsChannel(env({ TWILIO_FROM_NUMBER: undefined })).isEnabled()).toBe(false);
    });
  });

  describe("send", () => {
    it("POSTs to the Twilio Messages API with Basic auth, From/To/Body", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
      vi.stubGlobal("fetch", fetchMock);

      await new SmsChannel(env()).send(baseMsg);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/Accounts/AC123/Messages.json");
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
      const body = (init.body as URLSearchParams);
      expect(body.get("From")).toBe("+15550000000");
      expect(body.get("To")).toBe("+381601234567");
      expect(body.get("Body")).toBe("Запись подтверждена");
    });

    it("is a no-op when the recipient has no phone (channel skipped)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await new SmsChannel(env()).send({ clientId: "c1", text: "hi" });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws on a non-2xx response without leaking the auth token", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      vi.stubGlobal("fetch", fetchMock);

      await expect(new SmsChannel(env()).send(baseMsg)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("tok-secret") })
      );
    });
  });
});
