import { Injectable, Logger } from "@nestjs/common";
import type { NotificationType } from "@beosand/types";
import {
  bookingConfirmedMessage,
  groupBookingConfirmedMessage,
  reminderMessage,
  reminderWindow,
  trainingCancelledMessage
} from "./notification-messages";
import {
  type NotificationRecipient,
  NotificationsRepository
} from "./notifications.repository";
import { TelegramSender } from "./telegram-sender";

/**
 * Owns every outbound domain notification (T2.2). Sends are server-side here —
 * the bot never sends them — and the `notifications` send log is the idempotency
 * key: at-most-once per (clientId, trainingId, type). Every method checks the log
 * before sending and writes it after a successful send.
 *
 * Failure tolerance is an invariant: a Telegram send failure is logged via the
 * Nest Logger and swallowed, never rethrown into a committed booking flow and
 * never recorded in the log (so a later scan can retry). A committed booking is
 * never undone because Telegram was unreachable.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly sender: TelegramSender
  ) {}

  /**
   * Confirm a single booking, idempotent per (clientId, trainingId,
   * 'booking-confirmed'). Skips if already logged or if the booking row can no
   * longer be rendered. Fire-and-forget: tolerates a send failure.
   */
  async sendBookingConfirmation(clientId: string, trainingId: string): Promise<void> {
    if (await this.repo.hasBeenSent(clientId, trainingId, "booking-confirmed")) {
      return;
    }
    const [recipient] = await this.repo.findClientTrainingRecipients(clientId, [trainingId]);
    if (!recipient) {
      this.logger.warn(
        `No bookable training ${trainingId} for client ${clientId}; skipping confirmation`
      );
      return;
    }
    await this.sendAndLog(recipient, "booking-confirmed", bookingConfirmedMessage(recipient));
  }

  /**
   * Confirm a monthly group booking with one batch-summary message, logged once
   * against the earliest training in the batch with type 'booking-confirmed'
   * (default §Open questions 2). Idempotent on that earliest training; tolerates a
   * send failure. `trainingIds` are the created bookings' trainings.
   */
  async sendGroupBookingConfirmation(clientId: string, trainingIds: string[]): Promise<void> {
    if (trainingIds.length === 0) {
      return;
    }
    const recipients = await this.repo.findClientTrainingRecipients(clientId, trainingIds);
    if (recipients.length === 0) {
      return;
    }
    // recipients are ordered by date; the earliest carries the dedupe key.
    const anchor = recipients[0];
    if (await this.repo.hasBeenSent(clientId, anchor.trainingId, "booking-confirmed")) {
      return;
    }
    await this.sendAndLog(
      anchor,
      "booking-confirmed",
      groupBookingConfirmedMessage(recipients)
    );
  }

  /**
   * Send all due reminders of `type` at `now`: compute the ±15 min window, fetch
   * recipients (already excluding logged rows in SQL and any cancelled/completed
   * training), send + log each. Returns the number actually sent for the
   * scheduler log. A per-recipient failure is tolerated and not logged, so the
   * next scan retries it.
   */
  async sendDueReminders(type: "reminder-24h" | "reminder-3h", now: Date): Promise<number> {
    const { start, end } = reminderWindow(type, now);
    const recipients = await this.repo.findDueReminders(type, start, end);
    let sent = 0;
    for (const recipient of recipients) {
      const ok = await this.sendAndLog(recipient, type, reminderMessage(type, recipient));
      if (ok) {
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Fan out a training cancellation to every booked client, idempotent per
   * (clientId, trainingId, 'training-cancelled') via the log anti-join. Exposed
   * for T1.12 (the training-cancel write); not triggered by any endpoint here.
   * Returns the number notified.
   */
  async sendTrainingCancelled(trainingId: string): Promise<number> {
    const recipients = await this.repo.findBookedRecipientsForTraining(
      trainingId,
      "training-cancelled"
    );
    let sent = 0;
    for (const recipient of recipients) {
      const ok = await this.sendAndLog(
        recipient,
        "training-cancelled",
        trainingCancelledMessage(recipient)
      );
      if (ok) {
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Send one message and, only on success, write the send-log row. A failure is
   * logged and swallowed (no log row) so the operation is retried next time and
   * never propagates into the caller. Returns whether the message was sent.
   */
  private async sendAndLog(
    recipient: NotificationRecipient,
    type: NotificationType,
    text: string
  ): Promise<boolean> {
    try {
      await this.sender.sendMessage(recipient.telegramId, text);
      await this.repo.logSent({
        type,
        clientId: recipient.clientId,
        trainingId: recipient.trainingId
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Notification ${type} to client ${recipient.clientId} (training ${recipient.trainingId}) failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }
}
