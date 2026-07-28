---
name: feature-planning
description: Turn a spec slice into an agreed, implementable feature brief under docs/product/features before any code is written. Use at the planning stage of any non-trivial BeoSand feature after pre-plan clarification is complete.
---

# Feature planning

Produce a brief precise enough that backend/bot/test work can proceed without further product
questions. Start only from the global `ready_for_planner` package containing the final polished
request, completed analysis, and resolved material questions.

## Steps

1. Confirm the ready-for-planner package has no unresolved material questions. Locate the slice in
   `docs/product/feature-roadmap.md` and the underlying spec section(s). Read the relevant
   `docs/architecture/*`.
2. Identify the **smallest correct slice** that delivers user value end to end.
3. Write/replace `docs/product/features/<slug>.md` with:
   - **Goal** - one or two sentences.
   - **Spec refs** - which product/UX sections it implements.
   - **Contracts & tables** - schemas in `packages/types` and tables in `packages/db` touched.
   - **API** - endpoints (method, path, request/response contract).
   - **Bot flow** - screens, buttons, the 2-3 tap path.
   - **Invariants** - which product invariants apply and how they're enforced.
   - **Acceptance criteria** - observable, testable bullet points.
   - **Tests** - the cases to cover, including the unsafe/forbidden path.
   - **Dependencies** - other features that must land first.
   - **Decisions & assumptions** - resolved product decisions and any safe, evidence-supported
     assumptions used by the plan.
4. If a new material ambiguity appears, stop and return it through the retained prompt-polisher and
   analyst handles. Resume only when the refreshed package is ready; do not start the analyst,
   architect, implementers, or other later-flow roles from the planner.
5. Present the completed brief and explicitly ask whether to run the full agent flow.

## Done

The brief exists, dependencies are explicit, no material question is unresolved, and every recorded
assumption is safe and supported by the request, completed analysis, repository evidence, or existing
product rules.
