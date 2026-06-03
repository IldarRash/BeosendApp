import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Broadcast, BroadcastPreview, BroadcastType, SlotCard } from "@beosand/types";
import { broadcastPreviewSchema, freeSeats, isBookable, isoWeekdayOf } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { type InlineKeyboardMarkup, TelegramSender } from "../notifications/telegram-sender";
import { composeBroadcastText } from "./broadcast-messages";
import { type BroadcastSlotRow, BroadcastsRepository } from "./broadcasts.repository";

/**
 * Owns free-slot broadcast logic (T2.4). Both operations are admin-only, gated
 * here by ADMIN_TELEGRAM_IDS via isAdmin — never in the controller or bot. The
 * broadcast only advertises bookable slots: every candidate row is re-asserted
 * with isBookable (status open + free seats) at BOTH preview and send time, so a
 * full/cancelled training is never advertised. The broadcast never creates a
 * booking; each slot line carries a `book:slot:<trainingId>` inline button that
 * funnels into the existing single-booking flow (T1.8), which re-checks
 * availability. Send writes exactly one broadcasts row.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly repo: BroadcastsRepository,
    private readonly sender: TelegramSender,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Admin: compose the preview for `type`. Does NOT write. */
  async preview(actorTelegramId: number, type: BroadcastType): Promise<BroadcastPreview> {
    this.assertAdmin(actorTelegramId);

    const slots = await this.selectBookableSlots(type);
    const text = composeBroadcastText(type, slots);
    const recipientsCount = await this.repo.countActiveRecipients();

    return broadcastPreviewSchema.parse({ type, text, slots, recipientsCount });
  }

  /**
   * Admin: re-run selection at send time (slots can have gone full since
   * preview), fan out to every active client with a per-slot inline button, and
   * insert exactly one broadcasts row (payload = composed text, createdBy = admin
   * telegramId, recipientsCount = clients actually targeted). A per-recipient
   * Telegram failure is logged and tolerated; the broadcasts row is still written.
   */
  async send(actorTelegramId: number, type: BroadcastType): Promise<Broadcast> {
    this.assertAdmin(actorTelegramId);

    const slots = await this.selectBookableSlots(type);
    const text = composeBroadcastText(type, slots);
    const replyMarkup = buildKeyboard(slots);
    const recipients = await this.repo.listActiveRecipients();

    for (const recipient of recipients) {
      try {
        await this.sender.sendMessage(recipient.telegramId, text, replyMarkup);
      } catch (error) {
        this.logger.error(
          `Broadcast ${type} to ${recipient.telegramId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    return this.repo.insertBroadcast({
      type,
      payload: text,
      createdBy: actorTelegramId,
      recipientsCount: recipients.length
    });
  }

  /**
   * Select the bookable slot cards for `type` (Europe/Belgrade dates). Reads the
   * candidate rows for the date window, re-asserts isBookable, and maps to slot
   * cards with server-side free seats / price. "freed-up" is, for this slice,
   * the upcoming-bookable set (no was-full-now-open tracking yet — see the brief).
   */
  private async selectBookableSlots(type: BroadcastType): Promise<SlotCard[]> {
    const today = belgradeToday();
    const { from, to } = windowFor(type, today);
    const rows = await this.repo.listSlots(from, to);

    return rows.filter((row) => isBookable(row)).map((row) => toSlotCard(row));
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** The [from, to] date window for each broadcast type, anchored on today. */
function windowFor(type: BroadcastType, today: string): { from: string; to: string } {
  if (type === "today") {
    return { from: today, to: today };
  }
  if (type === "tomorrow") {
    const tomorrow = addDays(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  // "week" and "freed-up": today..today+6 (freed-up = upcoming-bookable for this slice).
  return { from: today, to: addDays(today, 6) };
}

/** Map a candidate row to the SlotCard contract (free seats computed here). */
function toSlotCard(row: BroadcastSlotRow): SlotCard {
  return {
    trainingId: row.trainingId,
    date: row.date,
    dayOfWeek: isoWeekdayOf(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    trainerName: row.trainerName,
    levelName: row.levelName,
    freeSeats: freeSeats(row),
    priceSingleRsd: row.priceSingleRsd
  };
}

/** Per-slot inline "Записаться" buttons routing into the T1.8 booking flow. */
function buildKeyboard(slots: SlotCard[]): InlineKeyboardMarkup | undefined {
  if (slots.length === 0) {
    return undefined;
  }
  return {
    inline_keyboard: slots.map((slot) => [
      { text: "Записаться", callback_data: `book:slot:${slot.trainingId}` }
    ])
  };
}

/** Today's date in Europe/Belgrade as "YYYY-MM-DD". */
function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** Add whole days to a "YYYY-MM-DD" date, returning the same ISO format. */
function addDays(isoDate: string, days: number): string {
  const cursor = new Date(`${isoDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
