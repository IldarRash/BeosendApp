import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { courts, levels, trainers, trainingPricingTiers } from "./schema";

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
    .onConflictDoNothing({ target: courts.number });

  await db
    .insert(trainingPricingTiers)
    .values([
      {
        label: "1-3 trainings",
        minTrainings: 1,
        maxTrainings: 3,
        pricePerTrainingRsd: 1500,
        sortOrder: 0
      },
      {
        label: "4-7 trainings",
        minTrainings: 4,
        maxTrainings: 7,
        pricePerTrainingRsd: 1400,
        sortOrder: 1
      },
      {
        label: "8-11 trainings",
        minTrainings: 8,
        maxTrainings: 11,
        pricePerTrainingRsd: 1300,
        sortOrder: 2
      },
      {
        label: "12+ trainings",
        minTrainings: 12,
        maxTrainings: null,
        pricePerTrainingRsd: 1200,
        sortOrder: 3
      }
    ])
    .onConflictDoNothing({ target: trainingPricingTiers.minTrainings });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(courts);
  const [{ tierCount }] = await db
    .select({ tierCount: sql<number>`count(*)::int` })
    .from(trainingPricingTiers);
  console.log(`✓ seeded reference data (courts: ${count}, pricing tiers: ${tierCount})`);

  await pool.end();
}

main().catch((error) => {
  console.error("seed failed", error);
  process.exit(1);
});
