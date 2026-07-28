# Rule: agent workflow

Detailed companion to `AGENTS.md`. Use for any change beyond a single file. Inherit the global
pre-plan clarification state machine; local planning starts only after it produces a
`ready_for_planner` package. Do not add a separate local role sequence or workflow agent.

1. **Plan before code.** The `planner` writes/updates `docs/product/features/<slug>.md`: goal,
   contracts/tables touched, API endpoints, bot flow, acceptance criteria, tests, dependencies, and
   resolved decisions and supported assumptions. The planner presents the brief and asks whether to
   run the full agent flow. If a new material ambiguity appears, return it through the retained
   prompt-polisher and analyst handles before continuing. The planner does not start the analyst,
   architect, implementers, or any other later-flow role. No implementation until the brief is
   agreed and the required approvals are complete.
2. **Smallest correct slice.** Prefer a thin vertical slice (contract -> service -> repo -> bot flow
   -> test) that runs, over a broad half-wired change.
3. **Contracts first**, then DB schema + migration, then services, then bot. Don't wire the bot to a
   contract that doesn't exist yet.
4. **Delegate by role after approval** (see `AGENTS.md`); the root agent starts later-flow roles only
   after the global approval gates. Run backend and bot work in parallel against the agreed
   contracts. For web admin work, `ui-designer` shapes the `apps/admin` design system and
   `frontend-implementer` wires the screens - same contracts-first rule, and the frontend stays an
   interaction layer (no domain logic, never imports `@beosand/config`). See `.codex/rules/frontend.md`.
5. **Test the invariant the feature touches**, plus the unsafe/forbidden path.
6. **Verify in the running app.** Done means the flow works in the live bot/API (or, for admin work,
   the running `apps/admin` SPA against the API) - not "compiles" and not "should work". Report a
   concrete blocker if it doesn't.
7. **Clean up.** Remove superseded paths in the same change; name any remaining legacy in the summary.

Validation gate before declaring done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then
the end-to-end run.
