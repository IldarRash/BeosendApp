# Rule: Drizzle schema & migrations

- `packages/db/src/schema.ts` is the **only** place the schema lives. `apps/api` reads it via
  `@beosand/db`; nothing else defines tables.
- After any schema change: `pnpm --filter @beosand/db db:generate` to produce a migration under
  `packages/db/drizzle/`. **Commit the generated SQL** with the schema change. Never hand-edit
  applied migrations; add a new one.
- Apply with `pnpm db:migrate`. Seeds (`pnpm db:seed`) are idempotent (`onConflictDoNothing`).
- Keep `packages/db` schema and `packages/types` contracts in lockstep — same fields, same enum
  values, same names. A field exists in both or neither.
- Money columns are integer RSD. Times are `time`, dates are `date`, timestamps are `timestamptz`.
- Never overwrite active plan state in place: a changed/cancelled training keeps its row and status;
  bookings move through statuses (`booked → cancelled/attended/no_show`) rather than being deleted.
