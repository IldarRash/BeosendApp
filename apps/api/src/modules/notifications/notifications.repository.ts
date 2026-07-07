import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type { Locale, NotificationChannelId, NotificationType } from "@beosand/types";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

/**
 * One recipient of a notification: the client to log against plus the Telegram
 * id and training render fields the message template needs. Produced by the
 * recipient-selection joins, which anti-join the `notifications` log so a
 * (client, training, type) already sent is excluded in SQL (idempotency).
 */
export interface NotificationRecipient {
  clientId: string;
  trainingId: string;
  /** Null for walk-in clients (no Telegram account); they are never DM'd. */
  telegramId: number | null;
  /** Email address (walk-ins may have one); null when absent — email channel skipped. */
  email: string | null;
  /** Phone number (walk-ins may have one); null when absent — SMS channel skipped. */
  phone: string | null;
  /** The client's notification locale; drives which template body is rendered. */
  language: Locale;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string;
}

/** Only place notifications DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * True when a row already exists for this (client, training, type). The send
   * log is the idempotency key: an existing row means the message was sent.
   * `trainingId` is nullable in the schema; match it precisely.
   */
  async hasBeenSent(
    clientId: string,
    trainingId: string | null,
    type: NotificationType
  ): Promise<boolean> {
    const [row] = await this.database.db
      .select({ id: tables.notifications.id })
      .from(tables.notifications)
      .where(
        and(
          eq(tables.notifications.clientId, clientId),
          trainingId === null
            ? isNull(tables.notifications.trainingId)
            : eq(tables.notifications.trainingId, trainingId),
          eq(tables.notifications.type, type)
        )
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * The set of channels already logged for this (client, training, type) — the
   * per-channel idempotency gate. `sendAndLog` skips any channel already present so
   * a resend never duplicates a (client, training, type, channel) send. Legacy rows
   * default to 'telegram' (the column default), so the existing telegram-shaped
   * dedup is preserved.
   */
  async sentChannels(
    clientId: string,
    trainingId: string | null,
    type: NotificationType
  ): Promise<Set<NotificationChannelId>> {
    const rows = await this.database.db
      .select({ channel: tables.notifications.channel })
      .from(tables.notifications)
      .where(
        and(
          eq(tables.notifications.clientId, clientId),
          trainingId === null
            ? isNull(tables.notifications.trainingId)
            : eq(tables.notifications.trainingId, trainingId),
          eq(tables.notifications.type, type)
        )
      );
    const channels = new Set<NotificationChannelId>();
    for (const row of rows) {
      // Null/legacy rows are telegram by the column default.
      channels.add((row.channel ?? "telegram") as NotificationChannelId);
    }
    return channels;
  }

  /**
   * Insert one send-log row; `sentAt` defaults to now. `channel` records which
   * connector channel delivered the send (defaults to 'telegram' so the existing
   * telegram-shaped anti-join idempotency is unchanged; email/sms log their own
   * channel in Slice B).
   */
  async logSent(values: {
    type: NotificationType;
    clientId: string;
    trainingId: string | null;
    channel?: NotificationChannelId;
  }): Promise<void> {
    await this.database.db.insert(tables.notifications).values({
      type: values.type,
      clientId: values.clientId,
      trainingId: values.trainingId,
      channel: values.channel ?? "telegram"
    });
  }

  /**
   * Recipients of a reminder of `type` whose training start (`date` + `startTime`)
   * falls in [windowStart, windowEnd] and whose status is open|full (never
   * cancelled|completed). Returns each `booked` booking's client + Telegram id +
   * render fields, LEFT-JOINed to the log so any (client, training, type) already
   * sent is excluded in SQL — at-most-once even across overlapping scan ticks.
   *
   * Window bounds are passed as instants; the training start is compared as
   * Belgrade wall-clock `date + startTime`, independent of the API host timezone.
   */
  async findDueReminders(
    type: NotificationType,
    windowStart: Date,
    windowEnd: Date
  ): Promise<NotificationRecipient[]> {
    // `date + time` yields a naive timestamp (training wall-clock). Compare it
    // against the window bounds formatted as naive Belgrade wall-clock strings
    // so production UTC hosts do not skew reminder due windows.
    const startsAt = sql<string>`(${tables.trainings.date} + ${tables.trainings.startTime})`;
    const lower = toNaiveBelgrade(windowStart);
    const upper = toNaiveBelgrade(windowEnd);
    const rows = await this.database.db
      .select({
        clientId: tables.bookings.clientId,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
        email: tables.clients.email,
        phone: tables.clients.phone,
        language: tables.clients.language,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .leftJoin(
        tables.notifications,
        and(
          eq(tables.notifications.clientId, tables.bookings.clientId),
          eq(tables.notifications.trainingId, tables.trainings.id),
          eq(tables.notifications.type, type)
        )
      )
      .where(
        and(
          eq(tables.bookings.status, "booked"),
          sql`${tables.trainings.status} in ('open','full')`,
          gte(startsAt, lower),
          lte(startsAt, upper),
          isNull(tables.notifications.id),
          // Reachable on at least one channel (telegram, email, or phone); a client
          // with no contact target at all is never selected.
          sql`(${tables.clients.telegramId} is not null or ${tables.clients.email} is not null or ${tables.clients.phone} is not null)`
        )
      );

    return rows.map((row) => normalizeRecipient(row));
  }

  /**
   * One client's booked-training render fields + Telegram id, for any training in
   * `trainingIds`, ordered by date. Drives the booking-confirmation render (single
   * or monthly batch). No log anti-join: the service does its own exists-check so a
   * batch summary can be logged against just the earliest training.
   */
  async findClientTrainingRecipients(
    clientId: string,
    trainingIds: string[]
  ): Promise<NotificationRecipient[]> {
    if (trainingIds.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        clientId: tables.bookings.clientId,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
        email: tables.clients.email,
        phone: tables.clients.phone,
        language: tables.clients.language,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name
      })
      .from(tables.bookings)
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          eq(tables.bookings.status, "booked"),
          inArray(tables.trainings.id, trainingIds)
        )
      )
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => normalizeRecipient(row));
  }

  /**
   * Render fields + Telegram id for the given clients on one training, regardless
   * of current booking status. The cancellation fan-out flips bookings to
   * `cancelled` before notifying, so the booked-only lookup would return nobody;
   * this resolves recipients from the just-cancelled clientIds the cancel tx
   * captured. The `notifications` log is anti-joined per (client, training, type)
   * so the fan-out stays idempotent.
   */
  async findRecipientsByClientIds(
    trainingId: string,
    clientIds: string[],
    type: NotificationType
  ): Promise<NotificationRecipient[]> {
    if (clientIds.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        clientId: tables.clients.id,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
        email: tables.clients.email,
        phone: tables.clients.phone,
        language: tables.clients.language,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.clients, inArray(tables.clients.id, clientIds))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .leftJoin(
        tables.notifications,
        and(
          eq(tables.notifications.clientId, tables.clients.id),
          eq(tables.notifications.trainingId, tables.trainings.id),
          eq(tables.notifications.type, type)
        )
      )
      .where(
        and(
          eq(tables.trainings.id, trainingId),
          isNull(tables.notifications.id),
          // Reachable on at least one channel (telegram, email, or phone); a client
          // with no contact target at all is never selected.
          sql`(${tables.clients.telegramId} is not null or ${tables.clients.email} is not null or ${tables.clients.phone} is not null)`
        )
      );

    return rows.map((row) => normalizeRecipient(row));
  }

  /**
   * Render fields + Telegram id for one client across many trainings, regardless
   * of booking status — the pending/declined DMs (trainer confirmation) fire while
   * the booking is `pending` or already `cancelled`, so the booked-only lookups
   * don't fit. No log anti-join: these are notification-only sends the service
   * fires once per decision. Ordered by date for a readable batch summary.
   */
  async findClientTrainingRenderFields(
    clientId: string,
    trainingIds: string[]
  ): Promise<NotificationRecipient[]> {
    if (trainingIds.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        clientId: tables.clients.id,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
        email: tables.clients.email,
        phone: tables.clients.phone,
        language: tables.clients.language,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.clients, eq(tables.clients.id, clientId))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(inArray(tables.trainings.id, trainingIds))
      .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime));

    return rows.map((row) => normalizeRecipient(row));
  }

  /**
   * Render fields + Telegram id for one (client, training) pair regardless of any
   * booking — the waitlist-promoted/-displaced sends target a client off the back
   * of a queue change, so the booked-only lookups don't fit. No log anti-join: the
   * waitlist promotion is a fresh event each time a seat frees, so it is sent every time.
   */
  async findWaitlistRecipient(
    clientId: string,
    trainingId: string
  ): Promise<NotificationRecipient | undefined> {
    const [row] = await this.database.db
      .select({
        clientId: tables.clients.id,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
        email: tables.clients.email,
        phone: tables.clients.phone,
        language: tables.clients.language,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainerName: tables.trainers.name,
        levelName: tables.levels.name
      })
      .from(tables.trainings)
      .innerJoin(tables.trainers, eq(tables.trainings.trainerId, tables.trainers.id))
      .innerJoin(tables.clients, eq(tables.clients.id, clientId))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .leftJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
      .where(eq(tables.trainings.id, trainingId))
      .limit(1);
    return row ? normalizeRecipient(row) : undefined;
  }
}

interface RecipientRow {
  clientId: string;
  trainingId: string;
  telegramId: number | null;
  email: string | null;
  phone: string | null;
  language: Locale;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string | null;
}

const BELGRADE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

/** Format a Date as a naive Belgrade "YYYY-MM-DD HH:MM:SS" (no timezone suffix). */
function toNaiveBelgrade(date: Date): string {
  const parts = BELGRADE_DATE_TIME_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((item) => item.type === type)?.value;
    if (value === undefined) {
      throw new Error(`Missing ${type} while formatting Belgrade reminder window`);
    }
    return value;
  };
  return (
    `${part("year")}-${part("month")}-${part("day")} ` +
    `${part("hour")}:${part("minute")}:${part("second")}`
  );
}

/** Trim `time` columns to HH:MM and fall back to an empty level name. */
function normalizeRecipient(row: RecipientRow): NotificationRecipient {
  return {
    clientId: row.clientId,
    trainingId: row.trainingId,
    telegramId: row.telegramId,
    email: row.email,
    phone: row.phone,
    language: row.language,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    trainerName: row.trainerName,
    levelName: row.levelName ?? ""
  };
}
