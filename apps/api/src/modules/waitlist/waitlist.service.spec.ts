import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import { type Client, type WaitlistEntry, waitlistAdminItemSchema } from "@beosand/types";
import { describe, expect, it } from "vitest";
import type { ClientsRepository } from "../clients/clients.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import type { BookingPriceSnapshot } from "../training-pricing/training-pricing.repository";
import type { TrainingPricingService } from "../training-pricing/training-pricing.service";
import type {
  TrainingLockRow,
  WaitlistAdminRow,
  WaitlistLockRow,
  WaitlistRepository
} from "./waitlist.repository";
import { WaitlistService } from "./waitlist.service";

const ADMIN_ID = 111;
const OWNER_ID = 222;
const STRANGER_ID = 333;
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const TRAINING_ID = "33333333-3333-3333-3333-333333333333";
const GROUP_ID = "55555555-5555-5555-5555-555555555555";

const ownerClient: Client = {
  id: CLIENT_ID,
  name: "Owner",
  telegramId: OWNER_ID,
  telegramUsername: null,
  telegramPhotoUrl: null,
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

interface WaitlistRowState {
  id: string;
  clientId: string;
  trainingId: string;
  position: number;
  /** Optional in the fixtures (most pushes omit it); read as null when absent. */
  groupSubscriptionId?: string | null;
  status: WaitlistEntry["status"];
  addedAt: Date;
  notifiedAt: Date | null;
}

/** In-memory stand-in for the waitlist repository (only DB-access layer). */
class FakeWaitlistRepository {
  training: TrainingLockRow | undefined;
  entries: WaitlistRowState[] = [];
  bookings: {
    id: string;
    clientId: string;
    trainingId: string;
    groupSubscriptionId?: string | null;
    status: string;
  }[] = [];
  private seq = 0;

  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    const before = {
      training: this.training ? { ...this.training } : undefined,
      entries: this.entries.map((entry) => ({ ...entry })),
      bookings: this.bookings.map((booking) => ({ ...booking })),
      seq: this.seq
    };
    try {
      return await work({} as Database);
    } catch (error) {
      this.training = before.training;
      this.entries = before.entries;
      this.bookings = before.bookings;
      this.seq = before.seq;
      throw error;
    }
  }

  async findTrainingForUpdate(
    _tx: Database,
    trainingId: string
  ): Promise<TrainingLockRow | undefined> {
    return this.training && this.training.id === trainingId ? this.training : undefined;
  }

  async findActiveEntryForClient(
    _tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<WaitlistEntry | undefined> {
    const row = this.entries.find(
      (e) =>
        e.clientId === clientId &&
        e.trainingId === trainingId &&
        (e.status === "waiting" || e.status === "notified")
    );
    return row ? this.toEntry(row) : undefined;
  }

  async maxPosition(_tx: Database, trainingId: string): Promise<number> {
    return this.entries
      .filter((e) => e.trainingId === trainingId)
      .reduce((max, e) => Math.max(max, e.position), 0);
  }

  /** Mirror the repo: lowest ACTIVE (waiting|notified) position, 0 when none. */
  async minActivePosition(_tx: Database, trainingId: string): Promise<number> {
    const active = this.entries.filter(
      (e) =>
        e.trainingId === trainingId && (e.status === "waiting" || e.status === "notified")
    );
    return active.length === 0 ? 0 : active.reduce((min, e) => Math.min(min, e.position), Infinity);
  }

  async insertEntry(
    _tx: Database,
    values: {
      clientId: string;
      trainingId: string;
      position: number;
      groupSubscriptionId?: string | null;
      status: "waiting";
    }
  ): Promise<WaitlistEntry> {
    const row: WaitlistRowState = {
      id: `bbbbbbbb-bbbb-bbbb-bbbb-0000000000${String(++this.seq).padStart(2, "0")}`,
      clientId: values.clientId,
      trainingId: values.trainingId,
      position: values.position,
      groupSubscriptionId: values.groupSubscriptionId ?? null,
      status: values.status,
      addedAt: new Date(),
      notifiedAt: null
    };
    this.entries.push(row);
    return this.toEntry(row);
  }

  /** Mirror the repo: append at max+1 with an optional subscription link. */
  async appendEntry(
    tx: Database,
    values: { clientId: string; trainingId: string; groupSubscriptionId: string | null }
  ): Promise<WaitlistEntry> {
    const position = (await this.maxPosition(tx, values.trainingId)) + 1;
    return this.insertEntry(tx, {
      clientId: values.clientId,
      trainingId: values.trainingId,
      position,
      groupSubscriptionId: values.groupSubscriptionId,
      status: "waiting"
    });
  }

  /** Mirror the repo: prepend at min(active)-1 (front of queue) with an optional link. */
  async prependEntry(
    tx: Database,
    values: { clientId: string; trainingId: string; groupSubscriptionId: string | null }
  ): Promise<WaitlistEntry> {
    const position = (await this.minActivePosition(tx, values.trainingId)) - 1;
    return this.insertEntry(tx, {
      clientId: values.clientId,
      trainingId: values.trainingId,
      position,
      groupSubscriptionId: values.groupSubscriptionId,
      status: "waiting"
    });
  }

  async findEntryForUpdate(_tx: Database, id: string): Promise<WaitlistLockRow | undefined> {
    const row = this.entries.find((e) => e.id === id);
    return row
      ? {
          id: row.id,
          clientId: row.clientId,
          trainingId: row.trainingId,
          position: row.position,
          groupSubscriptionId: row.groupSubscriptionId ?? null,
          status: row.status,
          notifiedAt: row.notifiedAt
        }
      : undefined;
  }

  async findHeadWaitingForUpdate(
    _tx: Database,
    trainingId: string
  ): Promise<WaitlistLockRow | undefined> {
    const row = this.entries
      .filter((e) => e.trainingId === trainingId && e.status === "waiting")
      .sort((a, b) => a.position - b.position)[0];
    return row
      ? {
          id: row.id,
          clientId: row.clientId,
          trainingId: row.trainingId,
          position: row.position,
          groupSubscriptionId: row.groupSubscriptionId ?? null,
          status: row.status,
          notifiedAt: row.notifiedAt
        }
      : undefined;
  }

  async setStatus(
    _tx: Database,
    id: string,
    status: WaitlistEntry["status"]
  ): Promise<WaitlistEntry> {
    const row = this.entries.find((e) => e.id === id);
    if (!row) throw new Error(`entry ${id} missing`);
    row.status = status;
    return this.toEntry(row);
  }

  async updateTrainingCount(
    _tx: Database,
    trainingId: string,
    bookedCount: number,
    status: TrainingLockRow["status"]
  ): Promise<void> {
    if (this.training && this.training.id === trainingId) {
      this.training.bookedCount = bookedCount;
      this.training.status = status;
    }
  }

  async hasActiveBooking(
    _tx: Database,
    clientId: string,
    trainingId: string
  ): Promise<boolean> {
    return this.bookings.some(
      (b) => b.clientId === clientId && b.trainingId === trainingId && b.status === "booked"
    );
  }

  async insertBooking(
    _tx: Database,
    values: {
      clientId: string;
      trainingId: string;
      type: "single" | "group";
      groupSubscriptionId: string | null;
      status?: "booked" | "pending";
      source?: string;
    }
  ): Promise<{
    id: string;
    clientId: string;
    trainingId: string;
    type: "single" | "group";
    groupSubscriptionId: string | null;
    createdAt: Date;
    status: "booked" | "pending";
    source: string;
    paymentStatus: "unpaid";
    paidAt: null;
    paidBy: null;
  }> {
    const booking = {
      id: `cccccccc-cccc-cccc-cccc-0000000000${String(++this.seq).padStart(2, "0")}`,
      clientId: values.clientId,
      trainingId: values.trainingId,
      // Honor the group-aware promotion: a subscription entry rebooks as `group`.
      type: values.type,
      groupSubscriptionId: values.groupSubscriptionId,
      createdAt: new Date(),
      // Honor the caller's status/source (the admin promote/swap book `booked`/"admin").
      status: values.status ?? ("booked" as const),
      source: values.source ?? "telegram",
      paymentStatus: "unpaid" as const,
      paidAt: null,
      paidBy: null
    };
    this.bookings.push({
      id: booking.id,
      clientId: booking.clientId,
      trainingId: booking.trainingId,
      groupSubscriptionId: booking.groupSubscriptionId,
      status: booking.status
    });
    return booking;
  }

  /** The booking the admin swap displaces, mirrored from the real FOR UPDATE read. */
  async findBookingForUpdate(
    _tx: Database,
    bookingId: string
  ): Promise<
    | {
        id: string;
        clientId: string;
        trainingId: string;
        groupSubscriptionId: string | null;
        status: string;
      }
    | undefined
  > {
    const booking = this.bookings.find((b) => b.id === bookingId);
    return booking
      ? {
          id: booking.id,
          clientId: booking.clientId,
          trainingId: booking.trainingId,
          groupSubscriptionId: booking.groupSubscriptionId ?? null,
          status: booking.status
        }
      : undefined;
  }

  /** Mark exactly one booking cancelled (matched by id). */
  async markBookingCancelled(_tx: Database, bookingId: string): Promise<void> {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (booking) {
      booking.status = "cancelled";
    }
  }

  /** Joined admin display fields per training, supplied by the list tests. */
  trainingMeta: Record<
    string,
    { date: string; startTime: string; endTime: string; trainingStatus: string; groupName: string | null }
  > = {};
  /** Client names keyed by clientId, supplied by the list tests. */
  clientNames: Record<string, string> = {};

  private toAdminRow(row: WaitlistRowState): WaitlistAdminRow {
    const meta = this.trainingMeta[row.trainingId] ?? {
      date: "2099-06-01",
      startTime: "18:00:00",
      endTime: "19:30:00",
      trainingStatus: "full",
      groupName: null
    };
    return {
      id: row.id,
      clientId: row.clientId,
      trainingId: row.trainingId,
      position: row.position,
      groupSubscriptionId: row.groupSubscriptionId ?? null,
      status: row.status,
      addedAt: row.addedAt,
      notifiedAt: row.notifiedAt,
      clientName: this.clientNames[row.clientId] ?? "Client",
      date: meta.date,
      startTime: meta.startTime,
      endTime: meta.endTime,
      trainingStatus: meta.trainingStatus as WaitlistAdminRow["trainingStatus"],
      groupName: meta.groupName
    };
  }

  async listForTraining(trainingId: string): Promise<WaitlistAdminRow[]> {
    return this.entries
      .filter(
        (e) =>
          e.trainingId === trainingId && (e.status === "waiting" || e.status === "notified")
      )
      .sort((a, b) => a.position - b.position)
      .map((e) => this.toAdminRow(e));
  }

  async listForClient(clientId: string): Promise<WaitlistAdminRow[]> {
    return this.entries
      .filter(
        (e) => e.clientId === clientId && (e.status === "waiting" || e.status === "notified")
      )
      .sort((a, b) => a.position - b.position)
      .map((e) => this.toAdminRow(e));
  }

  /**
   * Distinct trainings with a `waiting` head that are still bookable — the sweep's
   * candidates. The real query also filters group-only + open via the join; here the
   * tests stock only group trainings, so we mirror the bookability check off the
   * single stocked training.
   */
  async findPromotableTrainings(): Promise<string[]> {
    const ids = new Set<string>();
    for (const e of this.entries) {
      if (e.status !== "waiting") continue;
      const training = this.training;
      if (
        training &&
        training.id === e.trainingId &&
        training.groupId !== null &&
        training.status === "open" &&
        training.bookedCount < training.capacity
      ) {
        ids.add(e.trainingId);
      }
    }
    return [...ids];
  }

  private toEntry(row: WaitlistRowState): WaitlistEntry {
    return {
      id: row.id,
      clientId: row.clientId,
      trainingId: row.trainingId,
      position: row.position,
      groupSubscriptionId: row.groupSubscriptionId ?? null,
      status: row.status,
      addedAt: row.addedAt.toISOString(),
      notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null
    };
  }
}

class FakeClientsRepository {
  client: Client | undefined = { ...ownerClient };
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
  }
}

