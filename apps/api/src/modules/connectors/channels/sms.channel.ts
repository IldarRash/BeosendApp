import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../../config/config.module";
import type { NotificationChannel, OutboundMessage } from "../ports/channel.port";

/**
 * The SMS notification channel (Twilio): sends a domain notification by SMS when
 * the recipient has a phone — primarily for walk-in clients with a phone but no
 * Telegram. Config-gated on all three TWILIO_* vars being present.
 *
 * Implemented as a thin `fetch` to the Twilio Messages API (Basic auth
 * SID:AUTH_TOKEN, form-encoded body) rather than the `twilio` SDK: this channel
 * makes exactly one POST shape, so the SDK's auth/HTTP machinery is not worth the
 * added bundle weight (matches the SendGrid/Telegram thin-fetch adapters here).
 *
 * `send` throws on a non-2xx so the ChannelDispatcher logs and tolerates it; the
 * auth token is never logged or echoed in the thrown error. Reachable only when
 * the message carries a `phone` target; otherwise the dispatcher skips this channel.
 */
@Injectable()
export class SmsChannel implements NotificationChannel {
  readonly id = "sms" as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(): boolean {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = this.env;
    return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
  }

  canReach(msg: OutboundMessage): boolean {
    return typeof msg.phone === "string" && msg.phone.length > 0;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!msg.phone) {
      return;
    }
    const sid = this.env.TWILIO_ACCOUNT_SID as string;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${this.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const body = new URLSearchParams({
      From: this.env.TWILIO_FROM_NUMBER as string,
      To: msg.phone,
      Body: msg.text
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!response.ok) {
      // Never include the Basic auth header / token in the thrown message.
      throw new Error(`Twilio SMS to ${msg.phone} failed: ${response.status}`);
    }
  }
}
