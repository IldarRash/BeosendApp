import { Injectable, Logger } from "@nestjs/common";
import type {
  BroadcastAudience,
  SameDayFreedSlotAutomationSettings,
  SlotCard
} from "@beosand/types";
import {
  BELGRADE_TZ,
  freeSeats,
  isBookable,
  isoWeekdayOf,
  zonedWallClockToUtc
} from "@beosand/types";
import { bookSlotsKeyboard } from "../notifications/notification-keyboards";
import { TelegramSender } from "../notifications/telegram-sender";
import { SettingsService } from "../settings/settings.service";
import { composeBroadcastText } from "./broadcast-messages";
import {
  BroadcastsRepository,
  type SameDayFreedSlotOccurrenceRow,
  type SameDayFreedSlotRecipient
} from "./broadcasts.repository";
import { BroadcastsService } from "./broadcasts.service";

export interface SameDayFreedSlotCancellationEvidence {
  cancelledBookingId: string;
  trainingId: string;
  cancellingClientId: string;
  selfCancellation: boolean;
}

/** One-shot automatic freed-slot handling entered only from the explicit cancel endpoint. */
@Injectable()
export class SameDayFreedSlotDispatcher {
  private readonly logger = new Logger(SameDayFreedSlotDispatcher.name);

  constructor(
    private readonly repo: BroadcastsRepository,
    private readonly broadcasts: BroadcastsService,
    private readonly settings: SettingsService,
    private readonly sender: TelegramSender
  ) {}

  async dispatchAfterCancellation(evidence: SameDayFreedSlotCancellationEvidence): Promise<void> {
    if (!evidence.selfCancellation) {
      return;
    }

    const policy = await this.settings.currentSameDayFreedSlotAutomationSettings();
    if (!policy.enabled || policy.audience === null) {
      return;
    }

    const occurrence = await this.repo.findSameDayFreedSlotOccurrence(evidence.trainingId);
    const occurrenceReason = this.occurrenceIneligibilityReason(occurrence, new Date());
    if (occurrenceReason !== undefined || occurrence === undefined) {
      return;
    }
    if (await this.repo.hasBlockingSameDayFreedSlotWaitlist(evidence.trainingId)) {
      return;
    }

    const event = await this.repo.createSameDayFreedSlotEvent({
      cancelledBookingId: evidence.cancelledBookingId,
      trainingId: evidence.trainingId,
      audienceSnapshot: policy.audience,
      occurrenceDate: occurrence.date,
      occurrenceStartTime: occurrence.startTime,
      capacity: occurrence.capacity,
      bookedCount: occurrence.bookedCount
    });
    if (!event) {
      return;
    }

    let recipients: SameDayFreedSlotRecipient[];
    try {
      const audience = await this.broadcasts.resolveRecipients(policy.audience);
      recipients = await this.repo.filterSameDayFreedSlotRecipients(
        audience,
        evidence.trainingId,
        evidence.cancellingClientId
      );
    } catch (error) {
      try {
        await this.repo.markSameDayFreedSlotEventSkipped(event.id, "audience-resolution-failed");
      } catch (recordError) {
        this.logger.error(
          `Freed-slot event failure recording failed: ${sanitizeFreedSlotDiagnostic(recordError)}`
        );
      }
      throw error;
    }

    const recheck = await this.finalRecheck(evidence.trainingId, policy.audience);
    if (recheck.reason !== undefined || recheck.occurrence === undefined) {
      await this.repo.markSameDayFreedSlotEventSkipped(event.id, recheck.reason ?? "not-found");
      return;
    }

    const slot = toSlotCard(recheck.occurrence);
    const text = composeBroadcastText("freed-up", [slot]);
    for (const recipient of recipients) {
      await this.dispatchRecipient(event.id, recipient, slot, text);
    }
    await this.repo.markSameDayFreedSlotEventDispatched(event.id);
  }

  private async finalRecheck(
    trainingId: string,
    initialAudience: BroadcastAudience
  ): Promise<{ occurrence?: SameDayFreedSlotOccurrenceRow; reason?: string }> {
    const policy = await this.settings.currentSameDayFreedSlotAutomationSettings();
    if (!policyEnabled(policy)) {
      return { reason: "policy-disabled" };
    }
    if (!sameAudience(policy.audience, initialAudience)) {
      return { reason: "audience-changed" };
    }

    const occurrence = await this.repo.findSameDayFreedSlotOccurrence(trainingId);
    const occurrenceReason = this.occurrenceIneligibilityReason(occurrence, new Date());
    if (occurrenceReason !== undefined || occurrence === undefined) {
      return { reason: occurrenceReason ?? "not-found" };
    }
    if (await this.repo.hasBlockingSameDayFreedSlotWaitlist(trainingId)) {
      return { reason: "waitlist-blocked" };
    }
    return { occurrence };
  }

