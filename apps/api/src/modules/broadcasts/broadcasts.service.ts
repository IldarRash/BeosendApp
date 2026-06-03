import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  Broadcast,
  BroadcastAudience,
  BroadcastPreview,
  BroadcastType,
  SlotCard
} from "@beosand/types";
import { broadcastPreviewSchema, freeSeats, isBookable, isoWeekdayOf } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { type InlineKeyboardMarkup, TelegramSender } from "../notifications/telegram-sender";
import { composeBroadcastText } from "./broadcast-messages";
import {
  type BroadcastRecipient,
  type BroadcastSlotRow,
  BroadcastsRepository
} from "./broadcasts.repository";

/** Default audience preserves T2.4: every active client. */
const DEFAULT_AUDIENCE: BroadcastAudience = { kind: "all" };

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

  /**
   * Admin: compose the preview for `type` and `audience`. Does NOT write. The
   * reported recipientsCount is the resolved segment size (so it matches exactly
   * what send would dispatch). Absent audience ⇒ all active clients (T2.4).
   */
  async preview(
    actorTelegramId: number,
    type: BroadcastType,
    audience: BroadcastAudience = DEFAULT_AUDIENCE
  ): Promise<BroadcastPreview> {
    this.assertAdmin(actorTelegramId);

    const slots = await this.selectBookableSlots(type);
    const text = composeBroadcastText(type, slots);
    const recipients = await this.resolveRecipients(audience);

    return broadcastPreviewSchema.parse({
      type,
      text,
      slots,
      recipientsCount: recipients.length
    });
  }

  /**
   * Admin: re-run selection at send time (slots can have gone full since
   * preview), resolve the audience segment, fan out with a per-slot inline
   * button, and insert exactly one broadcasts row (payload = composed text,
   * createdBy = admin telegramId, recipientsCount = the resolved segment size,
   * i.e. the count actually dispatched). The audience is also recorded in the
   * payload for audit. A per-recipient Telegram failure is logged and tolerated;
   * the broadcasts row is still written.
   */
  async send(
    actorTelegramId: number,
    type: BroadcastType,
    audience: BroadcastAudience = DEFAULT_AUDIENCE
  ): Promise<Broadcast> {
    this.assertAdmin(actorTelegramId);

    const slots = await this.selectBookableSlots(type);
    const text = composeBroadcastText(type, slots);
    const replyMarkup = buildKeyboard(slots);
    const recipients = await this.resolveRecipients(audience);

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

  /**
   * Resolve an audience segment to a concrete recipient list via the repo (the
   * only DB access). A segment can only ever *narrow* the active-client base:
   * recipients are always active clients. `active`/`lapsed` use a rolling cutoff
   * of now − days. This is the single place the audience → recipients mapping
   * lives, so preview and send always agree.
   */
  private resolveRecipients(audience: BroadcastAudience): Promise<BroadcastRecipient[]> {
    switch (audience.kind) {
      case "all":
        return this.repo.listActiveRecipients();
      case "level":
        return this.repo.listActiveRecipientsByLevel(audience.levelId);
      case "active":
        return this.repo.listActiveRecipientsBookedSince(cutoffDaysAgo(audience.days));
      case "lapsed":
        return this.repo.listActiveRecipientsNotBookedSince(cutoffDaysAgo(audience.days));
      default: {
        const exhaustive: never = audience;
        throw new ForbiddenException(`Unsupported audience ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** A Date `days` whole days before now — the rolling cutoff for active/lapsed. */
function cutoffDaysAgo(days: number): Date {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
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
