import { Injectable } from "@nestjs/common";
import { tables } from "@beosand/db";
import type { NotificationType } from "@beosand/types";
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
  telegramId: number;
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

  /** Insert one send-log row; `sentAt` defaults to now. */
  async logSent(values: {
    type: NotificationType;
    clientId: string;
    trainingId: string | null;
  }): Promise<void> {
    await this.database.db.insert(tables.notifications).values({
      type: values.type,
      clientId: values.clientId,
      trainingId: values.trainingId
    });
  }

  /**
   * Recipients of a reminder of `type` whose training start (`date` + `startTime`)
   * falls in [windowStart, windowEnd] and whose status is open|full (never
   * cancelled|completed). Returns each `booked` booking's client + Telegram id +
   * render fields, LEFT-JOINed to the log so any (client, training, type) already
   * sent is excluded in SQL — at-most-once even across overlapping scan ticks.
   *
   * Window bounds are passed as full timestamps; the training start is compared
   * as `date + startTime` interpreted in the API process timezone.
   */
  async findDueReminders(
    type: NotificationType,
    windowStart: Date,
    windowEnd: Date
  ): Promise<NotificationRecipient[]> {
    // `date + time` yields a naive timestamp (training wall-clock). Compare it
    // against the window bounds formatted as naive local wall-clock strings so
    // both sides share the API/DB local timezone (no UTC offset skew).
    const startsAt = sql<string>`(${tables.trainings.date} + ${tables.trainings.startTime})`;
    const lower = toNaiveLocal(windowStart);
    const upper = toNaiveLocal(windowEnd);
    const rows = await this.database.db
      .select({
        clientId: tables.bookings.clientId,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
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
          isNull(tables.notifications.id)
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
   * Booked clients of one training (render fields + Telegram id) that have not
   * yet been logged for `type`. Used by the cancellation fan-out (T1.12) and the
   * confirmation render; the log anti-join keeps the fan-out idempotent.
   */
  async findBookedRecipientsForTraining(
    trainingId: string,
    type: NotificationType
  ): Promise<NotificationRecipient[]> {
    const rows = await this.database.db
      .select({
        clientId: tables.bookings.clientId,
        trainingId: tables.trainings.id,
        telegramId: tables.clients.telegramId,
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
          eq(tables.bookings.trainingId, trainingId),
          eq(tables.bookings.status, "booked"),
          isNull(tables.notifications.id)
        )
      );

    return rows.map((row) => normalizeRecipient(row));
  }
}

interface RecipientRow {
  clientId: string;
  trainingId: string;
  telegramId: number;
  date: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  levelName: string | null;
}

/** Format a Date as a naive local "YYYY-MM-DD HH:MM:SS" (no timezone suffix). */
function toNaiveLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Trim `time` columns to HH:MM and fall back to an empty level name. */
function normalizeRecipient(row: RecipientRow): NotificationRecipient {
  return {
    clientId: row.clientId,
    trainingId: row.trainingId,
    telegramId: row.telegramId,
    date: row.date,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    trainerName: row.trainerName,
    levelName: row.levelName ?? ""
  };
}
