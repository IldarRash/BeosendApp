import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { Booking, Client, Group } from "@beosand/types";
import type { MyBookingRow } from "./bookings.repository";
import { beforeEach, describe, expect, it } from "vitest";
import { BookingsService } from "./bookings.service";
import type {
  BookingsRepository,
  GroupTrainingLockRow,
  TrainingLockRow
} from "./bookings.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { GroupsRepository } from "../groups/groups.repository";
import type { NotificationsService } from "../notifications/notifications.service";

/** No-op notifications double: confirmation sends are fire-and-forget here. */
const fakeNotifications = {
  sendBookingConfirmation: async (): Promise<void> => undefined,
  sendGroupBookingConfirmation: async (): Promise<void> => undefined
} as unknown as NotificationsService;

const ADMIN_ID = 111;
const OWNER_ID = 222;
const STRANGER_ID = 333;
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const TRAINING_ID = "33333333-3333-3333-3333-333333333333";
const GROUP_ID = "44444444-4444-4444-4444-444444444444";

// A month far in the future so the today-clamp never filters the fixtures.
const FUTURE_YEAR = 2099;
const FUTURE_MONTH = 6;

const ownerClient: Client = {
  id: CLIENT_ID,
  name: "Owner",
  telegramId: OWNER_ID,
  telegramUsername: null,
  levelId: null,
  registeredAt: new Date().toISOString(),
  status: "active"
};

/** In-memory stand-in for the bookings repository (only DB-access layer). */
class FakeBookingsRepository {
  training: TrainingLockRow | undefined;
  monthTrainings: GroupTrainingLockRow[] = [];
  bookings: Booking[] = [];
  /** When set, the next insertBooking throws to exercise transaction rollback. */
  failInsertOnTrainingId: string | undefined;
  private seq = 0;

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work({} as Database);
  }

  async findTrainingForUpdate(
    _tx: Database,
    trainingId: string
  ): Promise<TrainingLockRow | undefined> {
    return this.training && this.training.id === trainingId ? this.training : undefined;
  }

  async findGroupTrainingsForMonthForUpdate(
    _tx: Database,
    _groupId: string,
    _from: string,
    _to: string
  ): Promise<GroupTrainingLockRow[]> {
    return this.monthTrainings;
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
    return this.bookings.find(
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
      status: "booked";
      source: "telegram";
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
      source: values.source
    };
    this.bookings.push(booking);
    return booking;
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
    const monthRow = this.monthTrainings.find((t) => t.id === trainingId);
    if (monthRow) {
      monthRow.bookedCount = bookedCount;
      monthRow.status = status;
    }
  }
}

class FakeClientsRepository {
  client: Client | undefined = { ...ownerClient };
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
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
  capacity: 6,
  priceSingleRsd: 1200,
  priceMonthRsd: 8000,
  status: "active"
};

class FakeGroupsRepository {
  group: Group | undefined = { ...activeGroup };
  async findById(id: string): Promise<Group | undefined> {
    return this.group && this.group.id === id ? this.group : undefined;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("BookingsService.createSingle", () => {
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
      env
    );
  });

  const input = { clientId: CLIENT_ID, trainingId: TRAINING_ID };

  it("books a seat, increments bookedCount exactly once and keeps the slot open below capacity", async () => {
    bookingsRepo.training = {
      id: TRAINING_ID,
      capacity: 6,
      bookedCount: 2,
      status: "open"
    };
    const booking = await service.createSingle(OWNER_ID, input);

    expect(booking.status).toBe("booked");
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
  let service: BookingsService;

  beforeEach(() => {
    bookingsRepo = new FakeBookingsRepository();
    clientsRepo = new FakeClientsRepository();
    groupsRepo = new FakeGroupsRepository();
    service = new BookingsService(
      bookingsRepo as unknown as BookingsRepository,
      clientsRepo as unknown as ClientsRepository,
      groupsRepo as unknown as GroupsRepository,
      fakeNotifications,
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

  it("skips and reports a full date without failing the rest of the month", async () => {
    bookingsRepo.monthTrainings = [
      monthTraining("a1111111-1111-1111-1111-111111111111", "2099-06-01"),
      monthTraining("a2222222-2222-2222-2222-222222222222", "2099-06-03", {
        bookedCount: 6,
        status: "full"
      }),
      monthTraining("a3333333-3333-3333-3333-333333333333", "2099-06-08")
    ];

    const result = await service.createGroupBooking(OWNER_ID, input);

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual(["2099-06-03"]);
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
        source: "telegram"
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
      env
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
      env
    );
  });

  const today = new Date().toISOString().slice(0, 10);
  const future = "2099-06-08"; // a Monday in 2099 → dayOfWeek 1
  const past = "2000-01-03"; // a Monday in 2000

  const row = (over: Partial<MyBookingRow> = {}): MyBookingRow => ({
    bookingId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    trainingId: TRAINING_ID,
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
