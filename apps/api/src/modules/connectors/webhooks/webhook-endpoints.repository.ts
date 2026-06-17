import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { type Database, tables } from "@beosand/db";
import type { DomainEventType, EntityStatus } from "@beosand/types";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../../db/database.service";

type EndpointRow = typeof tables.webhookEndpoints.$inferSelect;

/**
 * A webhook endpoint row INCLUDING the secret. The repository may read the secret to
 * sign a delivery; the service/controller layer maps to the `secret`-less contract
 * before anything leaves the API. Callers must never echo `secret` to a client.
 */
export interface EndpointWithSecret {
  id: string;
  url: string;
  secret: string;
  events: DomainEventType[];
  status: EntityStatus;
  createdAt: string;
  createdBy: number | null;
}

/** Bytes of entropy for a generated endpoint secret (256-bit, hex-encoded). */
const SECRET_BYTES = 32;

/**
 * Only place webhook-endpoint DB access lives (connectors §6). Returns typed rows;
 * no business rules — the service owns the admin gate and contract mapping. Reads
 * include the secret so the dispatcher can sign; the secret never leaves this layer
 * except in the one-time create response the service constructs.
 */
@Injectable()
export class WebhookEndpointsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Insert an endpoint with a freshly generated secret. Returns the full row so the
   * service can surface the secret exactly once. `events` is stored verbatim (a
   * subset of the domain-event enum, validated upstream).
   */
  async create(
    values: { url: string; events: DomainEventType[]; createdBy: number | null },
    tx: Database = this.database.db
  ): Promise<EndpointWithSecret> {
    const secret = randomBytes(SECRET_BYTES).toString("hex");
    const [row] = await tx
      .insert(tables.webhookEndpoints)
      .values({
        url: values.url,
        secret,
        events: values.events,
        createdBy: values.createdBy
      })
      .returning();
    return toEndpoint(row);
  }

  /** Every endpoint (active + inactive), newest first. Includes the secret. */
  async findAll(tx: Database = this.database.db): Promise<EndpointWithSecret[]> {
    const rows = await tx
      .select()
      .from(tables.webhookEndpoints)
      .orderBy(sql`${tables.webhookEndpoints.createdAt} desc`);
    return rows.map(toEndpoint);
  }

  /** One endpoint by id, or undefined. Includes the secret. */
  async findById(
    id: string,
    tx: Database = this.database.db
  ): Promise<EndpointWithSecret | undefined> {
    const [row] = await tx
      .select()
      .from(tables.webhookEndpoints)
      .where(eq(tables.webhookEndpoints.id, id))
      .limit(1);
    return row ? toEndpoint(row) : undefined;
  }

  /**
   * Active endpoints subscribed to `eventType`. The dispatcher loads these on a fired
   * event; the `events` array-contains filter keeps the subscription check in the DB.
   */
  async findActiveForEvent(
    eventType: DomainEventType,
    tx: Database = this.database.db
  ): Promise<EndpointWithSecret[]> {
    const rows = await tx
      .select()
      .from(tables.webhookEndpoints)
      .where(
        and(
          eq(tables.webhookEndpoints.status, "active"),
          sql`${tables.webhookEndpoints.events} @> ARRAY[${eventType}]::text[]`
        )
      );
    return rows.map(toEndpoint);
  }

  /**
   * Apply an admin patch (events and/or status). Only provided keys are written.
   * Returns the updated row, or undefined if no endpoint has that id.
   */
  async updateById(
    id: string,
    patch: { events?: DomainEventType[]; status?: EntityStatus },
    tx: Database = this.database.db
  ): Promise<EndpointWithSecret | undefined> {
    const [row] = await tx
      .update(tables.webhookEndpoints)
      .set(patch)
      .where(eq(tables.webhookEndpoints.id, id))
      .returning();
    return row ? toEndpoint(row) : undefined;
  }
}

/** `events` is a free-text array column; the upstream contract constrains its values. */
function toEndpoint(row: EndpointRow): EndpointWithSecret {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: row.events as DomainEventType[],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy
  };
}
