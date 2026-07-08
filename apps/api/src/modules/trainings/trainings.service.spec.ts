import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import { tables } from "@beosand/db";
import type { Group, Training } from "@beosand/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingsService } from "./trainings.service";
import type {
  AvailableSlotRow,
  ClientTrainingBookingRow,
  ClientTrainingDetailRow,
  ClientTrainingWaitlistRow,
  RosterRow,
  ScheduleSlotRow,
  TrainerTrainingRow,
  TrainingCalendarRow,
  TrainingHeaderRow,
  TrainingLockRow,
  TrainingsRepository
} from "./trainings.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { DomainEventsService } from "../connectors/domain-events.service";
import type { GroupsRepository } from "../groups/groups.repository";
import type { NotificationsService } from "../notifications/notifications.service";
import type { SettingsService } from "../settings/settings.service";
import type { TrainersRepository } from "../trainers/trainers.repository";
import type { Client, Trainer } from "@beosand/types";

/** No-op domain-events double: the connector emit seam is fire-and-forget here. */
const fakeDomainEvents = {
  emitTrainingCancelled: (): void => undefined
} as unknown as DomainEventsService;

const fakeSettings = {
  resolveCourtWorkingHours: vi.fn(async (date: string) => ({
    date,
    openTime: "07:00",
    closeTime: "21:00",
    source: "fallback"
  }))
} as unknown as SettingsService;

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const GROUP_ID = "11111111-1111-1111-1111-111111111111";

// September 2026 is entirely in the future for this suite and has
// 4 Mondays + 5 Wednesdays = 9 trainings.
const FUTURE_YEAR = 2026;
const FUTURE_MONTH = 9;
const FUTURE_FIXTURE_TODAY = new Date("2026-06-03T12:00:00Z");
const MID_MONTH_FIXTURE_TODAY = new Date("2026-09-15T12:00:00Z");

function freezeFutureFixtureToday(): void {
  vi.useFakeTimers();
  vi.setSystemTime(FUTURE_FIXTURE_TODAY);
}

function freezeMidMonthFixtureToday(): void {
  vi.useFakeTimers();
  vi.setSystemTime(MID_MONTH_FIXTURE_TODAY);
}

const baseGroup: Group = {
  id: GROUP_ID,
  name: "Intermediate",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  trainerName: "Jovana",
  courtId: null,
  courtNumber: null,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000,
  hidden: false,
  status: "active"
};

/** In-memory stand-in for the trainings repository (only DB-access layer). */
class FakeTrainingsRepository {
  rows: Training[] = [];
  callLog?: string[];
  private seq = 0;

  async existingDatesForGroup(groupId: string, dates: readonly string[]): Promise<string[]> {
    this.callLog?.push(`existing:${groupId}:${[...dates].sort().join(",")}`);
    return this.rows
      .filter((r) => r.groupId === groupId && dates.includes(r.date))
      .map((r) => r.date);
  }

  async lockIndividualGenerationCandidate(
    _tx: Database,
    clientId: string,
    trainerId: string,
    date: string
  ): Promise<void> {
    this.callLog?.push(`individual-lock:${clientId}:${trainerId}:${date}`);
  }

  // Mirrors the real query: non-cancelled individual rows for this client + trainer.
  async existingIndividualDatesForClient(
    clientId: string,
    trainerId: string,
    dates: readonly string[]
  ): Promise<string[]> {
    this.callLog?.push(
      `existing-individual:${clientId}:${trainerId}:${[...dates].sort().join(",")}`
    );
    return this.rows
      .filter(
        (r) =>
          r.clientId === clientId &&
          r.trainerId === trainerId &&
          r.status !== "cancelled" &&
          dates.includes(r.date)
      )
      .map((r) => r.date);
  }

  async insertMany(
    _tx: Database,
    rows: (typeof tables.trainings.$inferInsert)[]
  ): Promise<Training[]> {
    const created = rows.map((row) => {
      const training: Training = {
        id: `00000000-0000-0000-0000-0000000000${String(++this.seq).padStart(2, "0")}`,
        groupId: row.groupId ?? null,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        trainerId: row.trainerId,
        clientId: row.clientId ?? null,
        capacity: row.capacity,
        bookedCount: row.bookedCount ?? 0,
        priceSingleRsd: row.priceSingleRsd ?? null,
        status: row.status ?? "open"
      };
      this.rows.push(training);
      return training;
    });
    return created;
  }

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work({} as Database);
  }

  async listInRange(
    from: string,
    to: string,
    groupId?: string,
    trainerId?: string,
    includeTerminal = false
  ): Promise<Training[]> {
    return this.rows
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (!groupId || r.groupId === groupId) &&
          (!trainerId || r.trainerId === trainerId) &&
          (includeTerminal || (r.status !== "cancelled" && r.status !== "completed"))
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  // Mirrors the real SQL: open + free seats + active joins, in [from, to],
  // optional level filter, ordered by date then start time.
  available: AvailableSlotRow[] = [];
  async listAvailable(
    from: string,
    to: string,
    levelId?: string,
    trainerId?: string
  ): Promise<AvailableSlotRow[]> {
    return this.available
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          r.status === "open" &&
          r.bookedCount < r.capacity &&
          (!levelId || r.levelId === levelId) &&
          (!trainerId || r.trainerId === trainerId)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  // Mirrors the real SQL: visible grouped schedule rows in [from, to], including
  // full rows so the Mini App can offer the waitlist path.
  schedule: ScheduleSlotRow[] = [];
  async listSchedule(
    from: string,
    to: string,
    levelId?: string,
    trainerId?: string
  ): Promise<ScheduleSlotRow[]> {
    return this.schedule
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (r.status === "open" || r.status === "full") &&
          (!levelId || r.levelId === levelId) &&
          (!trainerId || r.trainerId === trainerId)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  publicPreviewVisible = true;
  publicPreviewChecks: string[] = [];
  async isPublicPreviewVisible(trainingId: string): Promise<boolean> {
    this.publicPreviewChecks.push(trainingId);
    return this.publicPreviewVisible;
  }

  calendar: TrainingCalendarRow[] = [];
  async listCalendar(
    from: string,
    to: string,
    groupId?: string,
    trainerId?: string
  ): Promise<TrainingCalendarRow[]> {
    return this.calendar
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (!groupId || r.groupId === groupId) &&
          (!trainerId || r.trainerId === trainerId)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  async findCalendarItemById(id: string): Promise<TrainingCalendarRow | undefined> {
    const calendarRow = this.calendar.find((r) => r.id === id);
    if (calendarRow) {
      return calendarRow;
    }
    const row = this.rows.find((r) => r.id === id);
    return row
      ? {
          id: row.id,
          groupId: row.groupId,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          trainerId: row.trainerId,
          clientId: row.clientId,
          capacity: row.capacity,
          bookedCount: row.bookedCount,
          priceSingleRsd: row.priceSingleRsd,
          status: row.status,
          groupName: row.groupId ? "Group" : null,
          trainerName: "Trainer",
          courtId: null,
          courtNumber: null,
          clientName: row.clientId ? "Client" : null
        }
      : undefined;
  }

  trainerToday: TrainerTrainingRow[] = [];
  lastTrainerOnDate?: { trainerId: string; date: string };
  async listForTrainerOnDate(trainerId: string, date: string): Promise<TrainerTrainingRow[]> {
    this.lastTrainerOnDate = { trainerId, date };
    return this.trainerToday.filter(() => true);
  }

  headers: TrainingHeaderRow[] = [];
  async findHeaderById(trainingId: string): Promise<TrainingHeaderRow | undefined> {
    return this.headers.find((h) => h.trainingId === trainingId);
  }

  roster: RosterRow[] = [];
  async listRoster(_trainingId: string): Promise<RosterRow[]> {
    return this.roster;
  }

  // Participant name rows for the client-facing "кто записан" view.
  participantNames: { clientId: string; name: string; telegramPhotoUrl: string | null }[] = [];
  async listParticipantNames(
    _trainingId: string
  ): Promise<{ clientId: string; name: string; telegramPhotoUrl: string | null }[]> {
    return this.participantNames;
  }

  // Active waitlist name rows (already filtered + position-ordered by the real query).
  waitlistNames: { clientId: string; name: string; telegramPhotoUrl: string | null }[] = [];
  async listWaitlistNames(
    _trainingId: string
  ): Promise<{ clientId: string; name: string; telegramPhotoUrl: string | null }[]> {
    return this.waitlistNames;
  }

  clientDetail: ClientTrainingDetailRow | undefined;
  clientBooking: ClientTrainingBookingRow | undefined;
  clientWaitlist: ClientTrainingWaitlistRow | undefined;
  clientDetailChecks: Array<{ clientId: string; trainingId: string }> = [];
  async findClientDetailById(id: string): Promise<ClientTrainingDetailRow | undefined> {
    return this.clientDetail?.trainingId === id ? this.clientDetail : undefined;
  }
  async findClientBookingForTraining(
    clientId: string,
    trainingId: string
  ): Promise<ClientTrainingBookingRow | undefined> {
    this.clientDetailChecks.push({ clientId, trainingId });
    return this.clientBooking;
  }
  async findClientWaitlistForTraining(
    clientId: string,
    trainingId: string
  ): Promise<ClientTrainingWaitlistRow | undefined> {
    this.clientDetailChecks.push({ clientId, trainingId });
    return this.clientWaitlist;
  }

  participantAccess = true;
  participantAccessChecks: Array<{ trainingId: string; clientId: string }> = [];
  async hasActiveParticipantAccess(trainingId: string, clientId: string): Promise<boolean> {
    this.participantAccessChecks.push({ trainingId, clientId });
    return (
      this.participantAccess &&
      (this.participantNames.some((row) => row.clientId === clientId) ||
        this.waitlistNames.some((row) => row.clientId === clientId))
    );
  }

  // --- Admin manager writes (cancel / change capacity) ---
  lock: TrainingLockRow | undefined;
  cancelBookedCalls = 0;
  cancelledClientIds: string[] = [];

  async findForUpdate(_tx: Database, id: string): Promise<TrainingLockRow | undefined> {
    // Prefer an explicitly-seeded lock; otherwise fall back to a stored row so the
    // group-delete cascade (which locks many ids in one tx) can find each one.
    if (this.lock && this.lock.id === id) {
      return this.lock;
    }
    const row = this.rows.find((r) => r.id === id);
    return row
      ? {
          id: row.id,
          groupId: row.groupId,
          clientId: row.clientId,
          capacity: row.capacity,
          bookedCount: row.bookedCount,
          status: row.status,
          trainerId: row.trainerId
        }
      : undefined;
  }

  // Render fields for the connectors training.cancelled domain-event payload.
  async findRefById(
    id: string
  ): Promise<{ date: string; startTime: string; endTime: string } | undefined> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { date: row.date, startTime: row.startTime, endTime: row.endTime } : undefined;
  }

  // Full-training lock for the admin assign-court write.
  fullLock: Training | undefined;
  async findFullForUpdate(_tx: Database, id: string): Promise<Training | undefined> {
    this.callLog?.push(`full-lock:${id}`);
    if (this.fullLock && this.fullLock.id === id) {
      return this.fullLock;
    }
    if (this.lock && this.lock.id === id) {
      return this.lockToTraining(this.lock);
    }
    return this.rows.find((r) => r.id === id);
  }

  async findDateById(id: string): Promise<{ date: string } | undefined> {
    this.callLog?.push(`date:${id}`);
    if (this.fullLock && this.fullLock.id === id) {
      return { date: this.fullLock.date };
    }
    if (this.lock && this.lock.id === id) {
      return { date: this.lockToTraining(this.lock).date };
    }
    const row = this.rows.find((r) => r.id === id);
    return row ? { date: row.date } : undefined;
  }

  // Orphan trainings (no auto-block) on a date — the auto-assign candidate set.
  // The fake has no block link, so it returns every grouped open/full row on the
  // date; the test seeds only the orphans it wants placed.
  async listOrphansForDateForUpdate(_tx: Database, date: string): Promise<Training[]> {
    return this.rows
      .filter(
        (r) => r.date === date && r.groupId !== null && (r.status === "open" || r.status === "full")
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // Future non-cancelled trainings of a group (the cascade candidate set).
  async listFutureNonCancelledForGroup(
    groupId: string,
    fromDate: string
  ): Promise<{ id: string; date: string }[]> {
    return this.rows
      .filter((r) => r.groupId === groupId && r.date >= fromDate && r.status !== "cancelled")
      .map((r) => ({ id: r.id, date: r.date }));
  }

  markCancelledIds: string[] = [];
  async markCancelled(_tx: Database, id: string): Promise<Training> {
    this.markCancelledIds.push(id);
    // A stored row (cascade) is flipped in place; otherwise fall back to the lock.
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = "cancelled";
      return row;
    }
    const lock = this.requireLock(id);
    this.lock = { ...lock, status: "cancelled" };
    return this.lockToTraining(this.lock);
  }

  cancelBookedIds: string[] = [];
  /** Per-training cancelled clientIds for the cascade; falls back to the shared list. */
  cancelledClientIdsByTraining = new Map<string, string[]>();
  async cancelBookedBookingsForTraining(_tx: Database, id: string): Promise<string[]> {
    this.cancelBookedCalls += 1;
    this.cancelBookedIds.push(id);
    return this.cancelledClientIdsByTraining.get(id) ?? this.cancelledClientIds;
  }

  // --- Hard-delete purge writes (deleteTraining), recorded in call order. ---
  /** Ordered log of purge mutations, so a test can assert FK-safe ordering. */
  purgeCalls: string[] = [];
  async deleteNotificationsForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`notifications:${id}`);
  }
  async deleteWaitlistForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`waitlist:${id}`);
  }
  async deleteBookingsForTraining(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`bookings:${id}`);
  }
  async deleteTrainingRow(_tx: Database, id: string): Promise<void> {
    this.purgeCalls.push(`training:${id}`);
  }

  async updateCapacity(
    _tx: Database,
    id: string,
    capacity: number,
    status: TrainingLockRow["status"]
  ): Promise<Training> {
    const lock = this.requireLock(id);
    this.lock = { ...lock, capacity, status };
    return this.lockToTraining(this.lock);
  }

  // Reschedule write: mutate the stored row's start/end in place (keeping its id,
  // status, bookedCount and — since bookings live elsewhere — all its bookings).
  updateTimesIds: string[] = [];
  async updateTimes(
    _tx: Database,
    id: string,
    startTime: string,
    endTime: string
  ): Promise<Training> {
    this.updateTimesIds.push(id);
    const row = this.rows.find((r) => r.id === id);
    if (!row) {
      throw new Error("row not found");
    }
    row.startTime = startTime;
    row.endTime = endTime;
    return { ...row };
  }

  // Mirrors the real query: future non-cancelled individual rows for client + trainer.
  async listFutureNonCancelledIndividual(
    clientId: string,
    trainerId: string,
    fromDate: string
  ): Promise<{ id: string }[]> {
    return this.rows
      .filter(
        (r) =>
          r.clientId === clientId &&
          r.trainerId === trainerId &&
          r.date >= fromDate &&
          (r.status === "open" || r.status === "full")
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((r) => ({ id: r.id }));
  }

  async listDatesByIds(
    _tx: Database,
    ids: readonly string[]
  ): Promise<{ id: string; date: string }[]> {
    return this.rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, date: r.date }));
  }

  updatePriceIds: string[] = [];
  async updatePrice(_tx: Database, id: string, priceSingleRsd: number | null): Promise<Training> {
    this.updatePriceIds.push(id);
    const row = this.rows.find((r) => r.id === id);
    if (!row) {
      throw new Error("row not found");
    }
    row.priceSingleRsd = priceSingleRsd;
    return { ...row };
  }

  private requireLock(id: string): TrainingLockRow {
    if (!this.lock || this.lock.id !== id) {
      throw new Error("lock not set");
    }
    return this.lock;
  }

  private lockToTraining(lock: TrainingLockRow): Training {
    return {
      id: lock.id,
      groupId: lock.groupId,
      date: "2099-06-01",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: lock.trainerId,
      clientId: lock.clientId,
      capacity: lock.capacity,
      bookedCount: lock.bookedCount,
      priceSingleRsd: null,
      status: lock.status
    };
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

class FakeClientsRepository {
  client: Client | undefined;
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
  }
  async findById(id: string): Promise<Client | undefined> {
    return this.client && this.client.id === id ? this.client : undefined;
  }
}

