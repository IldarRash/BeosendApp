import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { Booking, Client } from "@beosand/types";
import { beforeEach, describe, expect, it } from "vitest";
import { BookingsService } from "./bookings.service";
import type { BookingsRepository, TrainingLockRow } from "./bookings.repository";
import type { ClientsRepository } from "../clients/clients.repository";

const ADMIN_ID = 111;
const OWNER_ID = 222;
const STRANGER_ID = 333;
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const TRAINING_ID = "33333333-3333-3333-3333-333333333333";

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
  bookings: Booking[] = [];
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
  }
}

class FakeClientsRepository {
  client: Client | undefined = { ...ownerClient };
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
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
