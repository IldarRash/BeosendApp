import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../config/config.module";

/** A single inline button: a label and the callback_data the bot routes on. */
export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Telegram inline keyboard markup (rows of buttons) accepted by sendMessage. */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

/**
 * The single outbound Telegram channel for the API: a raw fetch POST to the
 * Bot API, no grammY dependency. The bot token comes from the injected,
 * validated Env and is NEVER logged or echoed in an error — only the chat id and
 * a short status are surfaced. The API holds the token because outbound domain
 * notifications are server-side decisions (the bot never sends them).
 */
@Injectable()
export class TelegramSender {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Send one message, optionally carrying an inline keyboard (e.g. the waitlist
   * promotion's "Подтвердить" button — T2.1). Throws on a non-OK response so the
   * caller (the service) can decide to log-and-tolerate rather than persist a
   * send-log row. The thrown error carries the chat id and Telegram error
   * code/description only — never the token or the request URL.
   */
  async sendMessage(
    telegramId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      })
    });

    if (!response.ok) {
      const description = await safeDescription(response);
      // Token is in the URL only; never include the URL in the thrown message.
      throw new Error(
        `Telegram sendMessage to ${telegramId} failed: ${response.status} ${description}`
      );
    }
  }
}

/** Extract Telegram's error description without leaking the request, tolerating a non-JSON body. */
async function safeDescription(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { description?: unknown };
    return typeof body.description === "string" ? body.description : "";
  } catch {
    return "";
  }
}
