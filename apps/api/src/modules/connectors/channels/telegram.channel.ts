import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../../config/config.module";
import { TelegramSender } from "../../notifications/telegram-sender";
import type { NotificationChannel, OutboundMessage } from "../ports/channel.port";

/**
 * The Telegram notification channel: a thin adapter over the existing
 * TelegramSender (which already owns the raw Bot API send + token handling). This
 * keeps Telegram behavior identical while letting the ChannelDispatcher treat it as
 * one channel among telegram/email/sms. Enabled whenever the bot token is present
 * (always, in practice — the env contract requires it); reachable when the recipient
 * has a Telegram id.
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly id = "telegram" as const;

  constructor(
    private readonly sender: TelegramSender,
    @Inject(ENV) private readonly env: Env
  ) {}

  isEnabled(): boolean {
    return this.env.TELEGRAM_BOT_TOKEN.length > 0;
  }

  canReach(msg: OutboundMessage): boolean {
    return typeof msg.telegramId === "number";
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (typeof msg.telegramId !== "number") {
      return;
    }
    await this.sender.sendMessage(msg.telegramId, msg.text);
  }
}
