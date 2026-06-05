import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { Client, WaitlistEntry } from "@beosand/types";
import { describe, expect, it } from "vitest";
import type { ClientsRepository } from "../clients/clients.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import type {
  ExpiredCandidate,
  TrainingLockRow,
  WaitlistLockRow,
  WaitlistRepository
} from "./waitlist.repository";
import { WaitlistService } from "./waitlist.service";

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
  source: "telegram",
  phone: null,
  note: null,
  language: "ru",
  registeredAt: new Date().toISOString(),
  status: "active"
};

interface WaitlistRowState {
  id: string;
  clientId: string;
  trainingId: string;
  position: number;
  status: WaitlistEntry["status"];
  addedAt: Date;
  notifiedAt: Date | null;
}

/** In-memory stand-in for the waitlist repository (only DB-access layer). */
class FakeWaitlistRepository {
  training: TrainingLockRow | undefined;
  entries: WaitlistRowState[] = [];
  bookings: { id: string; clientId: string; trainingId: string; status: string }[] = [];
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

  async insertEntry(
    _tx: Database,
    values: { clientId: string; trainingId: string; position: number; status: "waiting" }
  ): Promise<WaitlistEntry> {
    const row: WaitlistRowState = {
      id: `bbbbbbbb-bbbb-bbbb-bbbb-0000000000${String(++this.seq).padStart(2, "0")}`,
      clientId: values.clientId,
      trainingId: values.trainingId,
      position: values.position,
      status: values.status,
      addedAt: new Date(),
      notifiedAt: null
    };
    this.entries.push(row);
    return this.toEntry(row);
  }

  async findEntryForUpdate(_tx: Database, id: string): Promise<WaitlistLockRow | undefined> {
    const row = this.entries.find((e) => e.id === id);
    return row
      ? {
          id: row.id,
          clientId: row.clientId,
          trainingId: row.trainingId,
          position: row.position,
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
          status: row.status,
          notifiedAt: row.notifiedAt
        }
      : undefined;
  }

  async markNotified(_tx: Database, id: string, notifiedAt: Date): Promise<WaitlistEntry> {
    const row = this.entries.find((e) => e.id === id);
    if (!row) throw new Error(`entry ${id} missing`);
    row.status = "notified";
    row.notifiedAt = notifiedAt;
    return this.toEntry(row);
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
    values: { clientId: string; trainingId: string }
  ): Promise<{
    id: string;
    clientId: string;
    trainingId: string;
    type: "single";
    groupSubscriptionId: null;
    createdAt: Date;
    status: "booked";
    source: string;
  }> {
    const booking = {
      id: `cccccccc-cccc-cccc-cccc-0000000000${String(++this.seq).padStart(2, "0")}`,
      clientId: values.clientId,
      trainingId: values.trainingId,
      type: "single" as const,
      groupSubscriptionId: null,
      createdAt: new Date(),
      status: "booked" as const,
      source: "telegram"
    };
    this.bookings.push({
      id: booking.id,
      clientId: booking.clientId,
      trainingId: booking.trainingId,
      status: "booked"
    });
    return booking;
  }

  async findExpiredNotified(cutoff: Date): Promise<ExpiredCandidate[]> {
    return this.entries
      .filter((e) => e.status === "notified" && e.notifiedAt !== null && e.notifiedAt <= cutoff)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, trainingId: e.trainingId }));
  }

  private toEntry(row: WaitlistRowState): WaitlistEntry {
    return {
      id: row.id,
      clientId: row.clientId,
      trainingId: row.trainingId,
      position: row.position,
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

/** Captures waitlist-slot pushes so promotion order can be asserted. */
class FakeNotifications {
  sent: { clientId: string; trainingId: string }[] = [];
  async sendWaitlistSlot(clientId: string, trainingId: string): Promise<boolean> {
    this.sent.push({ clientId, trainingId });
    return true;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [], WAITLIST_WINDOW_MINUTES: 30 } as unknown as Env;

function makeService(): {
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
    env
  );
  return { service, repo, clients, notifications };
}

const fullTraining: TrainingLockRow = {
  id: TRAINING_ID,
  capacity: 6,
  bookedCount: 6,
  status: "full"
};

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
    expect(entry.notifiedAt).toBeNull();
  });

  it("rejects joining a still-bookable training with a 409", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 3, status: "open" };
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("writes no entry when rejecting a join on a bookable slot (no side effect)", async () => {
    const { service, repo } = makeService();
    // Open with one free seat — the client must book directly, not waitlist.
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    await expect(
      service.join(OWNER_ID, { clientId: CLIENT_ID, trainingId: TRAINING_ID })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.entries).toHaveLength(0);
  });

  it("rejects joining a cancelled or completed training", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 0, status: "cancelled" };
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