/** Captures promoted/displaced notifications so promotion order can be asserted. */
class FakeNotifications {
  promoted: { clientId: string; trainingId: string }[] = [];
  displaced: { clientId: string; trainingId: string; position: number }[] = [];
  async sendWaitlistPromoted(clientId: string, trainingId: string): Promise<boolean> {
    this.promoted.push({ clientId, trainingId });
    return true;
  }
  async sendWaitlistDisplaced(
    clientId: string,
    trainingId: string,
    position: number
  ): Promise<boolean> {
    this.displaced.push({ clientId, trainingId, position });
    return true;
  }
}

class FakePricingService {
  assigned: Array<{ id: string; clientId: string; date: string }> = [];
  snapshots = new Map<string, BookingPriceSnapshot>();

  async assignSnapshotsForAcceptedBookings(
    _tx: Database,
    bookings: Array<{ id: string; clientId: string; date: string }>
  ): Promise<Map<string, BookingPriceSnapshot>> {
    this.assigned.push(...bookings);
    if (this.snapshots.size === 0) {
      for (const booking of bookings) {
        this.snapshots.set(booking.id, {
          bookingId: booking.id,
          priceSnapshotRsd: 1400,
          priceSnapshotSource: "training_pricing_tier" as const,
          pricingTierId: "77777777-7777-4777-8777-777777777777",
          pricingTierLabel: "4-7 trainings",
          pricingTierMinTrainings: 4,
          pricingTierMaxTrainings: 7,
          bookingOrdinalInMonth: 4,
          priceSnapshotAt: new Date("2026-06-01T12:00:00.000Z")
        });
      }
    }
    return this.snapshots;
  }
}

