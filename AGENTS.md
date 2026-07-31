# AGENTS.md - BeoSand project instructions

This repository inherits global Codex workflow and generic roles. Keep this file limited to
BeoSand paths, commands, and product invariants.

## Local layout and implementation ownership

- Repo skills live in `.agents/skills`; do not duplicate them under `.codex/skills`.
- Local implementation roles live in `.codex/agents`; generic planning, review, test, runtime,
  diagnostic, and GitHub roles are provided globally.
- Project rules and local configuration live in `.codex/rules` and `.codex/config.toml`.

| Local role | BeoSand ownership |
| --- | --- |
| `backend-implementer` | `apps/api`, `packages/types` contracts, and `packages/db` schema/migrations. |
| `bot-implementer` | `apps/bot` grammY flows and typed ApiClient integration. |
| `ui-designer` | `apps/admin` visual system, typography, layout, components, and accessibility. |
| `frontend-implementer` | `apps/admin` React+Vite screens, typed ApiClient calls, hooks, and validated rendering. |

## Planning artifact

- The global planner receives only a global `ready` handoff. It uses `.agents/skills/feature-planning`
  to create `docs/product/features/<slug>.md` from the relevant roadmap, architecture, and product
  evidence.
- A BeoSand brief records goal, spec references, contracts/tables, API, bot flow, invariants,
  acceptance criteria, tests, dependencies, and supported decisions/assumptions.
- A material ambiguity returns to the global clarification workflow. Local planning does not define
  a second workflow or approval gate.
- Contracts are the source of truth: add or adjust Zod contracts in `packages/types` and schema in
  `packages/db` before wiring services.
- Backend owns domain decisions, recompute, money, and availability.
- Bot and admin must only render state and call the API; no domain logic belongs in `apps/bot` or
  `apps/admin`.
- For external handoff/export UX (calendar export, file downloads, OAuth, deep links, feed
  subscriptions), always ask the user first which UX/format is preferred instead of choosing by
  default.
- Cover the invariant touched by the feature, such as capacity recompute, status flip, monthly
  batch, single-date cancel, or six-per-hour limits.

## Definition of done

- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` across all workspaces, including
  `@beosand/admin`.
- Verify changed behavior in the running API, bot, or admin app, or document the exact blocker and
  next owner.
- Meet the feature brief's acceptance criteria; remove superseded code or name any remaining legacy
  path in the handoff.