class FakeGroupsRepository {
  group: Group | undefined = { ...baseGroup };
  activeGroups: Group[] = [];
  async findById(id: string): Promise<Group | undefined> {
    return this.group && this.group.id === id ? this.group : undefined;
  }
  async listActive(): Promise<Group[]> {
    return this.activeGroups;
  }
}

interface FakeOccupancyRow {
  id?: string;
  courtId: string;
  startTime: string;
  durationMinutes: number;
  requestId?: string;
  /** Optional date filter; when set, the row only counts on that date. */
  date?: string;
}

/** Minutes between two "HH:MM" times (for the fake's block-occupancy read). */
function minutesBetween(start: string, end: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m(end) - m(start);
}

function expectCallBefore(calls: readonly string[], before: string, after: string): void {
  const beforeIndex = calls.indexOf(before);
  const afterIndex = calls.indexOf(after);
  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  expect(afterIndex).toBeGreaterThanOrEqual(0);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

/** In-memory stand-in for the court-blocks repo (the only court DB access in generation). */
class FakeCourtBlocksRepository {
  courts: { id: string; number: number }[] = [
    { id: "c0000000-0000-4000-8000-000000000001", number: 1 },
    { id: "c0000000-0000-4000-8000-000000000002", number: 2 }
  ];
  confirmed: FakeOccupancyRow[] = [];
  held: FakeOccupancyRow[] = [];
  existingBlocks: FakeOccupancyRow[] = [];
  inserted: {
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    groupTrainingId?: string | null;
  }[] = [];
  updated: string[] = [];
  updatedAssignments: {
    id: string;
    input: { courtId: string; date: string; startTime: string; endTime: string };
  }[] = [];
  deletedTrainingIds: string[] = [];
  calls: string[] = [];

  async lockDate(date: string): Promise<void> {
    this.calls.push(`lock:${date}`);
  }

  async activeCourts(): Promise<{ id: string; number: number }[]> {
    return this.courts;
  }
  async countActiveCourts(): Promise<number> {
    return this.courts.length;
  }
  async confirmedOccupancyForDate(date: string): Promise<FakeOccupancyRow[]> {
    this.calls.push(`confirmed:${date}`);
    return this.confirmed.filter((r) => !r.date || r.date === date).map((r) => ({ ...r }));
  }
  async heldOccupancyForDate(date: string): Promise<FakeOccupancyRow[]> {
    this.calls.push(`held:${date}`);
    return this.held.filter((r) => !r.date || r.date === date).map((r) => ({ ...r }));
  }
  async blocksOccupancyForDate(
    date: string,
    _tx?: Database,
    excludeBlockId?: string
  ): Promise<FakeOccupancyRow[]> {
    this.calls.push(`blocks:${date}`);
    // Mirror the real DB read: previously-committed auto-blocks on this date are
    // visible to a later read (cross-group in-run accumulation in generate-all).
    const persisted = this.inserted
      .filter((b) => b.date === date)
      .map((b) => ({
        courtId: b.courtId,
        startTime: b.startTime,
        durationMinutes: minutesBetween(b.startTime, b.endTime)
      }));
    const linked = [...this.linkedBlocks.values()]
      .filter((b) => b.date === date)
      .map((b) => ({
        id: b.id,
        courtId: b.courtId,
        startTime: b.startTime,
        durationMinutes: minutesBetween(b.startTime, b.endTime)
      }));
    return [
      ...this.existingBlocks.filter(
        (r) =>
          (!r.date || r.date === date) &&
          (excludeBlockId === undefined || r.id !== excludeBlockId)
      ),
      ...persisted,
      ...linked.filter((r) => excludeBlockId === undefined || r.id !== excludeBlockId)
    ].map((r) => ({ ...r }));
  }
  async insert(input: {
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    groupTrainingId?: string | null;
  }): Promise<unknown> {
    this.calls.push(`insert:${input.date}`);
    this.inserted.push(input);
    return { id: "b0000000-0000-4000-8000-000000000001", ...input };
  }
  async deleteByGroupTrainingId(id: string): Promise<boolean> {
    this.calls.push(`deleteAuto:${id}`);
    this.deletedTrainingIds.push(id);
    return true;
  }

  // Training ids that already hold a court block (guards a double assign-court).
  blockedTrainingIds = new Set<string>();
  linkedBlocks = new Map<
    string,
    {
      id: string;
      courtId: string;
      date: string;
      startTime: string;
      endTime: string;
      reason: string;
      groupTrainingId: string;
    }
  >();
  async findByGroupTrainingId(id: string): Promise<{
    id: string;
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    groupTrainingId: string;
  } | null> {
    const linked = this.linkedBlocks.get(id);
    if (linked) {
      return { ...linked };
    }
    return this.blockedTrainingIds.has(id)
      ? {
          id: "existing-block",
          courtId: "c0000000-0000-4000-8000-000000000001",
          date: "2099-06-01",
          startTime: "20:00",
          endTime: "21:30",
          reason: "Existing",
          groupTrainingId: id
        }
      : null;
  }

  async updateCourt(id: string, courtId: string): Promise<{ id: string }> {
    this.calls.push(`update:${id}:${courtId}`);
    this.updated.push(id);
    return { id };
  }

  async updateAssignment(
    id: string,
    input: { courtId: string; date: string; startTime: string; endTime: string }
  ): Promise<{ id: string }> {
    this.calls.push(
      `updateAssignment:${id}:${input.courtId}:${input.date}:${input.startTime}:${input.endTime}`
    );
    this.updated.push(id);
    this.updatedAssignments.push({ id, input });
    for (const [trainingId, block] of this.linkedBlocks) {
      if (block.id === id) {
        this.linkedBlocks.set(trainingId, { ...block, ...input });
      }
    }
    return { id };
  }
}

/**
 * In-memory stand-in for the bookings repo's seat-write path, reused by the
 * individual-month generator. `insertBooking` records the created booking;
 * `updateTrainingCount` mirrors the real recompute by mutating the stored training
 * row in `trainings.rows`, so a test sees the instance flip open → full after its
 * owner booking — exactly as the real bookGroupMonth path persists it.
 */
class FakeBookingsRepository {
  inserted: {
    clientId: string;
    trainingId: string;
    type: string;
    groupSubscriptionId: string | null;
    status: string;
    source: string;
  }[] = [];
  private seq = 0;

  constructor(private readonly trainingsRepo: FakeTrainingsRepository) {}

  async insertBooking(
    _tx: Database,
    values: {
      clientId: string;
      trainingId: string;
      type: string;
      groupSubscriptionId?: string | null;
      status: string;
      source: string;
    }
  ): Promise<{ id: string }> {
    const id = `b0000000-0000-4000-8000-0000000000${String(++this.seq).padStart(2, "0")}`;
    this.inserted.push({
      clientId: values.clientId,
      trainingId: values.trainingId,
      type: values.type,
      groupSubscriptionId: values.groupSubscriptionId ?? null,
      status: values.status,
      source: values.source
    });
    return { id };
  }

  async updateTrainingCount(
    _tx: Database,
    trainingId: string,
    bookedCount: number,
    status: TrainingLockRow["status"]
  ): Promise<void> {
    const row = this.trainingsRepo.rows.find((r) => r.id === trainingId);
    if (row) {
      row.bookedCount = bookedCount;
      row.status = status;
    }
  }

  // The subscription id of a training's owner booking (matched by trainingId +
  // clientId), mirroring the real read against the inserted owner bookings.
  async findSubscriptionIdForTrainingOwner(
    _tx: Database,
    trainingId: string,
    clientId: string
  ): Promise<string | null | undefined> {
    const booking = this.inserted.find(
      (b) => b.trainingId === trainingId && b.clientId === clientId
    );
    return booking ? booking.groupSubscriptionId : undefined;
  }

  // Distinct training ids whose bookings share one groupSubscriptionId.
  async findSubscriptionTrainingIds(_tx: Database, groupSubscriptionId: string): Promise<string[]> {
    return [
      ...new Set(
        this.inserted
          .filter((b) => b.groupSubscriptionId === groupSubscriptionId)
          .map((b) => b.trainingId)
      )
    ];
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("TrainingsService", () => {
  let trainingsRepo: FakeTrainingsRepository;
  let groupsRepo: FakeGroupsRepository;
  let trainersRepo: FakeTrainersRepository;
  let clientsRepo: FakeClientsRepository;
  let notifications: { sendTrainingCancelled: ReturnType<typeof vi.fn> };
  let courtBlocksRepo: FakeCourtBlocksRepository;
  let bookingsRepo: FakeBookingsRepository;
  let service: TrainingsService;

  beforeEach(() => {
    trainingsRepo = new FakeTrainingsRepository();
    groupsRepo = new FakeGroupsRepository();
    trainersRepo = new FakeTrainersRepository();
    clientsRepo = new FakeClientsRepository();
    notifications = { sendTrainingCancelled: vi.fn().mockResolvedValue(0) };
    courtBlocksRepo = new FakeCourtBlocksRepository();
    trainingsRepo.callLog = courtBlocksRepo.calls;
    bookingsRepo = new FakeBookingsRepository(trainingsRepo);
    service = new TrainingsService(
      trainingsRepo as unknown as TrainingsRepository,
      groupsRepo as unknown as GroupsRepository,
      trainersRepo as unknown as TrainersRepository,
      clientsRepo as unknown as ClientsRepository,
      notifications as unknown as NotificationsService,
      courtBlocksRepo as unknown as import("../courts/court-blocks.repository").CourtBlocksRepository,
      bookingsRepo as unknown as import("../bookings/bookings.repository").BookingsRepository,
      fakeDomainEvents,
      fakeSettings,
      env
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const generate = () => {
    freezeFutureFixtureToday();
    return service.generateMonth(ADMIN_ID, {
      groupId: GROUP_ID,
      year: FUTURE_YEAR,
      month: FUTURE_MONTH
    });
  };

  it("generates one training per group weekday across the month (9 for Mon+Wed September 2026)", async () => {
    const created = await generate();
    expect(created).toHaveLength(9);
  });

  it("copies the group's capacity, trainer, times and starts open with bookedCount 0", async () => {
    const created = await generate();
    for (const t of created) {
      expect(t.capacity).toBe(baseGroup.capacity);
      expect(t.trainerId).toBe(baseGroup.trainerId);
      expect(t.startTime).toBe(baseGroup.startTime);
      expect(t.endTime).toBe(baseGroup.endTime);
      expect(t.groupId).toBe(GROUP_ID);
      expect(t.bookedCount).toBe(0);
      expect(t.status).toBe("open");
    }
  });

  it("is idempotent: re-running the same month creates none", async () => {
    const first = await generate();
    expect(first).toHaveLength(9);
    const second = await generate();
    expect(second).toEqual([]);
    expect(trainingsRepo.rows).toHaveLength(9);
  });

  it("rejects a non-admin caller with ForbiddenException before any write", async () => {
    await expect(
      service.generateMonth(NON_ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(trainingsRepo.rows).toHaveLength(0);
  });

  it("throws NotFoundException for an unknown group", async () => {
    groupsRepo.group = undefined;
    await expect(generate()).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects generation for an inactive group", async () => {
    groupsRepo.group = { ...baseGroup, status: "inactive" };
    await expect(generate()).rejects.toBeInstanceOf(BadRequestException);
    expect(trainingsRepo.rows).toHaveLength(0);
  });

  it("list is admin-only", async () => {
    await expect(
      service.list(NON_ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("passes group/trainer filters and hides terminal statuses unless includeTerminal=true", async () => {
    const spy = vi.spyOn(trainingsRepo, "listInRange");
    await service.list(ADMIN_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
      groupId: GROUP_ID,
      trainerId: baseGroup.trainerId
    });
    expect(spy).toHaveBeenCalledWith(
      "2026-07-01",
      "2026-07-31",
      GROUP_ID,
      baseGroup.trainerId,
      false
    );
    await service.list(ADMIN_ID, {
      from: "2026-07-01",
      to: "2026-07-31",
      groupId: GROUP_ID,
      trainerId: baseGroup.trainerId,
      includeTerminal: true
    });
    expect(spy).toHaveBeenCalledWith(
      "2026-07-01",
      "2026-07-31",
      GROUP_ID,
      baseGroup.trainerId,
      true
    );
  });

  it("list returns generated trainings within the range", async () => {
    await generate();
    const listed = await service.list(ADMIN_ID, {
      from: "2026-09-01",
      to: "2026-09-30",
      groupId: GROUP_ID
    });
    expect(listed).toHaveLength(9);
  });

  describe("admin calendar (listCalendar / getCalendarItem)", () => {
    const TRAINER_A = "33333333-3333-3333-3333-333333333333";
    const calItem = (over: Partial<TrainingCalendarRow> = {}): TrainingCalendarRow => ({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      groupId: GROUP_ID,
      date: "2026-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_A,
      clientId: null,
      capacity: 12,
      bookedCount: 3,
      priceSingleRsd: null,
      status: "open",
      groupName: "Intermediate",
      trainerName: "Jovana",
      courtId: null,
      courtNumber: 2,
      clientName: null,
      ...over
    });

    it("listCalendar is admin-only", async () => {
      await expect(
        service.listCalendar(NON_ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("listCalendar rejects to < from", async () => {
      await expect(
        service.listCalendar(ADMIN_ID, { from: "2026-07-31", to: "2026-07-01" })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("defaults listCalendar calls to hide terminal statuses unless includeTerminal=true", async () => {
      const spy = vi.spyOn(trainingsRepo, "listCalendar");
      trainingsRepo.calendar = [calItem({ status: "cancelled", id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" })];
      await service.listCalendar(ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" });
      expect(spy).toHaveBeenCalledWith(
        "2026-07-01",
        "2026-07-31",
        undefined,
        undefined,
        false
      );
      await service.listCalendar(ADMIN_ID, {
        from: "2026-07-01",
        to: "2026-07-31",
        includeTerminal: true
      });
      expect(spy).toHaveBeenCalledWith(
        "2026-07-01",
        "2026-07-31",
        undefined,
        undefined,
        true
      );
    });

    it("listCalendar returns contract-valid items in the range, with null group/court allowed", async () => {
      trainingsRepo.calendar = [
        calItem(),
        calItem({
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          groupId: null,
          groupName: null,
          courtNumber: null
        })
      ];
      const items = await service.listCalendar(ADMIN_ID, { from: "2026-07-01", to: "2026-07-31" });
      expect(items).toHaveLength(2);
      expect(items[1].groupName).toBeNull();
      expect(items[1].courtNumber).toBeNull();
    });

    it("getCalendarItem returns the matching item for an admin", async () => {
      trainingsRepo.calendar = [calItem()];
      const item = await service.getCalendarItem(ADMIN_ID, calItem().id);
      expect(item.trainerName).toBe("Jovana");
      expect(item.courtNumber).toBe(2);
    });

    it("getCalendarItem is admin-only", async () => {
      trainingsRepo.calendar = [calItem()];
      await expect(service.getCalendarItem(NON_ADMIN_ID, calItem().id)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("getCalendarItem 404s a missing id", async () => {
      await expect(
        service.getCalendarItem(ADMIN_ID, "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listAvailable", () => {
    // Freeze "today" to 2026-06-03 so these fixtures stay inside the default
    // today..today+14 window regardless of the real calendar date (otherwise the
    // hardcoded 2026-06-05 slots rot out of the window once that date passes).
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-03T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const TRAINER_A = "33333333-3333-3333-3333-333333333333";
    const LEVEL_A = "22222222-2222-2222-2222-222222222222";
    const slot = (over: Partial<AvailableSlotRow>): AvailableSlotRow => ({
      trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      date: "2026-06-05",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_A,
      trainerName: "Coach",
      groupName: "Evening group",
      levelId: LEVEL_A,
      levelName: "Intermediate",
      capacity: 6,
      bookedCount: 2,
      status: "open",
      priceSingleRsd: 1500,
      ...over
    });

    it("maps a bookable row to a SlotCard with server-computed free seats, price and weekday", async () => {
      trainingsRepo.available = [slot({ bookedCount: 4, capacity: 6 })];
      const cards = await service.listAvailable({});
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        freeSeats: 2,
        priceSingleRsd: 1500,
        groupName: "Evening group",
        trainerName: "Coach",
        levelName: "Intermediate",
        dayOfWeek: 5 // 2026-06-05 is a Friday
      });
    });

    it("never returns a full slot, but it reappears once a seat is freed", async () => {
      const full = slot({ bookedCount: 6, capacity: 6, status: "open" });
      trainingsRepo.available = [full];
      expect(await service.listAvailable({})).toHaveLength(0);

      full.bookedCount = 5; // one seat freed
      const after = await service.listAvailable({});
      expect(after).toHaveLength(1);
      expect(after[0].freeSeats).toBe(1);
    });

    it("keeps full rows out of available but returns them in schedule as non-bookable", async () => {
      const full = slot({ status: "full", bookedCount: 6, capacity: 6 });
      trainingsRepo.available = [full];
      trainingsRepo.schedule = [{ ...full, trainingContextLabel: "Women" }];

      expect(await service.listAvailable({})).toEqual([]);

      const schedule = await service.listSchedule({});
      expect(schedule).toHaveLength(1);
      expect(schedule[0]).toMatchObject({
        trainingId: full.trainingId,
        freeSeats: 0,
        trainingContextLabel: "Women",
        trainingStatus: "full",
        bookable: false
      });
    });

    it("excludes cancelled and completed trainings even if the repo were to leak them", async () => {
      trainingsRepo.available = [
        slot({ status: "cancelled", bookedCount: 0 }),
        slot({ status: "completed", bookedCount: 0 })
      ];
      expect(await service.listAvailable({})).toHaveLength(0);
    });

    it("excludes past trainings by clamping `from` to today", async () => {
      trainingsRepo.available = [slot({ date: "2026-05-01" })];
      expect(await service.listAvailable({ from: "2026-05-01" })).toHaveLength(0);
    });

    it("orders results by date then start time", async () => {
      trainingsRepo.available = [
        slot({
          trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          date: "2026-06-07",
          startTime: "18:00"
        }),
        slot({
          trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          date: "2026-06-05",
          startTime: "20:00"
        }),
        slot({
          trainingId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          date: "2026-06-05",
          startTime: "08:00"
        })
      ];
      const cards = await service.listAvailable({});
      expect(cards.map((c) => c.startTime)).toEqual(["08:00", "20:00", "18:00"]);
    });

    it("rejects to < from with BadRequestException", async () => {
      await expect(
        service.listAvailable({ from: "2026-06-10", to: "2026-06-05" })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("passes the levelId and trainerId filters through to the repository", async () => {
      const spy = vi.spyOn(trainingsRepo, "listAvailable");
      await service.listAvailable({
        levelId: "22222222-2222-2222-2222-222222222222",
        trainerId: TRAINER_A
      });
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "22222222-2222-2222-2222-222222222222",
        TRAINER_A
      );
    });

    it("narrows by weekday (T3.2) and never returns a non-matching slot", async () => {
      // 2026-06-05 is Friday (5); 2026-06-08 is Monday (1).
      trainingsRepo.available = [
        slot({ trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", date: "2026-06-05" }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", date: "2026-06-08" })
      ];
      const cards = await service.listAvailable({ weekday: 1 });
      expect(cards).toHaveLength(1);
      expect(cards[0].dayOfWeek).toBe(1);
    });

    it("narrows by timeOfDay (T3.2)", async () => {
      trainingsRepo.available = [
        slot({ trainingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", startTime: "09:00" }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", startTime: "20:00" })
      ];
      const morning = await service.listAvailable({ timeOfDay: "morning" });
      expect(morning.map((c) => c.startTime)).toEqual(["09:00"]);
      const evening = await service.listAvailable({ timeOfDay: "evening" });
      expect(evening.map((c) => c.startTime)).toEqual(["20:00"]);
    });

    it("returns an empty list when a filter matches nothing — never a non-bookable slot", async () => {
      trainingsRepo.available = [
        slot({ status: "cancelled", bookedCount: 0 }),
        slot({ trainingId: "cccccccc-cccc-cccc-cccc-cccccccccccc", date: "2026-06-05" })
      ];
      // weekday 2 (Tuesday) matches neither; the cancelled slot is excluded by isBookable.
      expect(await service.listAvailable({ weekday: 2 })).toHaveLength(0);
    });

    // Defence in depth: the bot must only ever receive contract-valid cards.
    // A repo row that would map to an invalid SlotCard (e.g. negative price)
    // is rejected by the output schema, never silently returned.
    it("rejects a row that would map to a contract-invalid SlotCard", async () => {
      trainingsRepo.available = [slot({ priceSingleRsd: -100 })];
      await expect(service.listAvailable({})).rejects.toThrow();
    });
  });

  describe("listTrainerToday (T2.3)", () => {
    const TRAINER_TG = 555;
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
    const today = new Date().toISOString().slice(0, 10);

    const makeTrainer = (over: Partial<Trainer> = {}): Trainer => ({
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

    const todayRow = (over: Partial<TrainerTrainingRow> = {}): TrainerTrainingRow => ({
      trainingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      date: today,
      startTime: "20:00",
      endTime: "21:30",
      levelName: "Intermediate",
      status: "open",
      bookedCount: 4,
      capacity: 12,
      ...over
    });

    it("resolves the trainer by telegram_id and returns only their today trainings", async () => {
      trainersRepo.trainers = [makeTrainer()];
      trainingsRepo.trainerToday = [todayRow()];
      const items = await service.listTrainerToday(TRAINER_TG, TRAINER_TG);
      expect(items).toHaveLength(1);
      expect(trainingsRepo.lastTrainerOnDate).toEqual({ trainerId: TRAINER_ID, date: today });
      expect(items[0]).toMatchObject({ bookedCount: 4, capacity: 12, status: "open" });
    });

    it("rejects a caller with no trainer record (403)", async () => {
      trainersRepo.trainers = [];
      await expect(service.listTrainerToday(TRAINER_TG, TRAINER_TG)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("rejects a query telegramId that does not match the actor (403)", async () => {
      trainersRepo.trainers = [makeTrainer()];
      await expect(service.listTrainerToday(TRAINER_TG, 777)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("lets an admin read another trainer's schedule by query id", async () => {
      trainersRepo.trainers = [makeTrainer()];
      trainingsRepo.trainerToday = [todayRow()];
      const items = await service.listTrainerToday(ADMIN_ID, TRAINER_TG);
      expect(items).toHaveLength(1);
    });
  });

  describe("getRoster (T2.3)", () => {
    const TRAINER_TG = 555;
    const OTHER_TG = 556;
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    beforeEach(() => {
      trainersRepo.trainers = [
        {
          id: TRAINER_ID,
          name: "Coach",
          type: "main",
          status: "active",
          telegramId: TRAINER_TG,
          telegramUsername: null,
          language: "ru",
          individualVisible: true
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Other",
          type: "main",
          status: "active",
          telegramId: OTHER_TG,
          telegramUsername: null,
          language: "ru",
          individualVisible: true
        }
      ];
      trainingsRepo.headers = [
        {
          trainingId: TRAINING_ID,
          date: "2026-06-03",
          startTime: "20:00",
          endTime: "21:30",
          levelName: "Intermediate",
          trainerId: TRAINER_ID
        }
      ];
      trainingsRepo.roster = [
        {
          bookingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          clientId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          clientName: "Ana",
          telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg",
          bookingStatus: "booked",
          bookingType: "group",
          groupSubscriptionId: "dddddddd-dddd-dddd-dddd-dddddddddddd"
        },
        {
          bookingId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          clientId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
          clientName: "Boris",
          telegramPhotoUrl: null,
          bookingStatus: "booked",
          bookingType: "single",
          groupSubscriptionId: null
        }
      ];
    });

    it("returns the roster for the owning trainer", async () => {
      const roster = await service.getRoster(TRAINER_TG, TRAINING_ID);
      expect(roster.participants).toHaveLength(2);
      expect(roster.participants[0].clientName).toBe("Ana");
    });

    it("surfaces booking type and subscription id for group and drop-in rows", async () => {
      const roster = await service.getRoster(TRAINER_TG, TRAINING_ID);
      const ana = roster.participants.find((p) => p.clientName === "Ana");
      const boris = roster.participants.find((p) => p.clientName === "Boris");
      expect(ana?.bookingType).toBe("group");
      expect(ana?.groupSubscriptionId).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
      expect(ana?.telegramPhotoUrl).toBe("https://t.me/i/userpic/320/ana.jpg");
      expect(boris?.bookingType).toBe("single");
      expect(boris?.groupSubscriptionId).toBeNull();
      expect(boris?.telegramPhotoUrl).toBeNull();
    });

    it("lets an admin read any roster", async () => {
      const roster = await service.getRoster(ADMIN_ID, TRAINING_ID);
      expect(roster.trainingId).toBe(TRAINING_ID);
    });

    it("forbids another trainer (403)", async () => {
      await expect(service.getRoster(OTHER_TG, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("forbids a non-trainer (403)", async () => {
      await expect(service.getRoster(12345, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("404s an unknown training", async () => {
      await expect(
        service.getRoster(TRAINER_TG, "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listParticipants (client-facing 'кто записан')", () => {
    const CLIENT_TG = 222;
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";
    const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const CLIENT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const CLIENT_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const clientRow = (telegramId: number, id = CLIENT_C): Client => ({
      id,
      name: "Onboarded",
      telegramId,
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
    });

    beforeEach(() => {
      trainingsRepo.headers = [
        {
          trainingId: TRAINING_ID,
          date: "2026-07-06",
          startTime: "20:00",
          endTime: "21:30",
          levelName: "Intermediate",
          trainerId: TRAINER_ID
        }
      ];
      // The repo query already excludes cancelled/waitlist; the fake returns only the
      // active roster, so the participant list mirrors that filtered set.
      trainingsRepo.participantNames = [
        {
          clientId: CLIENT_A,
          name: "Ана Петровић",
          telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg"
        },
        { clientId: CLIENT_B, name: "Marko Novak", telegramPhotoUrl: null }
      ];
      // The repo query already returns ONLY active entries (waiting/notified), in
      // queue-position order; the fake reflects that filtered, ordered set. CLIENT_C
      // is queued ahead of CLIENT_D; a promoted/cancelled entry would simply not be
      // here (the query excludes it), so it can never appear in the list.
      trainingsRepo.waitlistNames = [
        {
          clientId: CLIENT_C,
          name: "Зоран Илић",
          telegramPhotoUrl: "https://t.me/i/userpic/320/zoran.jpg"
        },
        { clientId: CLIENT_D, name: "Petra Kovač", telegramPhotoUrl: null }
      ];
    });

    it("admin gets full participant rows including clientId and fullName", async () => {
      const result = await service.listParticipants(ADMIN_ID, TRAINING_ID);
      expect(result.trainingId).toBe(TRAINING_ID);
      expect(result.participantCount).toBe(2);
      const [first] = result.participants;
      expect(first.clientId).toBe(CLIENT_A);
      expect(first.fullName).toBe("Ана Петровић");
      expect(first.firstName).toBe("Ана");
      expect(first.avatarInitial).toBe("А");
      expect(first.telegramPhotoUrl).toBe("https://t.me/i/userpic/320/ana.jpg");
    });

    it("admin gets the full waitlist rows in queue order with clientId and fullName", async () => {
      const result = await service.listParticipants(ADMIN_ID, TRAINING_ID);
      expect(result.waitlistCount).toBe(2);
      // Queue order is preserved: CLIENT_C (position 1) before CLIENT_D.
      expect(result.waitlist.map((m) => m.clientId)).toEqual([CLIENT_C, CLIENT_D]);
      expect(result.waitlist[0].fullName).toBe("Зоран Илић");
      expect(result.waitlist[0].firstName).toBe("Зоран");
      expect(result.waitlist[0].telegramPhotoUrl).toBe("https://t.me/i/userpic/320/zoran.jpg");
    });

    it("a client caller gets only firstName + avatarInitial + telegramPhotoUrl — never clientId/fullName", async () => {
      clientsRepo.client = clientRow(CLIENT_TG);
      const result = await service.listParticipants(CLIENT_TG, TRAINING_ID);
      expect(result.participantCount).toBe(2);
      for (const participant of result.participants) {
        expect(participant.clientId).toBeUndefined();
        expect(participant.fullName).toBeUndefined();
        expect(participant.firstName).toBeTruthy();
        expect(participant.avatarInitial).toBeTruthy();
        expect(participant).toHaveProperty("telegramPhotoUrl");
      }
      expect(result.participants[0].telegramPhotoUrl).toBe("https://t.me/i/userpic/320/ana.jpg");
      expect(result.participants[1].telegramPhotoUrl).toBeNull();
    });

    it("publicPreviewVisible=true does not require participant access", async () => {
      clientsRepo.client = clientRow(CLIENT_TG, CLIENT_A);
      trainingsRepo.participantAccess = false;
      const result = await service.listParticipants(CLIENT_TG, TRAINING_ID);

      expect(result.participantCount).toBe(2);
      expect(trainingsRepo.publicPreviewChecks).toEqual([TRAINING_ID]);
      expect(trainingsRepo.participantAccessChecks).toEqual([]);
      expect(result.participants[0].clientId).toBeUndefined();
    });

    it("publicPreviewVisible=false permits the caller's active waitlisted access", async () => {
      clientsRepo.client = clientRow(CLIENT_TG, CLIENT_C);
      trainingsRepo.publicPreviewVisible = false;
      const result = await service.listParticipants(CLIENT_TG, TRAINING_ID);

      expect(result.waitlistCount).toBe(2);
      expect(trainingsRepo.publicPreviewChecks).toEqual([TRAINING_ID]);
      expect(trainingsRepo.participantAccessChecks).toEqual([
        { trainingId: TRAINING_ID, clientId: CLIENT_C }
      ]);
    });

    it("publicPreviewVisible=false forbids an onboarded client with no active participant access", async () => {
      const unrelatedClientId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      clientsRepo.client = clientRow(CLIENT_TG, unrelatedClientId);
      trainingsRepo.publicPreviewVisible = false;

      await expect(service.listParticipants(CLIENT_TG, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsRepo.publicPreviewChecks).toEqual([TRAINING_ID]);
      expect(trainingsRepo.participantAccessChecks).toEqual([
        { trainingId: TRAINING_ID, clientId: unrelatedClientId }
      ]);
    });

    it("narrows the waitlist for a client caller (firstName + avatarInitial only), in queue order", async () => {
      clientsRepo.client = clientRow(CLIENT_TG);
      const result = await service.listParticipants(CLIENT_TG, TRAINING_ID);
      expect(result.waitlistCount).toBe(2);
      // Order is preserved even when ids/full names are stripped.
      expect(result.waitlist.map((m) => m.firstName)).toEqual(["Зоран", "Petra"]);
      for (const entry of result.waitlist) {
        expect(entry.clientId).toBeUndefined();
        expect(entry.fullName).toBeUndefined();
        expect(entry.avatarInitial).toBeTruthy();
        expect(entry).toHaveProperty("telegramPhotoUrl");
      }
    });

    it("returns an empty waitlist (count 0) when the active-only query yields no entries (promoted/cancelled excluded)", async () => {
      // The repo query filters out promoted/cancelled/expired entries, so a training
      // whose queue holds only terminal entries returns nothing here.
      trainingsRepo.waitlistNames = [];
      const result = await service.listParticipants(ADMIN_ID, TRAINING_ID);
      expect(result.waitlistCount).toBe(0);
      expect(result.waitlist).toEqual([]);
      // The booked participants are unaffected.
      expect(result.participantCount).toBe(2);
    });

    it("forbids a non-admin caller with no client record (403)", async () => {
      clientsRepo.client = undefined;
      await expect(service.listParticipants(NON_ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("404s a missing training", async () => {
      await expect(
        service.listParticipants(ADMIN_ID, "00000000-0000-0000-0000-000000000000")
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getClientDetail (Mini App self-scoped detail)", () => {
    const CLIENT_TG = 222;
    const TRAINING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const CLIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const client = (): Client => ({
      id: CLIENT_ID,
      name: "Onboarded",
      telegramId: CLIENT_TG,
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
    });

    const detailRow = (
      over: Partial<ClientTrainingDetailRow> = {}
    ): ClientTrainingDetailRow => ({
      trainingId: TRAINING_ID,
      groupId: GROUP_ID,
      trainingClientId: null,
      date: "2099-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerName: "Jovana",
      levelName: "Intermediate",
      groupName: "Intermediate",
      courtNumber: 2,
      trainingStatus: "open",
      groupStatus: "active",
      groupHidden: false,
      trainerStatus: "active",
      levelStatus: "active",
      ...over
    });

    beforeEach(() => {
      clientsRepo.client = client();
      trainingsRepo.clientDetail = detailRow();
      trainingsRepo.clientBooking = {
        bookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        groupSubscriptionId: null,
        status: "booked"
      };
      trainingsRepo.participantNames = [
        { clientId: CLIENT_ID, name: "Ana Petrovic", telegramPhotoUrl: null },
        {
          clientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "Marko Novak",
          telegramPhotoUrl: "https://t.me/i/userpic/320/marko.jpg"
        }
      ];
      trainingsRepo.waitlistNames = [
        {
          clientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "Petra Kovac",
          telegramPhotoUrl: null
        }
      ];
    });

    it("returns computed viewer state and narrowed participant rows without leaking ids", async () => {
      const result = await service.getClientDetail(CLIENT_TG, TRAINING_ID);

      expect(result).not.toHaveProperty("courtId");
      expect(result.viewerRelation).toBe("booked");
      expect(result.canCancel).toBe(true);
      expect(result.exportEligible).toBe(true);
      expect(result.courtNumber).toBe(2);
      expect(result.bookingId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(result.participants.participants).toHaveLength(2);
      expect(result.participants.participants[0]).toEqual({
        firstName: "Ana",
        avatarInitial: "A",
        telegramPhotoUrl: null
      });
      expect(result.participants.participants[1]).not.toHaveProperty("clientId");
      expect(result.participants.waitlist[0]).not.toHaveProperty("fullName");
    });

    it("forbids a hidden training for an unrelated client", async () => {
      trainingsRepo.clientDetail = detailRow({ groupHidden: true });
      trainingsRepo.clientBooking = undefined;
      trainingsRepo.clientWaitlist = undefined;

      await expect(service.getClientDetail(CLIENT_TG, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it("allows a hidden training for an active waitlisted caller and computes waitlist relation", async () => {
      trainingsRepo.clientDetail = detailRow({ groupHidden: true });
      trainingsRepo.clientBooking = undefined;
      trainingsRepo.clientWaitlist = { position: 3 };

      const result = await service.getClientDetail(CLIENT_TG, TRAINING_ID);

      expect(result.viewerRelation).toBe("waitlisted");
      expect(result.bookingStatus).toBeNull();
      expect(result.waitlistPosition).toBe(3);
      expect(result.canCancel).toBe(false);
      expect(result.exportEligible).toBe(false);
    });
  });

  describe("deleteTraining (soft-cancel, admin-only)", () => {
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    const openLock = (over: Partial<TrainingLockRow> = {}): TrainingLockRow => ({
      id: TRAINING_ID,
      capacity: 12,
      bookedCount: 3,
      status: "open",
      trainerId: TRAINER_ID,
      groupId: null,
      clientId: null,
      ...over
    });

    it("rejects a non-admin with 403 and purges nothing", async () => {
      trainingsRepo.lock = openLock();
      await expect(service.deleteTraining(NON_ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
      expect(notifications.sendTrainingCancelled).not.toHaveBeenCalled();
    });

    it("404s a missing training (findForUpdate → undefined) and purges nothing", async () => {
      // No seeded lock and no stored row → findForUpdate returns undefined.
      await expect(service.deleteTraining(ADMIN_ID, TRAINING_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(trainingsRepo.purgeCalls).toEqual([]);
      expect(notifications.sendTrainingCancelled).not.toHaveBeenCalled();
    });

    it("cancels a booked training, notifies the captured clients, and returns {id}", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 3 });
      trainingsRepo.cancelledClientIds = ["client-a", "client-b", "client-c"];
      // Mark notify in the same ordered log so we can assert it runs while court
      // cleanup is in the same transaction.
      notifications.sendTrainingCancelled.mockImplementationOnce(async () => {
        trainingsRepo.purgeCalls.push(`notify:${TRAINING_ID}`);
        return 0;
      });

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      // tx1 cancelled the booked bookings, capturing the affected clientIds.
      expect(trainingsRepo.cancelBookedCalls).toBe(1);
      // Notify ran with the captured clientIds (never against zero rows post-purge).
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(TRAINING_ID, [
        "client-a",
        "client-b",
        "client-c"
      ]);
      // Notify happens after tx1 cancellation (and after booking flips) while the
      // row still exists for FK-safe notification-log writes.
      expect(trainingsRepo.purgeCalls).toEqual([`notify:${TRAINING_ID}`]);
      // The court block keyed by this training is freed (cancelOneInTx + idempotent tx2 delete).
      expect(courtBlocksRepo.deletedTrainingIds).toContain(TRAINING_ID);
      const firstLock = courtBlocksRepo.calls.indexOf("lock:2099-06-01");
      const firstDelete = courtBlocksRepo.calls.indexOf(`deleteAuto:${TRAINING_ID}`);
      expect(firstLock).toBeGreaterThanOrEqual(0);
      expect(firstLock).toBeLessThan(firstDelete);
    });

    it("does not recancel an already-cancelled training and returns {id} (clientIds empty)", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 0, status: "cancelled" });

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      // Already cancelled → cancelOneInTx is skipped (no re-flip of bookings).
      expect(trainingsRepo.cancelBookedCalls).toBe(0);
      // Notify is still called, with no affected clients (idempotent, never 500s).
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(TRAINING_ID, []);
      // No block delete happens because it is already cancelled in this path.
      expect(trainingsRepo.purgeCalls).toEqual([]);
      expect(courtBlocksRepo.calls).toEqual([
        `date:${TRAINING_ID}`,
        "lock:2099-06-01",
        `full-lock:${TRAINING_ID}`
      ]);
    });

    it("completes the delete even when the notification send fails (purge still runs)", async () => {
      trainingsRepo.lock = openLock({ bookedCount: 1 });
      notifications.sendTrainingCancelled.mockRejectedValueOnce(new Error("telegram down"));

      const result = await service.deleteTraining(ADMIN_ID, TRAINING_ID);

      expect(result).toEqual({ id: TRAINING_ID });
      expect(trainingsRepo.cancelBookedCalls).toBe(1);
    });
  });

  describe("changeCapacity (A1 manager console)", () => {
    const TRAINING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    it("flips status to full when new capacity equals bookedCount", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 5,
        status: "open",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      const result = await service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 5 });

      expect(result.capacity).toBe(5);
      expect(result.status).toBe("full");
    });

    it("flips status back to open when capacity is raised above bookedCount", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 5,
        bookedCount: 5,
        status: "full",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      const result = await service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 8 });

      expect(result.capacity).toBe(8);
      expect(result.status).toBe("open");
    });

    it("rejects capacity below bookedCount and leaves the training unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 6,
        status: "open",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 4 })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(trainingsRepo.lock.capacity).toBe(12);
      expect(trainingsRepo.lock.status).toBe("open");
    });

    it("rejects a non-admin with 403 and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "open",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      await expect(
        service.changeCapacity(NON_ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });

    it("404s a missing training", async () => {
      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("409s a cancelled training and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 0,
        status: "cancelled",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });

    it("409s a completed training and leaves capacity unchanged", async () => {
      trainingsRepo.lock = {
        id: TRAINING_ID,
        capacity: 12,
        bookedCount: 3,
        status: "completed",
        trainerId: TRAINER_ID,
        groupId: null,
        clientId: null
      };

      await expect(
        service.changeCapacity(ADMIN_ID, TRAINING_ID, { capacity: 20 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.lock.capacity).toBe(12);
    });
  });

  describe("generationStatus (admin generate-month coverage)", () => {
    // September 2026 (Mon+Wed) has 9 candidate future dates; January 2026 is entirely past.
    const PAST_MONTH = 1;

    beforeEach(() => {
      freezeFutureFixtureToday();
    });

    const statusFor = (over: Partial<Group> = {}) => {
      groupsRepo.activeGroups = [{ ...baseGroup, ...over }];
      return service.generationStatus(ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH });
    };

    it("reports fullyGenerated=false for a group with no trainings for the month", async () => {
      const [item] = await statusFor();
      expect(item).toMatchObject({
        groupId: GROUP_ID,
        groupName: baseGroup.name,
        expected: 9,
        existing: 0,
        fullyGenerated: false
      });
    });

    it("reports fullyGenerated=true once every expected date has a training", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await generate(); // creates all 9 September trainings for the group
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(item).toMatchObject({ expected: 9, existing: 9, fullyGenerated: true });
    });

    it("reports fullyGenerated=false for a partially generated group", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await generate();
      // Drop one generated date so coverage is incomplete.
      trainingsRepo.rows = trainingsRepo.rows.slice(0, -1);
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(item).toMatchObject({ expected: 9, existing: 8, fullyGenerated: false });
    });

    it("reports expected=0 and fullyGenerated=false when no future dates remain", async () => {
      groupsRepo.activeGroups = [baseGroup];
      const [item] = await service.generationStatus(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: PAST_MONTH
      });
      expect(item).toMatchObject({ expected: 0, existing: 0, fullyGenerated: false });
    });

    it("is admin-only", async () => {
      await expect(
        service.generationStatus(NON_ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("auto court blocks (Feature 2 — generateMonth)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const COURT_2 = "c0000000-0000-4000-8000-000000000002";

    beforeEach(() => {
      freezeFutureFixtureToday();
    });

    it("T2 — creates one auto-block per new training on its [start,end) window, reason = group name", async () => {
      const created = await generate(); // 9 trainings (Mon+Wed September 2026)

      expect(courtBlocksRepo.inserted).toHaveLength(created.length);
      for (const block of courtBlocksRepo.inserted) {
        expect(block.startTime).toBe(baseGroup.startTime);
        expect(block.endTime).toBe(baseGroup.endTime);
        expect(block.reason).toBe(baseGroup.name);
        expect(block.groupTrainingId).toBeDefined();
        // Each new training is reservable on a free court (2 courts, distinct dates).
        expect([COURT_1, COURT_2]).toContain(block.courtId);
      }
    });

    it("locks each candidate date in sorted order before idempotency and occupancy reads", async () => {
      const created = await generate();
      const generatedDates = [...new Set(created.map((training) => training.date))].sort();

      expect(courtBlocksRepo.calls.filter((call) => call.startsWith("lock:"))).toEqual(
        generatedDates.map((date) => `lock:${date}`)
      );
      const existingRead = courtBlocksRepo.calls.findIndex((call) => call.startsWith("existing:"));
      const firstOccupancyOrInsert = courtBlocksRepo.calls.findIndex((call) =>
        /^(held|blocks|insert):/.test(call)
      );
      const lastLock = Math.max(
        ...generatedDates.map((date) => courtBlocksRepo.calls.indexOf(`lock:${date}`))
      );
      expect(existingRead).toBeGreaterThanOrEqual(0);
      expect(lastLock).toBeLessThan(existingRead);
      expect(firstOccupancyOrInsert).toBeGreaterThanOrEqual(0);
      expect(lastLock).toBeLessThan(firstOccupancyOrInsert);
    });

    it("locks all candidate dates before re-reading existing dates, including already-generated dates", async () => {
      const existingDate = "2026-09-02";
      trainingsRepo.rows = [
        {
          id: "eeeeeeee-0000-4000-8000-000000000001",
          groupId: GROUP_ID,
          date: existingDate,
          startTime: baseGroup.startTime,
          endTime: baseGroup.endTime,
          trainerId: baseGroup.trainerId,
          clientId: null,
          capacity: baseGroup.capacity,
          bookedCount: 0,
          priceSingleRsd: null,
          status: "open"
        }
      ];

      const created = await generate();

      expect(created.map((training) => training.date)).not.toContain(existingDate);
      expect(courtBlocksRepo.calls.filter((call) => call.startsWith("lock:"))).toContain(
        `lock:${existingDate}`
      );
      const existingRead = courtBlocksRepo.calls.findIndex((call) => call.startsWith("existing:"));
      const existingDateLock = courtBlocksRepo.calls.indexOf(`lock:${existingDate}`);
      expect(existingDateLock).toBeGreaterThanOrEqual(0);
      expect(existingDateLock).toBeLessThan(existingRead);
    });

    it("T3 — uses the preferred court when it is free for the covered slots", async () => {
      await service.generateMonth(ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        courtId: COURT_2
      });

      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_2)).toBe(true);
    });

    it("T3 — falls back to the lowest-numbered free court when the preferred is taken", async () => {
      // Court 2 is occupied for the whole window on every date the read returns.
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_2, startTime: baseGroup.startTime, durationMinutes: 90 }
      ];
      await service.generateMonth(ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        courtId: COURT_2
      });

      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_1)).toBe(true);
    });

    it("treats a pending picked-court hold as busy during generation", async () => {
      courtBlocksRepo.held = [
        {
          courtId: COURT_2,
          startTime: baseGroup.startTime,
          durationMinutes: 90,
          requestId: "pending-picked-court"
        }
      ];

      await service.generateMonth(ADMIN_ID, {
        groupId: GROUP_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        courtId: COURT_2
      });

      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_1)).toBe(true);
    });

    it("T4 — skips the block (no court) when every court is occupied for the slots; never inserts", async () => {
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: baseGroup.startTime, durationMinutes: 90 },
        { courtId: COURT_2, startTime: baseGroup.startTime, durationMinutes: 90 }
      ];
      const created = await generate();

      expect(created).toHaveLength(9);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("T1 — idempotent: a second run creates no trainings and no auto-blocks", async () => {
      await generate();
      const insertedAfterFirst = courtBlocksRepo.inserted.length;
      const second = await generate();

      expect(second).toEqual([]);
      expect(courtBlocksRepo.inserted).toHaveLength(insertedAfterFirst);
    });
  });

  describe("generateMonthForAll (Feature 3)", () => {
    beforeEach(() => {
      freezeFutureFixtureToday();
    });

    it("T6 — iterates active groups and returns per-group summary with blocked + skipped === created", async () => {
      groupsRepo.activeGroups = [baseGroup];
      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });

      expect(result.perGroup).toHaveLength(1);
      const summary = result.perGroup[0];
      expect(summary.groupId).toBe(GROUP_ID);
      expect(summary.created).toBe(9);
      expect(summary.blocked + summary.skipped).toBe(summary.created);
    });

    it("is admin-only", async () => {
      await expect(
        service.generateMonthForAll(NON_ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("T6 — iterates ACTIVE groups only (inactive groups are never listed/processed)", async () => {
      // listActive() is the only source; an inactive group simply isn't returned,
      // so generate-all never creates trainings or blocks for it.
      groupsRepo.activeGroups = [baseGroup];
      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(result.perGroup.map((p) => p.groupId)).toEqual([GROUP_ID]);
    });

    it("T6 — is idempotent across groups: a second generate-all creates no new blocks", async () => {
      groupsRepo.activeGroups = [baseGroup];
      await service.generateMonthForAll(ADMIN_ID, { year: FUTURE_YEAR, month: FUTURE_MONTH });
      const insertedAfterFirst = courtBlocksRepo.inserted.length;

      const again = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });
      expect(courtBlocksRepo.inserted).toHaveLength(insertedAfterFirst);
      // Re-run reports zero new trainings for the already-generated month.
      expect(again.perGroup[0].created).toBe(0);
      expect(again.perGroup[0].blocked).toBe(0);
    });

    it("T5 — two groups sharing a date+window do not both grab the same court (in-run accumulation across the batch)", async () => {
      // Only ONE active court, so the two groups' Monday/Wednesday trainings compete
      // for it on every shared date. The first group to run takes the court for that
      // date; the second sees it busy (the committed block reads back) and is skipped.
      courtBlocksRepo.courts = [{ id: "c0000000-0000-4000-8000-000000000001", number: 1 }];
      const groupA: Group = { ...baseGroup, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "A" };
      const groupB: Group = { ...baseGroup, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "B" };
      groupsRepo.activeGroups = [groupA, groupB];

      const result = await service.generateMonthForAll(ADMIN_ID, {
        year: FUTURE_YEAR,
        month: FUTURE_MONTH
      });

      // For each shared date, at most one block lands on the single court — never two.
      const byDate = new Map<string, number>();
      for (const block of courtBlocksRepo.inserted) {
        byDate.set(block.date, (byDate.get(block.date) ?? 0) + 1);
      }
      expect([...byDate.values()].every((count) => count <= 1)).toBe(true);

      // Per-group invariant still holds: blocked + skipped === created for both groups.
      for (const summary of result.perGroup) {
        expect(summary.blocked + summary.skipped).toBe(summary.created);
      }
      // Group A claimed each date; group B was skipped on those same dates.
      const a = result.perGroup.find((p) => p.groupId === groupA.id)!;
      const b = result.perGroup.find((p) => p.groupId === groupB.id)!;
      expect(a.blocked).toBe(a.created);
      expect(b.skipped).toBe(b.created);
    });
  });

  describe("generateIndividualMonth (1-on-1 month generation)", () => {
    const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
    const TRAINER_ID = "33333333-3333-3333-3333-333333333333";

    const individualClient = (): Client => ({
      id: CLIENT_ID,
      name: "Ивана",
      telegramId: 4242,
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
    });

    const activeTrainer = (over: Partial<Trainer> = {}): Trainer => ({
      id: TRAINER_ID,
      name: "Coach",
      type: "main",
      status: "active",
      telegramId: 555,
      telegramUsername: null,
      language: "ru",
      individualVisible: true,
      ...over
    });

    const input = (
      over: Partial<Parameters<TrainingsService["generateIndividualMonth"]>[1]> = {}
    ): Parameters<TrainingsService["generateIndividualMonth"]>[1] => ({
      clientId: CLIENT_ID,
      trainerId: TRAINER_ID,
      daysOfWeek: [1, 3],
      startTime: "18:00",
      endTime: "19:00",
      year: FUTURE_YEAR,
      month: FUTURE_MONTH,
      priceSingleRsd: 3000,
      ...over
    });

    beforeEach(() => {
      freezeFutureFixtureToday();
      clientsRepo.client = individualClient();
      trainersRepo.trainers = [activeTrainer()];
    });

    it("creates one individual instance per chosen weekday (9 for Mon+Wed September 2026)", async () => {
      const result = await service.generateIndividualMonth(ADMIN_ID, input());
      expect(result.created).toHaveLength(9);
    });

    it("each instance is capacity 1, groupId null, clientId set, priced, and full after the owner booking", async () => {
      const result = await service.generateIndividualMonth(ADMIN_ID, input());
      for (const training of result.created) {
        expect(training.capacity).toBe(1);
        expect(training.groupId).toBeNull();
        expect(training.clientId).toBe(CLIENT_ID);
        expect(training.priceSingleRsd).toBe(3000);
        expect(training.trainerId).toBe(TRAINER_ID);
        expect(training.startTime).toBe("18:00");
        expect(training.endTime).toBe("19:00");
        // The owner booking took the single seat → recomputed full.
        expect(training.bookedCount).toBe(1);
        expect(training.status).toBe("full");
      }
    });

    it("inserts exactly one owner booking per instance, all sharing ONE groupSubscriptionId", async () => {
      const result = await service.generateIndividualMonth(ADMIN_ID, input());
      expect(bookingsRepo.inserted).toHaveLength(9);
      const subscriptionIds = new Set(bookingsRepo.inserted.map((b) => b.groupSubscriptionId));
      expect(subscriptionIds.size).toBe(1);
      expect([...subscriptionIds][0]).toBe(result.groupSubscriptionId);
      for (const booking of bookingsRepo.inserted) {
        expect(booking.clientId).toBe(CLIENT_ID);
        expect(booking.type).toBe("single");
        expect(booking.status).toBe("booked");
        expect(booking.source).toBe("admin");
      }
      // One booking per created instance, on distinct trainings.
      expect(new Set(bookingsRepo.inserted.map((b) => b.trainingId)).size).toBe(9);
    });

    it("does NOT auto-assign a court (no court block inserted)", async () => {
      await service.generateIndividualMonth(ADMIN_ID, input());
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("is idempotent: a second run creates zero duplicate trainings and bookings", async () => {
      const first = await service.generateIndividualMonth(ADMIN_ID, input());
      expect(first.created).toHaveLength(9);
      const bookingsAfterFirst = bookingsRepo.inserted.length;

      const second = await service.generateIndividualMonth(ADMIN_ID, input());
      expect(second.created).toEqual([]);
      // No new trainings and no new owner bookings on the re-run.
      expect(trainingsRepo.rows).toHaveLength(9);
      expect(bookingsRepo.inserted).toHaveLength(bookingsAfterFirst);
    });

    it("locks each client/trainer/date candidate in sorted order before the idempotency read", async () => {
      const result = await service.generateIndividualMonth(ADMIN_ID, input());
      const dates = result.created.map((training) => training.date).sort();

      expect(courtBlocksRepo.calls.filter((call) => call.startsWith("individual-lock:"))).toEqual(
        dates.map((date) => `individual-lock:${CLIENT_ID}:${TRAINER_ID}:${date}`)
      );
      const existingRead = courtBlocksRepo.calls.findIndex((call) =>
        call.startsWith("existing-individual:")
      );
      const lastLock = Math.max(
        ...dates.map((date) =>
          courtBlocksRepo.calls.indexOf(`individual-lock:${CLIENT_ID}:${TRAINER_ID}:${date}`)
        )
      );
      expect(existingRead).toBeGreaterThanOrEqual(0);
      expect(lastLock).toBeLessThan(existingRead);
    });

    it("generated individual trainings never appear in listAvailable (group-null exclusion holds)", async () => {
      await service.generateIndividualMonth(ADMIN_ID, input());
      // The bookable catalogue only ever surfaces grouped slots (the repo requires
      // groupId IS NOT NULL); the in-memory `available` set is untouched here, so the
      // individual rows are structurally absent from the client feed.
      expect(trainingsRepo.available).toEqual([]);
      expect(await service.listAvailable({})).toEqual([]);
    });

    it("skips dates before today, creating only future instances", async () => {
      // Freeze "today" mid-month so only the remaining Mondays/Wednesdays are created.
      freezeMidMonthFixtureToday();
      const result = await service.generateIndividualMonth(ADMIN_ID, input());
      expect(result.created.every((t) => t.date >= "2026-09-15")).toBe(true);
      expect(result.created.length).toBeLessThan(9);
      expect(result.created.length).toBeGreaterThan(0);
    });

    it("404s an unknown client and writes nothing", async () => {
      clientsRepo.client = undefined;
      await expect(service.generateIndividualMonth(ADMIN_ID, input())).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(trainingsRepo.rows).toHaveLength(0);
      expect(bookingsRepo.inserted).toHaveLength(0);
    });

    it("404s an unknown trainer and writes nothing", async () => {
      trainersRepo.trainers = [];
      await expect(service.generateIndividualMonth(ADMIN_ID, input())).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(trainingsRepo.rows).toHaveLength(0);
    });

    it("400s an inactive trainer and writes nothing", async () => {
      trainersRepo.trainers = [activeTrainer({ status: "inactive" })];
      await expect(service.generateIndividualMonth(ADMIN_ID, input())).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(trainingsRepo.rows).toHaveLength(0);
    });

    it("is admin-only: a non-admin is rejected with 403 before any write", async () => {
      await expect(service.generateIndividualMonth(NON_ADMIN_ID, input())).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsRepo.rows).toHaveLength(0);
      expect(bookingsRepo.inserted).toHaveLength(0);
    });
  });

  describe("assignCourt (manual court assignment for an orphan training)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const COURT_2 = "c0000000-0000-4000-8000-000000000002";
    const TRAINING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const orphan = (over: Partial<Training> = {}): Training => ({
      id: TRAINING_ID,
      groupId: GROUP_ID,
      date: "2026-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: baseGroup.trainerId,
      clientId: null,
      capacity: 12,
      bookedCount: 0,
      priceSingleRsd: null,
      status: "open",
      ...over
    });

    it("inserts a block keyed to the training on the requested court when it is free", async () => {
      trainingsRepo.fullLock = orphan();

      const result = await service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });

      expect(result.id).toBe(TRAINING_ID);
      expect(courtBlocksRepo.inserted).toHaveLength(1);
      const block = courtBlocksRepo.inserted[0];
      expect(block.courtId).toBe(COURT_1);
      expect(block.groupTrainingId).toBe(TRAINING_ID);
      expect(block.reason).toBe(baseGroup.name);
      expect(block.startTime).toBe("20:00");
      expect(block.endTime).toBe("21:30");
    });

    it("locks the training date before row lock, occupancy reads, and block insert", async () => {
      trainingsRepo.fullLock = orphan();

      await service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });

      expectCallBefore(courtBlocksRepo.calls, "lock:2026-07-06", `full-lock:${TRAINING_ID}`);
      expectCallBefore(courtBlocksRepo.calls, "lock:2026-07-06", "held:2026-07-06");
      expectCallBefore(courtBlocksRepo.calls, "lock:2026-07-06", "blocks:2026-07-06");
      expectCallBefore(courtBlocksRepo.calls, "lock:2026-07-06", "insert:2026-07-06");
    });

    it("rejects assigning a court held by a pending picked-court request", async () => {
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.held = [
        {
          courtId: COURT_1,
          startTime: "20:00",
          durationMinutes: 90,
          requestId: "pending-picked-court"
        }
      ];

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("rejects with ConflictException when the requested court is taken (chosen-court freeness)", async () => {
      trainingsRepo.fullLock = orphan();
      // The requested court is busy for the whole window; pickCourtForSlots would pick
      // the other court, which !== the requested one → not grantable.
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "20:00", durationMinutes: 90 }
      ];

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("rejects with ConflictException when every covered slot is at the 6-per-slot limit", async () => {
      // Only one active court, already taken → no court can be granted for the slot.
      courtBlocksRepo.courts = [{ id: COURT_1, number: 1 }];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "20:00", durationMinutes: 90 }
      ];

      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("reassigns an existing court block with the locked training time instead of double-assigning", async () => {
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.blockedTrainingIds.add(TRAINING_ID);

      await service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_2 });
      expect(courtBlocksRepo.inserted).toHaveLength(0);
      expect(courtBlocksRepo.updated).toEqual([`${"existing-block"}`]);
      expect(courtBlocksRepo.updatedAssignments).toEqual([
        {
          id: "existing-block",
          input: {
            courtId: COURT_2,
            date: "2026-07-06",
            startTime: "20:00",
            endTime: "21:30"
          }
        }
      ]);
      expect(courtBlocksRepo.calls[courtBlocksRepo.calls.length - 1]).toBe(
        `updateAssignment:existing-block:${COURT_2}:2026-07-06:20:00:21:30`
      );
    });

    it("409s a cancelled training", async () => {
      trainingsRepo.fullLock = orphan({ status: "cancelled" });
      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("404s a missing training", async () => {
      await expect(
        service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("is admin-only", async () => {
      trainingsRepo.fullLock = orphan();
      await expect(
        service.assignCourt(NON_ADMIN_ID, TRAINING_ID, { courtId: COURT_1 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("creates a block for an individual training with a neutral reason", async () => {
      trainingsRepo.fullLock = orphan({ groupId: null, clientId: "11111111-1111-1111-1111-111111111111" });
      await service.assignCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });
      expect(courtBlocksRepo.inserted).toHaveLength(1);
      expect(courtBlocksRepo.inserted[0].reason).toBe("Manual assignment");
    });

    it("updates one training's time and linked court block atomically", async () => {
      trainingsRepo.rows = [orphan()];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.linkedBlocks.set(TRAINING_ID, {
        id: "linked-block",
        courtId: COURT_1,
        date: "2026-07-06",
        startTime: "20:00",
        endTime: "21:30",
        reason: "Existing",
        groupTrainingId: TRAINING_ID
      });

      const result = await service.updateScheduleCourt(ADMIN_ID, TRAINING_ID, {
        startTime: "18:30",
        endTime: "20:00",
        courtId: COURT_2
      });

      expect(result.startTime).toBe("18:30");
      expect(result.endTime).toBe("20:00");
      expect(trainingsRepo.updateTimesIds).toEqual([TRAINING_ID]);
      expect(courtBlocksRepo.updatedAssignments).toEqual([
        {
          id: "linked-block",
          input: {
            courtId: COURT_2,
            date: "2026-07-06",
            startTime: "18:30",
            endTime: "20:00"
          }
        }
      ]);
    });

    it("excludes its own linked auto-block from schedule conflict checks", async () => {
      trainingsRepo.rows = [orphan()];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.linkedBlocks.set(TRAINING_ID, {
        id: "linked-block",
        courtId: COURT_1,
        date: "2026-07-06",
        startTime: "20:00",
        endTime: "21:30",
        reason: "Existing",
        groupTrainingId: TRAINING_ID
      });

      await service.updateScheduleCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });

      expect(courtBlocksRepo.updatedAssignments[0].input).toMatchObject({
        courtId: COURT_1,
        startTime: "20:00",
        endTime: "21:30"
      });
    });

    it("allows end-exclusive adjacent court ranges", async () => {
      trainingsRepo.rows = [orphan()];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.existingBlocks = [
        { id: "other-block", courtId: COURT_1, startTime: "21:30", durationMinutes: 90 }
      ];

      await service.updateScheduleCourt(ADMIN_ID, TRAINING_ID, { courtId: COURT_1 });

      expect(courtBlocksRepo.inserted[0]).toMatchObject({
        courtId: COURT_1,
        startTime: "20:00",
        endTime: "21:30"
      });
    });

    it("rejects an overlapping schedule/court update without mutating time or block", async () => {
      trainingsRepo.rows = [orphan()];
      trainingsRepo.fullLock = orphan();
      courtBlocksRepo.existingBlocks = [
        { id: "other-block", courtId: COURT_1, startTime: "20:30", durationMinutes: 60 }
      ];

      await expect(
        service.updateScheduleCourt(ADMIN_ID, TRAINING_ID, {
          startTime: "20:00",
          endTime: "21:30",
          courtId: COURT_1
        })
      ).rejects.toBeInstanceOf(ConflictException);

      expect(trainingsRepo.updateTimesIds).toHaveLength(0);
      expect(courtBlocksRepo.inserted).toHaveLength(0);
      expect(courtBlocksRepo.updatedAssignments).toHaveLength(0);
    });
  });

  describe("autoAssignOrphans (one-click placement of orphan trainings)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const COURT_2 = "c0000000-0000-4000-8000-000000000002";
    const DATE = "2026-07-06";

    const orphan = (id: string, startTime: string, endTime: string): Training => ({
      id,
      groupId: GROUP_ID,
      date: DATE,
      startTime,
      endTime,
      trainerId: baseGroup.trainerId,
      clientId: null,
      capacity: 12,
      bookedCount: 0,
      priceSingleRsd: null,
      status: "open"
    });

    it("places each orphan on its group's preferred court when free", async () => {
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      trainingsRepo.rows = [
        orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30"),
        orphan("a0000000-0000-4000-8000-000000000002", "10:00", "11:30")
      ];

      const result = await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expect(result).toEqual({ assigned: 2, skipped: 0 });
      expect(courtBlocksRepo.inserted).toHaveLength(2);
      expect(courtBlocksRepo.inserted.every((b) => b.courtId === COURT_1)).toBe(true);
      expect(courtBlocksRepo.inserted.map((b) => b.groupTrainingId).sort()).toEqual(
        trainingsRepo.rows.map((r) => r.id).sort()
      );
    });

    it("locks the target date before occupancy reads and block inserts", async () => {
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      trainingsRepo.rows = [orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30")];

      await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expectCallBefore(courtBlocksRepo.calls, `lock:${DATE}`, `held:${DATE}`);
      expectCallBefore(courtBlocksRepo.calls, `lock:${DATE}`, `blocks:${DATE}`);
      expectCallBefore(courtBlocksRepo.calls, `lock:${DATE}`, `insert:${DATE}`);
    });

    it("auto-assign falls back when the preferred court has a pending picked-court hold", async () => {
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      courtBlocksRepo.held = [
        {
          courtId: COURT_1,
          startTime: "08:00",
          durationMinutes: 90,
          date: DATE,
          requestId: "pending-picked-court"
        }
      ];
      trainingsRepo.rows = [orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30")];

      const result = await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expect(result).toEqual({ assigned: 1, skipped: 0 });
      expect(courtBlocksRepo.inserted[0].courtId).toBe(COURT_2);
    });

    it("falls back to the lowest free court when the preferred one is busy", async () => {
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "08:00", durationMinutes: 90, date: DATE }
      ];
      trainingsRepo.rows = [orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30")];

      const result = await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expect(result).toEqual({ assigned: 1, skipped: 0 });
      expect(courtBlocksRepo.inserted[0].courtId).toBe(COURT_2);
    });

    it("skips an orphan when every court is busy for its slot (6-per-slot limit)", async () => {
      courtBlocksRepo.courts = [{ id: COURT_1, number: 1 }];
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      courtBlocksRepo.existingBlocks = [
        { courtId: COURT_1, startTime: "08:00", durationMinutes: 90, date: DATE }
      ];
      trainingsRepo.rows = [orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30")];

      const result = await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expect(result).toEqual({ assigned: 0, skipped: 1 });
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });

    it("does not place two orphans on the same court/slot (in-run occupancy)", async () => {
      groupsRepo.group = { ...baseGroup, courtId: COURT_1 };
      trainingsRepo.rows = [
        orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30"),
        orphan("a0000000-0000-4000-8000-000000000002", "08:00", "09:30")
      ];

      const result = await service.autoAssignOrphans(ADMIN_ID, { date: DATE });

      expect(result).toEqual({ assigned: 2, skipped: 0 });
      const courts = courtBlocksRepo.inserted.map((b) => b.courtId).sort();
      expect(courts).toEqual([COURT_1, COURT_2]);
    });

    it("is admin-only", async () => {
      trainingsRepo.rows = [orphan("a0000000-0000-4000-8000-000000000001", "08:00", "09:30")];
      await expect(service.autoAssignOrphans(NON_ADMIN_ID, { date: DATE })).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(courtBlocksRepo.inserted).toHaveLength(0);
    });
  });

  describe("cancelFutureTrainingsForGroup (group-delete cascade)", () => {
    const TRAINER_ID = baseGroup.trainerId;
    const future1 = "f1111111-1111-4111-8111-111111111111";
    const future2 = "f2222222-2222-4222-8222-222222222222";
    const past = "f3333333-3333-4333-8333-333333333333";
    const alreadyCancelled = "f4444444-4444-4444-8444-444444444444";

    const row = (over: Partial<Training>): Training => ({
      id: "x",
      groupId: GROUP_ID,
      date: "2099-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_ID,
      clientId: null,
      capacity: 12,
      bookedCount: 0,
      priceSingleRsd: null,
      status: "open",
      ...over
    });

    beforeEach(() => {
      trainingsRepo.rows = [
        row({ id: future1, date: "2099-07-06" }),
        row({ id: future2, date: "2099-07-13" }),
        row({ id: past, date: "2000-01-01" }),
        row({ id: alreadyCancelled, date: "2099-07-20", status: "cancelled" })
      ];
    });

    it("cancels only future non-cancelled trainings, leaving past + already-cancelled untouched", async () => {
      const count = await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);

      expect(count).toBe(2);
      expect(trainingsRepo.markCancelledIds.sort()).toEqual([future1, future2].sort());
      // The past session and the already-cancelled one are never marked again.
      expect(trainingsRepo.markCancelledIds).not.toContain(past);
      expect(trainingsRepo.markCancelledIds).not.toContain(alreadyCancelled);
      // Each cancelled training freed its court and notified its members.
      expect(courtBlocksRepo.deletedTrainingIds.sort()).toEqual([future1, future2].sort());
      for (const [date, id] of [
        ["2099-07-06", future1],
        ["2099-07-13", future2]
      ] as const) {
        expect(courtBlocksRepo.calls.indexOf(`lock:${date}`)).toBeLessThan(
          courtBlocksRepo.calls.indexOf(`full-lock:${id}`)
        );
        expect(courtBlocksRepo.calls.indexOf(`lock:${date}`)).toBeLessThan(
          courtBlocksRepo.calls.indexOf(`deleteAuto:${id}`)
        );
      }
    });

    it("notifies the affected clients per cancelled training after commit", async () => {
      trainingsRepo.cancelledClientIdsByTraining.set(future1, ["client-a"]);
      trainingsRepo.cancelledClientIdsByTraining.set(future2, ["client-b", "client-c"]);

      await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);

      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(future1, ["client-a"]);
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(future2, [
        "client-b",
        "client-c"
      ]);
    });

    it("is admin-only and cancels nothing for a non-admin", async () => {
      await expect(
        service.cancelFutureTrainingsForGroup(NON_ADMIN_ID, GROUP_ID)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainingsRepo.markCancelledIds).toHaveLength(0);
    });

    it("returns 0 when the group has no future non-cancelled trainings", async () => {
      trainingsRepo.rows = [row({ id: past, date: "2000-01-01" })];
      const count = await service.cancelFutureTrainingsForGroup(ADMIN_ID, GROUP_ID);
      expect(count).toBe(0);
    });
  });

  describe("rescheduleTraining (admin time reschedule, part 2)", () => {
    const COURT_1 = "c0000000-0000-4000-8000-000000000001";
    const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
    const TRAINER_ID = baseGroup.trainerId;
    const SUBSCRIPTION_ID = "5b000000-0000-4000-8000-000000000001";
    const NEW_START = "10:00";
    const NEW_END = "11:30";

    // An individual (1-on-1) instance: groupId null, clientId set, capacity 1.
    const individual = (over: Partial<Training>): Training => ({
      id: "10000000-0000-4000-8000-000000000000",
      groupId: null,
      date: "2099-07-06",
      startTime: "18:00",
      endTime: "19:00",
      trainerId: TRAINER_ID,
      clientId: CLIENT_ID,
      capacity: 1,
      bookedCount: 1,
      priceSingleRsd: 3000,
      status: "full",
      ...over
    });

    // An owner booking row in the FakeBookingsRepository's `inserted` log (the shape
    // its subscription reads inspect), linking a training to the series subscription.
    const ownerBooking = (trainingId: string, subscriptionId: string | null) => ({
      clientId: CLIENT_ID,
      trainingId,
      type: "single",
      groupSubscriptionId: subscriptionId,
      status: "booked",
      source: "admin"
    });

    const groupTraining = (over: Partial<Training> = {}): Training => ({
      id: "a0000000-0000-4000-8000-000000000099",
      groupId: GROUP_ID,
      date: "2099-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_ID,
      clientId: null,
      capacity: 12,
      bookedCount: 3,
      priceSingleRsd: null,
      status: "open",
      ...over
    });

    it("/time changes ONLY the target row's start/end; siblings and all bookings are untouched", async () => {
      const targetId = "10000000-0000-4000-8000-000000000001";
      const siblingId = "10000000-0000-4000-8000-000000000002";
      trainingsRepo.rows = [
        individual({ id: targetId, date: "2099-07-06" }),
        individual({ id: siblingId, date: "2099-07-13" })
      ];
      bookingsRepo.inserted = [
        ownerBooking(targetId, SUBSCRIPTION_ID),
        ownerBooking(siblingId, SUBSCRIPTION_ID)
      ];

      const result = (await service.rescheduleTraining(
        ADMIN_ID,
        targetId,
        { startTime: NEW_START, endTime: NEW_END },
        { series: false }
      )) as Training;

      expect(result.id).toBe(targetId);
      expect(result.startTime).toBe(NEW_START);
      expect(result.endTime).toBe(NEW_END);
      // Only the target row was written.
      expect(trainingsRepo.updateTimesIds).toEqual([targetId]);
      // The sibling keeps its original window — the batch is not dropped/moved.
      const sibling = trainingsRepo.rows.find((r) => r.id === siblingId)!;
      expect(sibling.startTime).toBe("18:00");
      expect(sibling.endTime).toBe("19:00");
      // No booking was re-created or cancelled (the reschedule never touches bookings).
      expect(bookingsRepo.inserted).toHaveLength(2);
      expect(bookingsRepo.inserted.every((b) => b.status === "booked")).toBe(true);
    });

    it("/time moves an existing linked court block to the new time and preserves its court", async () => {
      const targetId = "10000000-0000-4000-8000-000000000101";
      trainingsRepo.rows = [individual({ id: targetId, date: "2099-07-06" })];
      courtBlocksRepo.linkedBlocks.set(targetId, {
        id: "block-101",
        courtId: COURT_1,
        date: "2099-07-06",
        startTime: "18:00",
        endTime: "19:00",
        reason: "Manual assignment",
        groupTrainingId: targetId
      });

      await service.rescheduleTraining(
        ADMIN_ID,
        targetId,
        { startTime: NEW_START, endTime: NEW_END },
        { series: false }
      );

      expect(courtBlocksRepo.updatedAssignments).toEqual([
        {
          id: "block-101",
          input: {
            courtId: COURT_1,
            date: "2099-07-06",
            startTime: NEW_START,
            endTime: NEW_END
          }
        }
      ]);
      expect(trainingsRepo.updateTimesIds).toEqual([targetId]);
      expectCallBefore(courtBlocksRepo.calls, "lock:2099-07-06", `full-lock:${targetId}`);
      expectCallBefore(courtBlocksRepo.calls, "lock:2099-07-06", "blocks:2099-07-06");
      expectCallBefore(
        courtBlocksRepo.calls,
        "blocks:2099-07-06",
        `updateAssignment:block-101:${COURT_1}:2099-07-06:${NEW_START}:${NEW_END}`
      );
    });

    it("/time rejects when the linked court is occupied at the new slot and leaves the training time unchanged", async () => {
      const targetId = "10000000-0000-4000-8000-000000000102";
      trainingsRepo.rows = [individual({ id: targetId, date: "2099-07-06" })];
      courtBlocksRepo.linkedBlocks.set(targetId, {
        id: "block-102",
        courtId: COURT_1,
        date: "2099-07-06",
        startTime: "18:00",
        endTime: "19:00",
        reason: "Manual assignment",
        groupTrainingId: targetId
      });
      courtBlocksRepo.existingBlocks = [
        {
          id: "other-block",
          courtId: COURT_1,
          date: "2099-07-06",
          startTime: NEW_START,
          durationMinutes: 90
        }
      ];

      await expect(
        service.rescheduleTraining(
          ADMIN_ID,
          targetId,
          { startTime: NEW_START, endTime: NEW_END },
          { series: false }
        )
      ).rejects.toBeInstanceOf(ConflictException);

      const row = trainingsRepo.rows.find((r) => r.id === targetId)!;
      expect(row.startTime).toBe("18:00");
      expect(row.endTime).toBe("19:00");
      expect(trainingsRepo.updateTimesIds).toEqual([]);
      expect(courtBlocksRepo.updatedAssignments).toEqual([]);
    });

    it("/time-series moves every FUTURE sibling and leaves PAST instances unchanged; bookings intact", async () => {
      const pastId = "10000000-0000-4000-8000-00000000000a";
      const targetId = "10000000-0000-4000-8000-00000000000b";
      const futureId = "10000000-0000-4000-8000-00000000000c";
      const today = new Date().toISOString().slice(0, 10);

      trainingsRepo.rows = [
        individual({ id: pastId, date: "2000-01-01" }),
        individual({ id: targetId, date: addDaysLocal(today, 1) }),
        individual({ id: futureId, date: addDaysLocal(today, 8) })
      ];
      bookingsRepo.inserted = [
        ownerBooking(pastId, SUBSCRIPTION_ID),
        ownerBooking(targetId, SUBSCRIPTION_ID),
        ownerBooking(futureId, SUBSCRIPTION_ID)
      ];

      const result = (await service.rescheduleTraining(
        ADMIN_ID,
        targetId,
        { startTime: NEW_START, endTime: NEW_END },
        { series: true }
      )) as Training[];

      // Both future instances (target + later sibling) were moved, ordered by date.
      expect(result.map((t) => t.id)).toEqual([targetId, futureId]);
      expect(result.every((t) => t.startTime === NEW_START && t.endTime === NEW_END)).toBe(true);
      expect(trainingsRepo.updateTimesIds.sort()).toEqual([targetId, futureId].sort());
      expectCallBefore(courtBlocksRepo.calls, `lock:${addDaysLocal(today, 1)}`, `full-lock:${targetId}`);
      expectCallBefore(courtBlocksRepo.calls, `lock:${addDaysLocal(today, 8)}`, `full-lock:${targetId}`);
      // The PAST instance is never written and keeps its original window (history rule).
      expect(trainingsRepo.updateTimesIds).not.toContain(pastId);
      const pastRow = trainingsRepo.rows.find((r) => r.id === pastId)!;
      expect(pastRow.startTime).toBe("18:00");
      expect(pastRow.endTime).toBe("19:00");
      // No booking was re-created or cancelled across the series move.
      expect(bookingsRepo.inserted).toHaveLength(3);
      expect(bookingsRepo.inserted.every((b) => b.status === "booked")).toBe(true);
    });

    it("/time-series on a one-off individual (no subscription link) moves only itself", async () => {
      const targetId = "10000000-0000-4000-8000-00000000000d";
      trainingsRepo.rows = [individual({ id: targetId, date: "2099-07-06" })];
      bookingsRepo.inserted = [ownerBooking(targetId, null)];

      const result = (await service.rescheduleTraining(
        ADMIN_ID,
        targetId,
        { startTime: NEW_START, endTime: NEW_END },
        { series: true }
      )) as Training[];

      expect(result.map((t) => t.id)).toEqual([targetId]);
      expect(trainingsRepo.updateTimesIds).toEqual([targetId]);
    });

    it("/time-series rejects a GROUP training with 400 and writes nothing", async () => {
      const id = "a0000000-0000-4000-8000-000000000099";
      trainingsRepo.rows = [groupTraining({ id })];

      await expect(
        service.rescheduleTraining(
          ADMIN_ID,
          id,
          { startTime: NEW_START, endTime: NEW_END },
          { series: true }
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(trainingsRepo.updateTimesIds).toEqual([]);
    });

    it("rejects a non-admin with 403 and writes nothing (single and series)", async () => {
      const id = "10000000-0000-4000-8000-00000000000e";
      trainingsRepo.rows = [individual({ id })];

      await expect(
        service.rescheduleTraining(
          NON_ADMIN_ID,
          id,
          { startTime: NEW_START, endTime: NEW_END },
          { series: false }
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.rescheduleTraining(
          NON_ADMIN_ID,
          id,
          { startTime: NEW_START, endTime: NEW_END },
          { series: true }
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trainingsRepo.updateTimesIds).toEqual([]);
    });

    it("404s a missing training", async () => {
      await expect(
        service.rescheduleTraining(
          ADMIN_ID,
          "00000000-0000-0000-0000-000000000000",
          { startTime: NEW_START, endTime: NEW_END },
          { series: false }
        )
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("409s a cancelled training and writes nothing", async () => {
      const id = "10000000-0000-4000-8000-00000000000f";
      trainingsRepo.rows = [individual({ id, status: "cancelled" })];
      await expect(
        service.rescheduleTraining(
          ADMIN_ID,
          id,
          { startTime: NEW_START, endTime: NEW_END },
          { series: false }
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.updateTimesIds).toEqual([]);
    });

    it("409s a completed training and writes nothing", async () => {
      const id = "10000000-0000-4000-8000-000000000010";
      trainingsRepo.rows = [individual({ id, status: "completed" })];
      await expect(
        service.rescheduleTraining(
          ADMIN_ID,
          id,
          { startTime: NEW_START, endTime: NEW_END },
          { series: true }
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(trainingsRepo.updateTimesIds).toEqual([]);
    });
  });

  describe("individual admin price and series delete rules", () => {
    const CLIENT_ID = "c1111111-1111-4111-8111-111111111111";
    const TRAINER_ID = baseGroup.trainerId;
    const SUBSCRIPTION_ID = "5b000000-0000-4000-8000-000000000001";

    const individual = (over: Partial<Training> = {}): Training => ({
      id: "10000000-0000-4000-8000-000000000100",
      groupId: null,
      date: "2099-07-06",
      startTime: "18:00",
      endTime: "19:00",
      trainerId: TRAINER_ID,
      clientId: CLIENT_ID,
      capacity: 1,
      bookedCount: 1,
      priceSingleRsd: 3000,
      status: "full",
      ...over
    });

    const ownerBooking = (trainingId: string, subscriptionId: string | null) => ({
      clientId: CLIENT_ID,
      trainingId,
      type: "single",
      groupSubscriptionId: subscriptionId,
      status: "booked",
      source: "admin"
    });

    const groupTraining = (over: Partial<Training> = {}): Training => ({
      id: "a0000000-0000-4000-8000-000000000199",
      groupId: GROUP_ID,
      date: "2099-07-06",
      startTime: "20:00",
      endTime: "21:30",
      trainerId: TRAINER_ID,
      clientId: null,
      capacity: 12,
      bookedCount: 3,
      priceSingleRsd: null,
      status: "open",
      ...over
    });

    it("updates the price of one individual instance only", async () => {
      const targetId = "10000000-0000-4000-8000-000000000101";
      const siblingId = "10000000-0000-4000-8000-000000000102";
      trainingsRepo.rows = [
        individual({ id: targetId, date: "2099-07-06" }),
        individual({ id: siblingId, date: "2099-07-13" })
      ];
      bookingsRepo.inserted = [
        ownerBooking(targetId, SUBSCRIPTION_ID),
        ownerBooking(siblingId, SUBSCRIPTION_ID)
      ];

      const result = (await service.updateIndividualPrice(
        ADMIN_ID,
        targetId,
        { priceSingleRsd: 3500 },
        { series: false }
      )) as Training;

      expect(result.id).toBe(targetId);
      expect(result.priceSingleRsd).toBe(3500);
      expect(trainingsRepo.updatePriceIds).toEqual([targetId]);
      expect(trainingsRepo.rows.find((row) => row.id === siblingId)?.priceSingleRsd).toBe(3000);
    });

    it("updates the whole future individual series target set and leaves past/terminal siblings untouched", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const pastId = "10000000-0000-4000-8000-000000000103";
      const targetId = "10000000-0000-4000-8000-000000000104";
      const futureId = "10000000-0000-4000-8000-000000000105";
      const completedId = "10000000-0000-4000-8000-000000000106";
      const cancelledId = "10000000-0000-4000-8000-000000000107";
      trainingsRepo.rows = [
        individual({ id: pastId, date: "2000-01-01" }),
        individual({ id: targetId, date: addDaysLocal(today, 1) }),
        individual({ id: futureId, date: addDaysLocal(today, 8) }),
        individual({ id: completedId, date: addDaysLocal(today, 15), status: "completed" }),
        individual({ id: cancelledId, date: addDaysLocal(today, 22), status: "cancelled" })
      ];
      bookingsRepo.inserted = [
        ownerBooking(pastId, SUBSCRIPTION_ID),
        ownerBooking(targetId, SUBSCRIPTION_ID),
        ownerBooking(futureId, SUBSCRIPTION_ID),
        ownerBooking(completedId, SUBSCRIPTION_ID),
        ownerBooking(cancelledId, SUBSCRIPTION_ID)
      ];

      const result = (await service.updateIndividualPrice(
        ADMIN_ID,
        targetId,
        { priceSingleRsd: null },
        { series: true }
      )) as Training[];

      expect(result.map((training) => training.id)).toEqual([targetId, futureId]);
      expect(trainingsRepo.updatePriceIds).toEqual([targetId, futureId]);
      expect(trainingsRepo.rows.find((row) => row.id === pastId)?.priceSingleRsd).toBe(3000);
      expect(trainingsRepo.rows.find((row) => row.id === completedId)?.priceSingleRsd).toBe(3000);
      expect(trainingsRepo.rows.find((row) => row.id === cancelledId)?.priceSingleRsd).toBe(3000);
    });

    it("falls back to only the target for a one-off individual price-series update", async () => {
      const targetId = "10000000-0000-4000-8000-000000000108";
      trainingsRepo.rows = [individual({ id: targetId })];
      bookingsRepo.inserted = [ownerBooking(targetId, null)];

      const result = (await service.updateIndividualPrice(
        ADMIN_ID,
        targetId,
        { priceSingleRsd: 4200 },
        { series: true }
      )) as Training[];

      expect(result.map((training) => training.id)).toEqual([targetId]);
      expect(trainingsRepo.updatePriceIds).toEqual([targetId]);
    });

    it("soft-cancels all future individual series targets and notifies affected clients", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const pastId = "10000000-0000-4000-8000-000000000109";
      const targetId = "10000000-0000-4000-8000-00000000010a";
      const futureId = "10000000-0000-4000-8000-00000000010b";
      trainingsRepo.rows = [
        individual({ id: pastId, date: "2000-01-01" }),
        individual({ id: targetId, date: addDaysLocal(today, 1) }),
        individual({ id: futureId, date: addDaysLocal(today, 8) })
      ];
      bookingsRepo.inserted = [
        ownerBooking(pastId, SUBSCRIPTION_ID),
        ownerBooking(targetId, SUBSCRIPTION_ID),
        ownerBooking(futureId, SUBSCRIPTION_ID)
      ];
      trainingsRepo.cancelledClientIdsByTraining.set(targetId, ["client-a"]);
      trainingsRepo.cancelledClientIdsByTraining.set(futureId, ["client-b", "client-c"]);

      const result = await service.deleteIndividualSeries(ADMIN_ID, targetId);

      expect(result.ids).toEqual([targetId, futureId]);
      expect(trainingsRepo.markCancelledIds).toEqual([targetId, futureId]);
      expect(trainingsRepo.cancelBookedIds).toEqual([targetId, futureId]);
      expect(trainingsRepo.rows.find((row) => row.id === pastId)?.status).toBe("full");
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(targetId, ["client-a"]);
      expect(notifications.sendTrainingCancelled).toHaveBeenCalledWith(futureId, [
        "client-b",
        "client-c"
      ]);
    });

    it("rejects non-admin price and series-delete writes before mutating rows", async () => {
      const targetId = "10000000-0000-4000-8000-00000000010c";
      trainingsRepo.rows = [individual({ id: targetId })];

      await expect(
        service.updateIndividualPrice(
          NON_ADMIN_ID,
          targetId,
          { priceSingleRsd: 3500 },
          { series: false }
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.deleteIndividualSeries(NON_ADMIN_ID, targetId)).rejects.toBeInstanceOf(
        ForbiddenException
      );

      expect(trainingsRepo.updatePriceIds).toEqual([]);
      expect(trainingsRepo.markCancelledIds).toEqual([]);
    });

    it("rejects group/non-individual targets with 400", async () => {
      const targetId = "a0000000-0000-4000-8000-000000000199";
      trainingsRepo.rows = [groupTraining({ id: targetId })];

      await expect(
        service.updateIndividualPrice(
          ADMIN_ID,
          targetId,
          { priceSingleRsd: 3500 },
          { series: false }
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.deleteIndividualSeries(ADMIN_ID, targetId)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(trainingsRepo.updatePriceIds).toEqual([]);
      expect(trainingsRepo.markCancelledIds).toEqual([]);
    });

    it("rejects terminal individual targets with 409", async () => {
      const targetId = "10000000-0000-4000-8000-00000000010d";
      trainingsRepo.rows = [individual({ id: targetId, status: "cancelled" })];

      await expect(
        service.updateIndividualPrice(
          ADMIN_ID,
          targetId,
          { priceSingleRsd: 3500 },
          { series: true }
        )
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.deleteIndividualSeries(ADMIN_ID, targetId)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(trainingsRepo.updatePriceIds).toEqual([]);
      expect(trainingsRepo.markCancelledIds).toEqual([]);
    });

    it("rejects past targets for series price/delete so history is not rewritten", async () => {
      const targetId = "10000000-0000-4000-8000-00000000010e";
      trainingsRepo.rows = [individual({ id: targetId, date: "2000-01-01" })];
      bookingsRepo.inserted = [ownerBooking(targetId, SUBSCRIPTION_ID)];

      await expect(
        service.updateIndividualPrice(
          ADMIN_ID,
          targetId,
          { priceSingleRsd: 3500 },
          { series: true }
        )
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.deleteIndividualSeries(ADMIN_ID, targetId)).rejects.toBeInstanceOf(
        ConflictException
      );

      expect(trainingsRepo.updatePriceIds).toEqual([]);
      expect(trainingsRepo.markCancelledIds).toEqual([]);
      expect(trainingsRepo.rows[0].priceSingleRsd).toBe(3000);
      expect(trainingsRepo.rows[0].status).toBe("full");
    });
  });
});

/** Add whole days to a "YYYY-MM-DD" date (test-local mirror of the service helper). */
function addDaysLocal(isoDate: string, days: number): string {
  const cursor = new Date(`${isoDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