class IncompletePricingService extends FakePricingService {
  override async assignSnapshotsForAcceptedBookings(
    _tx: Database,
    bookings: Array<{ id: string; clientId: string; date: string }>
  ): Promise<Map<string, BookingPriceSnapshot>> {
    this.assigned.push(...bookings);
    return new Map();
  }
}

const env = { ADMIN_TELEGRAM_IDS: [] } as unknown as Env;
// Admin-enabled env for the admin tools (promote/swap/remove + admin lists). The
// owner stays a plain client under this env (only ADMIN_ID is an admin), so the
// ownership-bypass behaviour of admins is exercised only where intended.
const adminEnv = {
  ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)]
} as unknown as Env;

function makeService(pricing?: TrainingPricingService): {
  service: WaitlistService;
  repo: FakeWaitlistRepository;
  clients: FakeClientsRepository;
  notifications: FakeNotifications;
} {
  const repo = new FakeWaitlistRepository();
  const clients = new FakeClientsRepository();
  const notifications = new FakeNotifications();
  const service = new WaitlistService(
    repo as unknown as WaitlistRepository,
    clients as unknown as ClientsRepository,
    notifications as unknown as NotificationsService,
    env,
    pricing
  );
  return { service, repo, clients, notifications };
}

/** A service wired to the admin-enabled env for the admin-tool describe blocks. */
function makeAdminService(pricing?: TrainingPricingService): {
  service: WaitlistService;
  repo: FakeWaitlistRepository;
  clients: FakeClientsRepository;
  notifications: FakeNotifications;
} {
  const repo = new FakeWaitlistRepository();
  const clients = new FakeClientsRepository();
  const notifications = new FakeNotifications();
  const service = new WaitlistService(
    repo as unknown as WaitlistRepository,
    clients as unknown as ClientsRepository,
    notifications as unknown as NotificationsService,
    adminEnv,
    pricing
  );
  return { service, repo, clients, notifications };
}

/** A full GROUP training (the default subject of the waitlist). */
const fullTraining: TrainingLockRow = {
  id: TRAINING_ID,
  groupId: GROUP_ID,
  capacity: 6,
  bookedCount: 6,
  status: "full"
};

