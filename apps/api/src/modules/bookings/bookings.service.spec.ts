import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { Booking, Client, Group, Trainer, WaitlistEntry } from "@beosand/types";
import type { MyBookingRow } from "./bookings.repository";
import { beforeEach, describe, expect, it } from "vitest";
import { BookingsService } from "./bookings.service";
import type {
  BookingsRepository,
  GroupTrainingLockRow,
  TrainingLockRow
} from "./bookings.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { DomainEventsService } from "../connectors/domain-events.service";
import type { GroupsRepository } from "../groups/groups.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import type { TrainersRepository } from "../trainers/trainers.repository";
import type { WaitlistService } from "../waitlist/waitlist.service";

/** No-op notifications double: confirmation/pending sends are fire-and-forget here. */
const fakeNotifications = {
  sendBookingConfirmation: async (): Promise<void> => undefined,
  sendGroupBookingConfirmation: async (): Promise<void> => undefined,
  sendBookingPending: async (): Promise<void> => undefined,
  sendBookingPendingToAdmins: async (): Promise<void> => undefined,
  sendGroupPendingToAdmins: async (): Promise<void> => undefined
} as unknown as NotificationsService;

/**
 * Stateful waitlist double. `promoteNext` is the no-op post-commit promotion the
 * cancel/decline paths fire-and-forget. `appendSubscriptionEntry` mirrors the real
 * append: it records each (clientId, trainingId, groupSubscriptionId) queued by a
 * monthly booking on a full date, assigns the next position per training, and
 * returns undefined when the client is already queued on that training (re-run
 * guard) so the service folds the date into `skipped`.
 */
class FakeWaitlistService {
  /** Entries appended by bookGroupMonth, in order — the tests assert over these. */
  appended: Array<{ clientId: string; trainingId: string; groupSubscriptionId: string; position: number }> = [];
  /** trainingId → preexisting max position, so a second queue on it appends at +1. */
  startPositions: Record<string, number> = {};
  /** clientIds already holding an active entry per training (skip, don't re-queue). */
  private activeByTraining: Record<string, Set<string>> = {};
  /** Source-group cleanups the transfer requests — the tests assert over these. */
  cancelledSourceEntries: Array<{ clientId: string; groupId: string; from: string; to: string }> = [];

  /** Seed a preexisting active entry so a re-run's duplicate guard returns undefined. */
  seedActive(trainingId: string, clientId: string): void {
    (this.activeByTraining[trainingId] ??= new Set()).add(clientId);
  }

  async promoteNext(): Promise<void> {
    return undefined;
  }

  /** Record the transfer's source-waitlist cleanup; returns the (fake) cancel count. */
  async cancelClientGroupEntriesForMonth(
    _tx: Database,
    params: { clientId: string; groupId: string; from: string; to: string }
  ): Promise<number> {
    this.cancelledSourceEntries.push({ ...params });
    return 0;
  }

  async appendSubscriptionEntry(
    _tx: Database,
    params: { clientId: string; trainingId: string; groupSubscriptionId: string }
  ): Promise<WaitlistEntry | undefined> {
    const active = (this.activeByTraining[params.trainingId] ??= new Set());
    if (active.has(params.clientId)) {
      return undefined;
    }
    active.add(params.clientId);
    const prior = this.appended.filter((e) => e.trainingId === params.trainingId).length;
    const position = (this.startPositions[params.trainingId] ?? 0) + prior + 1;
    this.appended.push({ ...params, position });
    return { position } as unknown as WaitlistEntry;
  }
}

/** Shared no-op instance for the describe blocks that never waitlist. */
const fakeWaitlist = new FakeWaitlistService() as unknown as WaitlistService;

/** No-op domain-events double: the connector emit seam is fire-and-forget here. */
const fakeDomainEvents = {
  emitBookingCreated: (): void => undefined,
  emitBookingDeclined: (): void => undefined
} as unknown as DomainEventsService;

const ADMIN_ID = 111;
const OWNER_ID = 222;
const STRANGER_ID = 333;
const TRAINER_ID_TG = 444;
const OTHER_TRAINER_ID_TG = 555;
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const WALKIN_CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const TRAINING_ID = "33333333-3333-3333-3333-333333333333";
const GROUP_ID = "44444444-4444-4444-4444-444444444444";
const TRAINER_ID = "66666666-6666-6666-6666-666666666666";
const OTHER_TRAINER_DB_ID = "77777777-7777-4777-8777-777777777777";

// A month far in the future so the today-clamp never filters the fixtures.
const FUTURE_YEAR = 2099;
const FUTURE_MONTH = 6;

