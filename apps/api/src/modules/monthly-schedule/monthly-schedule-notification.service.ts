import { Injectable, Logger } from "@nestjs/common";
import type {
  MonthlyScheduleNotificationChange,
  MonthlyScheduleNotificationDelivery,
  MonthlyScheduleNotificationDeliveryOutcome
} from "@beosand/types";
import { ChannelDispatcher } from "../connectors/channels/channel-dispatcher.service";
import { sanitizeTelegramDiagnostic, TelegramSender } from "../notifications/telegram-sender";
import {
  MonthlyScheduleNotificationRepository,
  type EnqueueMonthlyScheduleDigest,
  type InternalMonthlyScheduleDelivery
} from "./monthly-schedule-notification.repository";

export interface EnqueueMonthlySchedulePropagation {
  operationId: string;
  planId: string;
  planRevision: number;
  year: number;
  month: number;
  oldTrainerId: string;
  newTrainerId: string;
  trainingIds: string[];
  changes: MonthlyScheduleNotificationChange[];
}

@Injectable()
export class MonthlyScheduleNotificationService {
  private readonly logger = new Logger(MonthlyScheduleNotificationService.name);

  constructor(
    private readonly repository: MonthlyScheduleNotificationRepository,
    private readonly sender: TelegramSender,
    private readonly dispatcher: ChannelDispatcher
  ) {}

  enqueueInTransaction(
    input: EnqueueMonthlyScheduleDigest,
    db: Parameters<MonthlyScheduleNotificationRepository["enqueue"]>[1]
  ): Promise<void> {
    return this.repository.enqueue(input, db);
  }

  async enqueuePropagation(
    input: EnqueueMonthlySchedulePropagation,
    db: Parameters<MonthlyScheduleNotificationRepository["enqueue"]>[1]
  ): Promise<void> {
    const recipients = await this.repository.recipients(
      input.trainingIds,
      input.oldTrainerId,
      input.newTrainerId,
      db
    );
    for (const recipient of recipients) {
      const changes =
        recipient.kind === "trainer"
          ? input.changes
          : input.changes.filter((change) => recipient.entryIds.includes(change.entryId));
      if (changes.length === 0) continue;
      await this.repository.enqueue(
        {
          operationId: input.operationId,
          planId: input.planId,
          planRevision: input.planRevision,
          year: input.year,
          month: input.month,
          recipientKind: recipient.kind,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientChannelAddress: recipient.channelAddress,
          changes
        },
        db
      );
    }
  }

  async dispatchPending(limit = 20): Promise<void> {
    await this.repository.expireProcessing();
    for (const delivery of await this.repository.claim(limit)) {
      await this.dispatchOne(delivery);
    }
  }

  list(
    planId: string,
    outcome?: MonthlyScheduleNotificationDeliveryOutcome
  ): Promise<MonthlyScheduleNotificationDelivery[]> {
    return this.repository.list(planId, outcome);
  }

