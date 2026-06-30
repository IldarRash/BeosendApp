# Rule: agent workflow

Detailed companion to `AGENTS.md`. Use for any change beyond a single file.

In Codex, start non-trivial code changes with `prompt-polisher`, then `workflow-agent`, then the
project `planner`. The planner remains the single orchestrator and does not implement.

1. **Plan before code.** The `planner` writes/updates `docs/product/features/<slug>.md`: goal,
   contracts/tables touched, API endpoints, bot flow, acceptance criteria, tests, dependencies, and
   any open question with a chosen default. No implementation until the brief is agreed.
2. **Smallest correct slice.** Prefer a thin vertical slice (contract в†’ service в†’ repo в†’ bot flow в†’
   test) that runs, over a broad half-wired change.
3. **Contracts first**, then DB schema + migration, then services, then bot. Don't wire the bot to a
   contract that doesn't exist yet.
4. **Delegate by role** (see `AGENTS.md`); run backend and bot work in parallel against the agreed
   contracts. For web admin work, `ui-designer` shapes the `apps/admin` design system and
   `frontend-implementer` wires the screens вЂ” same contracts-first rule, and the frontend stays an
   interaction layer (no domain logic, never imports `@beosand/config`). See `.Codex/rules/frontend.md`.
5. **Test the invariant the feature touches**, plus the unsafe/forbidden path.
6. **Verify in the running app.** Done means the flow works in the live bot/API (or, for admin work,
   the running `apps/admin` SPA against the API) вЂ” not "compiles" and not "should work". Report a
   concrete blocker if it doesn't.
7. **Clean up.** Remove superseded paths in the same change; name any remaining legacy in the summary.

Validation gate before declaring done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then
the end-to-end run.

