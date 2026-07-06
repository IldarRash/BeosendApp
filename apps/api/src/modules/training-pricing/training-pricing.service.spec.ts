import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { ReplaceTrainingPricingTierRow, TrainingPricingTier } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingPriceSnapshotConflictError,
  type BookingPriceSnapshot,
  type TrainingPricingRepository
} from "./training-pricing.repository";
import { TrainingPricingService } from "./training-pricing.service";

const ADMIN_ID = 111;
const STRANGER_ID = 999;
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CLIENT_ID = "22222222-2222-4222-8222-222222222222";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const tierRows: ReplaceTrainingPricingTierRow[] = [
  { label: "1-3 trainings", minTrainings: 1, maxTrainings: 3, pricePerTrainingRsd: 1500, sortOrder: 0 },
  { label: "4-7 trainings", minTrainings: 4, maxTrainings: 7, pricePerTrainingRsd: 1400, sortOrder: 1 },
  { label: "8-11 trainings", minTrainings: 8, maxTrainings: 11, pricePerTrainingRsd: 1300, sortOrder: 2 },
  { label: "12+ trainings", minTrainings: 12, maxTrainings: null, pricePerTrainingRsd: 1200, sortOrder: 3 }
];

function tier(row: ReplaceTrainingPricingTierRow, index: number): TrainingPricingTier {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${index}`,
    ...row,
    status: "active",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}

class FakeTrainingPricingRepository {
  activeTiers: TrainingPricingTier[] = tierRows.map(tier);
  countByKey = new Map<string, number>();
  locks: Array<{ clientId: string; year: number; month: number }> = [];
  countCalls: Array<{
    clientId: string;
    from: string;
    to: string;
    excludeBookingIds: string[];
  }> = [];
  snapshots: BookingPriceSnapshot[] = [];
  existingSnapshots = new Map<string, BookingPriceSnapshot>();
  replacedWith: ReplaceTrainingPricingTierRow[] | null = null;

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work({} as Database);
  }

  async listActive(): Promise<TrainingPricingTier[]> {
    return this.activeTiers;
  }

  async replaceActive(
    _tx: Database,
    tiers: ReplaceTrainingPricingTierRow[]
  ): Promise<TrainingPricingTier[]> {
    this.replacedWith = tiers;
    this.activeTiers = tiers.map(tier);
    return this.activeTiers;
  }

  async lockClientMonth(
    _tx: Database,
    clientId: string,
    year: number,
    month: number
  ): Promise<void> {
    this.locks.push({ clientId, year, month });
  }

  async countClientMonthPricedBookings(
    _tx: Database,
    params: { clientId: string; from: string; to: string; excludeBookingIds: string[] }
  ): Promise<number> {
    this.countCalls.push(params);
    return this.countByKey.get(`${params.clientId}:${params.from}`) ?? 0;
  }

  async setBookingPriceSnapshot(
    _tx: Database,
    snapshot: BookingPriceSnapshot
  ): Promise<BookingPriceSnapshot> {
    if (this.existingSnapshots.has(snapshot.bookingId)) {
      throw new BookingPriceSnapshotConflictError(snapshot.bookingId);
    }
    this.snapshots.push(snapshot);
    return snapshot;
  }
}

let repo: FakeTrainingPricingRepository;
let service: TrainingPricingService;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  repo = new FakeTrainingPricingRepository();
  service = new TrainingPricingService(repo as unknown as TrainingPricingRepository, env);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TrainingPricingService admin access", () => {
  it("rejects a non-admin before reading tiers", async () => {
    let read = false;
    repo.listActive = async () => {
      read = true;
      return [];
    };

    await expect(service.list(STRANGER_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(read).toBe(false);
  });

  it("replaces the active tier table inside the repository transaction", async () => {
    const replacement = [
      { label: "1+", minTrainings: 1, maxTrainings: null, pricePerTrainingRsd: 1600, sortOrder: 0 }
    ];

    const result = await service.replace(ADMIN_ID, { tiers: replacement });

    expect(repo.replacedWith).toEqual(replacement);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: "1+", pricePerTrainingRsd: 1600 });
  });
});

describe("TrainingPricingService.assignSnapshotsForAcceptedBookings", () => {
  it("uses unpaid booked rows in the existing monthly count: 3 existing -> next #4 at 1400", async () => {
    repo.countByKey.set(`${CLIENT_ID}:2026-07-01`, 3);

    const snapshots = await service.assignSnapshotsForAcceptedBookings({} as Database, [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", clientId: CLIENT_ID, date: "2026-07-09" }
    ]);

    const snapshot = snapshots.get("bbbbbbbb-bbbb-4bbb-8bbb-000000000001");
    expect(snapshot).toMatchObject({
      bookingOrdinalInMonth: 4,
      priceSnapshotRsd: 1400,
      pricingTierLabel: "4-7 trainings",
      pricingTierMinTrainings: 4,
      pricingTierMaxTrainings: 7
    });
    expect(repo.countCalls[0]).toMatchObject({
      clientId: CLIENT_ID,
      from: "2026-07-01",
      to: "2026-07-31",
      excludeBookingIds: ["bbbbbbbb-bbbb-4bbb-8bbb-000000000001"]
    });
  });

  it("assigns multi-date accepted bookings sequentially by date: 7 existing -> #8 and #9 at 1300", async () => {
    repo.countByKey.set(`${CLIENT_ID}:2026-07-01`, 7);

    await service.assignSnapshotsForAcceptedBookings({} as Database, [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000020", clientId: CLIENT_ID, date: "2026-07-20" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000010", clientId: CLIENT_ID, date: "2026-07-10" }
    ]);

    expect(repo.snapshots.map((snapshot) => snapshot.bookingId)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-000000000010",
      "bbbbbbbb-bbbb-4bbb-8bbb-000000000020"
    ]);
    expect(repo.snapshots.map((snapshot) => snapshot.bookingOrdinalInMonth)).toEqual([8, 9]);
    expect(repo.snapshots.map((snapshot) => snapshot.priceSnapshotRsd)).toEqual([1300, 1300]);
    expect(repo.locks).toEqual([{ clientId: CLIENT_ID, year: 2026, month: 7 }]);
  });

  it("keeps separate client-month counts when one operation accepts bookings across clients", async () => {
    repo.countByKey.set(`${CLIENT_ID}:2026-07-01`, 11);
    repo.countByKey.set(`${OTHER_CLIENT_ID}:2026-07-01`, 0);

    await service.assignSnapshotsForAcceptedBookings({} as Database, [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000101", clientId: CLIENT_ID, date: "2026-07-11" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000201", clientId: OTHER_CLIENT_ID, date: "2026-07-11" }
    ]);

    expect(repo.snapshots.map((snapshot) => [snapshot.bookingId, snapshot.bookingOrdinalInMonth, snapshot.priceSnapshotRsd])).toEqual([
      ["bbbbbbbb-bbbb-4bbb-8bbb-000000000101", 12, 1200],
      ["bbbbbbbb-bbbb-4bbb-8bbb-000000000201", 1, 1500]
    ]);
  });

  it("rejects accepted bookings when no active tier covers the next ordinal", async () => {
    repo.activeTiers = [tier({ ...tierRows[0], maxTrainings: 3 }, 0)];
    repo.countByKey.set(`${CLIENT_ID}:2026-07-01`, 3);

    await expect(
      service.assignSnapshotsForAcceptedBookings({} as Database, [
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", clientId: CLIENT_ID, date: "2026-07-09" }
      ])
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.snapshots).toHaveLength(0);
  });

  it("maps already-snapshotted booking writes to a conflict without overwriting", async () => {
    const bookingId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000777";
    const existing: BookingPriceSnapshot = {
      bookingId,
      priceSnapshotRsd: 1500,
      priceSnapshotSource: "training_pricing_tier",
      pricingTierId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000000",
      pricingTierLabel: "1-3 trainings",
      pricingTierMinTrainings: 1,
      pricingTierMaxTrainings: 3,
      bookingOrdinalInMonth: 1,
      priceSnapshotAt: new Date("2026-05-01T12:00:00.000Z")
    };
    repo.existingSnapshots.set(bookingId, existing);

    await expect(
      service.assignSnapshotsForAcceptedBookings({} as Database, [
        { id: bookingId, clientId: CLIENT_ID, date: "2026-07-09" }
      ])
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.existingSnapshots.get(bookingId)).toEqual(existing);
    expect(repo.snapshots).toHaveLength(0);
  });
});
