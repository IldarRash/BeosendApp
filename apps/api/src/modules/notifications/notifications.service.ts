import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { adminTelegramIds } from "@beosand/config";
import type { Client, Locale, NotificationType, Trainer } from "@beosand/types";
import {
  bookingConfirmedMessage,
  bookingDeclinedMessage,
  bookingPendingMessage,
  buildTemplateVars,
  clientMentionLink,
  escapeHtml,
  groupBookingConfirmedMessage,
  groupBookingDeclinedMessage,
  groupPendingAdminMessage,
  renderNotificationTemplate,
  reminderMessage,
  reminderWindow,
  resolveTemplateBody,
  trainingCancelledMessage,
  waitlistSlotMessage
} from "./notification-messages";
import { ChannelDispatcher } from "../connectors/channels/channel-dispatcher.service";
import { ManagersRepository } from "../managers/managers.repository";
import { NotificationTemplatesRepository } from "../notification-templates/notification-templates.repository";
import { TrainersRepository } from "../trainers/trainers.repository";
import {
  type NotificationRecipient,
  NotificationsRepository
} from "./notifications.repository";
import { TelegramSender } from "./telegram-sender";
import {
  adminDeepLinkMarkup,
  confirmDeclineKeyboard,
  waitlistAcceptKeyboard,
  withAdminDeepLink
} from "./notification-keyboards";
import { ENV } from "../../config/config.module";

