import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  ReplaceTrainingPricingTiersInput,
  TrainingPricingTier,
  TrainingPricingTiers
} from "@beosand/types";
import { trainingPricingTiersSchema } from "@beosand/types";
import type { Database } from "@beosand/db";
import { ENV } from "../../config/config.module";
import {
  BookingPriceSnapshotConflictError,
  type BookingPriceSnapshot,
  TrainingPricingRepository
} from "./training-pricing.repository";

export interface AcceptedSubscriptionBookingForPricing {
  id: string;
  clientId: string;
  date: string;
}

@Injectable()
export class TrainingPricingService {
  constructor(
    private readonly repo: TrainingPricingRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  async list(actorTelegramId: number): Promise<TrainingPricingTiers> {
    this.assertAdmin(actorTelegramId);
    return trainingPricingTiersSchema.parse(await this.repo.listActive());
  }

  async replace(
    actorTelegramId: number,
    input: ReplaceTrainingPricingTiersInput
  ): Promise<TrainingPricingTiers> {
    this.assertAdmin(actorTelegramId);
    const rows = await this.repo.transaction((tx) => this.repo.replaceActive(tx, input.tiers));
    return trainingPricingTiersSchema.parse(rows);
  }

  async assignSnapshotsForAcceptedBookings(
    tx: Database,
    bookings: AcceptedSubscriptionBookingForPricing[]
  ): Promise<Map<string, BookingPriceSnapshot>> {
    const byMonth = new Map<string, AcceptedSubscriptionBookingForPricing[]>();
    for (const booking of bookings) {
      const [year, month] = parseYearMonth(booking.date);
      const key = `${booking.clientId}:${year}:${month}`;
      const list = byMonth.get(key) ?? [];
      list.push(booking);
      byMonth.set(key, list);
    }

    const snapshots = new Map<string, BookingPriceSnapshot>();
    for (const list of byMonth.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const [year, month] = parseYearMonth(list[0].date);
      const [from, to] = monthBounds(year, month);
      const clientId = list[0].clientId;

      await this.repo.lockClientMonth(tx, clientId, year, month);
      const existingCount = await this.repo.countClientMonthPricedBookings(tx, {
        clientId,
        from,
        to,
        excludeBookingIds: list.map((booking) => booking.id)
      });
      const tiers = await this.repo.listActive(tx);
      if (tiers.length === 0) {
        throw new ConflictException("No active training pricing tiers configured");
      }

      for (let index = 0; index < list.length; index += 1) {
        const booking = list[index];
        const ordinal = existingCount + index + 1;
        const tier = tierForOrdinal(tiers, ordinal);
        if (!tier) {
          throw new ConflictException(`No pricing tier covers booking ordinal ${ordinal}`);
        }
        const snapshot = await this.setRequiredBookingPriceSnapshot(tx, {
          bookingId: booking.id,
          priceSnapshotRsd: tier.pricePerTrainingRsd,
          priceSnapshotSource: "training_pricing_tier",
          pricingTierId: tier.id,
          pricingTierLabel: tier.label,
          pricingTierMinTrainings: tier.minTrainings,
          pricingTierMaxTrainings: tier.maxTrainings,
          bookingOrdinalInMonth: ordinal,
          priceSnapshotAt: new Date()
        });
        snapshots.set(booking.id, snapshot);
      }
    }
    return snapshots;
  }

  private async setRequiredBookingPriceSnapshot(
    tx: Database,
    snapshot: BookingPriceSnapshot
  ): Promise<BookingPriceSnapshot> {
    try {
      return await this.repo.setBookingPriceSnapshot(tx, snapshot);
    } catch (error) {
      if (error instanceof BookingPriceSnapshotConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

function tierForOrdinal(tiers: TrainingPricingTier[], ordinal: number): TrainingPricingTier | undefined {
  return tiers.find(
    (tier) =>
      tier.minTrainings <= ordinal && (tier.maxTrainings === null || ordinal <= tier.maxTrainings)
  );
}

function parseYearMonth(date: string): [number, number] {
  const [year, month] = date.split("-");
  return [Number(year), Number(month)];
}

function monthBounds(year: number, month: number): [string, string] {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [from, `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`];
}
