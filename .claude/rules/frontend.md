# Rule: frontend (apps/admin)

The web admin console (`apps/admin`, React + Vite) is the manager/admin counterpart to the bot. Like
the bot, it is an **interaction layer** over `apps/api` — it never owns domain truth.

- **No domain logic in the frontend.** No money, availability, capacity, or status math. The console
  fetches decided values from the API and renders them.
- **Validate everything the UI renders** against a `packages/types` contract in the `ApiClient`
  (`apps/admin/src/api/client.ts`) before use. Reuse contracts/helpers; never redeclare schemas.
- **Config via `import.meta.env` (`VITE_*`) only.** Never import `@beosand/config` into the browser:
  it validates and loads server secrets (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`) from `process.env`. The
  only app dependency the frontend shares is `@beosand/types`.
- **Admin-only, enforced server-side.** Authorization lives in the API (admin via `ADMIN_TELEGRAM_IDS`,
  and the future browser auth) — never trust role/identity asserted by the client. A real auth seam
  (token/session validated by the API) is a follow-up feature; until it exists, treat the console as a
  trusted-network tool and don't expose it publicly.
- **Money is RSD**, whole dinars, computed server-side and shown via the shared formatter. Never render
  a court number for a pending request; never show other users' data the API wouldn't return.
- **Design quality is not optional.** Build on the design system in `apps/admin/src/ui/*` (`theme.css`
  tokens, shared components) via the `ui-designer` + `frontend-design` skill — refined, utilitarian,
  data-dense; not generic AI aesthetics. UI strings are Russian (Serbian where used). Accessibility
  (semantics, focus, contrast, `aria-*`) is part of done.
- Keep `pnpm --filter @beosand/admin typecheck lint test build` green; unit-test render/validation
  logic and the unsafe path (malformed API response rejected by the contract).
