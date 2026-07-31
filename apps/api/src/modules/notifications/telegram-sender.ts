import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { ENV } from "../../config/config.module";

/** A single inline button that routes a callback the bot handles. */
export interface InlineCallbackButton {
  text: string;
  callback_data: string;
}

/** A single inline button that opens a URL (e.g. the admin console deep link). */
export interface InlineUrlButton {
  text: string;
  url: string;
}

/** A single inline button: either a callback button or a URL (link) button. */
export type InlineButton = InlineCallbackButton | InlineUrlButton;

/** Telegram inline keyboard markup (rows of buttons) accepted by sendMessage. */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

/**
 * A send can be known not to have reached Telegram (an HTTP response), or it
 * can be indeterminate (a transport failure after the request may have left
 * this process). Callers that persist delivery history must not retry the
 * latter automatically.
 */
export type TelegramSendOutcome =
  | { kind: "sent" }
  | { kind: "failed"; diagnostic: string }
  | { kind: "ambiguous"; diagnostic: string };

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
    const outcome = await this.sendMessageWithOutcome(telegramId, text, replyMarkup);
    if (outcome.kind !== "sent") {
      throw new Error(outcome.diagnostic);
    }
  }

  /** Typed outcome for durable one-shot delivery workflows. */
  async sendMessageWithOutcome(
    telegramId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup
  ): Promise<TelegramSendOutcome> {
    const url = `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramId,
          text,
          parse_mode: "HTML",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        })
      });
    } catch (error) {
      return { kind: "ambiguous", diagnostic: sanitizeTelegramDiagnostic(error, telegramId) };
    }

    if (!response.ok) {
      const description = await safeDescription(response);
      return {
        kind: "failed",
        diagnostic: sanitizeTelegramDiagnostic(`Telegram sendMessage failed: ${response.status} ${description}`, telegramId)
      };
    }
    return { kind: "sent" };
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

/** Safe for durable audit fields: no URL, chat id, token-shaped value, or controls. */
export function sanitizeTelegramDiagnostic(value: unknown, telegramId?: number): string {
  const raw = value instanceof Error ? value.message : String(value);
  const knownTelegramId = telegramId === undefined
    ? undefined
    : new RegExp(`(?<!\\d)${escapeRegExp(String(telegramId))}(?!\\d)`, "g");
  return raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(?:bot)?\d{6,}:[A-Za-z0-9_-]+/gi, "[token]")
    .replace(/@[A-Za-z0-9_]+/g, "[username]")
    .replace(knownTelegramId ?? /$^/, "[id]")
    .replace(/\b\d{7,}\b/g, "[id]")
    .trim()
    .slice(0, 1024);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