/** The staff-DM fallback locale (SR) when a recipient is neither manager nor trainer. */
const STAFF_FALLBACK_LOCALE: Locale = "sr";

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
 *
 * Client-facing sends fan out through the connectors ChannelDispatcher (Slice 0:
 * TelegramChannel only, so behavior is identical). The admin-DM/keyboard sends
 * (pending booking/subscription, new court request, individual-session request)
 * stay on TelegramSender directly — they carry an inline keyboard and target the
 * admins, not a client the dispatcher fans out to.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly sender: TelegramSender,
    private readonly templates: NotificationTemplatesRepository,
    private readonly dispatcher: ChannelDispatcher,
    private readonly managers: ManagersRepository,
    private readonly trainers: TrainersRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /**
   * The notification locale for a staff recipient: the manager row's language,
   * else the trainer row's, else SR (the primary staff language). A staff member
   * is identified solely by Telegram id (env admins with no DB row also fall back
   * to SR). Reused by every admin-DM loop so each admin reads the template in their
   * own language.
   */
  async resolveStaffLocale(telegramId: number): Promise<Locale> {
    const manager = await this.managers.findLanguageByTelegramId(telegramId);
    if (manager) {
      return manager;
    }
    const trainer = await this.trainers.findLanguageByTelegramId(telegramId);
    return trainer ?? STAFF_FALLBACK_LOCALE;
  }

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
    // No telegram-only early-return: a walk-in with an email/phone but no Telegram is
    // still reached on the email/SMS channels (Slice B). sendAndLog skips a recipient
    // with no reachable channel at all.
    const override = await this.templates.findOverride("booking-confirmed", recipient.language);
    await this.sendAndLog(
      recipient,
      "booking-confirmed",
      bookingConfirmedMessage(recipient, recipient.language, override)
    );
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
    const override = await this.templates.findOverride("booking-pending", recipient.language);
    await this.sendAndLog(
      recipient,
      "booking-pending",
      bookingPendingMessage(recipient, recipient.language, override)
    );
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
    const override = await this.templates.findOverride("booking-declined", recipient.language);
    await this.sendAndLog(
      recipient,
      "booking-declined",
      bookingDeclinedMessage(recipient, recipient.language, override)
    );
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
   * DM every admin that a single booking request awaits a decision (T
   * admin-confirm). Notification-only: no send-log row. Carries the caller's
   * confirm/decline keyboard (whose callback data the bot routes on) plus a
   * deep-link button into the trainings page. Best-effort per recipient; a
   * blocked/failed DM is logged and skipped, the committed booking stands.
   */
  async sendBookingPendingToAdmins(
    adminIds: number[],
    clientId: string,
    trainingId: string,
    clientName: string,
    bookingId: string
  ): Promise<void> {
    if (adminIds.length === 0) {
      return;
    }
    const recipient = await this.repo.findWaitlistRecipient(clientId, trainingId);
    if (!recipient) {
      this.logger.warn(`No training ${trainingId} render fields; skipping admin pending DM`);
      return;
    }
    const vars = { ...buildTemplateVars(recipient), clientName: escapeHtml(clientName) };
    for (const adminId of adminIds) {
      try {
        const locale = await this.resolveStaffLocale(adminId);
        const override = await this.templates.findOverride("booking-pending-admin", locale);
        const text = renderNotificationTemplate(
          resolveTemplateBody("booking-pending-admin", locale, override),
          vars
        );
        const replyMarkup = withAdminDeepLink(
          confirmDeclineKeyboard(locale, "bk", bookingId),
          this.env.ADMIN_URL,
          locale,
          "/trainings",
          "bot.notify.openAdmin"
        );
        await this.sender.sendMessage(adminId, text, replyMarkup);
      } catch (error) {
        this.logger.warn(
          `Booking-pending DM (training ${trainingId}) to admin ${adminId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }
  }

  /**
   * DM every admin ONE summary of a monthly-subscription batch of pending requests
   * with a single confirm/decline keyboard (keyed on the groupSubscriptionId) plus
   * a deep-link button into the subscriptions page. Notification-only: no send-log
   * row. Best-effort per recipient; a failed DM is logged and skipped.
   */
  async sendGroupPendingToAdmins(
    adminIds: number[],
    clientId: string,
    trainingIds: string[],
    clientName: string,
    groupSubscriptionId: string
  ): Promise<void> {
    if (adminIds.length === 0) {
      return;
    }
    const recipients = await this.repo.findClientTrainingRenderFields(clientId, trainingIds);
    if (recipients.length === 0) {
      this.logger.warn(`No render fields for subscription batch; skipping admin pending DM`);
      return;
    }
    const text = groupPendingAdminMessage(recipients, clientName);
    for (const adminId of adminIds) {
      try {
        const locale = await this.resolveStaffLocale(adminId);
        const replyMarkup = withAdminDeepLink(
          confirmDeclineKeyboard(locale, "sub", groupSubscriptionId),
          this.env.ADMIN_URL,
          locale,
          "/subscriptions",
          "bot.notify.openAdmin"
        );
        await this.sender.sendMessage(adminId, text, replyMarkup);
      } catch (error) {
        this.logger.warn(
          `Subscription-pending DM to admin ${adminId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
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
      // Override is locale-keyed, so resolve per recipient's language (tiny table).
      const override = await this.templates.findOverride(type, recipient.language);
      const ok = await this.sendAndLog(
        recipient,
        type,
        reminderMessage(type, recipient, recipient.language, override)
      );
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
      const override = await this.templates.findOverride(
        "training-cancelled",
        recipient.language
      );
      const ok = await this.sendAndLog(
        recipient,
        "training-cancelled",
        trainingCancelledMessage(recipient, recipient.language, override)
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
    entryId: string
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
    const override = await this.templates.findOverride("waitlist-slot", recipient.language);
    const replyMarkup = waitlistAcceptKeyboard(recipient.language, entryId);
    try {
      await this.sender.sendMessage(
        recipient.telegramId,
        waitlistSlotMessage(recipient, windowMinutes, recipient.language, override),
        replyMarkup
      );
      await this.repo.logSent({
        type: "waitlist-slot",
        clientId: recipient.clientId,
        trainingId: recipient.trainingId,
        channel: "telegram"
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
   * Ad-hoc admin DM (Feature 8): a client wants an individual session with a
   * trainer — DM every admin a "please contact the client" message naming the
   * requested trainer and carrying a clickable link to the client (username link
   * or an id-based mention for username-less clients) plus a deep-link button into
   * the trainings page. Notification-only: no send-log row (there is no training to
   * key it on). Returns whether at least one admin received it; per-recipient
   * failures are logged (never the token) and swallowed.
   */
  async notifyAdminsOfIndividualRequest(
    adminIds: number[],
    trainer: Trainer,
    client: Client
  ): Promise<boolean> {
    if (adminIds.length === 0) {
      return false;
    }
    // The client name is a clickable HTML mention/link; the trainer name is escaped.
    const vars = {
      clientName: clientMentionLink(client),
      trainerName: escapeHtml(trainer.name)
    };
    let delivered = false;
    for (const adminId of adminIds) {
      try {
        const locale = await this.resolveStaffLocale(adminId);
        const override = await this.templates.findOverride("individual-request-admin", locale);
        const text = renderNotificationTemplate(
          resolveTemplateBody("individual-request-admin", locale, override),
          vars
        );
        const replyMarkup = adminDeepLinkMarkup(
          this.env.ADMIN_URL,
          locale,
          "/trainings",
          "bot.notify.openAdmin"
        );
        await this.sender.sendMessage(adminId, text, replyMarkup);
        delivered = true;
      } catch (error) {
        this.logger.warn(
          `Individual-session request (client ${client.id}, trainer ${trainer.id}) to admin ` +
            `${adminId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }
    return delivered;
  }

  /**
   * Operational DM to every admin (ADMIN_TELEGRAM_IDS) that a new court request was
   * just created, so a manager can open the moderation queue and confirm/reject it.
   * This is an inline operational message, NOT one of the client-facing DB templates,
   * and it carries no send-log row. When ADMIN_URL is set it attaches a single
   * "Открыть заявку" URL button deep-linking the admin console's court-requests page.
   * Best-effort: each per-admin send is wrapped so a blocked/failed DM is logged and
   * skipped — the committed court request is never undone because Telegram was
   * unreachable. A no-op when no admin ids are configured.
   */
  async sendCourtRequestCreatedToAdmins(input: {
    clientName: string;
    clientTelegramId: number;
    date: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    courtCount: number;
    priceRsd: number;
  }): Promise<void> {
    const adminIds = adminTelegramIds(this.env);
    if (adminIds.length === 0) {
      return;
    }

    const vars = {
      clientName: escapeHtml(input.clientName),
      clientTelegramId: input.clientTelegramId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      durationHours: input.durationHours,
      courtCount: input.courtCount,
      priceRsd: input.priceRsd
    };

    for (const adminId of adminIds) {
      try {
        const locale = await this.resolveStaffLocale(adminId);
        const override = await this.templates.findOverride("court-request-created-admin", locale);
        const text = renderNotificationTemplate(
          resolveTemplateBody("court-request-created-admin", locale, override),
          vars
        );
        const replyMarkup = adminDeepLinkMarkup(
          this.env.ADMIN_URL,
          locale,
          "/court-requests",
          "bot.notify.openRequest"
        );
        await this.sender.sendMessage(adminId, text, replyMarkup);
      } catch (error) {
        this.logger.warn(
          `New-court-request DM to admin ${adminId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }
  }

  /**
   * Fan a message out to every channel the recipient can be reached on (telegram if a
   * Telegram id, email if an email, sms if a phone) and log each channel that delivered
   * with its own `channel` value (Slice B). Per-channel idempotency: the channels
   * already logged for this (client, training, type) are passed to the dispatcher as a
   * skip set, so a resend never re-delivers a channel that already succeeded. The
   * telegram anti-join idempotency is unchanged — a telegram row is still written only
   * when telegram delivered. The dispatcher tolerates per-channel failures and never
   * throws, so a failed channel is simply not logged and is retried on the next call,
   * and a committed booking is never undone because a channel was unreachable. Returns
   * whether the telegram channel delivered (kept for the existing callers/assertions).
   */
  private async sendAndLog(
    recipient: NotificationRecipient,
    type: NotificationType,
    text: string
  ): Promise<boolean> {
    // Skip channels already logged for this (client, training, type) so a resend never
    // duplicates a (client, training, type, channel) send. Legacy rows default to
    // telegram (column default), preserving the telegram-shaped dedup.
    const skip = await this.repo.sentChannels(recipient.clientId, recipient.trainingId, type);
    const results = await this.dispatcher.dispatch(
      {
        clientId: recipient.clientId,
        telegramId: recipient.telegramId,
        email: recipient.email,
        phone: recipient.phone,
        text
      },
      skip
    );
    // Log every channel that delivered, tagged by its channel so each (client, training,
    // type, channel) is recorded at most once and a resend skips it next time.
    for (const result of results) {
      if (result.delivered) {
        await this.repo.logSent({
          type,
          clientId: recipient.clientId,
          trainingId: recipient.trainingId,
          channel: result.channelId
        });
      }
    }
    return results.some((result) => result.channelId === "telegram" && result.delivered);
  }
}
