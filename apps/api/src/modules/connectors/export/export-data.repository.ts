import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import { desc, eq } from "drizzle-orm";
import { DatabaseService } from "../../../db/database.service";

/** One client row for the clients export (the columns a manager wants in a sheet). */
export interface ClientExportRow {
  id: string;
  name: string;
  telegramId: number | null;
  telegramUsername: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  status: string;
  registeredAt: string;
}

/** One booking row, joined to client + training, for the bookings export. */
export interface BookingExportRow {
  id: string;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  status: string;
  paymentStatus: string;
  priceRsd: number;
  createdAt: string;
}

/** Cap the export so an unbounded table can't be streamed in one request. */
const EXPORT_LIMIT = 5000;

/**
 * Read-only access for the clients/bookings exports (connectors §6, Slice C). Both the
 * CSV and the Google Sheets export read the same rows from here — the only place these
 * export queries touch Drizzle. No business rules; money is the server-stored RSD
 * integer (per-single price from the booking's group), rendered downstream as whole
 * dinars.
 */
@Injectable()
export class ExportDataRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Every client, newest first (capped). */
  async findClients(tx: Database = this.database.db): Promise<ClientExportRow[]> {
    const rows = await tx
      .select({
        id: tables.clients.id,
        name: tables.clients.name,
        telegramId: tables.clients.telegramId,
        telegramUsername: tables.clients.telegramUsername,
        phone: tables.clients.phone,
        email: tables.clients.email,
        source: tables.clients.source,
        status: tables.clients.status,
        registeredAt: tables.clients.registeredAt
      })
      .from(tables.clients)
      .orderBy(desc(tables.clients.registeredAt))
      .limit(EXPORT_LIMIT);
    return rows.map((row) => ({
      ...row,
      registeredAt: row.registeredAt.toISOString()
    }));
  }

  /**
   * Every booking joined to its client + training, newest first (capped). The single
   * price comes from the training's group (left-joined; ad-hoc trainings have no group
   * and so no price → 0).
   */
  async findBookings(tx: Database = this.database.db): Promise<BookingExportRow[]> {
    const rows = await tx
      .select({
        id: tables.bookings.id,
        clientName: tables.clients.name,
        date: tables.trainings.date,
        startTime: tables.trainings.startTime,
        endTime: tables.trainings.endTime,
        type: tables.bookings.type,
        status: tables.bookings.status,
        paymentStatus: tables.bookings.paymentStatus,
        priceSingleRsd: tables.groups.priceSingleRsd,
        createdAt: tables.bookings.createdAt
      })
      .from(tables.bookings)
      .innerJoin(tables.clients, eq(tables.bookings.clientId, tables.clients.id))
      .innerJoin(tables.trainings, eq(tables.bookings.trainingId, tables.trainings.id))
      .leftJoin(tables.groups, eq(tables.trainings.groupId, tables.groups.id))
      .orderBy(desc(tables.bookings.createdAt))
      .limit(EXPORT_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      clientName: row.clientName,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      type: row.type,
      status: row.status,
      paymentStatus: row.paymentStatus,
      priceRsd: row.priceSingleRsd ?? 0,
      createdAt: row.createdAt.toISOString()
    }));
  }
}
