# Mini App — onboarding & identity (`apps/miniapp`, slice S1)

**Status.** Planned. Slice S1 of the Mini App plan (`giggly-gathering-bee.md`). Builds on the merged
FOUNDATION (scaffold, auth seam, `MiniappApiClient`, provider stack, native UI shell). No API or
contract change — S1 is frontend-only and reuses existing endpoints.

## Goal

Replace the placeholder `App.tsx` with the real client identity surface: a fresh user is guided
through onboarding (name → language → level), an onboarded user lands on a read-only **profile** with
an editable **language** switch. The slice also resolves the `Client.id` (uuid) once and caches it so
later slices (S4–S8) can pass `clientId` to booking/waitlist endpoints without re-fetching. This is
the hard prerequisite that unblocks the booking slices.

## Non-goal

No new domain behaviour, no new endpoints/contracts. No home/nav shell (that is S2), no slot
browsing or booking. Name and level are **set once** at onboarding and are read-only afterwards —
there is no edit-name or change-level flow in S1 or later (matches the bot today).

## Spec refs

ТЗ §3.1 (clients), §3.2 (levels), §16 (UX: ≤3 taps); plan `giggly-gathering-bee.md` rows FND + S1;
`.claude/rules/frontend.md`, `.claude/rules/telegram-bot.md` (native UX conventions),
`.claude/rules/zod-contracts.md`.

## Guardrails (non-negotiable)

- **Interaction layer only.** No domain/money/availability/capacity/status math in the Mini App. It
  renders values the API decided and posts user input. Identity is enforced server-side.
- **Validate every API response** against a `@beosand/types` contract inside `MiniappApiClient`
  (`apps/miniapp/src/api/client.ts`) before the UI uses it. Reuse contracts; never redeclare a schema.
- **Config via `import.meta.env` (`VITE_*`) only.** Never import `@beosand/config`. The only shared
  app dependency stays `@beosand/types` (+ `@beosand/i18n`).
- **Identity is the verified session.** The ApiClient sends only `Authorization: Bearer <token>`; the
  API bridge maps the token to `x-client-telegram-id` and the clients controller resolves the actor
  from it. `onboardClient` passes the caller's own `telegramId` (from `getMe()`) in the body; the
  server rejects a mismatch. The Mini App never sends or trusts a foreign id.
- **UI strings via `@beosand/i18n`** (RU default; SR/EN where the catalog needs new keys). Native
  Telegram look (`@telegram-apps/telegram-ui`), theme-adaptive light/dark, BeoSand coral accent.
  Native `MainButton` per screen, `BackButton` for navigation, `HapticFeedback` on confirm/switch.
  ≤3 taps per journey.

## Contracts & data (reused — no change)

| Contract (`@beosand/types`) | Used for |
|---|---|
| `clientSchema` / `Client` | profile fields, onboarding result; `id` is the cached `clientId` |
| `onboardClientSchema` / `OnboardClientInput` (`telegramId`, `name`, `levelId?`, `telegramUsername?`) | onboarding submit |
| `levelSchema` / `Level` (`id`, `name`, `status`) | level picker (active levels only) |
| `localeSchema` / `Locale` (`ru` \| `sr` \| `en`) | language picker + PATCH body |
| `miniappMeSchema` / `MiniappMe` (already in session) | `getMe()` identity: `telegramId`, `name`, `username?`, `language?` |

No DB/table changes. No new Zod schemas. Language values come from `@beosand/i18n`
(`LOCALES`, `localeLabel`).

## Endpoints (reused — NO new API)

- `GET /levels` — active levels for the onboarding picker. Public read.
- `GET /clients/by-telegram/:id` — boot probe; `200` → onboarded (cache the row + `id`), `404`
  (typed `NotFoundError`) → route to onboarding. Path id is the caller's own; actor enforced
  server-side.
- `POST /clients/onboard` — register. Body `{ telegramId: <own id from getMe()>, name, levelId? }`.
  **Idempotent on `telegramId`**: a second call returns the existing row (does not overwrite name or
  level). Server forbids onboarding a different `telegramId` (account squatting).
- `PATCH /clients/by-telegram/:id/language` — body `{ language }`. Persists the chosen locale.
  Self-only (or admin) server-side. Returns the updated `Client`.

`MiniappApiClient` already has `getMe`, `getClientByTelegramId`, `onboardClient`, `health`. **Add two
methods** in `apps/miniapp/src/api/client.ts` (append, keep file order):

- `listLevels(): Promise<Level[]>` → `GET /levels`, parse with `z.array(levelSchema)`.
- `setLanguage(telegramId: number, language: Locale): Promise<Client>` →
  `PATCH /clients/by-telegram/${telegramId}/language`, body `{ language }`, parse with `clientSchema`.

## Screen / navigation map

Lightweight client-side router (state machine, not a heavy router lib — mirror the FOUNDATION
boot-status pattern). The boot gate in `ApiProvider` already resolves the session; S1 adds the
onboarded-vs-not branch on top of it.

```
boot (ApiProvider ready)
  └─ resolve client: GET /clients/by-telegram/:id
       ├─ 200  → cache Client (+ clientId) → ProfileScreen
       └─ 404  → OnboardingWizard ──(submit, 200)──► cache Client → ProfileScreen
```

**OnboardingWizard** (one screen, three steps; ≤3 taps to finish):
1. **Name** — text input, prefilled from `getMe().name`, required (min 1).
2. **Language** — single-select from `LOCALES` (`localeLabel`), default = `getMe().language ?? ru`.
   Selecting it switches the live UI locale immediately (via `LanguageProvider.setLocale`).