describe("WaitlistService.accept", () => {
  function seedNotified(repo: FakeWaitlistRepository, notifiedAt: Date): string {
    const id = "dddddddd-dddd-dddd-dddd-000000000001";
    repo.entries.push({
      id,
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "notified",
      addedAt: new Date(),
      notifiedAt
    });
    return id;
  }

  it("books, increments count, recomputes status and marks the entry promoted", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    const id = seedNotified(repo, new Date());

    const booking = await service.accept(OWNER_ID, id);

    expect(booking.status).toBe("booked");
    expect(booking.clientId).toBe(CLIENT_ID);
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("promoted");
  });

  it("rejects acceptance when no seat is free (seat re-taken)", async () => {
    const { service, repo } = makeService();
    repo.training = { ...fullTraining };
    const id = seedNotified(repo, new Date());
    await expect(service.accept(OWNER_ID, id)).rejects.toBeInstanceOf(ConflictException);
    // Entry stays notified so the sweep can retry/expire it.
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("notified");
  });

  it("rejects and expires an entry past its window", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    const past = new Date(Date.now() - 31 * 60 * 1000);
    const id = seedNotified(repo, past);
    await expect(service.accept(OWNER_ID, id)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.entries.find((e) => e.id === id)?.status).toBe("expired");
  });

  it("rejects acceptance on another client's behalf", async () => {
    const { service, repo, clients } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    clients.client = {
      ...ownerClient,
      id: OTHER_CLIENT_ID,
      telegramId: STRANGER_ID
    };
    const id = seedNotified(repo, new Date());
    await expect(service.accept(STRANGER_ID, id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects acceptance of a non-notified entry", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    repo.entries.push({
      id: "waiting-1",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "waiting",
      addedAt: new Date(),
      notifiedAt: null
    });
    await expect(service.accept(OWNER_ID, "waiting-1")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("WaitlistService.promoteNext", () => {
  it("notifies the lowest-position waiting entry and stamps notifiedAt", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = { ...fullTraining, bookedCount: 5, status: "open" };
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

    const head = repo.entries.find((e) => e.id === "head");
    expect(head?.status).toBe("notified");
    expect(head?.notifiedAt).not.toBeNull();
    expect(repo.entries.find((e) => e.id === "second")?.status).toBe("waiting");
    expect(notifications.sent).toEqual([{ clientId: CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("is a no-op when there is no waiting head", async () => {
    const { service, notifications } = makeService();
    await service.promoteNext(TRAINING_ID);
    expect(notifications.sent).toHaveLength(0);
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
    return { service, repo };
  }

  it("assigns contiguous positions 1,2,3 as three clients join a full slot", async () => {
    const { service, repo } = makeMultiClientService();
    repo.training = { ...fullTraining };

    const first = await service.join(1, { clientId: A, trainingId: TRAINING_ID });
    const second = await service.join(2, { clientId: B, trainingId: TRAINING_ID });
    const third = await service.join(3, { clientId: C, trainingId: TRAINING_ID });

    expect([first.position, second.position, third.position]).toEqual([1, 2, 3]);
  });

  it("promotes the lowest position first, then the next on a second freed seat", async () => {
    const { service, repo } = makeMultiClientService();
    repo.training = { ...fullTraining };
    await service.join(1, { clientId: A, trainingId: TRAINING_ID });
    await service.join(2, { clientId: B, trainingId: TRAINING_ID });

    // First freed seat: head (position 1, client A) is notified.
    await service.promoteNext(TRAINING_ID);
    expect(repo.entries.find((e) => e.clientId === A)?.status).toBe("notified");
    expect(repo.entries.find((e) => e.clientId === B)?.status).toBe("waiting");

    // A is no longer `waiting`, so the next promote targets B (position 2).
    await service.promoteNext(TRAINING_ID);
    expect(repo.entries.find((e) => e.clientId === B)?.status).toBe("notified");
  });

  it("never increments bookedCount beyond capacity when the seat was re-taken", async () => {
    const { service, repo } = makeMultiClientService();
    // Promotion happened while a seat was briefly free, but it filled again: now full.
    repo.training = { ...fullTraining };
    repo.entries.push({
      id: "dddddddd-dddd-dddd-dddd-000000000099",
      clientId: A,
      trainingId: TRAINING_ID,
      position: 1,
      status: "notified",
      addedAt: new Date(),
      notifiedAt: new Date()
    });

    await expect(
      service.accept(1, "dddddddd-dddd-dddd-dddd-000000000099")
    ).rejects.toBeInstanceOf(ConflictException);

    // No oversell: count stays at capacity, no booking row written.
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.bookings).toHaveLength(0);
  });

  it("accept fills exactly one freed seat and flips full→open→full atomically", async () => {
    const { service, repo } = makeMultiClientService();
    // One seat free (5/6, open) after a cancel; head was notified.
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    repo.entries.push({
      id: "dddddddd-dddd-dddd-dddd-000000000100",
      clientId: A,
      trainingId: TRAINING_ID,
      position: 1,
      status: "notified",
      addedAt: new Date(),
      notifiedAt: new Date()
    });

    const booking = await service.accept(1, "dddddddd-dddd-dddd-dddd-000000000100");

    expect(booking.status).toBe("booked");
    expect(repo.bookings).toHaveLength(1);
    expect(repo.training?.bookedCount).toBe(6);
    expect(repo.training?.status).toBe("full");
  });
});

describe("WaitlistService.sweepExpired", () => {
  it("expires a stale notified entry and promotes the next head", async () => {
    const { service, repo, notifications } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    repo.entries.push(
      {
        id: "expired-head",
        clientId: CLIENT_ID,
        trainingId: TRAINING_ID,
        position: 1,
        status: "notified",
        addedAt: new Date(),
        notifiedAt: stale
      },
      {
        id: "next-head",
        clientId: OTHER_CLIENT_ID,
        trainingId: TRAINING_ID,
        position: 2,
        status: "waiting",
        addedAt: new Date(),
        notifiedAt: null
      }
    );

    const count = await service.sweepExpired(new Date());

    expect(count).toBe(1);
    expect(repo.entries.find((e) => e.id === "expired-head")?.status).toBe("expired");
    expect(repo.entries.find((e) => e.id === "next-head")?.status).toBe("notified");
    expect(notifications.sent).toEqual([{ clientId: OTHER_CLIENT_ID, trainingId: TRAINING_ID }]);
  });

  it("leaves a notified entry still within its window untouched", async () => {
    const { service, repo } = makeService();
    repo.training = { id: TRAINING_ID, capacity: 6, bookedCount: 5, status: "open" };
    repo.entries.push({
      id: "fresh",
      clientId: CLIENT_ID,
      trainingId: TRAINING_ID,
      position: 1,
      status: "notified",
      addedAt: new Date(),
      notifiedAt: new Date()
    });
    const count = await service.sweepExpired(new Date());
    expect(count).toBe(0);
    expect(repo.entries.find((e) => e.id === "fresh")?.status).toBe("notified");
  });
});