/** A group training with one free seat (open). */
function openGroupTraining(bookedCount = 5): TrainingLockRow {
  return { id: TRAINING_ID, groupId: GROUP_ID, capacity: 6, bookedCount, status: "open" };
}

describe("WaitlistService.join", () => {
  it("appends at contiguous positions for a full training", async () => {
    const { service, repo } = makeService();
    repo.training = { ...fullTraining };
    // An earlier client already holds position 1.
    repo.entries.push({
      id: "existing-head",
      clientId: "99999999-9999-9999-9999-999999999999",
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    const entry = await service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID });

    expect(entry.position).toBe(2);
    expect(entry.status).toBe("waiting");
  });

  it("rejects joining an individual (group-less) training with a 400", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, groupId: null, capacity: 1, bookedCount: 1, status: "full" };
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.entries).toHaveLength(0);
  });

  it("rejects joining a still-bookable training with a 409", async () => {
    const { service, repo } = makeService();
    repo.training = openGroupTraining(3);
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("writes no entry when rejecting a join on a bookable slot (no side effect)", async () => {
    const { service, repo } = makeService();
    // Open with one free seat — the client must book directly, not waitlist.
    repo.training = openGroupTraining(5);
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.entries).toHaveLength(0);
  });

  it("rejects joining a cancelled or completed training", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, groupId: GROUP_ID, capacity: 6, bookedCount: 0, status: "cancelled" };
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.entries).toHaveLength(0);
  });

  it("rejects a duplicate active entry", async () => {
    const { service, repo } = makeService();
    repo.training = { ...fullTraining };
    await service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID });
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects joining on another client's behalf", async () => {
    const { service, repo } = makeService();
    repo.training = { ...fullTraining };
    await expect(
      service.join(OWNER_ID, { clientId: OTHER_CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets a raw admin join on behalf of another client", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };

    const entry = await service.join(ADMIN_ID, {
      clientId: OTHER_CLIENT_ID,
      trainingId: TRAINING_ID
    });

    expect(entry.clientId).toBe(OTHER_CLIENT_ID);
    expect(repo.entries).toHaveLength(1);
  });

  it("rejects a client-scoped admin joining on behalf of another client", async () => {
    const { service, repo, clients } = makeAdminService();
    clients.client = { ...ownerClient, telegramId: ADMIN_ID };
    repo.training = { ...fullTraining };

    await expect(
      service.join(
        ADMIN_ID,
        { clientId: OTHER_CLIENT_ID, trainingId: TRAINING_ID },
        { allowAdmin: false }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.entries).toHaveLength(0);
  });

  it("lets a client-scoped admin join for their own client record", async () => {
    const { service, repo, clients } = makeAdminService();
    clients.client = { ...ownerClient, telegramId: ADMIN_ID };
    repo.training = { ...fullTraining };

    const entry = await service.join(
      ADMIN_ID,
      { clientId: CLIENT_ID, trainingId: TRAINING_ID },
      { allowAdmin: false }
    );

    expect(entry.clientId).toBe(CLIENT_ID);
    expect(repo.entries).toHaveLength(1);
  });

  it("rejects a caller with no client record", async () => {
    const { service, repo, clients } = makeService();
    repo.training = { ...fullTraining };
    clients.client = undefined;
    await expect(
      service.join(STRANGER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("404s an unknown training", async () => {
    const { service } = makeService();
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("WaitlistService.promoteNext (auto-book + notify)", () => {
  it("auto-books the lowest-position waiting entry, recomputes, and notifies it", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = openGroupTraining(5);
    repo.entries.push(
      {
        id: "head",
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        position: 1,
        status: "waiting",
        addedAt: new Date(),
        notifiedAt: null
      },
      {
        id: "second",
        clientId: OTHER_CLIENT_ID,
        trainingId: TRAINING_ID,
        position: 2,
        status: "waiting",
        addedAt: new Date(),
        notifiedAt: null
      }
    );

    await service.promoteNext(TRAINING_ID);

    // Head is booked (promoted), the seat is filled, status flips to full.
    expect(repo.entries.find((e) => e.id === "head")?.status).toBe("promoted");
    expect(repo.entries.find((e) => e.id === "second")?.status).toBe("waiting");
    expect(repo.bookings).toHaveLength(1);
    expect(repo.bookings[0].clientId).toBe(CLIENT_ID);
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
    expect(notifications.promoted).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("auto-promotes a subscription-origin entry with a required pricing snapshot", async () => {
    const pricing = new FakePricingService();
    const { service, repo, notifications } = makeService(
      pricing as unknown as TrainingPricingService
    );
    repo.training = { ...openGroupTraining(5), date: "2026-06-10" };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      groupSubscriptionId: SUB_ID,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(repo.bookings).toHaveLength(1);
    expect(repo.bookings[0]).toMatchObject({
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      groupSubscriptionId: SUB_ID,
      status: "booked"
    });
    expect(pricing.assigned).toEqual([
      { id: repo.bookings[0].id, clientId: CLIENT_ID, date: "2026-06-10" }
    ]);
    expect(repo.entries.find((entry) => entry.id === "head")?.status).toBe("promoted");
    expect(repo.training).toMatchObject({ bookedCount: 6, status: "full" });
    expect(notifications.promoted).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("rolls back subscription-origin auto-promotion when pricing is not configured", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = { ...openGroupTraining(5), date: "2026-06-10" };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      groupSubscriptionId: SUB_ID,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(repo.bookings).toHaveLength(0);
    expect(repo.entries.find((entry) => entry.id === "head")?.status).toBe("waiting");
    expect(repo.training).toMatchObject({ bookedCount: 5, status: "open" });
    expect(notifications.promoted).toHaveLength(0);
  });

  it("rolls back subscription-origin auto-promotion when pricing returns no snapshot", async () => {
    const pricing = new IncompletePricingService();
    const { service, repo, notifications } = makeService(
      pricing as unknown as TrainingPricingService
    );
    repo.training = { ...openGroupTraining(5), date: "2026-06-10" };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      groupSubscriptionId: SUB_ID,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(pricing.assigned).toEqual([
      { id: "cccccccc-cccc-cccc-cccc-000000000001", clientId: CLIENT_ID, date: "2026-06-10" }
    ]);
    expect(repo.bookings).toHaveLength(0);
    expect(repo.entries.find((entry) => entry.id === "head")?.status).toBe("waiting");
    expect(repo.training).toMatchObject({ bookedCount: 5, status: "open" });
    expect(notifications.promoted).toHaveLength(0);
  });

  it("is a no-op when there is no waiting head", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = openGroupTraining(5);
    await service.promoteNext(TRAINING_ID);
    expect(notifications.promoted).toHaveLength(0);
    expect(repo.bookings).toHaveLength(0);
  });

  it("is a no-op (swallowed) for an individual (group-less) training", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = { id: TRAINING_ID, groupId: null, capacity: 6, bookedCount: 5, status: "open" };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(repo.bookings).toHaveLength(0);
    expect(notifications.promoted).toHaveLength(0);
    expect(repo.entries.find((e) => e.id === "head")?.status).toBe("waiting");
  });

  it("is a no-op when the freed seat was already re-taken (no oversell)", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = { ...fullTraining };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(repo.bookings).toHaveLength(0);
    expect(repo.training?.bookedCount).toBe(6);
    expect(notifications.promoted).toHaveLength(0);
  });
});

describe("WaitlistService.sweepPromotable", () => {
  it("auto-promotes a group training that is bookable and has a waiting head", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = openGroupTraining(5);
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    const count = await service.sweepPromotable();

    expect(count).toBe(1);
    expect(repo.entries.find((e) => e.id === "head")?.status).toBe("promoted");
    expect(repo.bookings).toHaveLength(1);
    expect(notifications.promoted).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("returns 0 when nothing is promotable", async () => {
    const { service, repo } = makeService();
    repo.training = { ...fullTraining };
    repo.entries.push({
      id: "head",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });
    expect(await service.sweepPromotable()).toBe(0);
  });
});

describe("WaitlistService invariant: ordered, contiguous, never oversells", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  /** Each join re-resolves ownership; map every clientId to its own caller. */
  function makeMultiClientService(): {
    service: WaitlistService;
    repo: FakeWaitlistRepository;
    notifications: FakeNotifications;
  } {
    const repo = new FakeWaitlistRepository();
    const clients = {
      // Treat the caller's telegram_id as numerically equal to a clientId hash;
      // here every client owns itself, so accept the supplied clientId as-is.
      async findByTelegramId(telegramId: number): Promise<Client | undefined> {
        const byId: Record<number, string> = { 1: A, 2: B, 3: C };
        const id = byId[telegramId];
        return id ? { ...ownerClient, id, telegramId } : undefined;
      }
    };
    const notifications = new FakeNotifications();
    const service = new WaitlistService(
      repo as unknown as WaitlistRepository,
      clients as unknown as ClientsRepository,
      notifications as unknown as NotificationsService,
      env
    );
    return { service, repo, notifications };
  }

  it("assigns contiguous positions 1,2,3 as three clients join a full slot", async () => {
    const { service, repo } = makeMultiClientService();
    repo.training = { ...fullTraining };

    const first = await service.join(1, { clientId: A, trainingId: TRAINING_ID });
    const second = await service.join(2, { clientId: B, trainingId: TRAINING_ID });
    const third = await service.join(3, { clientId: C, trainingId: TRAINING_ID });

    expect([first.position, second.position, third.position]).toEqual([1, 2, 3]);
  });

  it("auto-books the lowest position first, then the next on a second freed seat", async () => {
    const { service, repo } = makeMultiClientService();
    repo.training = { ...fullTraining };
    await service.join(1, { clientId: A, trainingId: TRAINING_ID });
    await service.join(2, { clientId: B, trainingId: TRAINING_ID });

    // First freed seat: head (position 1, client A) is auto-booked.
    repo.training = openGroupTraining(5);
    await service.promoteNext(TRAINING_ID);
    expect(repo.entries.find((e) => e.clientId === A)?.status).toBe("promoted");
    expect(repo.entries.find((e) => e.clientId === B)?.status).toBe("waiting");
    expect(repo.training?.status).toBe("full");

    // A second seat frees: the next waiting head (B) is auto-booked.
    repo.training = openGroupTraining(5);
    await service.promoteNext(TRAINING_ID);
    expect(repo.entries.find((e) => e.clientId === B)?.status).toBe("promoted");
  });

  it("never increments bookedCount beyond capacity when the seat was re-taken", async () => {
    const { service, repo, notifications } = makeMultiClientService();
    // The seat filled again before promotion could run: now full.
    repo.training = { ...fullTraining };
    repo.entries.push({
      id: "dddddddd-dddd-dddd-dddd-000000000099",
      clientId: A,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    // No oversell: count stays at capacity, no booking row, nothing notified.
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.bookings).toHaveLength(0);
    expect(notifications.promoted).toHaveLength(0);
  });

  it("auto-promote fills exactly one freed seat and flips open→full atomically", async () => {
    const { service, repo } = makeMultiClientService();
    // One seat free (5/6, open) after a cancel.
    repo.training = openGroupTraining(5);
    repo.entries.push({
      id: "dddddddd-dddd-dddd-dddd-000000000100",
      clientId: A,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    await service.promoteNext(TRAINING_ID);

    expect(repo.bookings).toHaveLength(1);
    expect(repo.bookings[0].status).toBe("booked");
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
  });
});

// --- Admin waitlist tools (promote / swap / remove + admin lists) -----------------

const ENTRY_ID = "dddddddd-dddd-dddd-dddd-00000000aaaa";
const SUB_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const DISPLACED_BOOKING_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Seed one active waitlist entry on TRAINING_ID for the admin-tool tests. */
function seedEntry(
  repo: FakeWaitlistRepository,
  over: Partial<WaitlistRowState> = {}
): string {
  const row: WaitlistRowState = {
    id: ENTRY_ID,
    clientId: CLIENT_ID,
    trainingId: TRAINING_ID,
    position: 1,
    groupSubscriptionId: null,
    status: "waiting",
    addedAt: new Date(),
    notifiedAt: null,
    ...over
  };
  repo.entries.push(row);
  return row.id;
}

describe("WaitlistService.promoteEntry (admin)", () => {
  it("books into a free seat, recomputes, marks promoted, and notifies the client", async () => {
    const { service, repo, notifications } = makeAdminService();
    repo.training = openGroupTraining(5);
    const id = seedEntry(repo);

    const booking = await service.promoteEntry(ADMIN_ID, id);

    expect(booking.status).toBe("booked");
    expect(booking.clientId).toBe(CLIENT_ID);
    // An admin promote is sourced "admin".
    expect(booking.source).toBe("admin");
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("promoted");
    expect(notifications.promoted).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("rebooks a subscription-origin entry as a group booking carrying its id", async () => {
    const pricing = new FakePricingService();
    const { service, repo } = makeAdminService(pricing as unknown as TrainingPricingService);
    repo.training = { ...openGroupTraining(5), date: "2026-06-10" };
    const id = seedEntry(repo, { groupSubscriptionId: SUB_ID });

    const booking = await service.promoteEntry(ADMIN_ID, id);

    expect(booking.type).toBe("group");
    expect(booking.groupSubscriptionId).toBe(SUB_ID);
  });

  it("rejects with a 409 (no free seat — use swap) when the training is full", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };
    const id = seedEntry(repo);

    await expect(service.promoteEntry(ADMIN_ID, id)).rejects.toBeInstanceOf(ConflictException);
    // No oversell: count untouched, no booking written, entry stays waiting.
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.bookings).toHaveLength(0);
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("waiting");
  });

  it("charges a subscription waitlist booking when it is promoted to booked", async () => {
    const pricing = new FakePricingService();
    const { service, repo } = makeAdminService(pricing as unknown as TrainingPricingService);
    repo.training = { ...openGroupTraining(5), date: "2026-06-10" };
    const id = seedEntry(repo, { groupSubscriptionId: SUB_ID });

    const booking = await service.promoteEntry(ADMIN_ID, id);

    expect(pricing.assigned).toEqual([
      { id: booking.id, clientId: CLIENT_ID, date: "2026-06-10" }
    ]);
    expect(booking).toMatchObject({
      status: "booked",
      priceSnapshotRsd: 1400,
      pricingTierLabel: "4-7 trainings",
      bookingOrdinalInMonth: 4
    });
  });

  it("forbids a non-admin caller (403)", async () => {
    const { service, repo } = makeAdminService();
    repo.training = openGroupTraining(5);
    const id = seedEntry(repo);

    await expect(service.promoteEntry(OWNER_ID, id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.bookings).toHaveLength(0);
  });
});

describe("WaitlistService.swapEntry (admin)", () => {
  /** Seed a full training, the entry to promote, and the displaced booking on it. */
  function seedSwap(
    repo: FakeWaitlistRepository,
    over: { entrySub?: string | null; displacedSub?: string | null } = {}
  ): void {
    repo.training = { ...fullTraining };
    seedEntry(repo, { groupSubscriptionId: over.entrySub ?? null });
    repo.bookings.push({
      id: DISPLACED_BOOKING_ID,
      clientId: OTHER_CLIENT_ID,
      trainingId: TRAINING_ID,
      groupSubscriptionId: over.displacedSub ?? null,
      status: "booked"
    });
  }

  it("cancels the displaced booking, books the entry, and never changes the seat count", async () => {
    const { service, repo, notifications } = makeAdminService();
    seedSwap(repo);

    const { promoted, displaced } = await service.swapEntry(
      ADMIN_ID,
      ENTRY_ID,
      DISPLACED_BOOKING_ID
    );

    // Displaced booking is cancelled; promoted client gets a booked booking.
    expect(repo.bookings.find((b) => b.id === DISPLACED_BOOKING_ID)?.status).toBe("cancelled");
    expect(promoted.status).toBe("booked");
    expect(promoted.clientId).toBe(CLIENT_ID);
    // Count UNCHANGED (one out, one in) — never oversells; status preserved (full).
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
    // The promoted entry is now a booking.
    expect(repo.entries.find((e) => e.id === ENTRY_ID)?.status).toBe("promoted");
    // The displaced client is re-queued at the FRONT (position below the existing head).
    expect(displaced.clientId).toBe(OTHER_CLIENT_ID);
    expect(displaced.status).toBe("waiting");
    expect(displaced.position).toBeLessThan(1);
    // Both clients are notified: promoted (booked) and displaced (back on waitlist).
    expect(notifications.promoted).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
    expect(notifications.displaced).toEqual([
      { clientId: OTHER_CLIENT_ID, trainingId: TRAINING_ID, position: displaced.position }
    ]);
  });

  it("re-queues the displaced client at the lowest position (ahead of every active entry)", async () => {
    const { service, repo } = makeAdminService();
    seedSwap(repo);
    // Another active entry already sits at position 1 alongside the promoted one.
    repo.entries.push({
      id: "other-waiting",
      clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });

    const { displaced } = await service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID);

    // Front-insert = min(active position) - 1 = 0, strictly ahead of the others.
    expect(displaced.position).toBe(0);
    const others = repo.entries.filter(
      (e) => e.status === "waiting" && e.id !== displaced.id
    );
    for (const entry of others) {
      expect(displaced.position).toBeLessThan(entry.position);
    }
  });

  it("books the promoted client group when the entry has a subscription id, single otherwise", async () => {
    const pricing = new FakePricingService();
    const grp = makeAdminService(pricing as unknown as TrainingPricingService);
    seedSwap(grp.repo, { entrySub: SUB_ID });
    grp.repo.training = { ...fullTraining, date: "2026-06-10" };
    const groupResult = await grp.service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID);
    expect(groupResult.promoted.type).toBe("group");
    expect(groupResult.promoted.groupSubscriptionId).toBe(SUB_ID);

    const single = makeAdminService();
    seedSwap(single.repo, { entrySub: null });
    const singleResult = await single.service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID);
    expect(singleResult.promoted.type).toBe("single");
    expect(singleResult.promoted.groupSubscriptionId).toBeNull();
  });

  it("re-queues the displaced client carrying their booking's subscription id", async () => {
    const { service, repo } = makeAdminService();
    seedSwap(repo, { displacedSub: SUB_ID });

    const { displaced } = await service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID);

    // So a later promote rebooks the displaced client as a group booking.
    expect(displaced.groupSubscriptionId).toBe(SUB_ID);
  });

  it("forbids a non-admin caller (403) and touches nothing", async () => {
    const { service, repo } = makeAdminService();
    seedSwap(repo);

    await expect(
      service.swapEntry(OWNER_ID, ENTRY_ID, DISPLACED_BOOKING_ID)
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repo.bookings.find((b) => b.id === DISPLACED_BOOKING_ID)?.status).toBe("booked");
    expect(repo.entries.find((e) => e.id === ENTRY_ID)?.status).toBe("waiting");
  });

  it("rejects (400) when the displaced booking is on a different training", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };
    seedEntry(repo);
    repo.bookings.push({
      id: DISPLACED_BOOKING_ID,
      clientId: OTHER_CLIENT_ID,
      // A booking on a DIFFERENT training — swapping it would oversell this one.
      trainingId: "99999999-9999-4999-8999-999999999999",
      groupSubscriptionId: null,
      status: "booked"
    });

    await expect(
      service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID)
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing written: no booking inserted, the displaced one still booked.
    expect(repo.bookings.find((b) => b.id === DISPLACED_BOOKING_ID)?.status).toBe("booked");
    expect(repo.bookings).toHaveLength(1);
  });

  it("rejects (409) when the displaced booking is not active", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };
    seedEntry(repo);
    repo.bookings.push({
      id: DISPLACED_BOOKING_ID,
      clientId: OTHER_CLIENT_ID,
      trainingId: TRAINING_ID,
      groupSubscriptionId: null,
      status: "cancelled"
    });

    await expect(
      service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID)
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects (409) and writes no second booking when the promoted client already holds an active booking", async () => {
    const { service, repo } = makeAdminService();
    seedSwap(repo);
    // The promoted entry's client (CLIENT_ID) already holds an active booking on the
    // training (e.g. booked directly meanwhile). Swapping would hand them a SECOND
    // seat — there is no DB unique constraint, so the service guard must reject it.
    repo.bookings.push({
      id: "ababab00-0000-4000-8000-000000000001",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      groupSubscriptionId: null,
      status: "booked"
    });
    const bookingsBefore = repo.bookings.length;

    await expect(
      service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID)
    ).rejects.toBeInstanceOf(ConflictException);

    // No second booking for the promoted client; the whole tx rolls back so the
    // displaced booking is NOT cancelled and the entry stays waiting (the in-memory
    // fake doesn't roll back the cancel, but no new booking row is the key assertion).
    expect(repo.bookings).toHaveLength(bookingsBefore);
    expect(
      repo.bookings.filter((b) => b.clientId === CLIENT_ID && b.status === "booked")
    ).toHaveLength(1);
  });

  it("rejects (400) a self-swap (the displaced booking belongs to the promoted entry's own client)", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };
    seedEntry(repo); // entry for CLIENT_ID
    repo.bookings.push({
      id: DISPLACED_BOOKING_ID,
      // Same client as the entry — cancel-then-rebook the same client is a no-op.
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      groupSubscriptionId: null,
      status: "booked"
    });

    await expect(
      service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID)
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing written: the displaced booking is still booked, no new booking row,
    // and the entry is untouched.
    expect(repo.bookings.find((b) => b.id === DISPLACED_BOOKING_ID)?.status).toBe("booked");
    expect(repo.bookings).toHaveLength(1);
    expect(repo.entries.find((e) => e.id === ENTRY_ID)?.status).toBe("waiting");
  });

  it("re-queues the displaced client into their EXISTING active entry rather than double-queuing", async () => {
    const { service, repo } = makeAdminService();
    seedSwap(repo);
    // The displaced client (OTHER_CLIENT_ID) already sits on this training's queue.
    const existingDisplacedEntryId = "cdcdcdcd-0000-4000-8000-000000000001";
    repo.entries.push({
      id: existingDisplacedEntryId,
      clientId: OTHER_CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 5,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });
    const entriesForOtherBefore = repo.entries.filter(
      (e) => e.clientId === OTHER_CLIENT_ID
    ).length;

    const { displaced } = await service.swapEntry(ADMIN_ID, ENTRY_ID, DISPLACED_BOOKING_ID);

    // The existing entry is reused (same id/position), not a new front entry.
    expect(displaced.id).toBe(existingDisplacedEntryId);
    expect(displaced.position).toBe(5);
    // No second entry was created for the displaced client.
    expect(repo.entries.filter((e) => e.clientId === OTHER_CLIENT_ID)).toHaveLength(
      entriesForOtherBefore
    );
  });
});

