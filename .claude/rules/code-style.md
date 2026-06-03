# Rule: code style

- TypeScript everywhere, `strict` on. No `any` (lint warns; warnings fail `--max-warnings=0`). Prefer
  precise types and Zod-inferred types from `packages/types`.
- Match the surrounding code's naming and idioms. `camelCase` for values, `PascalCase` for types and
  Nest classes, `kebab-case` file names (`court-requests.service.ts`).
- Keep functions small and single-purpose. Pure domain math goes in `packages/types/src/helpers.ts`
  so it is unit-testable without Nest or a DB.
- No `console.log` in committed library/service code; use Nest's `Logger`. Bootstraps and scripts may
  log to stdout.
- Comments explain *why*, not *what*. Don't restate the code.
- Format with Prettier (`pnpm format`); don't hand-fight the formatter.
