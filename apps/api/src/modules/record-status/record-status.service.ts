import { Injectable, Logger } from "@nestjs/common";
import type { Database } from "@beosand/db";
import type { ClientRecord, RecordStatusDeliveryFailure, RecordStatusEventSnapshot } from "@beosand/types";
import { sanitizeTelegramDiagnostic, TelegramSender } from "../notifications/telegram-sender";
import { NotificationTemplatesRepository } from "../notification-templates/notification-templates.repository";
import {
  enqueueRecordStatus,
  enqueueRecordStatusBatch,
  RecordStatusRepository,
  type ClaimedRecordStatusDelivery
} from "./record-status.repository";
import { renderRecordStatus, renderRecordStatusBatch } from "./record-status-renderer";

const MAX_ATTEMPTS = 5;

@Injectable()
export class RecordStatusService {
  private readonly logger = new Logger(RecordStatusService.name);

  constructor(
    private readonly repository: RecordStatusRepository,
    private readonly sender: TelegramSender,
    private readonly templates: NotificationTemplatesRepository
  ) {}

  /** Domain services call this from the transaction that changed the source row. */
  enqueueInTransaction(
    tx: Database,
    input: { transitionKey: string; snapshot: RecordStatusEventSnapshot }
  ): Promise<boolean> {
    return enqueueRecordStatus(tx, input);
  }

  enqueueBatchInTransaction(
    tx: Database,
    input: Parameters<typeof enqueueRecordStatusBatch>[1]
  ): Promise<boolean> {
    return enqueueRecordStatusBatch(tx, input);
  }

  async dispatchPending(limit = 20): Promise<void> {
    await this.repository.expireClaims();
    for (const delivery of await this.repository.claim(Math.min(Math.max(limit, 1), 100))) {
      await this.dispatchOne(delivery);
    }
  }

  /** Caller must enforce admin authorization; transport addresses are never returned. */
  listFailures(limit = 50): Promise<RecordStatusDeliveryFailure[]> {
    return this.repository.listFailures(limit);
  }

  private async dispatchOne(delivery: ClaimedRecordStatusDelivery): Promise<void> {
    const recipient = delivery.snapshot.recipient;
    if (recipient.telegramId === null) {
      await this.repository.markSkipped(delivery.id, "Recipient has no Telegram address");
      return;
    }
    let text: string;
    try {
      const override = "record" in delivery.snapshot && !delivery.snapshot.staffMessage
        ? await this.templateOverride(delivery.snapshot.record, recipient.locale)
        : undefined;
      text = "record" in delivery.snapshot
        ? delivery.snapshot.staffMessage ?? renderRecordStatus(delivery.snapshot.record, recipient.locale, override)
        : renderRecordStatusBatch(delivery.snapshot.records, recipient.locale);
    } catch (error) {
      await this.failKnown(delivery, sanitizeTelegramDiagnostic(error, recipient.telegramId));
      return;
    }
    try {
      const outcome = await this.sender.sendMessageWithOutcome(
        recipient.telegramId,
        text,
        ("record" in delivery.snapshot ? delivery.snapshot.replyMarkup : undefined) as import("../notifications/telegram-sender").InlineKeyboardMarkup | undefined
      );
      if (outcome.kind === "sent") {
        await this.markSentOrAmbiguous(delivery.id);
      } else if (outcome.kind === "ambiguous") {
        await this.repository.markAmbiguous(delivery.id, sanitizeTelegramDiagnostic(outcome.diagnostic, recipient.telegramId));
      } else {
        await this.failKnown(delivery, sanitizeTelegramDiagnostic(outcome.diagnostic, recipient.telegramId));
      }
    } catch (error) {
      // The sender did not return a known HTTP outcome. Its request might have
      // reached Telegram, so leave this terminally ambiguous rather than retrying.
      try {
        await this.repository.markAmbiguous(delivery.id, sanitizeTelegramDiagnostic(error, recipient.telegramId));
      } catch (recordError) {
        this.logger.error(`Record-status ambiguity recording failed: ${sanitizeTelegramDiagnostic(recordError)}`);
      }
    }
  }

  /** Existing editable client templates remain a prefix; the status renderer then
   * appends authoritative state/reason so an old template cannot hide a decision. */
  private async templateOverride(
    record: ClientRecord,
    locale: RecordStatusEventSnapshot["recipient"]["locale"]
  ): Promise<string | undefined> {
    const key = record.kind === "court" && record.status === "confirmed" ? "court-request-confirmed"
      : record.kind === "court" && record.status === "declined" ? "court-request-rejected"
        : record.status === "confirmed" ? "booking-confirmed"
          : record.status === "pending" ? "booking-pending"
            : record.status === "declined" ? "booking-declined"
              : undefined;
    return key ? this.templates.findOverride(key, locale) : undefined;
  }

  private async failKnown(delivery: ClaimedRecordStatusDelivery, diagnostic: string): Promise<void> {
    const retryAt = delivery.attempts >= MAX_ATTEMPTS
      ? null
      : new Date(Date.now() + Math.min(2 ** delivery.attempts * 60_000, 30 * 60_000));
    await this.repository.markFailure(delivery.id, retryAt, diagnostic);
  }

  private async markSentOrAmbiguous(id: string): Promise<void> {
    try {
      await this.repository.markSent(id);
    } catch (error) {
      const diagnostic = sanitizeTelegramDiagnostic(`Message sent but persistence failed: ${String(error)}`);
      try {
        await this.repository.markAmbiguous(id, diagnostic);
      } catch (recordError) {
        this.logger.error(`Record-status ambiguity recording failed: ${sanitizeTelegramDiagnostic(recordError)}`);
      }
    }
  }
}