const ownerClient: Client = {
  id: CLIENT_ID,
  name: "Owner",
  telegramId: OWNER_ID,
  telegramUsername: null,
  levelId: null,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: new Date().toISOString(),
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

/** A walk-in client (no Telegram id) for the manual-booking tests. */
const walkInClient: Client = {
  id: WALKIN_CLIENT_ID,
  name: "Marko",
  telegramId: null,
  telegramUsername: null,
  levelId: null,
  source: "walk_in",
  phone: "+381601234567",
  email: null,
  note: null,
  language: "ru",
  registeredAt: new Date().toISOString(),
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

/** A training fixture without trainerId; the fake fills a default trainerId on read. */
type FakeTraining = Omit<TrainingLockRow, "trainerId"> & { trainerId?: string };
type FakeMonthTraining = Omit<GroupTrainingLockRow, "trainerId"> & { trainerId?: string };

/** In-memory stand-in for the bookings repository (only DB-access layer). */
class FakeBookingsRepository {
  training: FakeTraining | undefined;
  monthTrainings: FakeMonthTraining[] = [];
  bookings: Booking[] = [];
  /** When set, the next insertBooking throws to exercise transaction rollback. */
  failInsertOnTrainingId: string | undefined;
  /** When set, updateTrainingCount throws for this training to exercise cancel rollback. */
  failUpdateCountOnTrainingId: string | undefined;
  /**
   * Optional linked clients fake whose bonus balances this fake transaction snapshots
   * and restores on throw, so a test can faithfully assert the cross-table atomicity
   * of a bonus-credit redemption (the debit and the seat write commit together or not
   * at all). Unset for the suites that don't touch bonus credits.
   */
  rollbackClients: FakeClientsRepository | undefined;
  private seq = 0;

  /**
   * Model a DB transaction: when a linked clients fake is present, snapshot every
   * client's bonus balance up front and restore it if `work` rejects — mirroring a
   * real ROLLBACK so a redemption that fails downstream (e.g. a full-slot 409 thrown
   * after the debit) leaves the balance untouched. Without a link it is a passthrough.
   */
  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    const snapshot = this.rollbackClients?.snapshotBonus();
    try {
      return await work({} as Database);
    } catch (error) {
      if (snapshot) {
        this.rollbackClients?.restoreBonus(snapshot);
      }
      throw error;
    }
  }

  /**
   * Extra lockable trainings keyed by id, for the subscription-batch tests where a
   * decline must recompute several distinct trainings. `training` remains the single
   * default fixture used by the rest of the suite.
   */
  trainingsById: Record<string, FakeTraining> = {};

  async findTrainingForUpdate(
    _tx: Database,
    trainingId: string
  ): Promise<TrainingLockRow | undefined> {
    const extra = this.trainingsById[trainingId];
    if (extra) {
      return { ...extra, trainerId: extra.trainerId ?? TRAINER_ID };
    }
    if (this.training && this.training.id === trainingId) {
      return { ...this.training, trainerId: this.training.trainerId ?? TRAINER_ID };
    }
    // The transfer cancels source-group bookings whose training is among the
    // configured source instances; resolve those too.
    const source = this.sourceTrainings.find((t) => t.id === trainingId);
    if (source) {
      return { ...source, trainerId: source.trainerId ?? TRAINER_ID };
    }
    return undefined;
  }

  /** Render fields for the connectors domain-event payloads (best-effort emit). */
  async findTrainingRefs(
    trainingIds: string[]
  ): Promise<Map<string, { date: string; startTime: string; endTime: string }>> {
    return new Map(
      trainingIds.map((id) => [id, { date: "2099-06-08", startTime: "18:00", endTime: "19:30" }])
    );
  }

  /** Source-group training instances the transfer cancels (locked then recomputed). */
  sourceTrainings: FakeMonthTraining[] = [];

  async findGroupTrainingsForMonthForUpdate(
    _tx: Database,
    _groupId: string,
    _from: string,
    _to: string
  ): Promise<GroupTrainingLockRow[]> {
    return this.monthTrainings.map((t) => ({ ...t, trainerId: t.trainerId ?? TRAINER_ID }));
  }

  /** Rows the listForClient read returns, keyed nowhere — the test supplies them. */
  myRows: MyBookingRow[] = [];

  async listForClient(
    _clientId: string,
    _scope: "upcoming" | "past",
    _today: string
  ): Promise<MyBookingRow[]> {
    return this.myRows;
  }

  async findActiveBookingForClient(
    _tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<Booking | undefined> {
    // Mirrors the repo: a `pending` hold also occupies the seat, so it counts as a
    // duplicate exactly like a `booked` one.
    return this.bookings.find(
      (b) =>
        b.clientId === clientId &&
        b.trainingId === trainingId &&
        (b.status === "booked" || b.status === "pending")
    );
  }

  /** Maps a trainingId to its date for the transfer's source-booking read. */
  bookingTrainingDates: Record<string, string> = {};

  /** Maps a trainingId to its source group id for the transfer's group filter. */
  bookingGroupIds: Record<string, string> = {};

  async findClientGroupBookingsForUpdate(
    _tx: Database,
    clientId: string,
    groupId: string,
    from: string,
    to: string
  ): Promise<Array<{ bookingId: string; trainingId: string; date: string }>> {
    // Mirror the real query: only this client's booked rows on `groupId` whose
    // training date falls within the [from, to] window (so the today-clamp and
    // the group filter are actually exercised by the tests).
    return this.bookings
      .filter((b) => b.clientId === clientId && b.status === "booked")
      .map((b) => ({
        bookingId: b.id,
        trainingId: b.trainingId,
        date: this.bookingTrainingDates[b.trainingId] ?? "2099-06-01"
      }))
      .filter((row) => {
        const rowGroupId = this.bookingGroupIds[row.trainingId];
        if (rowGroupId !== undefined && rowGroupId !== groupId) return false;
        return row.date >= from && row.date <= to;
      });
  }

  async insertBooking(
    _tx: Database,
    values: {
      clientId: string;
      trainingId: string;
      type: "single" | "group";
      groupSubscriptionId: string | null;
      status: "booked" | "pending";
      source: Booking["source"];
      // Optional payment stamp for a comped (bonus-redeemed) seat; mirrors NewBookingRow.
      paymentStatus?: "paid" | "unpaid";
      paidAt?: Date | null;
      paidBy?: number | null;
    }
  ): Promise<Booking> {
    if (this.failInsertOnTrainingId && values.trainingId === this.failInsertOnTrainingId) {
      throw new Error("simulated DB failure mid-batch");
    }
    const booking: Booking = {
      id: `aaaaaaaa-aaaa-aaaa-aaaa-0000000000${String(++this.seq).padStart(2, "0")}`,
      clientId: values.clientId,
      trainingId: values.trainingId,
      type: values.type,
      groupSubscriptionId: values.groupSubscriptionId,
      createdAt: new Date().toISOString(),
      status: values.status,
      source: values.source,
      // Default to unpaid (the column default) unless the caller comped the seat,
      // mirroring the repo's toBooking mapping (paidAt → ISO string or null).
      paymentStatus: values.paymentStatus ?? "unpaid",
      paidAt: values.paidAt ? values.paidAt.toISOString() : null,
      paidBy: values.paidBy ?? null
    };
    this.bookings.push(booking);
    return booking;
  }

  /**
   * Every row of a subscription (ANY status), locked for the confirm/decline batch,
   * joined to its training's trainerId. Mirrors the repo: matched by
   * groupSubscriptionId ONLY so the service can detect an empty batch (404) and
   * authorize before short-circuiting on an already-decided one.
   */
  async findBySubscriptionForUpdate(
    _tx: Database,
    groupSubscriptionId: string
  ): Promise<
    { id: string; clientId: string; trainingId: string; trainerId: string; status: Booking["status"] }[]
  > {
    return this.bookings
      .filter((b) => b.groupSubscriptionId === groupSubscriptionId)
      .map((b) => ({
        id: b.id,
        clientId: b.clientId,
        trainingId: b.trainingId,
        trainerId: this.trainingsById[b.trainingId]?.trainerId ?? this.training?.trainerId ?? TRAINER_ID,
        status: b.status
      }));
  }

  async findBookingForUpdate(
    _tx: Database,
    bookingId: string
  ): Promise<
    { id: string; clientId: string; trainingId: string; status: Booking["status"] } | undefined
  > {
    const booking = this.bookings.find((b) => b.id === bookingId);
    return booking
      ? {
          id: booking.id,
          clientId: booking.clientId,
          trainingId: booking.trainingId,
          status: booking.status
        }
      : undefined;
  }

  /** Maps a trainingId to its trainerId/date for the attendance read. */
  trainingMeta: Record<string, { trainerId: string; date: string }> = {};

  async findBookingWithTrainingForUpdate(
    _tx: Database,
    bookingId: string
  ): Promise<
    | {
        id: string;
        status: Booking["status"];
        trainingId: string;
        trainerId: string;
        trainingDate: string;
      }
    | undefined
  > {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      return undefined;
    }
    const meta = this.trainingMeta[booking.trainingId] ?? {
      trainerId: "00000000-0000-0000-0000-000000000000",
      date: "2026-06-03"
    };
    return {
      id: booking.id,
      status: booking.status,
      trainingId: booking.trainingId,
      trainerId: meta.trainerId,
      trainingDate: meta.date
    };
  }

  async updateBookingStatus(
    _tx: Database,
    bookingId: string,
    status: Booking["status"]
  ): Promise<Booking> {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      throw new Error(`booking ${bookingId} missing in fake`);
    }
    booking.status = status;
    return booking;
  }

  async markCancelled(_tx: Database, bookingId: string): Promise<Booking> {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) {
      throw new Error(`booking ${bookingId} missing in fake`);
    }
    booking.status = "cancelled";
    return booking;
  }

  async updateTrainingCount(
    _tx: Database,
    trainingId: string,
    bookedCount: number,
    status: TrainingLockRow["status"]
  ): Promise<void> {
    if (this.failUpdateCountOnTrainingId && trainingId === this.failUpdateCountOnTrainingId) {
      throw new Error("simulated DB failure persisting recompute");
    }
    if (this.training && this.training.id === trainingId) {
      this.training.bookedCount = bookedCount;
      this.training.status = status;
    }
    const extra = this.trainingsById[trainingId];
    if (extra) {
      extra.bookedCount = bookedCount;
      extra.status = status;
    }
    const monthRow = this.monthTrainings.find((t) => t.id === trainingId);
    if (monthRow) {
      monthRow.bookedCount = bookedCount;
      monthRow.status = status;
    }
    const sourceRow = this.sourceTrainings.find((t) => t.id === trainingId);
    if (sourceRow) {
      sourceRow.bookedCount = bookedCount;
      sourceRow.status = status;
    }
  }
}

class FakeClientsRepository {
  client: Client | undefined = { ...ownerClient };
  /** Clients resolvable by id (the manual-booking path reads the booked client). */
  byId: Client[] = [{ ...ownerClient }, { ...walkInClient }];
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
  }
  async findById(id: string): Promise<Client | undefined> {
    return this.byId.find((c) => c.id === id);
  }
  /** Mirror the atomic credit add: bump the resolvable client's bonus balance. */
  async addBonusCredits(_tx: Database, clientId: string, amount: number): Promise<void> {
    const target = this.byId.find((c) => c.id === clientId);
    if (target) {
      target.bonusTrainingCredits += amount;
    }
    if (this.client && this.client.id === clientId) {
      this.client.bonusTrainingCredits += amount;
    }
  }

  /** Snapshot every client's bonus balance so a faked transaction can roll it back. */
  snapshotBonus(): Map<Client, number> {
    const snapshot = new Map<Client, number>();
    for (const client of [...this.byId, ...(this.client ? [this.client] : [])]) {
      snapshot.set(client, client.bonusTrainingCredits);
    }
    return snapshot;
  }

  /** Restore a bonus-balance snapshot (the faked transaction's ROLLBACK). */
  restoreBonus(snapshot: Map<Client, number>): void {
    for (const [client, credits] of snapshot) {
      client.bonusTrainingCredits = credits;
    }
  }
}

class FakeTrainersRepository {
  trainers: Trainer[] = [];
  async findByTelegramId(telegramId: number): Promise<Trainer | undefined> {
    return this.trainers.find((t) => t.telegramId === telegramId && t.status === "active");
  }
  async findById(id: string): Promise<Trainer | undefined> {
    return this.trainers.find((t) => t.id === id);
  }
}

const activeGroup: Group = {
  id: GROUP_ID,
  name: "Mon/Wed Beginners",
  levelId: "55555555-5555-5555-5555-555555555555",
  daysOfWeek: [1, 3],
  startTime: "18:00",
  endTime: "19:30",
  trainerId: "66666666-6666-6666-6666-666666666666",
  trainerName: "Jovana",
  courtId: null,
  courtNumber: null,
  capacity: 6,
  priceSingleRsd: 1200,
  priceMonthRsd: 8000,
  hidden: false,
  status: "active"
};

