import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@beosand/config";
import { EmailChannel } from "./email.channel";
import type { OutboundMessage } from "../ports/channel.port";

// Mock nodemailer's createTransport so the SMTP path never opens a real connection.
const sendMail = vi.fn().mockResolvedValue(undefined);
vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({ sendMail }))
}));

function env(over: Partial<Env> = {}): Env {
  return {
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "noreply@beosand.test",
    SMTP_URL: "smtp://user:pass@host:587",
    ...over
  } as unknown as Env;
}

const baseMsg: OutboundMessage = {
  clientId: "c1",
  email: "client@example.com",
  subject: "BeoSand",
  text: "Запись подтверждена"
};

describe("EmailChannel", () => {
  beforeEach(() => {
    sendMail.mockClear();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("isEnabled", () => {
    it("is enabled for smtp when SMTP_URL + EMAIL_FROM are present", () => {
      expect(new EmailChannel(env()).isEnabled()).toBe(true);
    });

    it("is disabled for smtp when SMTP_URL is missing", () => {
      expect(new EmailChannel(env({ SMTP_URL: undefined })).isEnabled()).toBe(false);
    });

    it("is enabled for sendgrid when SENDGRID_API_KEY + EMAIL_FROM are present", () => {
      const channel = new EmailChannel(
        env({ EMAIL_PROVIDER: "sendgrid", SMTP_URL: undefined, SENDGRID_API_KEY: "sg-key" })
      );
      expect(channel.isEnabled()).toBe(true);
    });

    it("is disabled for sendgrid when the API key is missing", () => {
      const channel = new EmailChannel(
        env({ EMAIL_PROVIDER: "sendgrid", SMTP_URL: undefined })
      );
      expect(channel.isEnabled()).toBe(false);
    });

    it("is disabled when EMAIL_PROVIDER is absent", () => {
      expect(new EmailChannel(env({ EMAIL_PROVIDER: undefined })).isEnabled()).toBe(false);
    });
  });

  describe("send", () => {
    it("sends via the SMTP transport (default provider)", async () => {
      await new EmailChannel(env()).send(baseMsg);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe("client@example.com");
      expect(call.from).toBe("noreply@beosand.test");
      expect(call.text).toBe("Запись подтверждена");
    });

    it("sends via a thin SendGrid fetch when EMAIL_PROVIDER=sendgrid", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      vi.stubGlobal("fetch", fetchMock);
      const channel = new EmailChannel(
        env({ EMAIL_PROVIDER: "sendgrid", SMTP_URL: undefined, SENDGRID_API_KEY: "sg-key" })
      );

      await channel.send(baseMsg);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("sendgrid.com");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sg-key");
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("is a no-op when the recipient has no email (channel skipped)", async () => {
      await new EmailChannel(env()).send({ clientId: "c1", text: "hi" });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("surfaces an SMTP failure (dispatcher tolerates it)", async () => {
      sendMail.mockRejectedValueOnce(new Error("smtp refused"));
      await expect(new EmailChannel(env()).send(baseMsg)).rejects.toThrow("smtp refused");
    });

    it("throws on a non-2xx SendGrid response without leaking the API key", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal("fetch", fetchMock);
      const channel = new EmailChannel(
        env({ EMAIL_PROVIDER: "sendgrid", SMTP_URL: undefined, SENDGRID_API_KEY: "sg-secret" })
      );

      await expect(channel.send(baseMsg)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("sg-secret") })
      );
    });
  });
});
