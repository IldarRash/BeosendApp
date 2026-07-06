---
name: feature-planning
description: Turn a spec slice into an agreed, implementable feature brief at docs/product/features/<slug>.md before any code is written. Use at the start of any non-trivial BeoSand feature.
---

# Feature planning

Produce a brief precise enough that backend/bot/test work can proceed without further questions.

## Steps

1. Locate the slice in `docs/product/feature-roadmap.md` and the underlying spec section(s). Read the
   relevant `docs/architecture/*`.
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
   - **Open questions** - each with a chosen default.
4. Resolve open questions with the user when they change the design; otherwise pick a sensible default
   and record it.

## Done

The brief exists, dependencies are explicit, and every open question has a decision.
