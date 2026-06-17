import { Inject, Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { Env } from "@beosand/config";
import { ENV } from "../../../config/config.module";
import type { NotificationChannel, OutboundMessage } from "../ports/channel.port";

/** SendGrid v3 mail-send endpoint (thin HTTP adapter; no SDK). */
const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

/** Default subject for messages that don't carry one (RU; v1 templates are RU-only). */
const DEFAULT_SUBJECT = "BeoSand";

/**
 * The email notification channel: sends a domain notification by email when the
 * recipient has an address. Config-gated by EMAIL_PROVIDER + its required vars
 * (the env contract's .superRefine already enforces the cross-fields at boot, so
 * isEnabled only needs to check presence). Two providers:
 *
 * - `smtp` (default): nodemailer transport built from SMTP_URL.
 * - `sendgrid`: a thin `fetch` POST to the SendGrid v3 API with SENDGRID_API_KEY
 *   (no @sendgrid/mail SDK — keeps the bundle lean for a single POST shape).
 *
 * `send` throws on any provider failure; the ChannelDispatcher logs and tolerates
 * it so one unreachable channel never blocks the others or the committed op.
 * Secrets (SMTP creds, SendGrid key) are never logged. Reachable only when the
 * message carries an `email` target; otherwise the dispatcher skips this channel.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly id = "email" as const;
  /** Lazily built SMTP transport (only when EMAIL_PROVIDER=smtp). */
  private transporter: Transporter | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(): boolean {
    const { EMAIL_PROVIDER, EMAIL_FROM, SMTP_URL, SENDGRID_API_KEY } = this.env;
    if (EMAIL_PROVIDER === "smtp") {
      return Boolean(SMTP_URL && EMAIL_FROM);
    }
    if (EMAIL_PROVIDER === "sendgrid") {
      return Boolean(SENDGRID_API_KEY && EMAIL_FROM);
    }
    return false;
  }

  canReach(msg: OutboundMessage): boolean {
    return typeof msg.email === "string" && msg.email.length > 0;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!msg.email) {
      return;
    }
    const subject = msg.subject ?? DEFAULT_SUBJECT;
    const text = msg.text;
    if (this.env.EMAIL_PROVIDER === "sendgrid") {
      await this.sendViaSendgrid(msg.email, subject, text);
      return;
    }
    await this.sendViaSmtp(msg.email, subject, text);
  }

  /** Build (once) and reuse the nodemailer SMTP transport from SMTP_URL. */
  private smtpTransport(): Transporter {
    if (!this.transporter) {
      // isEnabled() guarantees SMTP_URL is present before send() runs.
      this.transporter = createTransport(this.env.SMTP_URL as string);
    }
    return this.transporter;
  }

  private async sendViaSmtp(to: string, subject: string, text: string): Promise<void> {
    await this.smtpTransport().sendMail({
      from: this.env.EMAIL_FROM,
      to,
      subject,
      text,
      // Domain bodies use Telegram-style HTML; a parallel HTML part is acceptable.
      html: text
    });
  }

  /** Thin SendGrid v3 send; throws on a non-2xx without leaking the API key. */
  private async sendViaSendgrid(to: string, subject: string, text: string): Promise<void> {
    const response = await fetch(SENDGRID_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.SENDGRID_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.env.EMAIL_FROM },
        subject,
        content: [{ type: "text/plain", value: text }]
      })
    });
    if (!response.ok) {
      // The Authorization header is never echoed in the thrown message.
      throw new Error(`SendGrid send to ${to} failed: ${response.status}`);
    }
  }
}
