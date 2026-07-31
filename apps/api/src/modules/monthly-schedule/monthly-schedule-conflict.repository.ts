import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, tables, type Database } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

export interface PlannerResourceRow {
  groupId: string;
  groupStatus: "active" | "inactive";
  groupHidden: boolean;
  levelStatus: "active" | "inactive";
  trainerId: string;
  trainerStatus: "active" | "inactive";
  preferredCourtId: string | null;
  preferredCourtStatus: "active" | "inactive" | null;
}

export interface PlannerExistingTrainingRow {
  id: string;
  monthlyScheduleEntryId: string | null;
  groupId: string | null;
  trainerId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "open" | "full" | "cancelled" | "completed";
}

export interface PlannerOccupancyRow {
  source: "request-pending" | "request-confirmed" | "manual-block" | "training-block";
  id: string;
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  groupTrainingId: string | null;
}

export interface PlannerCourtRow {
  id: string;
  number: number;
  status: "active" | "inactive";
}

export interface MonthlyScheduleConflictContext {
  resources: PlannerResourceRow[];
  courts: PlannerCourtRow[];
  trainings: PlannerExistingTrainingRow[];
  occupancy: PlannerOccupancyRow[];
}

@Injectable()
export class MonthlyScheduleConflictRepository {
  constructor(private readonly database: DatabaseService) {}

  async load(planId: string, from: string, to: string, db: Database = this.database.db): Promise<MonthlyScheduleConflictContext> {
    const [resources, courts, trainings, requests, blocks] = await Promise.all([
      db
        .select({
          groupId: tables.monthlyScheduleTemplates.groupId,
          groupStatus: tables.groups.status,
          groupHidden: tables.groups.hidden,
          levelStatus: tables.levels.status,
          trainerId: tables.monthlyScheduleTemplates.trainerId,
          trainerStatus: tables.trainers.status,
          preferredCourtId: tables.monthlyScheduleTemplates.preferredCourtId,
          preferredCourtStatus: tables.courts.status
        })
        .from(tables.monthlyScheduleTemplates)
        .innerJoin(tables.groups, eq(tables.monthlyScheduleTemplates.groupId, tables.groups.id))
        .innerJoin(tables.levels, eq(tables.groups.levelId, tables.levels.id))
        .innerJoin(tables.trainers, eq(tables.monthlyScheduleTemplates.trainerId, tables.trainers.id))
        .leftJoin(tables.courts, eq(tables.monthlyScheduleTemplates.preferredCourtId, tables.courts.id))
        .where(eq(tables.monthlyScheduleTemplates.planId, planId)),
      db
        .select({ id: tables.courts.id, number: tables.courts.number, status: tables.courts.status })
        .from(tables.courts)
        .orderBy(asc(tables.courts.number)),
      db
        .select({
          id: tables.trainings.id,
          monthlyScheduleEntryId: tables.trainings.monthlyScheduleEntryId,
          groupId: tables.trainings.groupId,
          trainerId: tables.trainings.trainerId,
          date: tables.trainings.date,
          startTime: tables.trainings.startTime,
          endTime: tables.trainings.endTime,
          status: tables.trainings.status
        })
        .from(tables.trainings)
        .where(and(gte(tables.trainings.date, from), lte(tables.trainings.date, to)))
        .orderBy(asc(tables.trainings.date), asc(tables.trainings.startTime)),
      db
        .select({
          id: tables.courtRequests.id,
          courtId: tables.courtRequestCourts.courtId,
          date: tables.courtRequests.date,
          startTime: tables.courtRequests.startTime,
          durationHours: tables.courtRequests.durationHours,
          status: tables.courtRequests.status
        })
        .from(tables.courtRequestCourts)
        .innerJoin(tables.courtRequests, eq(tables.courtRequestCourts.requestId, tables.courtRequests.id))
        .where(and(gte(tables.courtRequests.date, from), lte(tables.courtRequests.date, to)))
        .orderBy(asc(tables.courtRequests.date), asc(tables.courtRequests.startTime)),
      db
        .select({
          id: tables.courtBlocks.id,
          courtId: tables.courtBlocks.courtId,
          date: tables.courtBlocks.date,
          startTime: tables.courtBlocks.startTime,
          endTime: tables.courtBlocks.endTime,
          groupTrainingId: tables.courtBlocks.groupTrainingId
        })
        .from(tables.courtBlocks)
        .where(and(gte(tables.courtBlocks.date, from), lte(tables.courtBlocks.date, to)))
        .orderBy(asc(tables.courtBlocks.date), asc(tables.courtBlocks.startTime))
    ]);

    return {
      resources,
      courts,
      trainings: trainings.map((row) => ({ ...row, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) })),
      occupancy: [
        ...requests
          .filter((row) => row.status === "pending" || row.status === "confirmed")
          .map((row): PlannerOccupancyRow => ({
            source: row.status === "pending" ? "request-pending" : "request-confirmed",
            id: row.id,
            courtId: row.courtId,
            date: row.date,
            startTime: row.startTime.slice(0, 5),
            endTime: addHours(row.startTime, Number(row.durationHours)),
            groupTrainingId: null
          })),
        ...blocks.map((row): PlannerOccupancyRow => ({
            source: row.groupTrainingId === null ? "manual-block" : "training-block",
            id: row.id,
            courtId: row.courtId,
            date: row.date,
            startTime: row.startTime.slice(0, 5),
            endTime: row.endTime.slice(0, 5),
            groupTrainingId: row.groupTrainingId
          }))
      ]
    };
  }
}

function addHours(startTime: string, hours: number): string {
  const [hour, minute] = startTime.slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + Math.round(hours * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
