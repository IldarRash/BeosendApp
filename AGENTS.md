# AGENTS.md - BeoSand project instructions

This repository inherits the global Codex multi-agent workflow from
`C:\Users\ilsac\.codex\AGENTS.md`. Keep this file focused on BeoSand-specific conventions and
overrides.

BeoSand ships its Codex operating layer under `.codex/`. Older mirrors may still exist, but Codex
should prefer `.codex/agents`, `.codex/skills`, and `.codex/rules` whenever multiple versions are
present.

## Project roles

Role agents live in `.codex/agents/*.toml`.

| Agent | BeoSand responsibility |
| --- | --- |
| `prompt-polisher` | Rewrite the raw user request into a clear, complete, implementation-ready prompt without changing intent. |
| `planner` | Clarify scope, pick the smallest correct slice, and write the feature brief under `docs/product/features/<slug>.md`. |
| `analyst` | Analyze BeoSand behavior, edge cases, user flows, acceptance criteria, and product risks. |
| `architect` | Analyze contracts, data model, integrations, migration needs, and split work into agent-ready subtasks. |
| `github-bot` | Create the GitHub issue in the correct project, prepare the implementation worktree, open the pull request, and clean up. |
| `backend-implementer` | Own `apps/api` modules, `packages/types` contracts, and `packages/db` schema/migrations. |
| `bot-implementer` | Own `apps/bot` grammY flows and keyboards that call the API through the typed ApiClient. |
| `ui-designer` | Own visual and UX quality for `apps/admin`: design system, typography, layout, components, and accessibility. |
| `frontend-implementer` | Own `apps/admin` React+Vite screens, typed ApiClient calls, data hooks, and rendering validated data. |
| `test-writer` | Own Vitest unit/integration tests for changed services, helpers, contracts, and invariants. |
| `reviewer` | Review correctness, cleanliness, and BeoSand invariants before security review. |
| `security-reviewer` | Review authz (`telegram_id` ownership/role), input validation, secrets, money, and availability integrity. |
| `app-runner` | Run API, bot, and DB, then confirm the feature works end to end. |

## Project workflow rules

- Feature planning reads the polished prompt plus `docs/architecture/*`.
- Feature briefs live in `docs/product/features/<slug>.md` and must include goal, contracts/tables
  touched, API endpoints, bot flow, acceptance criteria, tests, and dependencies.
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

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green across all workspaces, including
  `@beosand/admin`.
- Behavior is verified in the running app, or a precise blocker and next owner are documented.
- The GitHub issue exists in the correct project, and the pull request is opened from the intended
  branch.
- Temporary worktrees and unnecessary feature docs are removed.
- Superseded code is removed; any remaining legacy path is named in the summary.
- The feature brief's acceptance criteria are all met.
