import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

async function main(): Promise<void> {
  const { db, pool } = createDb();
  await migrate(db, { migrationsFolder: join(__dirname, "..", "drizzle") });
  await pool.end();
  console.log("✓ migrations applied");
}

main().catch((error) => {
  console.error("migration failed", error);
  process.exit(1);
});
