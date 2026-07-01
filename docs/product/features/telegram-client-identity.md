# Telegram client identity/photo

**Status.** Approved brief. Scope is best-effort sync and display of Telegram-provided client
username/photo. Username and photo are optional display data, never requirements.

## Goal

Store optional Telegram client display identity when Telegram exposes it, and show it in the Mini App
and admin client surfaces with reliable fallbacks. Numeric `telegramId` remains the only Telegram
identity key; booking, money, availability, waitlist, court, trainer, and admin-auth behavior do not
change.

## Spec refs

- `docs/product/feature-roadmap.md`: TZ 3.1 clients, UX 7 onboarding, UX 16 low-tap flows.
- `docs/product/features/miniapp-onboarding-identity.md`: S1 auth, onboarding, profile, cached
  `Client.id`.
- `docs/product/features/admin-console.md`: M2 clients list/onboarding over the shared client API.
- `docs/product/design-plan.md`: admin Clients screen and Mini App Profile screen.
- `docs/architecture/overview.md`: API owns domain truth; Mini App/admin are interaction layers.
- `docs/architecture/domain-model.md`: `Client` identity is `telegramId`; username is optional.
- `docs/architecture/database.md`: `clients` table is the client identity table.

## Contracts & tables

- `packages/types/src/auth-contracts.ts`
  - Extend `miniappMeSchema` / `MiniappMe` with optional `photoUrl`.
  - Keep `username` optional. Missing `username` and `photoUrl` are valid.
- `apps/api/src/modules/auth/session-token.ts`
  - Allow client-scoped session claims to carry optional `username` and `photoUrl`.
  - These claims are display identity only, not authorization.
- `apps/api/src/modules/auth/session-bridge.middleware.ts`
  - Continue mapping `scope:"client"` only to `x-client-telegram-id`.
  - Strip inbound optional identity headers, then set bridge-controlled `x-client-telegram-username`
    and `x-client-telegram-photo-url` only from a valid client token when present.
- `packages/types/src/client-contracts.ts`
  - Extend `clientSchema` / `Client` with `telegramPhotoUrl: string | null`.
  - Keep `telegramUsername: string | null`.
  - Do not add `telegramPhotoUrl` to `onboardClientSchema`; the source is verified Mini App auth.
- `packages/db/src/schema.ts`
  - Add nullable `clients.telegram_photo_url text` plus a generated Drizzle migration.
- `apps/api/src/modules/clients/*`
  - Map the new column and add a focused sync helper that updates only
    `telegramUsername` / `telegramPhotoUrl` for a known `telegram_id`.

## API

- `POST /auth/miniapp`
  - Request remains `{ initData }`.
  - Parse `username?` and `photo_url?` from the verified `initData.user`.
  - Response `MiniappSession.user` may include `photoUrl`; session token may carry it.
  - Missing username/photo succeeds; tampered/stale initData still fails.
- `GET /clients/by-telegram/:telegramId`
  - Response `Client` includes nullable `telegramPhotoUrl`.
  - For a Mini App self request, sync optional username/photo from the verified session before return.
  - Bot/admin raw-id paths do not clear or invent photo data because they have no verified photo signal.
- `POST /clients/onboard`
  - Body remains self-only and idempotent on `telegramId`; no photo field in the body.
  - For Mini App self onboarding, insert/sync optional username/photo from verified session identity.
  - Existing rows are returned after display-identity sync, without changing `name`, `levelId`,
    language, consent, source, phone/email/note, status, or credits.
- `GET /clients`, `PATCH /clients/:id`, `PATCH /clients/by-telegram/:telegramId/language`
  - Return the extended `Client`.
  - Admin edit does not edit username/photo in this slice; existing username search remains optional.

## Mini App/Admin flow

- Mini App auth validates the extended `miniappSessionSchema`; `photoUrl` is never assumed.
- On boot/profile, `useClient()` receives the synced `Client` and caches it under the existing
  `["client", telegramId]` key.
- Mini App header/profile avatar uses `client.telegramPhotoUrl` when non-null; fallback is initials
  from `client.name`, then a neutral initial. On image load error, hide the image for that render and
  show initials.