  private occurrenceIneligibilityReason(
    occurrence: SameDayFreedSlotOccurrenceRow | undefined,
    now: Date
  ): string | undefined {
    if (!occurrence) {
      return "not-found";
    }
    if (
      occurrence.groupId === null ||
      occurrence.groupHidden !== false ||
      occurrence.groupStatus !== "active" ||
      occurrence.trainerStatus !== "active" ||
      occurrence.levelStatus !== "active"
    ) {
      return "not-public-group";
    }
    if (occurrence.date !== dateInBelgrade(now)) {
      return "not-same-day";
    }
    const start = zonedWallClockToUtc(occurrence.date, occurrence.startTime, BELGRADE_TZ);
    if (now.getTime() >= start.getTime()) {
      return "start-reached";
    }
    if (!isBookable(occurrence)) {
      return "not-bookable";
    }
    return undefined;
  }

  private async dispatchRecipient(
    eventId: string,
    recipient: SameDayFreedSlotRecipient,
    slot: SlotCard,
    text: string
  ): Promise<void> {
    let delivery: { id: string } | undefined;
    try {
      delivery = await this.repo.claimSameDayFreedSlotDelivery(eventId, recipient);
    } catch (error) {
      this.logger.error(
        `Freed-slot delivery claim failed: ${sanitizeFreedSlotDiagnostic(error)}`
      );
      return;
    }
    if (!delivery) {
      return;
    }

    try {
      const markup = bookSlotsKeyboard(recipient.language, [
        {
          trainingId: slot.trainingId,
          startTime: slot.startTime,
          groupName: slot.groupName,
          levelName: slot.levelName
        }
      ]);
      await this.sender.sendMessage(recipient.telegramId, text, markup);
    } catch (error) {
      const sanitized = sanitizeFreedSlotDiagnostic(error);
      try {
        if (isDefiniteTelegramFailure(error)) {
          await this.repo.markSameDayFreedSlotDeliveryFailed(delivery.id, sanitized);
        } else {
          await this.repo.markSameDayFreedSlotDeliveryAmbiguous(delivery.id, sanitized);
        }
      } catch (recordError) {
        this.logger.error(
          `Freed-slot failure recording failed: ${sanitizeFreedSlotDiagnostic(recordError)}`
        );
      }
      return;
    }

    try {
      await this.repo.markSameDayFreedSlotDeliverySent(delivery.id);
    } catch (error) {
      // Telegram returned success, but its durable state is unknown. Mark ambiguous and never resend.
      const ambiguousError = sanitizeFreedSlotDiagnostic(
        `Telegram send succeeded but persistence failed: ${errorMessage(error)}`
      );
      try {
        await this.repo.markSameDayFreedSlotDeliveryAmbiguous(delivery.id, ambiguousError);
      } catch (recordError) {
        this.logger.error(
          `Freed-slot ambiguity recording failed: ${sanitizeFreedSlotDiagnostic(recordError)}`
        );
      }
    }
  }
}

function policyEnabled(
  policy: SameDayFreedSlotAutomationSettings
): policy is SameDayFreedSlotAutomationSettings & { audience: NonNullable<typeof policy.audience> } {
  return policy.enabled && policy.audience !== null;
}

function sameAudience(current: BroadcastAudience, initial: BroadcastAudience): boolean {
  if (current.kind !== initial.kind) {
    return false;
  }
  switch (current.kind) {
    case "all":
      return true;
    case "level":
      return initial.kind === "level" && current.levelId === initial.levelId;
    case "active":
      return initial.kind === "active" && current.days === initial.days;
    case "lapsed":
      return initial.kind === "lapsed" && current.days === initial.days;
    default: {
      const exhaustive: never = current;
      return exhaustive;
    }
  }
}

function toSlotCard(row: SameDayFreedSlotOccurrenceRow): SlotCard {
  return {
    trainingId: row.trainingId,
    date: row.date,
    dayOfWeek: isoWeekdayOf(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    groupName: row.groupName,
    trainerName: row.trainerName,
    levelName: row.levelName,
    freeSeats: freeSeats(row),
    priceSingleRsd: row.priceSingleRsd
  };
}

function dateInBelgrade(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function sanitizeFreedSlotDiagnostic(error: unknown): string {
  const raw = Array.from(errorMessage(error), (character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
  }).join("");
  const sanitized = raw
    .replace(/(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s]+/gi, "[url]")
    .replace(/\bbot\d+:[A-Za-z0-9_-]+\b/gi, "bot[redacted]")
    .replace(
      /\b\d{3,}:(?=[A-Za-z0-9_-]{6,}\b)(?=[A-Za-z0-9_-]*[A-Za-z_-])[A-Za-z0-9_-]+\b/g,
      "[redacted-token]"
    )
    .replace(
      /(\b(?:bot[_-]?token|telegram[_-]?bot[_-]?token)\b["']?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`
    )
    .replace(
      /(\b(?:chat|telegram|user)[_-]?id\b["']?\s*[:=]\s*)(["']?)-?\d+\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`
    )
    .replace(
      /(\bsendMessage\s+to\s+)(["']?)-?\d+\2/gi,
      (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`
    )
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized || "Delivery failed").slice(0, 500);
}

function isDefiniteTelegramFailure(error: unknown): boolean {
  return /^Telegram sendMessage to \d+ failed: \d{3}(?:\s|$)/.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
