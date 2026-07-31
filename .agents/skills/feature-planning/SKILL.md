---
name: feature-planning
description: Turn a globally ready BeoSand request into an implementation-ready brief under docs/product/features. Use when a Factory plan needs a repository-specific artifact before implementation.
---

# Feature planning

Produce a brief precise enough for the selected global roles to proceed without further product
questions. Start only from the global `ready` package containing the objective, facts, author
decisions, assumptions, open protected decisions, and completed clarification where applicable.

## Steps

1. Confirm the `ready` package has no unresolved material questions. Locate the slice in
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
4. If a new material ambiguity appears, stop and return it to the global clarification workflow.
   Resume only after a refreshed `ready` package; do not start or sequence global roles.
5. Present the completed brief and selected-role handoff. Factory authorization and protected-action
   approval remain global; do not request a second broad implementation approval.

## Done

The brief exists, dependencies are explicit, no material question is unresolved, and every recorded
assumption is safe and supported by the request, completed analysis, repository evidence, or existing
product rules.