3. **Level** — single-select from `GET /levels` (active only); optional (the contract allows
   `levelId?`); a "Skip / decide later" affordance maps to omitting `levelId`.
   - Primary action via native **MainButton** ("Продолжить" per step, "Готово" on the last).
   - **BackButton** steps backward; on step 1 it is hidden (no parent screen).
   - On submit: `onboardClient({ telegramId, name, levelId? })`; if the chosen language differs from
     the server default, `setLanguage(telegramId, locale)` so the picked language persists on the
     record (one extra PATCH only when it differs). `HapticFeedback` on success → ProfileScreen.

**ProfileScreen** (the post-onboarding home for S1; S2 wraps it in the nav shell):
- Read-only cells: **name**, **level name** (resolve `levelId` against the cached `GET /levels`;
  show a neutral placeholder if `levelId == null`), **Telegram @username** (if any).
- **Language switch** — the only editable control: a selector of `LOCALES`. Changing it calls
  `setLanguage(telegramId, locale)`, then `LanguageProvider.setLocale(locale)` and invalidates the
  cached client query. `HapticFeedback` on switch. Optimistic locale flip with rollback on error.
- No name-edit, no level-edit controls (read-only invariant).

### `clientId` caching (load-bearing for S4–S8)

The resolved `Client` is held in the React Query cache under a stable key
(`["client", telegramId]`). Expose a small `useClient()` hook (in `apps/miniapp/src/api/` or a
`hooks/`) returning the cached `Client` and a `clientId` getter. Booking/waitlist slices read
`clientId` from there — they never re-resolve identity and never accept a `clientId` from anywhere
but this cache. After onboarding the wizard seeds the same cache key so no extra round-trip occurs.

## i18n

Add a `miniapp` catalog namespace (`packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts`) for the new
strings (onboarding step labels, profile labels, language-switch label, error/empty states), wired
into the static catalog like `bot`/`admin`. RU is authoritative; SR/EN mirror every key (the
`catalog-parity` spec enforces this). Reuse existing level/locale labels where they already exist.

## Invariants to test

1. **Onboard is idempotent on `telegramId`.** A second `onboardClient` with the same id returns the
   existing row and does not overwrite name/level (service-level behaviour already covered in
   `clients.service.spec.ts`; S1 adds the Mini App boot test that a returning user lands on
   ProfileScreen, never the wizard).
2. **Language persists.** `setLanguage` updates the record; on next boot `getMe().language` /
   the cached client reflects the chosen locale and seeds `LanguageProvider`.
3. **Name & level are read-only after onboarding.** ProfileScreen renders them as static cells with
   no edit control; only language is mutable.

## Unsafe path to test

1. **Forged / foreign `telegramId` cannot impersonate.** Identity is server-enforced from
   `x-client-telegram-id`; the body `telegramId` must equal the actor. A unit test on the client
   confirms `onboardClient` only ever sends `getMe().telegramId`; the server-side
   account-squatting `Forbidden` is already covered in `clients.service.spec.ts`.
2. **Malformed API response rejected by the contract.** A `GET /levels` / `onboard` / `setLanguage`
   response missing or mistyping a field (e.g. level without `id`, client without `language`) fails
   the Zod `.parse` in `MiniappApiClient` and surfaces as an error state — the UI never renders
   unvalidated data.
3. **No leakage / no escalation.** The slice calls only client-scoped endpoints; a `scope:"client"`
   token (the only token the Mini App holds) cannot reach any admin endpoint (FOUNDATION barrier).

## Acceptance criteria

- A fresh Telegram account opening the Mini App sees the onboarding wizard, completes
  name → language → level in ≤3 taps, and lands on ProfileScreen; a `Client` row exists.
- A returning (onboarded) account boots straight to ProfileScreen, never the wizard.
- ProfileScreen shows name, level (or a neutral placeholder), and @username read-only; only language
  is editable. Switching language updates the UI immediately and persists across a relaunch.
- `clientId` (the `Client.id` uuid) is resolved once and available from a shared hook/cache for later
  slices; no screen re-resolves identity.
- All strings come from `@beosand/i18n` (RU/SR/EN at parity). Native MainButton/BackButton/haptics
  wired; theme-adaptive with coral accent.
- Gate green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (plain `pnpm`; rebuild
  `@beosand/types` + `@beosand/i18n` first). Narrow loop:
  `pnpm --filter @beosand/miniapp typecheck lint test build`.
- Verified live in the Mini App inside Telegram (HTTPS tunnel): onboard a fresh account; relaunch and
  confirm direct-to-profile; switch language and confirm persistence; tampered/absent `initData` →
  auth error screen.

## Dependencies

FOUNDATION (merged). No dependency on other slices. S1 unblocks S2 (onboarded gate) and S4–S8
(`clientId`). Shared touch points appended only: `MiniappApiClient` (2 methods) and the router map.

## Open questions (with chosen defaults)

1. **Level optional or required at onboarding?** Default: **optional** — the contract permits
   `levelId?` and the bot allows deferring; offer a "decide later" affordance. (Revisit if product
   wants a level mandatory.)
2. **Persist the onboarding-chosen language with an extra PATCH, or rely on a future onboard-language
   field?** Default: **extra `setLanguage` PATCH only when the chosen locale differs from the server
   default** — no contract change, idempotent, cheap. The session/record then carries it.
3. **Router approach?** Default: **a small state-machine in `App.tsx`** (boot-status + onboarded
   branch), consistent with the FOUNDATION gate; a route library is deferred to S2's nav shell.
4. **Where does `useClient()` live?** Default: alongside the ApiClient
   (`apps/miniapp/src/api/useClient.ts`) so all slices import identity/clientId from one place.
