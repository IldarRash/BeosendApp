import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../config/config.module";

/**
 * Minimal outbound Telegram sender for court-moderation decisions. Per CLAUDE.md
 * outbound sends use the bot token directly from the API. This is an in-module
 * seam until a shared notifications module (T2.2) lands; the service calls it
 * AFTER the DB transaction commits, so a send failure never rolls back a
 * decision — it is logged as a warning instead.
 */
@Injectable()
export class CourtNotifier {
  private readonly logger = new Logger(CourtNotifier.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Send a plain-text message to a client's Telegram chat. Never throws. */
  async notifyClient(telegramId: number, text: string): Promise<void> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: telegramId, text })
        }
      );
      if (!response.ok) {
        this.logger.warn(
          `Telegram sendMessage to ${telegramId} failed with HTTP ${response.status}`
        );
      }
    } catch (error) {
      // A notification failure must not undo a committed assignment; log and move on.
      this.logger.warn(
        `Telegram sendMessage to ${telegramId} threw: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
