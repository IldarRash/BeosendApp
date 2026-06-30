---
name: frontend-implementation
description: Implement an apps/admin screen (React+Vite) вЂ” a typed ApiClient method, a data hook, and components built on the design system вЂ” that calls apps/api and renders validated data. Use when adding or changing what the admin/manager sees on the web.
---

# Frontend implementation

Wire one admin-console screen to the API. The console renders and routes; it never owns domain logic,
money, or availability.

## Steps

1. Read the feature brief and `docs/product/features/admin-manager-console.md`. Identify the screen,
   the data it shows, and the admin action(s) it triggers.
2. **Contract** вЂ” reuse (or, with the backend, add) the matching `packages/types` schema. The frontend
   never invents a shape the API doesn't return.
3. **ApiClient** вЂ” add a typed method in `apps/admin/src/api/client.ts`; parse the response with the
   contract (`schema.parse`) before returning. Read the base URL from `import.meta.env.VITE_API_URL`.
4. **Data** вЂ” a small hook/state that calls the client, with loading/error states. No business rules;
   just fetch, validate, render.
5. **UI** вЂ” compose `apps/admin/src/ui/*` design-system components (don't fork styles). RU strings;
   RSD via the shared formatter; never render a court number for a pending request.
6. **Gate** вЂ” admin-only; rely on the API (and future admin auth) for authorization, never the client.
7. **Tests** вЂ” unit-test render/validation logic and the unsafe path (malformed response rejected by
   the contract).

## Conventions

Follow `.Codex/rules/frontend.md`. No domain logic, DB access, or money math in `apps/admin`, and
never import `@beosand/config` (server secrets) into the browser bundle. Design quality comes from the
`ui-designer` + `frontend-design` skill.

## Done

`pnpm --filter @beosand/admin typecheck lint test build` green; render/validation covered by tests; the
screen works against a running API (use the `app-runner` / `run` skill).