- Mini App hides the `@username` line when `client.telegramUsername` is null; no placeholder handle.
- Admin Clients list and client pickers may show a small avatar from `Client.telegramPhotoUrl`;
  fallback is initials/no username. Admin creation/edit forms do not require or edit photo.
- No bot user flow changes. Bot fixtures/types may need the extended `Client` shape, but bot behavior
  remains numeric-id based and works without username/photo.

## Invariants

- Authorization and ownership are based on numeric Telegram id only.
- Username/photo never grant access, select another client, or satisfy admin/trainer checks.
- Persisted display identity comes only from verified Mini App `initData` or a signed client session
  derived from it, never arbitrary browser body/header fields.
- Client tokens still never populate `x-telegram-id`; client optional identity headers are
  bridge-controlled and stripped before verification.
- Missing username/photo is a valid state and must not block auth, onboarding, profile, admin views,
  booking, waitlist, court requests, or notifications.
- Sync never overwrites BeoSand profile fields (`name`, `levelId`, language, consent, admin-managed
  contact/status/credits).
- No Telegram photo scraping/proxying. Store the Telegram-provided URL as nullable text and render
  best-effort.

## Acceptance criteria

- Mini App user with verified `username` and `photo_url` authenticates, onboards or returns, and gets
  a `Client` with `telegramUsername` and `telegramPhotoUrl` populated.
- Mini App user with no username/photo authenticates, onboards or returns, and sees initials/no
  username with no broken UI.
- Returning Mini App user refreshes optional display fields before profile/header render; BeoSand
  profile fields remain unchanged.
- Verified Mini App omission clears stale stored username/photo. Bot/admin paths without verified
  photo signal do not clear `telegramPhotoUrl`.
- Forged body fields or raw headers cannot set another client's username/photo.
- Admin Clients surface renders the extended `Client` and does not require username/photo for create,
  edit, search, or display.
- Shared response validation is updated for auth, clients, Mini App, admin, and bot fixtures.
- Static gate expected green after implementation: `pnpm typecheck && pnpm lint && pnpm test &&
  pnpm build`; live check covers with-photo, no-photo, existing-client refresh, broken-image fallback,
  and tampered initData rejection.

## Tests

- `packages/types`: auth/client schemas accept optional/null photo, keep username optional, and reject
  malformed fields.
- `packages/db`: schema/migration adds nullable `telegram_photo_url`.
- `apps/api` auth: verified Mini App `photo_url` maps to `photoUrl`; missing username/photo succeeds;
  tampered/stale initData fails.
- `apps/api` session bridge: strips forged optional identity headers, sets them from valid client
  claims, and never maps client tokens to `x-telegram-id`.
- `apps/api` clients: onboard/get syncs only username/photo, clears them only on verified Mini App
  omission, leaves profile/admin fields unchanged, and rejects foreign actors before sync.
- `apps/miniapp`: API client validates `photoUrl`; profile/header render photo, initials fallback,
  no-username state, and image-error fallback.
- `apps/admin`: Clients list/pickers render extended client data and do not require photo/username.
- `apps/bot`: affected fixtures compile with the extended `Client`; no handler flow changes.

## Dependencies

- Existing Mini App auth/session bridge and S1 onboarding/profile.
- Existing admin Clients screen and typed ApiClient.
- Drizzle migration generation after schema change.
- No dependency on Telegram username/photo availability; no Telegram photo fetch/proxy service.

## Open questions with defaults

1. **Is Telegram username required?** Default: no, optional and nullable.
2. **Is Telegram photo/avatar required?** Default: no, optional and nullable; store/display only when
   Telegram exposes `photo_url`.
3. **What if Telegram stops exposing username/photo?** Default: clear stored optional values on a
   verified Mini App session; do not clear from bot/admin paths that lack that signal.
4. **Can clients submit photo in onboarding/body fields?** Default: no; sync only verified Mini
   App/auth identity where possible.
5. **Can admins edit username/photo?** Default: no; admin sees fallbacks and can keep working without
   those fields.
6. **What is the visual fallback?** Default: initials from client name, then neutral initial; hide
   username entirely when absent.
