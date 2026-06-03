import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to create a database connection");
  }
  return url;
}

/** Create a pooled Drizzle client. Callers own the returned pool's lifecycle. */
export function createDb(connectionString: string = requireDatabaseUrl()): {
  db: Database;
  pool: Pool;
} {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
