# Rule: NestJS layering (apps/api)

One module per domain under `apps/api/src/modules/<domain>/`. Within a module:

- **Controller** — thin. Parse/validate the request with a Zod contract, call one service method,
  map the result to the response. No domain logic, no DB.
- **Service** — owns domain logic: validation beyond schema, ownership checks, capacity/status
  recompute, money/availability, status transitions, orchestration across repositories. All the
  product invariants live here, never in the bot or a controller.
- **Repository** — the only place that touches Drizzle/`DatabaseService`. Returns typed rows; no
  business rules.

Other conventions:

- Validate every input with a `packages/types` schema at the controller boundary; validate every
  value the bot will render with the matching contract before returning it.
- Throw typed Nest exceptions (`BadRequestException`, `ConflictException`, `ForbiddenException`,
  `NotFoundException`). Never swallow errors or return `null` to mean "failed".
- Wrap multi-write operations (e.g. monthly-batch booking, booking + recompute) in a transaction.
- Get the DB handle from `DatabaseService` (injected); don't create new pools.
