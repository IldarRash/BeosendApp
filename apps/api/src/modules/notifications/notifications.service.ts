import { Injectable, Logger } from "@nestjs/common";
import type { Client, NotificationType, Trainer } from "@beosand/types";
import {
  bookingConfirmedMessage,
  bookingDeclinedMessage,
  bookingPendingMessage,
  bookingPendingTrainerMessage,
  groupBookingConfirmedMessage,
  groupBookingDeclinedMessage,
  groupPendingTrainerMessage,
  individualSessionRequestMessage,
  reminderMessage,
  reminderWindow,
  trainingCancelledMessage,
  waitlistSlotMessage
} from "./notification-messages";
import {
  type NotificationRecipient,
  NotificationsRepository
} from "./notifications.repository";
import { type InlineKeyboardMarkup, TelegramSender } from "./telegram-sender";

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
    if (recipient.telegramId === null) {
      // Walk-in client: no Telegram channel. Skip the send (the booking stands).
      this.logger.debug(`Client ${clientId} has no telegram_id; skipping confirmation DM`);
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
   * Acknowledge a client's booking request that is awaiting the trainer's
   * confirmation (the seat is held meanwhile). Idempotent per (clientId,
   * trainingId, 'booking-pending'); status-agnostic render lookup since the
   * booking is `pending` (not `booked`) at send time. Tolerates a send failure.
   */
  async sendBookingPending(clientId: string, trainingId: string): Promise<void> {
    if (await this.repo.hasBeenSent(clientId, trainingId, "booking-pending")) {
      return;
    }
    const recipient = await this.repo.findWaitlistRecipient(clientId, trainingId);
    if (!recipient) {
      this.logger.warn(`No training ${trainingId} render fields for client ${clientId}; skipping pending ack`);
      return;
    }
    await this.sendAndLog(recipient, "booking-pending", bookingPendingMessage(recipient));
  }

  /**
   * Notify a client that the trainer declined their request (the held seat was
   * freed). Idempotent per (clientId, trainingId, 'booking-declined'); the booking
   * is `cancelled` by send time, so the lookup is status-agnostic (mirrors
   * findWaitlistRecipient). Tolerates a send failure.
   */
  async sendBookingDeclined(clientId: string, trainingId: string): Promise<void> {
    if (await this.repo.hasBeenSent(clientId, trainingId, "booking-declined")) {
      return;
    }
    const recipient = await this.repo.findWaitlistRecipient(clientId, trainingId);
    if (!recipient) {
      this.logger.warn(`No training ${trainingId} render fields for client ${clientId}; skipping decline DM`);
      return;
    }
    await this.sendAndLog(recipient, "booking-declined", bookingDeclinedMessage(recipient));
  }

  /**
   * Notify a client that a monthly-subscription batch was declined with ONE summary
   * message, logged once against the earliest training with type 'booking-declined'.
   * Status-agnostic render (the rows are `cancelled` by send time). Idempotent on
   * that earliest training; tolerates a send failure.
   */
  async sendGroupBookingDeclined(clientId: string, trainingIds: string[]): Promise<void> {
    if (trainingIds.length === 0) {
      return;
    }
    const recipients = await this.repo.findClientTrainingRenderFields(clientId, trainingIds);
    if (recipients.length === 0) {
      return;
    }
    // recipients are ordered by date; the earliest carries the dedupe key.
    const anchor = recipients[0];
    if (await this.repo.hasBeenSent(clientId, anchor.trainingId, "booking-declined")) {
      return;
    }
    await this.sendAndLog(anchor, "booking-declined", groupBookingDeclinedMessage(recipients));
  }

  /**
   * DM the training's trainer that a single booking request awaits their decision
   * (T trainer-confirm). Notification-only: no send-log row (modeled on
   * requestIndividualSession). Carries an inline confirm/decline keyboard whose
   * callback data the bot routes on. The caller resolves the trainer telegram id
   * (skips entirely when the trainer has none — that path auto-confirms instead).
   * Returns whether the DM was sent; a failure is logged and swallowed.
   */
  async sendBookingPendingToTrainer(
    trainerTelegramId: number,
    clientId: string,
    trainingId: string,
    clientName: string,
    replyMarkup: InlineKeyboardMarkup
  ): Promise<boolean> {
    const recipient = await this.repo.findWaitlistRecipient(clientId, trainingId);
    if (!recipient) {
      this.logger.warn(`No training ${trainingId} render fields; skipping trainer pending DM`);
      return false;
    }
    try {
      await this.sender.sendMessage(
        trainerTelegramId,
        bookingPendingTrainerMessage(recipient, clientName),
        replyMarkup
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Trainer pending DM (training ${trainingId}) failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  /**
   * DM the trainer ONE summary of a monthly-subscription batch of pending requests
   * with a single confirm/decline keyboard (keyed on the groupSubscriptionId).
   * Notification-only: no send-log row. The caller resolves the trainer telegram id
   * (skips when the trainer has none — that path auto-confirms). Returns whether the
   * DM was sent; a failure is logged and swallowed.
   */
  async sendGroupPendingToTrainer(
    trainerTelegramId: number,
    clientId: string,
    trainingIds: string[],
    clientName: string,
    replyMarkup: InlineKeyboardMarkup
  ): Promise<boolean> {
    const recipients = await this.repo.findClientTrainingRenderFields(clientId, trainingIds);
    if (recipients.length === 0) {
      this.logger.warn(`No render fields for subscription batch; skipping trainer pending DM`);
      return false;
    }
    try {
      await this.sender.sendMessage(
        trainerTelegramId,
        groupPendingTrainerMessage(recipients, clientName),
        replyMarkup
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Trainer group-pending DM failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
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
   * Fan out a training cancellation to the clients whose bookings were just
   * cancelled, idempotent per (clientId, trainingId, 'training-cancelled') via the
   * log anti-join. The cancel tx flips those bookings to `cancelled` before this
   * runs, so recipients are resolved from the captured `clientIds` (a booked-only
   * lookup would now return nobody). Exposed for T1.12 (the training-cancel
   * write); not triggered by any endpoint here. Returns the number notified.
   */
  async sendTrainingCancelled(trainingId: string, clientIds: string[]): Promise<number> {
    const recipients = await this.repo.findRecipientsByClientIds(
      trainingId,
      clientIds,
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
   * Push a freed-seat ("waitlist-slot") message to the promoted client, carrying
   * an inline "Подтвердить" button (T2.1). Each promotion is a fresh event (a new
   * seat freed), so this is sent every time — no log anti-join — but the send is
   * still logged for analytics. A send failure is logged and swallowed (the
   * sweep/cancel flow must never be undone because Telegram was unreachable);
   * returns whether the message was sent so the caller can decide on a retry.
   */
  async sendWaitlistSlot(
    clientId: string,
    trainingId: string,
    windowMinutes: number,
    replyMarkup: InlineKeyboardMarkup
  ): Promise<boolean> {
    const recipient = await this.repo.findWaitlistRecipient(clientId, trainingId);
    if (!recipient) {
      this.logger.warn(
        `No training ${trainingId} render fields for client ${clientId}; skipping waitlist-slot`
      );
      return false;
    }
    if (recipient.telegramId === null) {
      // Walk-in client: no Telegram channel. Skip the waitlist-slot send.
      this.logger.debug(`Client ${clientId} has no telegram_id; skipping waitlist-slot`);
      return false;
    }
    try {
      await this.sender.sendMessage(
        recipient.telegramId,
        waitlistSlotMessage(recipient, windowMinutes),
        replyMarkup
      );
      await this.repo.logSent({
        type: "waitlist-slot",
        clientId: recipient.clientId,
        trainingId: recipient.trainingId
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Waitlist-slot to client ${clientId} (training ${trainingId}) failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  /**
   * Ad-hoc trainer DM (Feature 8): a client wants an individual session — DM the
   * trainer a "please contact the client" message carrying a clickable link to
   * the client (username link or an id-based mention for username-less clients).
   * Notification-only: no send-log row (there is no training to key it on). The
   * caller guarantees a non-null trainer telegram id. Returns whether the send
   * succeeded; a failure is logged (never the token) and swallowed.
   */
  async requestIndividualSession(
    trainer: Trainer & { telegramId: number },
    client: Client
  ): Promise<boolean> {
    try {
      await this.sender.sendMessage(trainer.telegramId, individualSessionRequestMessage(client));
      this.logger.log(
        `Individual-session request from client ${client.id} delivered to trainer ${trainer.id}`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Individual-session request from client ${client.id} to trainer ${trainer.id} failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
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
    if (recipient.telegramId === null) {
      // Walk-in client: no Telegram channel. Never attempt a send or log a row.
      this.logger.debug(
        `Recipient client ${recipient.clientId} has no telegram_id; skipping ${type}`
      );
      return false;
    }
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