class FakeGroupsRepository {
  group: Group | undefined = { ...activeGroup };
  /** When true, the client is treated as already holding an active monthly subscription. */
  subscribed = false;
  async findById(id: string): Promise<Group | undefined> {
    return this.group && this.group.id === id ? this.group : undefined;
  }
  async hasActiveSubscription(
    _clientId: string,
    _groupId: string,
    _from: string,
    _to: string
  ): Promise<boolean> {
    return this.subscribed;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;
// No admin configured: a client booking has nobody to confirm it, so it
// auto-confirms (→ booked) and the confirmation send is what fires post-commit.
const envNoAdmin = { ADMIN_TELEGRAM_IDS: [] as string[] } as unknown as Env;

describe("BookingsService.createSingle", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    // Admin configured (`env`) so admin-on-behalf and oversell tests authorize; a
    // client request therefore holds as 'pending' (a pending hold counts toward
    // capacity exactly like a booked seat, so the seat-math assertions are unchanged).
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      fakeNotifications,
      fakeWaitlist,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  const input = { clientId: CLIENT_ID, trainingId: TRAINING_ID };

  it("holds a seat, increments bookedCount exactly once and keeps the slot open below capacity", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 2,
      status: "open"
    };
    const booking = await service.createSingle(OWNER_ID, input);

    expect(booking.status).toBe("pending");
    expect(booking.type).toBe("single");
    expect(booking.groupSubscriptionId).toBeNull();
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training.bookedCount).toBe(3);
    expect(bookingsRepo.training.status).toBe("open");
  });

  it("flips the slot to full on the capacity-th booking", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 5,
      status: "open"
    };
    await service.createSingle(OWNER_ID, input);
    expect(bookingsRepo.training.bookedCount).toBe(6);
    expect(bookingsRepo.training.status).toBe("full");
  });

  it("rejects booking a full training with a 409 ConflictException (for the waitlist branch)", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 6, status: "full" };
    await expect(service.createSingle(OWNER_ID, input)).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rejects booking a cancelled training with a 409 ConflictException", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "cancelled" };
    await expect(service.createSingle(OWNER_ID, input)).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rejects a duplicate active booking with a 409 ConflictException", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 1, status: "open" };
    await service.createSingle(OWNER_ID, input);
    await expect(service.createSingle(OWNER_ID, input)).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training.bookedCount).toBe(2);
  });

  it("404s an unknown training", async () => {
    bookingsRepo.training = undefined;
    await expect(service.createSingle(OWNER_ID, input)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a caller booking for a client that is not their own (ForbiddenException)", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "open" };
    await expect(
      service.createSingle(OWNER_ID, { clientId: OTHER_CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rejects a caller with no client record (ForbiddenException)", async () => {
    clientsRepo.client = undefined;
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "open" };
    await expect(service.createSingle(STRANGER_ID, input)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("lets an admin book on behalf of any client", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "open" };
    const booking = await service.createSingle(ADMIN_ID, {
      clientId: OTHER_CLIENT_ID,
      trainingId: TRAINING_ID
    });
    expect(booking.clientId).toBe(OTHER_CLIENT_ID);
    expect(bookingsRepo.training.bookedCount).toBe(1);
  });

  // Oversell invariant: the FOR-UPDATE → recompute loop must let exactly
  // `capacity` distinct clients book, flip the slot to full on the capacity-th,
  // and then reject every further attempt with a 409 — never bookedCount > capacity.
  // Different clientIds are used (via the admin path) so this is the recompute
  // gate doing the work, not the duplicate check.
  it("never oversells: admits exactly capacity clients then rejects the overflow with a 409", async () => {
    const capacity = 3;
    bookingsRepo.training = { id: TRAINING_ID, capacity, bookedCount: 0, status: "open" };

    for (let i = 1; i <= capacity; i += 1) {
      await service.createSingle(ADMIN_ID, {
        clientId: `cccccccc-cccc-cccc-cccc-0000000000${String(i).padStart(2, "0")}`,
        trainingId: TRAINING_ID
      });
      expect(bookingsRepo.training.bookedCount).toBe(i);
      expect(bookingsRepo.training.status).toBe(i >= capacity ? "full" : "open");
    }

    // capacity-th booking flipped it to full → the (capacity+1)-th is rejected.
    await expect(
      service.createSingle(ADMIN_ID, {
        clientId: "cccccccc-cccc-cccc-cccc-0000000000ff",
        trainingId: TRAINING_ID
      })
    ).rejects.toBeInstanceOf(ConflictException);

    // Capacity is never exceeded and no overflow booking was inserted.
    expect(bookingsRepo.training.bookedCount).toBe(capacity);
    expect(bookingsRepo.bookings).toHaveLength(capacity);
  });

  it("recomputes status from the locked count, not the supplied training status (full despite stale 'open' input row)", async () => {
    // Lock row reports 'open' but is already at capacity-1; the booking that
    // reaches capacity must still be recomputed to 'full'.
    bookingsRepo.training = { id: TRAINING_ID, capacity: 2, bookedCount: 1, status: "open" };
    await service.createSingle(OWNER_ID, input);
    expect(bookingsRepo.training.bookedCount).toBe(2);
    expect(bookingsRepo.training.status).toBe("full");
  });
});

describe("BookingsService.createGroupBooking", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let groupsRepo: FakeGroupsRepository;
  let waitlist: FakeWaitlistService;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    groupsRepo = new FakeGroupsRepository();
    // A fresh, inspectable waitlist double per test: a full month-date is queued
    // through it (not silently skipped) and the bonus-credit grant follows.
    waitlist = new FakeWaitlistService();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      groupsRepo as unknown as GroupsRepository,
      fakeNotifications,
      waitlist as unknown as WaitlistService,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  const input = { clientId: CLIENT_ID, groupId: GROUP_ID, year: FUTURE_YEAR, month: FUTURE_MONTH };

  const monthTraining = (id: string, date: string, over: Partial<GroupTrainingLockRow> = {}) => ({
    id,
    date,
    capacity: 6,
    bookedCount: 0,
    status: "open" as const,
    ...over
  });

  it("creates one booking per bookable instance, all sharing a single groupSubscriptionId", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03"),
      monthTraining("a3333333-3333-3333-3333-333333333333", "2099-06-08")
    ];

    const result = await service.createGroupBooking(OWNER_ID, input);

    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    const subIds = new Set(result.created.map((b) => b.groupSubscriptionId));
    expect(subIds.size).toBe(1);
    expect([...subIds][0]).toBe(result.groupSubscriptionId);
    expect(result.created.every((b) => b.type === "group")).toBe(true);
  });

  it("recomputes count/status per instance and flips an at-capacity slot to full", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01", { bookedCount: 2 }),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03", {
        capacity: 6,
        bookedCount: 5
      })
    ];

    await service.createGroupBooking(OWNER_ID, input);

    expect(bookingsRepo.monthTrainings[0].bookedCount).toBe(3);
    expect(bookingsRepo.monthTrainings[0].status).toBe("open");
    expect(bookingsRepo.monthTrainings[1].bookedCount).toBe(6);
    expect(bookingsRepo.monthTrainings[1].status).toBe("full");
  });

  it("waitlists a full date (never skips it), grants a bonus credit, and books the rest", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03", {
        bookedCount: 6,
        status: "full"
      }),
      monthTraining("a3333333-3333-3333-3333-333333333333", "2099-06-08")
    ];

    const result = await service.createGroupBooking(OWNER_ID, input);

    // The two open dates are booked; the full date is queued, not skipped.
    expect(result.created).toHaveLength(2);
    expect(result.created.map((b) => b.trainingId)).not.toContain(
      "a2222222-2222-2222-2222-222222222222"
    );
    expect(result.waitlisted).toEqual([{ date: "2099-06-03", position: 1 }]);
    expect(result.skipped).toHaveLength(0);

    // The queue entry is linked to the batch subscription so promotion rebooks it
    // as a `group` booking later.
    expect(waitlist.appended).toEqual([
      {
        clientId: CLIENT_ID,
        trainingId: "a2222222-2222-2222-2222-222222222222",
        groupSubscriptionId: result.groupSubscriptionId,
        position: 1
      }
    ]);

    // +1 bonus-training credit for the one date the month couldn't honour.
    expect(clientsRepo.client?.bonusTrainingCredits).toBe(1);

    // The full training's seat counters are untouched (waitlisting holds no seat).
    expect(bookingsRepo.monthTrainings[1].bookedCount).toBe(6);
    expect(bookingsRepo.monthTrainings[1].status).toBe("full");

    // The booked dates recompute correctly (still open below capacity).
    expect(bookingsRepo.monthTrainings[0].bookedCount).toBe(1);
    expect(bookingsRepo.monthTrainings[0].status).toBe("open");
    expect(bookingsRepo.monthTrainings[2].bookedCount).toBe(1);
    expect(bookingsRepo.monthTrainings[2].status).toBe("open");
  });

  it("skips a cancelled/completed date without waitlisting or granting a credit", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03", {
        bookedCount: 6,
        status: "cancelled"
      }),
      monthTraining("a3333333-3333-3333-3333-333333333333", "2099-06-08", {
        bookedCount: 6,
        status: "completed"
      })
    ];

    const result = await service.createGroupBooking(OWNER_ID, input);

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual(["2099-06-03", "2099-06-08"]);
    expect(result.waitlisted).toHaveLength(0);
    expect(waitlist.appended).toHaveLength(0);
    expect(clientsRepo.client?.bonusTrainingCredits).toBe(0);
  });

  it("does not re-queue a full date the client already holds an active waitlist entry on (re-run safe)", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03", {
        bookedCount: 6,
        status: "full"
      })
    ];
    // Simulate a prior run that already queued this client on the full date.
    waitlist.seedActive("a2222222-2222-2222-2222-222222222222", CLIENT_ID);

    const result = await service.createGroupBooking(OWNER_ID, input);

    expect(result.created).toHaveLength(0);
    expect(result.waitlisted).toHaveLength(0);
    // Folded into skipped, and no second credit granted on the re-run.
    expect(result.skipped).toEqual(["2099-06-03"]);
    expect(clientsRepo.client?.bonusTrainingCredits).toBe(0);
  });

  it("skips an instance the client is already booked into (re-run safe)", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03")
    ];
    bookingsRepo.bookings = [
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        clientId: CLIENT_ID,
        trainingId: "a1111111-1111-1111-1111-111111111111",
        type: "single",
        groupSubscriptionId: null,
        createdAt: new Date().toISOString(),
        status: "booked",
        source: "telegram",
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      }
    ];

    const result = await service.createGroupBooking(OWNER_ID, input);

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual(["2099-06-01"]);
  });

  it("throws BadRequestException when the month has no generated trainings", async () => {
    bookingsRepo.monthTrainings = [];
    await expect(service.createGroupBooking(OWNER_ID, input)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("404s an unknown group", async () => {
    groupsRepo.group = undefined;
    await expect(service.createGroupBooking(OWNER_ID, input)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("400s an inactive group", async () => {
    groupsRepo.group = { ...activeGroup, status: "inactive" };
    await expect(service.createGroupBooking(OWNER_ID, input)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("409s re-buying a month the client already has an active subscription for, before any write", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01")
    ];
    // The client already holds an active monthly subscription for this group+month.
    groupsRepo.subscribed = true;

    await expect(service.createGroupBooking(OWNER_ID, input)).rejects.toBeInstanceOf(
      ConflictException
    );
    // The duplicate guard fires before the batch transaction, so nothing is booked.
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rejects booking the month for another client (ForbiddenException), supplied clientId untrusted", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01")
    ];
    await expect(
      service.createGroupBooking(OWNER_ID, { ...input, clientId: OTHER_CLIENT_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rolls back the whole month when an insert fails mid-batch (atomicity)", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03"),
      monthTraining("a3333333-3333-3333-3333-333333333333", "2099-06-08")
    ];
    bookingsRepo.failInsertOnTrainingId = "a2222222-2222-2222-2222-222222222222";

    await expect(service.createGroupBooking(OWNER_ID, input)).rejects.toThrow();
    // The transaction wrapper would discard partial writes; the failure must surface.
  });
});

// A committed booking must NEVER be undone because the post-commit Telegram
// confirmation failed (T2.2 invariant). The notifications double here throws on
// every send; the booking call must still resolve with the persisted booking.
describe("BookingsService confirmation hook is failure-tolerant", () => {
  const throwingNotifications = {
    sendBookingConfirmation: async (): Promise<void> => {
      throw new Error("telegram unreachable");
    },
    sendGroupBookingConfirmation: async (): Promise<void> => {
      throw new Error("telegram unreachable");
    }
  } as unknown as NotificationsService;

  let bookingsRepo: FakeBookingsRepository;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      throwingNotifications,
      fakeWaitlist,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      envNoAdmin
    );
  });

  it("returns the persisted single booking even when the confirmation send throws", async () => {
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "open" };

    const booking = await service.createSingle(OWNER_ID, {
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID
    });

    // The booking is committed and the count incremented despite the failed send.
    expect(booking.status).toBe("booked");
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training.bookedCount).toBe(1);
  });

  it("returns the persisted group batch even when the confirmation send throws", async () => {
    bookingsRepo.monthTrainings = [
      {
        id: "a1111111-1111-1111-1111-111111111111",
        date: "2099-06-01",
        capacity: 6,
        bookedCount: 0,
        status: "open"
      },
      {
        id: "a2222222-2222-2222-2222-222222222222",
        date: "2099-06-03",
        capacity: 6,
        bookedCount: 0,
        status: "open"
      }
    ];

    const result = await service.createGroupBooking(OWNER_ID, {
      clientId: CLIENT_ID,
      groupId: GROUP_ID,
      year: FUTURE_YEAR,
      month: FUTURE_MONTH
    });

    expect(result.created).toHaveLength(2);
    expect(bookingsRepo.bookings).toHaveLength(2);
  });
});

