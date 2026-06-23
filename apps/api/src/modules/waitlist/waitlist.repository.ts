import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { BookingStatus, TrainingStatus, WaitlistEntry, WaitlistStatus } from "@beosand/types";
import { type SQL, and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service";

type WaitlistRow = typeof tables.waitlist.$inferSelect;
type NewWaitlistRow = typeof tables.waitlist.$inferInsert;

/** A training row's capacity state, read FOR UPDATE so the accept recompute is race-safe. */
export interface TrainingLockRow {
  id: string;
  capacity: number;
  bookedCount: number;
  status: TrainingStatus;
}

/**
 * A booking row locked FOR UPDATE for the admin swap: the entry takes this
 * booking's seat, so the swap re-checks it is on the same training and still
 * active before cancelling it. Carries the displaced client's subscription link
 * so the re-queued front entry can rebook them as a `group` booking later.
 */
export interface SwapBookingLockRow {
  id: string;
  clientId: string;
  trainingId: string;
  groupSubscriptionId: string | null;
  status: BookingStatus;
}

/**
 * A waitlist entry joined to its read-only display fields (client name, training
 * date/time/status, group name) for the admin/Mini App queue views. The joined
 * fields are display-only and never accepted on a write — they map straight to
 * waitlistAdminItemSchema.
 */
export interface WaitlistAdminRow {
  id: string;
  clientId: string;
  trainingId: string;
  position: number;
  groupSubscriptionId: string | null;
  status: WaitlistStatus;
  addedAt: Date;
  notifiedAt: Date | null;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
  trainingStatus: TrainingStatus;
  groupName: string | null;
}

/** An active source-group waitlist entry the transfer cancels, locked FOR UPDATE. */
export interface SourceWaitlistRow {
  id: string;
  trainingId: string;
}

/** A waitlist entry locked FOR UPDATE for the accept/expire writes. */
export interface WaitlistLockRow {
  id: string;
  clientId: string;
  trainingId: string;
  position: number;
  /** The monthly subscription this entry belongs to; null for a single-training join. */
  groupSubscriptionId: string | null;
  status: WaitlistStatus;
  notifiedAt: Date | null;
}

/** An expired-window candidate: a `notified` entry whose window has passed. */
export interface ExpiredCandidate {
  id: string;
  trainingId: string;
}

/** Only place waitlist DB access lives. Returns typed rows; no business rules. */
@Injectable()
export class WaitlistRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Run a transaction with the waitlist repo's DB handle. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return this.database.db.transaction(work);
  }

  /** The training row selected FOR UPDATE so the accept recompute cannot oversell. */
  async findTrainingForUpdate(
    tx: Database,
    trainingId: string
  ): Promise<TrainingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.trainings.id,
        capacity: tables.trainings.capacity,
        bookedCount: tables.trainings.bookedCount,
        status: tables.trainings.status
      })
      .from(tables.trainings)
      .where(eq(tables.trainings.id, trainingId))
      .limit(1)
      .for("update");
    return row;
  }

  /** An active (`waiting`|`notified`) waitlist entry for this client + training — drives the duplicate check. */
  async findActiveEntryForClient(
    tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<WaitlistEntry | undefined> {
    const [row] = await tx
      .select()
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.clientId, clientId),
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .limit(1);
    return row ? toEntry(row) : undefined;
  }

  /**
   * The current max position on a training (0 when empty) so a new entry appends at
   * +1. Intentionally spans ALL statuses (a monotonically growing tail): the append
   * position never reuses a number freed by a promoted/expired/cancelled entry, so
   * positions stay unique and append order is preserved. This asymmetry with
   * `minActivePosition` (active-only, for the front-insert) is deliberate.
   */
  async maxPosition(tx: Database, trainingId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${tables.waitlist.position})` })
      .from(tables.waitlist)
      .where(eq(tables.waitlist.trainingId, trainingId));
    return row?.max ?? 0;
  }

  /**
   * The current minimum ACTIVE (`waiting`|`notified`) position on a training
   * (0 when none) so a front-insert (admin swap) prepends at min-1. Positions are
   * internal ordering, not a 1-based rank, so the result may be zero or negative.
   * Only active entries count: a promoted/expired/cancelled entry never blocks the
   * head.
   */
  async minActivePosition(tx: Database, trainingId: string): Promise<number> {
    const [row] = await tx
      .select({ min: sql<number | null>`min(${tables.waitlist.position})` })
      .from(tables.waitlist)
      .where(
        and(
          eq(tables.waitlist.trainingId, trainingId),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      );
    return row?.min ?? 0;
  }

  /** Insert one waitlist entry inside the caller's transaction; returns the created row. */
  async insertEntry(tx: Database, values: NewWaitlistRow): Promise<WaitlistEntry> {
    const [row] = await tx.insert(tables.waitlist).values(values).returning();
    return toEntry(row);
  }

  /**
   * Append a `waiting` entry at the tail of a training's queue (position
   * max+1), optionally linked to a monthly subscription so promotion later
   * rebooks it as a `group` booking. The single place the append position is
   * computed + the row inserted — shared by a plain single-training join (T2.1)
   * and a monthly subscription waitlisting a full date (T1.9). Runs inside the
   * caller's transaction; no business rules (the service owns the duplicate /
   * full-only guards).
   */
  async appendEntry(
    tx: Database,
    values: { clientId: string; trainingId: string; groupSubscriptionId: string | null }
  ): Promise<WaitlistEntry> {
    const position = (await this.maxPosition(tx, values.trainingId)) + 1;
    return this.insertEntry(tx, {
      clientId: values.clientId,
      trainingId: values.trainingId,
      groupSubscriptionId: values.groupSubscriptionId,
      position,
      status: "waiting"
    });
  }

  /**
   * Prepend a `waiting` entry at the FRONT of a training's queue (position
   * min-1, so it becomes the next promoted) — the admin swap re-queues the
   * displaced client ahead of everyone, optionally carrying their booking's
   * subscription link so a later promote rebooks them as a `group` booking.
   * Positions may go zero or negative; that is intentional (the contract documents
   * position as internal ordering, not a 1-based rank). Runs inside the caller's
   * transaction; no business rules.
   */
  async prependEntry(
    tx: Database,
    values: { clientId: string; trainingId: string; groupSubscriptionId: string | null }
  ): Promise<WaitlistEntry> {
    const position = (await this.minActivePosition(tx, values.trainingId)) - 1;
    return this.insertEntry(tx, {
      clientId: values.clientId,
      trainingId: values.trainingId,
      groupSubscriptionId: values.groupSubscriptionId,
      position,
      status: "waiting"
    });
  }

  /** A single waitlist entry selected FOR UPDATE for the accept/expire writes. */
  async findEntryForUpdate(tx: Database, id: string): Promise<WaitlistLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.waitlist.id,
        clientId: tables.waitlist.clientId,
        trainingId: tables.waitlist.trainingId,
        position: tables.waitlist.position,
        groupSubscriptionId: tables.waitlist.groupSubscriptionId,
        status: tables.waitlist.status,
        notifiedAt: tables.waitlist.notifiedAt
      })
      .from(tables.waitlist)
      .where(eq(tables.waitlist.id, id))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * The head `waiting` entry on a training (lowest position) locked FOR UPDATE so
   * promotion respects order and two cancels can't promote the same head twice.
   */
  async findHeadWaitingForUpdate(
    tx: Database,
    trainingId: string
  ): Promise<WaitlistLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.waitlist.id,
        clientId: tables.waitlist.clientId,
        trainingId: tables.waitlist.trainingId,
        position: tables.waitlist.position,
        groupSubscriptionId: tables.waitlist.groupSubscriptionId,
        status: tables.waitlist.status,
        notifiedAt: tables.waitlist.notifiedAt
      })
      .from(tables.waitlist)
      .where(
        and(eq(tables.waitlist.trainingId, trainingId), eq(tables.waitlist.status, "waiting"))
      )
      .orderBy(asc(tables.waitlist.position))
      .limit(1)
      .for("update");
    return row;
  }

  /** Mark an entry `notified` and stamp `notifiedAt`; returns the updated row. */
  async markNotified(tx: Database, id: string, notifiedAt: Date): Promise<WaitlistEntry> {
    const [row] = await tx
      .update(tables.waitlist)
      .set({ status: "notified", notifiedAt })
      .where(eq(tables.waitlist.id, id))
      .returning();
    return toEntry(row);
  }

  /** Set an entry's status (e.g. `promoted` / `expired`) inside the caller's transaction. */
  async setStatus(tx: Database, id: string, status: WaitlistStatus): Promise<WaitlistEntry> {
    const [row] = await tx
      .update(tables.waitlist)
      .set({ status })
      .where(eq(tables.waitlist.id, id))
      .returning();
    return toEntry(row);
  }

  /** Persist the recomputed capacity/status onto the training inside the caller's transaction. */
  async updateTrainingCount(
    tx: Database,
    trainingId: string,
    bookedCount: number,
    status: TrainingStatus
  ): Promise<void> {
    await tx
      .update(tables.trainings)
      .set({ bookedCount, status })
      .where(eq(tables.trainings.id, trainingId));
  }

  /**
   * An existing seat-occupying booking ('booked' or 'pending') for this client +
   * training (avoid double-booking on waitlist accept). A `pending` booking already
   * holds a seat, so a client awaiting confirmation must not also be promoted into a
   * second booking on the same training.
   */
  async hasActiveBooking(
    tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: tables.bookings.id })
      .from(tables.bookings)
      .where(
        and(
          eq(tables.bookings.clientId, clientId),
          eq(tables.bookings.trainingId, trainingId),
          inArray(tables.bookings.status, ["booked", "pending"])
        )
      )
      .limit(1);
    return row !== undefined;
  }

  /** Insert one `booked` booking inside the caller's transaction; returns the created id/training. */
  async insertBooking(
    tx: Database,
    values: typeof tables.bookings.$inferInsert
  ): Promise<typeof tables.bookings.$inferSelect> {
    const [row] = await tx.insert(tables.bookings).values(values).returning();
    return row;
  }

  /**
   * The booking the admin swap displaces, selected FOR UPDATE so the cancel and the
   * training recompute race-safely against it. Carries the displaced client's id,
   * its training (re-checked against the entry's), its subscription link (so the
   * re-queued front entry rebooks them as `group`), and its status (active-only
   * guard). Caller must hold a tx.
   */
  async findBookingForUpdate(
    tx: Database,
    bookingId: string
  ): Promise<SwapBookingLockRow | undefined> {
    const [row] = await tx
      .select({
        id: tables.bookings.id,
        clientId: tables.bookings.clientId,
        trainingId: tables.bookings.trainingId,
        groupSubscriptionId: tables.bookings.groupSubscriptionId,
        status: tables.bookings.status
      })
      .from(tables.bookings)
      .where(eq(tables.bookings.id, bookingId))
      .limit(1)
      .for("update");
    return row;
  }

  /** Mark exactly one booking (matched by id only) cancelled inside the caller's tx. */
  async markBookingCancelled(tx: Database, bookingId: string): Promise<void> {
    await tx
      .update(tables.bookings)
      .set({ status: "cancelled" })
      .where(eq(tables.bookings.id, bookingId));
  }

  /**
   * Every `notified` entry whose confirmation window has closed (`notifiedAt <=
   * cutoff`). Drives the minutely sweep; no lock here — the sweep re-loads each
   * entry FOR UPDATE before expiring it.
   */
  async findExpiredNotified(cutoff: Date): Promise<ExpiredCandidate[]> {
    return this.database.db
      .select({ id: tables.waitlist.id, trainingId: tables.waitlist.trainingId })
      .from(tables.waitlist)
      .where(and(eq(tables.waitlist.status, "notified"), lte(tables.waitlist.notifiedAt, cutoff)))
      .orderBy(asc(tables.waitlist.position));
  }

  /**
   * Active (`waiting`|`notified`) entries on ONE training, joined to the display
   * fields the admin/Mini App queue renders, ordered by position. Caller (service)
   * owns the admin gate; the repo applies no business rules. Group name comes via
   * the training's (nullable) group, so a group-less training reads null.
   */
  async listForTraining(trainingId: string): Promise<WaitlistAdminRow[]> {
    return this.selectAdminRows(
      and(
        eq(tables.waitlist.trainingId, trainingId),
        inArray(tables.waitlist.status, ["waiting", "notified"])
      ),
      [asc(tables.waitlist.position)]
    );
  }

  /**
   * Active (`waiting`|`notified`) entries across a group's trainings within
   * [from, to] (a calendar month), joined to the display fields, ordered by
   * training date then position — the admin "group queue" for the month. Caller
   * owns the admin gate.
   */
  async listForGroupMonth(
    groupId: string,
    from: string,
    to: string
  ): Promise<WaitlistAdminRow[]> {
    return this.selectAdminRows(
      and(
        eq(tables.trainings.groupId, groupId),
        gte(tables.trainings.date, from),
        lte(tables.trainings.date, to),
        inArray(tables.waitlist.status, ["waiting", "notified"])
      ),
      [asc(tables.trainings.date), asc(tables.waitlist.position)]
    );
  }

  /**
   * One client's own active (`waiting`|`notified`) entries, joined to the display
   * fields, ordered by training date then position — the client "my queue" view.
   * Ownership is the service's concern; the repo only filters by clientId.
   */
  async listForClient(clientId: string): Promise<WaitlistAdminRow[]> {
    return this.selectAdminRows(
      and(
        eq(tables.waitlist.clientId, clientId),
        inArray(tables.waitlist.status, ["waiting", "notified"])
      ),
      [asc(tables.trainings.date), asc(tables.waitlist.position)]
    );
  }

  /**
   * The client's active (`waiting`|`notified`) waitlist entries on a SOURCE group's
   * trainings whose date is within [from, to], locked FOR UPDATE so the transfer can
   * cancel them race-safely (a move must not strand the client on the old group's
   * queue). The service passes `from` already clamped to today. Lock scoped to the
   * waitlist rows (`of` waitlist) so the training join doesn't lock trainings.
   */
  async findClientGroupActiveEntriesForUpdate(
    tx: Database,
    clientId: string,
    groupId: string,
    from: string,
    to: string
  ): Promise<SourceWaitlistRow[]> {
    return tx
      .select({ id: tables.waitlist.id, trainingId: tables.waitlist.trainingId })
      .from(tables.waitlist)
      .innerJoin(tables.trainings, eq(tables.waitlist.trainingId, tables.trainings.id))
      .where(
        and(
          eq(tables.waitlist.clientId, clientId),
          eq(tables.trainings.groupId, groupId),
          gte(tables.trainings.date, from),
          lte(tables.trainings.date, to),
          inArray(tables.waitlist.status, ["waiting", "notified"])
        )
      )
      .for("update", { of: tables.waitlist });
  }

  /**
   * Shared SELECT for the three admin/queue list views (one training, a group's
   * month, or one client): the waitlist row + the client name + the training's
   * date/time/status + the group name, under the caller's `where` and `orderBy`.
   * The single place the admin-item join shape lives, so the three lists can't
   * drift. Raw `time` columns are trimmed to HH:MM by the service mapper.
   */
  private selectAdminRows(
    where: ReturnType<typeof and>,
    orderBy: SQL[]
  ): Promise<WaitlistAdminRow[]> {
    return this.database.db
      .select({
        id: tables.waitlist.id,
        clientId: tables.waitlist.clientId,
        trainingId: tables.waitlist.trainingId,
        position: tables.waitlist.position,
        groupSubscriptionId: tables.waitlist.groupSubscriptionId,
        status: tables.waitlist.status,
        addedAt: tables.waitlist.addedAt,
        notifiedAt: tables.waitlist.notifiedAt,
        clientName: tables.clients.name,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        trainingStatus: tables.trainings.status,
        groupName: tables.groups.name
      })
      .from(tables.waitlist)
      .innerJoin(tables.trainings, eq(tables.waitlist.trainingId, tables.trainings.id))
      .innerJoin(tables.clients, eq(tables.waitlist.clientId, tables.clients.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .where(where)
      .orderBy(...orderBy);
  }
}

/** The DB returns timestamps as Date; the contract wants ISO strings. */
function toEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: row.id,
    clientId: row.clientId,
    trainingId: row.trainingId,
    position: row.position,
    groupSubscriptionId: row.groupSubscriptionId,
    status: row.status,
    addedAt: row.addedAt.toISOString(),
    notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null
  };
}
