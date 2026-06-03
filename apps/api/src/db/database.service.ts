import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { createDb, type Database } from "@beosand/db";
import { ENV } from "../config/config.module";

/**
 * Owns the single Drizzle connection pool for the API process.
 * Repositories receive `db` from here; the pool is closed on shutdown.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly conn: ReturnType<typeof createDb>;

  constructor(@Inject(ENV) env: Env) {
    this.conn = createDb(env.DATABASE_URL);
  }

  get db(): Database {
    return this.conn.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.conn.pool.end();
  }
}