describe("BookingsService.listMine", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      fakeNotifications,
      fakeWaitlist,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  const today = new Date().toISOString().slice(0, 10);
  const future = "2099-06-08"; // a Monday in 2099 → dayOfWeek 1
  const past = "2000-01-03"; // a Monday in 2000

  const row = (over: Partial<MyBookingRow> = {}): MyBookingRow => ({
    bookingId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    trainingId: TRAINING_ID,
    groupSubscriptionId: null,
    date: future,
    startTime: "18:00",
    endTime: "19:30",
    trainerName: "Coach",
    levelName: "Beginners",
    bookingStatus: "booked",
    trainingStatus: "open",
    ...over
  });

  it("marks a future, booked item on a non-terminal training cancellable", async () => {
    bookingsRepo.myRows = [row()];
    const [item] = await service.listMine(OWNER_ID, CLIENT_ID, "upcoming");
    expect(item.canCancel).toBe(true);
    expect(item.dayOfWeek).toBe(1);
  });

  it("does not allow cancel for a cancelled booking", async () => {
    bookingsRepo.myRows = [row({ bookingStatus: "cancelled" })];
    const [item] = await service.listMine(OWNER_ID, CLIENT_ID, "upcoming");
    expect(item.canCancel).toBe(false);
  });

  it("does not allow cancel for a past (or today) item even if still booked", async () => {
    bookingsRepo.myRows = [row({ date: past, bookingStatus: "attended" })];
    const [item] = await service.listMine(OWNER_ID, CLIENT_ID, "past");
    expect(item.canCancel).toBe(false);
  });

  it("does not allow cancel when the training is terminal (cancelled)", async () => {
    bookingsRepo.myRows = [row({ trainingStatus: "cancelled" })];
    const [item] = await service.listMine(OWNER_ID, CLIENT_ID, "upcoming");
    expect(item.canCancel).toBe(false);
  });

  it("treats a today-dated booked item as cancellable (date >= today)", async () => {
    bookingsRepo.myRows = [row({ date: today })];
    const [item] = await service.listMine(OWNER_ID, CLIENT_ID, "upcoming");
    expect(item.canCancel).toBe(true);
  });

  it("rejects listing another client's bookings with a 403 and reads nothing", async () => {
    bookingsRepo.myRows = [row()];
    await expect(
      service.listMine(OWNER_ID, OTHER_CLIENT_ID, "upcoming")
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a caller with no client record (ForbiddenException)", async () => {
    clientsRepo.client = undefined;
    await expect(service.listMine(STRANGER_ID, CLIENT_ID, "upcoming")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("lets an admin list any client's bookings", async () => {
    bookingsRepo.myRows = [row()];
    const items = await service.listMine(ADMIN_ID, OTHER_CLIENT_ID, "upcoming");
    expect(items).toHaveLength(1);
  });
});

describe("BookingsService.cancelBooking", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let service: BookingsService;

  const BOOKING_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const SIBLING_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const SUB_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const OTHER_TRAINING_ID = "99999999-9999-9999-9999-999999999999";

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      fakeNotifications,
      fakeWaitlist,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  const booking = (over: Partial<Booking> = {}): Booking => ({
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    type: "single",
    groupSubscriptionId: null,
    createdAt: new Date().toISOString(),
    status: "booked",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    ...over
  });

  it("frees exactly one seat and flips a full training back to open", async () => {
    bookingsRepo.bookings = [booking()];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 6, status: "full" };

    const result = await service.cancelBooking(OWNER_ID, BOOKING_ID);

    expect(result.status).toBe("cancelled");
    expect(bookingsRepo.training.bookedCount).toBe(5);
    expect(bookingsRepo.training.status).toBe("open");
  });

  it("cancelling one group date leaves siblings sharing the subscription booked", async () => {
    bookingsRepo.bookings = [
      booking({ id: BOOKING_ID, type: "group", groupSubscriptionId: SUB_ID }),
      booking({
        id: SIBLING_ID,
        type: "group",
        groupSubscriptionId: SUB_ID,
        trainingId: OTHER_TRAINING_ID
      })
    ];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 3, status: "open" };

    await service.cancelBooking(OWNER_ID, BOOKING_ID);

    const sibling = bookingsRepo.bookings.find((b) => b.id === SIBLING_ID);
    expect(sibling?.status).toBe("booked");
    // Still linked to the same subscription — cancelling one date never unlinks the rest.
    expect(sibling?.groupSubscriptionId).toBe(SUB_ID);
    expect(bookingsRepo.training.bookedCount).toBe(2);
    // Exactly one booking of the batch is cancelled; every other sibling stays booked.
    const cancelled = bookingsRepo.bookings.filter((b) => b.status === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].id).toBe(BOOKING_ID);
  });

  // Atomicity: the seat free and the status recompute are one transaction. If
  // persisting the recompute fails, the whole cancel must abort and surface the
  // error — the booking is never left "cancelled" with the count un-updated.
  it("propagates a failure persisting the recompute (seat free + recompute are atomic)", async () => {
    bookingsRepo.bookings = [booking()];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 6, status: "full" };
    bookingsRepo.failUpdateCountOnTrainingId = TRAINING_ID;

    await expect(service.cancelBooking(OWNER_ID, BOOKING_ID)).rejects.toThrow();
    // The recompute never persisted, so the real tx would roll the cancel back too.
    expect(bookingsRepo.training.bookedCount).toBe(6);
    expect(bookingsRepo.training.status).toBe("full");
  });

  it("rejects cancelling another client's booking with a 403, changing no seat count", async () => {
    bookingsRepo.bookings = [booking({ clientId: OTHER_CLIENT_ID })];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 4, status: "open" };

    await expect(service.cancelBooking(OWNER_ID, BOOKING_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(bookingsRepo.bookings[0].status).toBe("booked");
    expect(bookingsRepo.training.bookedCount).toBe(4);
  });

  it("lets an admin cancel any client's booking", async () => {
    bookingsRepo.bookings = [booking({ clientId: OTHER_CLIENT_ID })];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 2, status: "open" };

    const result = await service.cancelBooking(ADMIN_ID, BOOKING_ID);
    expect(result.status).toBe("cancelled");
    expect(bookingsRepo.training.bookedCount).toBe(1);
  });

  it("rejects cancelling a non-booked booking with a 409", async () => {
    bookingsRepo.bookings = [booking({ status: "cancelled" })];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 4, status: "open" };

    await expect(service.cancelBooking(OWNER_ID, BOOKING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(bookingsRepo.training.bookedCount).toBe(4);
  });

  it("404s an unknown booking", async () => {
    bookingsRepo.bookings = [];
    await expect(service.cancelBooking(OWNER_ID, BOOKING_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("floors bookedCount at 0 on an inconsistent count", async () => {
    bookingsRepo.bookings = [booking()];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "open" };

    await service.cancelBooking(OWNER_ID, BOOKING_ID);
    expect(bookingsRepo.training.bookedCount).toBe(0);
    expect(bookingsRepo.training.status).toBe("open");
  });
});

describe("BookingsService.markAttendance (T2.3)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let trainersRepo: FakeTrainersRepository;
  let service: BookingsService;

  const BOOKING_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const TRAINER_TG = 555;
  const OTHER_TG = 556;
  const TRAINER_ID = "66666666-6666-6666-6666-666666666666";
  // Derived from the real current date so the attendance date-window assertions
  // (past markable, future rejected) hold on any day rather than a stale literal.
  const dayOffset = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const yesterday = dayOffset(-1);
  const tomorrow = dayOffset(1);

  const trainer = (over: Partial<Trainer> = {}): Trainer => ({
    id: TRAINER_ID,
    name: "Coach",
    type: "main",
    status: "active",
    telegramId: TRAINER_TG,
    telegramUsername: null,
    language: "ru",
    individualVisible: true,
    ...over
  });

  const booking = (over: Partial<Booking> = {}): Booking => ({
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    type: "single",
    groupSubscriptionId: null,
    createdAt: new Date().toISOString(),
    status: "booked",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    ...over
  });

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [
      trainer(),
      trainer({ id: "77777777-7777-7777-7777-777777777777", telegramId: OTHER_TG })
    ];
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      fakeNotifications,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.trainingMeta[TRAINING_ID] = { trainerId: TRAINER_ID, date: yesterday };
  });

  it("marks a booked participant attended for the owning trainer", async () => {
    bookingsRepo.bookings = [booking()];
    const result = await service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" });
    expect(result.status).toBe("attended");
    expect(bookingsRepo.bookings[0].status).toBe("attended");
  });

  it("marks a booked participant no_show", async () => {
    bookingsRepo.bookings = [booking()];
    const result = await service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "no_show" });
    expect(result.status).toBe("no_show");
  });

  it("does not touch the training's capacity/status", async () => {
    bookingsRepo.bookings = [booking()];
    bookingsRepo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 4, status: "open" };
    await service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" });
    expect(bookingsRepo.training.bookedCount).toBe(4);
    expect(bookingsRepo.training.status).toBe("open");
  });

  it("is idempotent: re-marking the same status is allowed", async () => {
    bookingsRepo.bookings = [booking({ status: "attended" })];
    const result = await service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" });
    expect(result.status).toBe("attended");
  });

  it("forbids another trainer and changes no status (403)", async () => {
    bookingsRepo.bookings = [booking()];
    await expect(
      service.markAttendance(OTHER_TG, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings[0].status).toBe("booked");
  });

  it("forbids a non-trainer (403)", async () => {
    bookingsRepo.bookings = [booking()];
    await expect(
      service.markAttendance(99999, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings[0].status).toBe("booked");
  });

  it("lets an admin mark any booking", async () => {
    bookingsRepo.bookings = [booking()];
    const result = await service.markAttendance(ADMIN_ID, BOOKING_ID, { status: "attended" });
    expect(result.status).toBe("attended");
  });

  it("rejects a future-dated training (400)", async () => {
    bookingsRepo.bookings = [booking()];
    bookingsRepo.trainingMeta[TRAINING_ID] = { trainerId: TRAINER_ID, date: tomorrow };
    await expect(
      service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingsRepo.bookings[0].status).toBe("booked");
  });

  it("rejects a non-markable status e.g. cancelled (409)", async () => {
    bookingsRepo.bookings = [booking({ status: "cancelled" })];
    await expect(
      service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a waitlist booking (409)", async () => {
    bookingsRepo.bookings = [booking({ status: "waitlist" })];
    await expect(
      service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "no_show" })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s an unknown booking", async () => {
    bookingsRepo.bookings = [];
    await expect(
      service.markAttendance(TRAINER_TG, BOOKING_ID, { status: "attended" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("BookingsService.createManual (Feature 5 — admin/trainer manual booking)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let trainersRepo: FakeTrainersRepository;
  let confirmationCalls: string[];
  let notifications: NotificationsService;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    trainersRepo = new FakeTrainersRepository();
    // The training's trainer (TRAINER_ID) maps to TRAINER_ID_TG; a different trainer to OTHER_TRAINER_ID_TG.
    trainersRepo.trainers = [
      {
        id: TRAINER_ID,
        name: "Coach",
        type: "main",
        status: "active",
        telegramId: TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      },
      {
        id: OTHER_TRAINER_DB_ID,
        name: "Other",
        type: "main",
        status: "active",
        telegramId: OTHER_TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      }
    ];
    confirmationCalls = [];
    notifications = {
      sendBookingConfirmation: async (clientId: string): Promise<void> => {
        confirmationCalls.push(clientId);
      },
      sendGroupBookingConfirmation: async (): Promise<void> => undefined
    } as unknown as NotificationsService;
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 2,
      status: "open",
      trainerId: TRAINER_ID
    };
  });

  it("lets an admin book an existing telegram client (source 'admin', count++, send invoked)", async () => {
    const booking = await service.createManual(ADMIN_ID, {
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });
    expect(booking.source).toBe("admin");
    expect(booking.status).toBe("booked");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    expect(confirmationCalls).toEqual([CLIENT_ID]);
  });

  it("lets an admin book a walk-in (source 'walk_in') without attempting a Telegram DM", async () => {
    const booking = await service.createManual(ADMIN_ID, {
      clientId: WALKIN_CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });
    expect(booking.source).toBe("walk_in");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    // Walk-in has no telegram_id → the confirmation send is skipped entirely.
    expect(confirmationCalls).toEqual([]);
  });

  it("commits a walk-in booking even when the notifications service would throw (send skipped, no throw)", async () => {
    // A throwing send must never reach a walk-in: telegramId === null short-circuits
    // the post-commit confirmation, so the booking resolves and the seat is counted.
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      {
        sendBookingConfirmation: async (): Promise<void> => {
          throw new Error("telegram unreachable");
        },
        sendGroupBookingConfirmation: async (): Promise<void> => undefined
      } as unknown as NotificationsService,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );

    const booking = await service.createManual(ADMIN_ID, {
      clientId: WALKIN_CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });

    expect(booking.status).toBe("booked");
    expect(booking.source).toBe("walk_in");
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });

  it("flips the slot to full on the capacity-th manual booking", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 5,
      status: "open",
      trainerId: TRAINER_ID
    };
    await service.createManual(ADMIN_ID, { clientId: WALKIN_CLIENT_ID, trainingId: TRAINING_ID, useBonusCredit: false });
    expect(bookingsRepo.training?.bookedCount).toBe(6);
    expect(bookingsRepo.training?.status).toBe("full");
  });

  it("lets the training's own trainer book onto their training", async () => {
    const booking = await service.createManual(TRAINER_ID_TG, {
      clientId: WALKIN_CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });
    expect(booking.status).toBe("booked");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });

  it("forbids a trainer who does not own the training (403, no seat change)", async () => {
    await expect(
      service.createManual(OTHER_TRAINER_ID_TG, {
        clientId: WALKIN_CLIENT_ID,
        trainingId: TRAINING_ID,
        useBonusCredit: false
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings).toHaveLength(0);
    expect(bookingsRepo.training?.bookedCount).toBe(2);
  });

  it("forbids a non-trainer non-admin (403)", async () => {
    await expect(
      service.createManual(STRANGER_ID, { clientId: WALKIN_CLIENT_ID, trainingId: TRAINING_ID, useBonusCredit: false })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("rejects booking onto a full training (409, no seat change)", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 6,
      status: "full",
      trainerId: TRAINER_ID
    };
    await expect(
      service.createManual(ADMIN_ID, { clientId: WALKIN_CLIENT_ID, trainingId: TRAINING_ID, useBonusCredit: false })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(0);
    expect(bookingsRepo.training?.bookedCount).toBe(6);
  });

  it("rejects a duplicate active booking for the same client + training (409)", async () => {
    await service.createManual(ADMIN_ID, {
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });
    await expect(
      service.createManual(ADMIN_ID, {
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        useBonusCredit: false
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });

  it("404s an unknown client before touching the training", async () => {
    await expect(
      service.createManual(ADMIN_ID, {
        clientId: "00000000-0000-4000-8000-000000000000",
        trainingId: TRAINING_ID,
        useBonusCredit: false
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bookingsRepo.bookings).toHaveLength(0);
  });

  it("404s an unknown training", async () => {
    bookingsRepo.training = undefined;
    await expect(
      service.createManual(ADMIN_ID, { clientId: WALKIN_CLIENT_ID, trainingId: TRAINING_ID, useBonusCredit: false })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("BookingsService.createManual — bonus-credit redemption (Slice 3, admin-only)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let clientsRepo: FakeClientsRepository;
  let trainersRepo: FakeTrainersRepository;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    // Model cross-table rollback: the faked tx restores bonus balances on throw, so
    // a redemption that fails downstream (full-slot 409) leaves the balance untouched.
    bookingsRepo.rollbackClients = clientsRepo;
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [
      {
        id: TRAINER_ID,
        name: "Coach",
        type: "main",
        status: "active",
        telegramId: TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      }
    ];
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      fakeNotifications,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 2,
      status: "open",
      trainerId: TRAINER_ID
    };
  });

  /** Set the resolvable client's starting bonus balance (findById/addBonusCredits share the row). */
  function seedCredits(clientId: string, credits: number): Client {
    const client = clientsRepo.byId.find((c) => c.id === clientId);
    if (!client) {
      throw new Error(`client ${clientId} not seeded`);
    }
    client.bonusTrainingCredits = credits;
    return client;
  }

  it("comps the seat (paid, paidAt/paidBy set) and decrements the balance by 1 when balance > 0", async () => {
    const client = seedCredits(CLIENT_ID, 2);
    const booking = await service.createManual(ADMIN_ID, {
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: true
    });

    expect(booking.paymentStatus).toBe("paid");
    expect(booking.paidAt).not.toBeNull();
    expect(booking.paidBy).toBe(ADMIN_ID);
    // The seat is still booked and the count still advanced — payment never alters seat math.
    expect(booking.status).toBe("booked");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    // Exactly one credit consumed.
    expect(client.bonusTrainingCredits).toBe(1);
  });

  it("rejects redemption with 400 when the client has no credits and writes NOTHING (no seat, no negative balance)", async () => {
    const client = seedCredits(CLIENT_ID, 0);
    await expect(
      service.createManual(ADMIN_ID, {
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        useBonusCredit: true
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    // No booking inserted, no seat consumed, balance untouched (never negative).
    expect(bookingsRepo.bookings).toHaveLength(0);
    expect(bookingsRepo.training?.bookedCount).toBe(2);
    expect(client.bonusTrainingCredits).toBe(0);
  });

  it("leaves the booking unpaid and the balance untouched when useBonusCredit is false", async () => {
    const client = seedCredits(CLIENT_ID, 2);
    const booking = await service.createManual(ADMIN_ID, {
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      useBonusCredit: false
    });

    expect(booking.paymentStatus).toBe("unpaid");
    expect(booking.paidAt).toBeNull();
    expect(booking.paidBy).toBeNull();
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    expect(client.bonusTrainingCredits).toBe(2);
  });

  it("forbids a trainer-of-the-training from redeeming a bonus credit (403, nothing written)", async () => {
    const client = seedCredits(CLIENT_ID, 2);
    // The training's own trainer may book manually, but redemption is admin-only.
    await expect(
      service.createManual(TRAINER_ID_TG, {
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        useBonusCredit: true
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    // No seat consumed, no booking inserted, the bonus balance is untouched.
    expect(bookingsRepo.bookings).toHaveLength(0);
    expect(bookingsRepo.training?.bookedCount).toBe(2);
    expect(client.bonusTrainingCredits).toBe(2);
  });

  it("rolls back the whole tx on a FULL training (409): no seat consumed and the bonus balance is UNCHANGED", async () => {
    const client = seedCredits(CLIENT_ID, 2);
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 6,
      status: "full",
      trainerId: TRAINER_ID
    };

    await expect(
      service.createManual(ADMIN_ID, {
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        useBonusCredit: true
      })
    ).rejects.toBeInstanceOf(ConflictException);

    // The full-slot 409 fires inside bookSeat, AFTER the credit decrement in the same
    // tx — so the real transaction rolls the debit back. The decrement and the booking
    // must commit together or not at all: the balance is unchanged and no seat moved.
    expect(bookingsRepo.bookings).toHaveLength(0);
    expect(bookingsRepo.training?.bookedCount).toBe(6);
    expect(client.bonusTrainingCredits).toBe(2);
  });
});

describe("BookingsService.transferGroup (Item C — admin group transfer)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let waitlist: FakeWaitlistService;
  let service: BookingsService;

  const FROM_GROUP_ID = "44444444-4444-4444-4444-444444444444";
  const TO_GROUP_ID = "55555555-5555-4555-8555-555555555555";
  const SRC_TRAINING_A = "a0000000-0000-4000-8000-000000000001";
  const SRC_TRAINING_B = "a0000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    // A fresh, tracked waitlist double so the source-waitlist cleanup is assertable.
    waitlist = new FakeWaitlistService();
    // The transfer validates both source and target groups; resolve both ids as active.
    const groupsRepo = {
      findById: async (id: string): Promise<Group | undefined> => {
        if (id === FROM_GROUP_ID) return { ...activeGroup, id: FROM_GROUP_ID };
        if (id === TO_GROUP_ID) return { ...activeGroup, id: TO_GROUP_ID };
        return undefined;
      }
    };
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      groupsRepo as unknown as GroupsRepository,
      fakeNotifications,
      waitlist as unknown as WaitlistService,
      new FakeTrainersRepository() as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  const input = {
    clientId: CLIENT_ID,
    fromGroupId: FROM_GROUP_ID,
    toGroupId: TO_GROUP_ID,
    year: FUTURE_YEAR,
    month: FUTURE_MONTH
  };

  const monthTraining = (id: string, date: string, over: Partial<GroupTrainingLockRow> = {}) => ({
    id,
    date,
    capacity: 6,
    bookedCount: 0,
    status: "open" as const,
    ...over
  });

  /** Seed two future source-group bookings for the client + their training rows. */
  const seedSource = () => {
    bookingsRepo.bookings = [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        clientId: CLIENT_ID,
        trainingId: SRC_TRAINING_A,
        type: "group",
        groupSubscriptionId: "c0000000-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        status: "booked",
        source: "telegram",
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      },
      {
        id: "b0000000-0000-4000-8000-000000000002",
        clientId: CLIENT_ID,
        trainingId: SRC_TRAINING_B,
        type: "group",
        groupSubscriptionId: "c0000000-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        status: "booked",
        source: "telegram",
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      }
    ];
    bookingsRepo.bookingTrainingDates = {
      [SRC_TRAINING_A]: "2099-06-01",
      [SRC_TRAINING_B]: "2099-06-03"
    };
    bookingsRepo.bookingGroupIds = {
      [SRC_TRAINING_A]: FROM_GROUP_ID,
      [SRC_TRAINING_B]: FROM_GROUP_ID
    };
    bookingsRepo.sourceTrainings = [
      monthTraining(SRC_TRAINING_A, "2099-06-01", { bookedCount: 4, status: "open" }),
      monthTraining(SRC_TRAINING_B, "2099-06-03", { bookedCount: 6, status: "full" })
    ];
  };

  it("moves a client's future bookings from A to B: cancels source, re-books target, one subscription", async () => {
    seedSource();
    bookingsRepo.monthTrainings = [
      monthTraining("d0000000-0000-4000-8000-000000000001", "2099-06-02"),
      monthTraining("d0000000-0000-4000-8000-000000000002", "2099-06-04")
    ];

    const result = await service.transferGroup(ADMIN_ID, input);

    expect(result.cancelledDates).toEqual(["2099-06-01", "2099-06-03"]);
    expect(result.movedDates).toEqual(["2099-06-02", "2099-06-04"]);
    expect(result.skippedDates).toEqual([]);

    // Source bookings are cancelled and the freed seats recomputed (full → open).
    const cancelled = bookingsRepo.bookings.filter((b) => b.status === "cancelled");
    expect(cancelled).toHaveLength(2);
    expect(bookingsRepo.sourceTrainings[0].bookedCount).toBe(3);
    expect(bookingsRepo.sourceTrainings[1].bookedCount).toBe(5);
    expect(bookingsRepo.sourceTrainings[1].status).toBe("open");

    // Target instances each gained a seat under one fresh subscription.
    const created = bookingsRepo.bookings.filter(
      (b) => b.status === "booked" && b.groupSubscriptionId === result.groupSubscriptionId
    );
    expect(created).toHaveLength(2);
    expect(bookingsRepo.monthTrainings[0].bookedCount).toBe(1);
  });

  it("also cancels the client's source-group waitlist entries for the month (no stranding)", async () => {
    seedSource();
    bookingsRepo.monthTrainings = [
      monthTraining("d0000000-0000-4000-8000-000000000001", "2099-06-02")
    ];

    await service.transferGroup(ADMIN_ID, input);

    // The transfer requested exactly one source-waitlist cleanup, scoped to the
    // SOURCE group and the clamped month window — so a queued source date never
    // strands the moved client on the old group's queue.
    expect(waitlist.cancelledSourceEntries).toHaveLength(1);
    const cleanup = waitlist.cancelledSourceEntries[0];
    expect(cleanup.clientId).toBe(CLIENT_ID);
    expect(cleanup.groupId).toBe(FROM_GROUP_ID);
    expect(cleanup.to).toBe("2099-06-30");
  });

  // All-or-nothing: a target with no bookable trainings throws a 409 inside the tx
  // so the real transaction wrapper rolls back the source cancellations too. The
  // in-memory fake does not roll back, so we assert the throw surfaces (the
  // createGroupBooking atomicity test documents the same fake limitation).
  it("rejects with a 409 when the target group has no bookable trainings (rolls back)", async () => {
    seedSource();
    bookingsRepo.monthTrainings = []; // target month not generated / all full

    await expect(service.transferGroup(ADMIN_ID, input)).rejects.toBeInstanceOf(ConflictException);
  });

  it("forbids a non-admin caller (403) and touches nothing", async () => {
    seedSource();
    bookingsRepo.monthTrainings = [
      monthTraining("d0000000-0000-4000-8000-000000000001", "2099-06-02")
    ];

    await expect(service.transferGroup(OWNER_ID, input)).rejects.toBeInstanceOf(ForbiddenException);

    const cancelled = bookingsRepo.bookings.filter((b) => b.status === "cancelled");
    expect(cancelled).toHaveLength(0);
  });

  // The today-clamp must exclude a past-dated source booking from cancellation:
  // it falls outside the [today, monthLast] window the source read honors, so it
  // stays booked while a future-dated sibling is moved.
  it("does not cancel a past-dated source booking (today-clamp) while moving a future one", async () => {
    const PAST_TRAINING = "a0000000-0000-4000-8000-0000000000ff";
    const FUTURE_TRAINING = SRC_TRAINING_A;
    bookingsRepo.bookings = [
      {
        id: "b0000000-0000-4000-8000-0000000000ff",
        clientId: CLIENT_ID,
        trainingId: PAST_TRAINING,
        type: "group",
        groupSubscriptionId: "c0000000-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        status: "booked",
        source: "telegram",
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      },
      {
        id: "b0000000-0000-4000-8000-000000000001",
        clientId: CLIENT_ID,
        trainingId: FUTURE_TRAINING,
        type: "group",
        groupSubscriptionId: "c0000000-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        status: "booked",
        source: "telegram",
        paymentStatus: "unpaid",
        paidAt: null,
        paidBy: null
      }
    ];
    // Past date precedes the clamped lower bound (the future month's first day).
    bookingsRepo.bookingTrainingDates = {
      [PAST_TRAINING]: "2000-01-03",
      [FUTURE_TRAINING]: "2099-06-01"
    };
    bookingsRepo.bookingGroupIds = {
      [PAST_TRAINING]: FROM_GROUP_ID,
      [FUTURE_TRAINING]: FROM_GROUP_ID
    };
    bookingsRepo.sourceTrainings = [
      monthTraining(FUTURE_TRAINING, "2099-06-01", { bookedCount: 4, status: "open" })
    ];
    bookingsRepo.monthTrainings = [
      monthTraining("d0000000-0000-4000-8000-000000000001", "2099-06-02")
    ];

    const result = await service.transferGroup(ADMIN_ID, input);

    expect(result.cancelledDates).toEqual(["2099-06-01"]);
    expect(result.movedDates).toEqual(["2099-06-02"]);

    // The past-dated booking is untouched (still booked); only the future one cancelled.
    const pastBooking = bookingsRepo.bookings.find((b) => b.trainingId === PAST_TRAINING);
    expect(pastBooking?.status).toBe("booked");
    const futureBooking = bookingsRepo.bookings.find((b) => b.id === "b0000000-0000-4000-8000-000000000001");
    expect(futureBooking?.status).toBe("cancelled");
  });
});

// --- Admin-confirmation feature -----------------------------------------------
//
// A client request starts `pending` (seat held) whenever at least one admin is
// configured, and an admin confirms (→ booked) or declines (→ cancelled, seat
// freed). With NO admin configured nobody can act, so the request auto-confirms
// (→ booked) instead of hanging forever. The pending hold counts toward capacity
// exactly like a booked seat, so recompute / open⇔full / the duplicate guard are
// unchanged by it.

/** A spying notifications double covering every admin-confirm send. */
function makeNotificationsSpy() {
  const calls = {
    confirmation: [] as string[],
    groupConfirmation: [] as string[][],
    pending: [] as string[],
    declined: [] as string[],
    groupDeclined: [] as string[][],
    pendingToAdmins: [] as { adminIds: number[]; bookingTrainingId: string }[],
    groupPendingToAdmins: [] as { adminIds: number[]; trainingIds: string[] }[]
  };
  const service = {
    sendBookingConfirmation: async (clientId: string): Promise<void> => {
      calls.confirmation.push(clientId);
    },
    sendGroupBookingConfirmation: async (_c: string, ids: string[]): Promise<void> => {
      calls.groupConfirmation.push(ids);
    },
    sendBookingPending: async (clientId: string): Promise<void> => {
      calls.pending.push(clientId);
    },
    sendBookingDeclined: async (clientId: string): Promise<void> => {
      calls.declined.push(clientId);
    },
    sendGroupBookingDeclined: async (_c: string, ids: string[]): Promise<void> => {
      calls.groupDeclined.push(ids);
    },
    sendBookingPendingToAdmins: async (
      adminIds: number[],
      _clientId: string,
      bookingTrainingId: string
    ): Promise<void> => {
      calls.pendingToAdmins.push({ adminIds, bookingTrainingId });
    },
    sendGroupPendingToAdmins: async (
      adminIds: number[],
      _clientId: string,
      trainingIds: string[]
    ): Promise<void> => {
      calls.groupPendingToAdmins.push({ adminIds, trainingIds });
    }
  } as unknown as NotificationsService;
  return { service, calls };
}

const TRAINER_WITH_TG: Trainer = {
  id: TRAINER_ID,
  name: "Coach",
  type: "main",
  status: "active",
  telegramId: TRAINER_ID_TG,
  telegramUsername: null,
  language: "ru",
  individualVisible: true
};

describe("BookingsService.createSingle — pending vs auto-confirm (admin-confirmation)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let trainersRepo: FakeTrainersRepository;
  let notifications: ReturnType<typeof makeNotificationsSpy>;
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [TRAINER_WITH_TG];
    notifications = makeNotificationsSpy();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications.service,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 2,
      status: "open",
      trainerId: TRAINER_ID
    };
  });

  const input = { clientId: CLIENT_ID, trainingId: TRAINING_ID };

  it("holds a pending seat and DMs the admins when an admin is configured", async () => {
    const booking = await service.createSingle(OWNER_ID, input);

    expect(booking.status).toBe("pending");
    // A pending hold still counts toward capacity exactly like a booked seat.
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    expect(bookingsRepo.training?.status).toBe("open");
    // Client gets an acknowledgement; the admins get a confirm/decline DM. No confirmation yet.
    expect(notifications.calls.pending).toEqual([CLIENT_ID]);
    expect(notifications.calls.pendingToAdmins).toEqual([
      { adminIds: [ADMIN_ID], bookingTrainingId: TRAINING_ID }
    ]);
    expect(notifications.calls.confirmation).toEqual([]);
  });

  it("flips the slot to full on the capacity-th pending hold (recompute unchanged by pending)", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 5,
      status: "open",
      trainerId: TRAINER_ID
    };
    const booking = await service.createSingle(OWNER_ID, input);
    expect(booking.status).toBe("pending");
    expect(bookingsRepo.training?.bookedCount).toBe(6);
    expect(bookingsRepo.training?.status).toBe("full");
  });

  it("auto-confirms (→ booked) and sends the confirmation when NO admin is configured", async () => {
    const noAdminService = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications.service,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      envNoAdmin
    );

    const booking = await noAdminService.createSingle(OWNER_ID, input);

    expect(booking.status).toBe("booked");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    // No admin to ask → the confirmation goes straight out; no pending/admin DM.
    expect(notifications.calls.confirmation).toEqual([CLIENT_ID]);
    expect(notifications.calls.pending).toEqual([]);
    expect(notifications.calls.pendingToAdmins).toEqual([]);
  });

  it("counts a pending hold in the duplicate guard (re-book rejected with 409)", async () => {
    await service.createSingle(OWNER_ID, input);
    await expect(service.createSingle(OWNER_ID, input)).rejects.toBeInstanceOf(ConflictException);
    expect(bookingsRepo.bookings).toHaveLength(1);
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });
});

describe("BookingsService.confirmBooking (trainer-confirmation)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let trainersRepo: FakeTrainersRepository;
  let notifications: ReturnType<typeof makeNotificationsSpy>;
  let service: BookingsService;

  const BOOKING_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  const pendingBooking = (over: Partial<Booking> = {}): Booking => ({
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    type: "single",
    groupSubscriptionId: null,
    createdAt: new Date().toISOString(),
    status: "pending",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    ...over
  });

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [
      TRAINER_WITH_TG,
      {
        id: OTHER_TRAINER_DB_ID,
        name: "Other",
        type: "main",
        status: "active",
        telegramId: OTHER_TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      }
    ];
    notifications = makeNotificationsSpy();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications.service,
      fakeWaitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID
    };
  });

  it("moves pending → booked WITHOUT changing the count and sends the confirmation DM", async () => {
    bookingsRepo.bookings = [pendingBooking()];

    const result = await service.confirmBooking(TRAINER_ID_TG, BOOKING_ID);

    expect(result.status).toBe("booked");
    // The seat was already counted at create time — confirm is a pure status flip.
    expect(bookingsRepo.training?.bookedCount).toBe(3);
    expect(bookingsRepo.training?.status).toBe("open");
    expect(notifications.calls.confirmation).toEqual([CLIENT_ID]);
  });

  it("lets the owning admin confirm", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    const result = await service.confirmBooking(ADMIN_ID, BOOKING_ID);
    expect(result.status).toBe("booked");
  });

  it("forbids a different trainer (403, no status change)", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    await expect(service.confirmBooking(OTHER_TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(bookingsRepo.bookings[0].status).toBe("pending");
  });

  it("forbids a non-trainer non-admin (403)", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    await expect(service.confirmBooking(STRANGER_ID, BOOKING_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(bookingsRepo.bookings[0].status).toBe("pending");
  });

  it("rejects a double-confirm with a 409 (already booked)", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    await service.confirmBooking(TRAINER_ID_TG, BOOKING_ID);
    await expect(service.confirmBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("rejects confirming a booking the client already withdrew (cancelled) with a 409", async () => {
    bookingsRepo.bookings = [pendingBooking({ status: "cancelled" })];
    await expect(service.confirmBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("404s an unknown booking", async () => {
    bookingsRepo.bookings = [];
    await expect(service.confirmBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe("BookingsService.declineBooking (trainer-confirmation)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let trainersRepo: FakeTrainersRepository;
  let notifications: ReturnType<typeof makeNotificationsSpy>;
  let promotedTrainings: string[];
  let waitlist: WaitlistService;
  let service: BookingsService;

  const BOOKING_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  const pendingBooking = (over: Partial<Booking> = {}): Booking => ({
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    type: "single",
    groupSubscriptionId: null,
    createdAt: new Date().toISOString(),
    status: "pending",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    ...over
  });

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [
      TRAINER_WITH_TG,
      {
        id: OTHER_TRAINER_DB_ID,
        name: "Other",
        type: "main",
        status: "active",
        telegramId: OTHER_TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      }
    ];
    notifications = makeNotificationsSpy();
    promotedTrainings = [];
    waitlist = {
      promoteNext: async (trainingId: string): Promise<void> => {
        promotedTrainings.push(trainingId);
      }
    } as unknown as WaitlistService;
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications.service,
      waitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
  });

  it("moves pending → cancelled, frees one seat, flips full → open, declines and promotes", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 6,
      status: "full",
      trainerId: TRAINER_ID
    };

    const result = await service.declineBooking(TRAINER_ID_TG, BOOKING_ID);

    expect(result.status).toBe("cancelled");
    expect(bookingsRepo.training?.bookedCount).toBe(5);
    expect(bookingsRepo.training?.status).toBe("open");
    expect(notifications.calls.declined).toEqual([CLIENT_ID]);
    // Same post-commit ordering as cancelBooking: the freed seat is promotable.
    expect(promotedTrainings).toEqual([TRAINING_ID]);
  });

  it("lets an admin decline", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID
    };
    const result = await service.declineBooking(ADMIN_ID, BOOKING_ID);
    expect(result.status).toBe("cancelled");
    expect(bookingsRepo.training?.bookedCount).toBe(2);
  });

  it("forbids a different trainer (403, no status/seat change)", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID
    };
    await expect(service.declineBooking(OTHER_TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(bookingsRepo.bookings[0].status).toBe("pending");
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });

  it("rejects declining an already-decided (booked) booking with a 409", async () => {
    bookingsRepo.bookings = [pendingBooking({ status: "booked" })];
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID
    };
    await expect(service.declineBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(bookingsRepo.training?.bookedCount).toBe(3);
  });

  it("rejects a double-decline with a 409", async () => {
    bookingsRepo.bookings = [pendingBooking()];
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID
    };
    await service.declineBooking(TRAINER_ID_TG, BOOKING_ID);
    await expect(service.declineBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("404s an unknown booking", async () => {
    bookingsRepo.bookings = [];
    await expect(service.declineBooking(TRAINER_ID_TG, BOOKING_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe("BookingsService.confirm/declineSubscription (trainer-confirmation, monthly-batch invariant)", () => {
  let bookingsRepo: FakeBookingsRepository;
  let trainersRepo: FakeTrainersRepository;
  let notifications: ReturnType<typeof makeNotificationsSpy>;
  let promotedTrainings: string[];
  let waitlist: WaitlistService;
  let service: BookingsService;

  const SUB_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const OTHER_SUB_ID = "fafafafa-fafa-fafa-fafa-fafafafafafa";
  const T1 = "a1111111-1111-1111-1111-111111111111";
  const T2 = "a2222222-2222-2222-2222-222222222222";
  const T_OTHER = "a3333333-3333-3333-3333-333333333333";

  const groupRow = (id: string, trainingId: string, subId: string): Booking => ({
    id,
    clientId: CLIENT_ID,
    trainingId,
    type: "group",
    groupSubscriptionId: subId,
    createdAt: new Date().toISOString(),
    status: "pending",
    source: "telegram",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null
  });

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    trainersRepo = new FakeTrainersRepository();
    trainersRepo.trainers = [
      TRAINER_WITH_TG,
      {
        id: OTHER_TRAINER_DB_ID,
        name: "Other",
        type: "main",
        status: "active",
        telegramId: OTHER_TRAINER_ID_TG,
        telegramUsername: null,
        language: "ru",
        individualVisible: true
      }
    ];
    notifications = makeNotificationsSpy();
    promotedTrainings = [];
    waitlist = {
      promoteNext: async (trainingId: string): Promise<void> => {
        promotedTrainings.push(trainingId);
      }
    } as unknown as WaitlistService;
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      new FakeClientsRepository() as unknown as ClientsRepository,
      new FakeGroupsRepository() as unknown as GroupsRepository,
      notifications.service,
      waitlist,
      trainersRepo as unknown as TrainersRepository,
      fakeDomainEvents,
      env
    );
    bookingsRepo.trainingsById = {
      [T1]: { id: T1, capacity: 6, bookedCount: 4, status: "open", trainerId: TRAINER_ID },
      [T2]: { id: T2, capacity: 6, bookedCount: 6, status: "full", trainerId: TRAINER_ID },
      [T_OTHER]: { id: T_OTHER, capacity: 6, bookedCount: 2, status: "open", trainerId: TRAINER_ID }
    };
  });

  it("confirms only the subscription's pending rows (sibling on another subscription untouched)", async () => {
    bookingsRepo.bookings = [
      groupRow("b1111111-1111-1111-1111-111111111111", T1, SUB_ID),
      groupRow("b2222222-2222-2222-2222-222222222222", T2, SUB_ID),
      groupRow("b3333333-3333-3333-3333-333333333333", T_OTHER, OTHER_SUB_ID)
    ];

    await service.confirmSubscription(TRAINER_ID_TG, SUB_ID);

    const byId = (id: string) => bookingsRepo.bookings.find((b) => b.id === id);
    expect(byId("b1111111-1111-1111-1111-111111111111")?.status).toBe("booked");
    expect(byId("b2222222-2222-2222-2222-222222222222")?.status).toBe("booked");
    // The other subscription's date is never touched — the monthly-batch invariant.
    expect(byId("b3333333-3333-3333-3333-333333333333")?.status).toBe("pending");
    // Confirm holds counts steady (seats already counted at create time).
    expect(bookingsRepo.trainingsById[T1].bookedCount).toBe(4);
    expect(bookingsRepo.trainingsById[T2].bookedCount).toBe(6);
    // One summary client confirmation for the subscription's two dates.
    expect(notifications.calls.groupConfirmation).toEqual([[T1, T2]]);
  });

  it("declines only the subscription's pending rows, frees their seats and promotes each", async () => {
    bookingsRepo.bookings = [
      groupRow("b1111111-1111-1111-1111-111111111111", T1, SUB_ID),
      groupRow("b2222222-2222-2222-2222-222222222222", T2, SUB_ID),
      groupRow("b3333333-3333-3333-3333-333333333333", T_OTHER, OTHER_SUB_ID)
    ];

    await service.declineSubscription(TRAINER_ID_TG, SUB_ID);

    const byId = (id: string) => bookingsRepo.bookings.find((b) => b.id === id);
    expect(byId("b1111111-1111-1111-1111-111111111111")?.status).toBe("cancelled");
    expect(byId("b2222222-2222-2222-2222-222222222222")?.status).toBe("cancelled");
    expect(byId("b3333333-3333-3333-3333-333333333333")?.status).toBe("pending");
    expect(bookingsRepo.trainingsById[T1].bookedCount).toBe(3);
    // T2 was full → freeing a seat flips it back to open.
    expect(bookingsRepo.trainingsById[T2].bookedCount).toBe(5);
    expect(bookingsRepo.trainingsById[T2].status).toBe("open");
    // The other subscription's training is never recomputed.
    expect(bookingsRepo.trainingsById[T_OTHER].bookedCount).toBe(2);
    expect(notifications.calls.groupDeclined).toEqual([[T1, T2]]);
    expect(promotedTrainings).toEqual([T1, T2]);
  });

  it("rejects an already-decided batch (no pending rows) with a 409, nothing changed", async () => {
    bookingsRepo.bookings = [groupRow("b1111111-1111-1111-1111-111111111111", T1, SUB_ID)];
    bookingsRepo.bookings[0].status = "booked";

    await expect(service.confirmSubscription(TRAINER_ID_TG, SUB_ID)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(notifications.calls.groupConfirmation).toEqual([]);
    expect(bookingsRepo.bookings[0].status).toBe("booked");
  });

  it("404s a subscription with no bookings at all", async () => {
    bookingsRepo.bookings = [];
    await expect(service.confirmSubscription(TRAINER_ID_TG, SUB_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.declineSubscription(TRAINER_ID_TG, SUB_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("forbids a trainer who does not own the batch (403, nothing decided)", async () => {
    bookingsRepo.bookings = [
      groupRow("b1111111-1111-1111-1111-111111111111", T1, SUB_ID),
      groupRow("b2222222-2222-2222-2222-222222222222", T2, SUB_ID)
    ];
    await expect(
      service.confirmSubscription(OTHER_TRAINER_ID_TG, SUB_ID)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      bookingsRepo.bookings.every((b) => b.status === "pending")
    ).toBe(true);
  });

  it("forbids a non-owning trainer BEFORE the no-op short-circuit (403 even with no pending rows)", async () => {
    // The batch is already decided (no pending rows): a non-owning trainer must
    // still get a 403, not a silent no-op — authorization precedes the no-op check.
    bookingsRepo.bookings = [groupRow("b1111111-1111-1111-1111-111111111111", T1, SUB_ID)];
    bookingsRepo.bookings[0].status = "booked";

    await expect(
      service.confirmSubscription(OTHER_TRAINER_ID_TG, SUB_ID)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.declineSubscription(OTHER_TRAINER_ID_TG, SUB_ID)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingsRepo.bookings[0].status).toBe("booked");
  });
});