  private async dispatchOne(delivery: InternalMonthlyScheduleDelivery): Promise<void> {
    const address = parseAddress(delivery.recipientChannelAddress);
    const text = renderDigest(delivery.changes, delivery.year, delivery.month, address.locale);
    try {
      if (delivery.recipientKind === "trainer") {
        if (address.telegramId === null) {
          await this.fail(delivery, "Trainer has no Telegram address");
          return;
        }
        const outcome = await this.sender.sendMessageWithOutcome(address.telegramId, text);
        if (outcome.kind === "ambiguous") {
          await this.repository.markAmbiguous(
            delivery.id,
            sanitizeTelegramDiagnostic(outcome.diagnostic, address.telegramId)
          );
          return;
        }
        if (outcome.kind === "failed") {
          await this.fail(delivery, sanitizeTelegramDiagnostic(outcome.diagnostic, address.telegramId));
          return;
        }
        await this.markSentOrAmbiguous(delivery.id);
        return;
      }

      let telegramSent = false;
      if (address.telegramId !== null) {
        const telegram = await this.sender.sendMessageWithOutcome(address.telegramId, text);
        if (telegram.kind === "ambiguous") {
          await this.repository.markAmbiguous(
            delivery.id,
            sanitizeTelegramDiagnostic(telegram.diagnostic, address.telegramId)
          );
          return;
        }
        telegramSent = telegram.kind === "sent";
      }
      const otherChannels = await this.dispatcher.dispatch(
        {
          clientId: delivery.recipientId,
          telegramId: null,
          email: address.email,
          phone: address.phone,
          subject: "Изменение расписания тренировок",
          text
        },
        new Set(["telegram"])
      );
      if (telegramSent || otherChannels.some((result) => result.delivered)) {
        await this.markSentOrAmbiguous(delivery.id);
      } else {
        await this.fail(delivery, "No configured recipient channel delivered the digest");
      }
    } catch (error) {
      await this.fail(delivery, sanitizeTelegramDiagnostic(error));
    }
  }

  private async fail(delivery: InternalMonthlyScheduleDelivery, diagnostic: string): Promise<void> {
    const retryAt =
      delivery.attempts >= 5
        ? null
        : new Date(Date.now() + Math.min(2 ** delivery.attempts * 60_000, 30 * 60_000));
    await this.repository.markFailure(delivery.id, retryAt, diagnostic.slice(0, 1024));
  }

  private async markSentOrAmbiguous(id: string): Promise<void> {
    try {
      await this.repository.markSent(id);
    } catch (error) {
      const diagnostic = sanitizeTelegramDiagnostic(
        `Message sent but persistence failed: ${error instanceof Error ? error.message : String(error)}`
      );
      try {
        await this.repository.markAmbiguous(id, diagnostic);
      } catch (recordError) {
        this.logger.error(
          `Planner notification ambiguity recording failed: ${sanitizeTelegramDiagnostic(recordError)}`
        );
      }
    }
  }
}

function parseAddress(value: string | null): {
  telegramId: number | null;
  email: string | null;
  phone: string | null;
  locale: "ru" | "sr" | "en";
} {
  if (!value) return { telegramId: null, email: null, phone: null, locale: "ru" };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      telegramId: typeof parsed.telegramId === "number" ? parsed.telegramId : null,
      email: typeof parsed.email === "string" ? parsed.email : null,
      phone: typeof parsed.phone === "string" ? parsed.phone : null,
      locale: parsed.locale === "sr" || parsed.locale === "en" ? parsed.locale : "ru"
    };
  } catch {
    return { telegramId: null, email: null, phone: null, locale: "ru" };
  }
}

function renderDigest(
  changes: readonly MonthlyScheduleNotificationChange[],
  year: number,
  month: number,
  locale: "ru" | "sr" | "en"
): string {
  const copy = locale === "en"
    ? { title: "Training schedule changed", trainer: "Coach", court: "court", none: "not assigned" }
    : locale === "sr"
      ? { title: "Raspored treninga je promenjen", trainer: "Trener", court: "teren", none: "nije dodeljen" }
      : { title: "Расписание тренировок изменено", trainer: "Тренер", court: "корт", none: "не назначен" };
  const court = (number: number | null) => number === null ? copy.none : `${copy.court} ${number}`;
  return [
    `${copy.title} · ${String(month).padStart(2, "0")}.${year}:`,
    ...changes.map(
      (change) =>
        `${escapeHtml(change.groupName)}: ` +
        `${change.before.date} ${change.before.startTime}–${change.before.endTime}, ` +
        `${copy.trainer} ${escapeHtml(change.before.trainerName)}, ${court(change.before.assignedCourtNumber)} → ` +
        `${change.after.date} ${change.after.startTime}–${change.after.endTime}, ` +
        `${copy.trainer} ${escapeHtml(change.after.trainerName)}, ${court(change.after.assignedCourtNumber)}`
    )
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