describe("WaitlistService.removeEntry (admin)", () => {
  it("cancels a waiting entry and does not promote (it held no seat)", async () => {
    const { service, repo, notifications } = makeAdminService();
    repo.training = { ...fullTraining };
    const id = seedEntry(repo, { status: "waiting" });

    const removed = await service.removeEntry(ADMIN_ID, id);

    expect(removed.status).toBe("cancelled");
    expect(notifications.promoted).toHaveLength(0);
  });

  it("forbids a non-admin caller (403)", async () => {
    const { service, repo } = makeAdminService();
    repo.training = { ...fullTraining };
    const id = seedEntry(repo);

    await expect(service.removeEntry(OWNER_ID, id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("waiting");
  });
});

describe("WaitlistService admin/queue lists", () => {
  it("listForTraining returns admin items that validate against the contract, ordered by position", async () => {
    const { service, repo } = makeAdminService();
    repo.clientNames = { [CLIENT_ID]: "Owner", [OTHER_CLIENT_ID]: "Other" };
    repo.trainingMeta = {
      [TRAINING_ID]: {
        date: "2099-06-01",
        startTime: "18:00:00",
        endTime: "19:30:00",
        trainingStatus: "full",
        groupName: "Mon/Wed"
      }
    };
    seedEntry(repo, {
      id: "11111111-1111-4111-8111-000000000002",
      clientId: OTHER_CLIENT_ID,
      position: 2
    });
    seedEntry(repo, {
      id: "11111111-1111-4111-8111-000000000001",
      clientId: CLIENT_ID,
      position: 1
    });

    const items = await service.listForTraining(ADMIN_ID, TRAINING_ID);

    // Each row is a valid WaitlistAdminItem with trimmed HH:MM times.
    for (const item of items) {
      expect(() => waitlistAdminItemSchema.parse(item)).not.toThrow();
    }
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0].startTime).toBe("18:00");
    expect(items[0].groupName).toBe("Mon/Wed");
  });

  it("listForTraining rejects a non-admin caller", async () => {
    const { service, repo } = makeAdminService();
    seedEntry(repo);
    await expect(service.listForTraining(OWNER_ID, TRAINING_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("listMine returns only the caller's own entries, resolved from the session identity", async () => {
    // Admin-less env: the owner reads their own queue, resolved from their telegram id.
    // No clientId is passed — a stranger entry on the SAME training must not leak.
    const { service, repo } = makeService();
    repo.clientNames = { [CLIENT_ID]: "Owner", [OTHER_CLIENT_ID]: "Other" };
    seedEntry(repo, {
      id: "33333333-3333-4333-8333-000000000001",
      clientId: CLIENT_ID,
      position: 1
    });
    seedEntry(repo, {
      id: "33333333-3333-4333-8333-000000000002",
      clientId: OTHER_CLIENT_ID,
      position: 2
    });

    const items = await service.listMine(OWNER_ID);

    expect(items).toHaveLength(1);
    expect(items[0].clientId).toBe(CLIENT_ID);
    expect(() => waitlistAdminItemSchema.parse(items[0])).not.toThrow();
  });

  it("listMine cannot read another client's queue (a caller only ever sees their own)", async () => {
    // The other client's entries exist, but the OWNER session resolves to CLIENT_ID,
    // so listMine returns nothing belonging to OTHER_CLIENT_ID.
    const { service, repo } = makeService();
    seedEntry(repo, { clientId: OTHER_CLIENT_ID });

    const items = await service.listMine(OWNER_ID);

    expect(items).toHaveLength(0);
  });

  it("listMine returns an empty list for a caller with no client record", async () => {
    const { service, repo, clients } = makeService();
    seedEntry(repo, { clientId: OTHER_CLIENT_ID });
    clients.client = undefined;

    await expect(service.listMine(STRANGER_ID)).resolves.toEqual([]);
  });
});
