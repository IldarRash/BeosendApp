# Rule: Zod contracts (packages/types)

- `packages/types` is the contract source of truth, shared by `apps/api` and `apps/bot`. Define each
  entity schema once; derive types with `z.infer`.
- Split request contracts from entity contracts (`createGroupSchema` vs `groupSchema`) using `.pick`
  / `.omit` so they can't drift.
- Put **pure** domain math in `src/helpers.ts` (status recompute, free seats, month dates, court
  price/hours). These must have no Nest/DB imports and must be unit-tested.
- Reuse the shared primitives in `src/common.ts` (`uuid`, `timeString`, `dateString`, `dayOfWeek`,
  `rsd`, `entityStatus`) — don't re-declare regexes/enums per file.
- When adding a field, update the entity schema, the relevant request schema, the DB schema, and a
  migration together. Bump nothing in isolation.
