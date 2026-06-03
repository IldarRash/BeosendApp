import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { courts, levels, trainers } from "./schema";

/** Seed reference data: levels, a couple of trainers, and the 6 courts. */
async function main(): Promise<void> {
  const { db, pool } = createDb();

  await db
    .insert(levels)
    .values([{ name: "Beginner" }, { name: "Intermediate" }, { name: "Advanced" }])
    .onConflictDoNothing();

  await db
    .insert(trainers)
    .values([
      { name: "Milena", type: "main" },
      { name: "Danilo", type: "main" }
    ])
    .onConflictDoNothing();

  await db
    .insert(courts)
    .values(Array.from({ length: 6 }, (_, i) => ({ number: i + 1 })))
    .onConflictDoNothing();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(courts);
  console.log(`✓ seeded reference data (courts: ${count})`);

  await pool.end();
}

main().catch((error) => {
  console.error("seed failed", error);
  process.exit(1);
});
