# Feature: Localization (ru / sr / en) with admin-editable labels

## Goal

Make every user-facing string in the BeoSand admin console and Telegram bot localizable into
**Russian (ru), Serbian (sr), English (en)** with **ru as the authoritative fallback**, and let the
manager edit any label from the admin console without a code deploy. Users pick their language:
the admin via a header selector (persisted in `sessionStorage`), each bot user **per-user** (stored
on their client record). Money/availability math is untouched — only display strings change.

## Model: static catalog + DB overrides → merged catalog

Three layers, resolved at read time:

1. **Static catalog** (`packages/i18n`) — canonical, version-controlled default strings, bundled
   into the admin and bot builds. RU is authoritative; SR/EN mirror RU's keys. Used as the offline
   fallback when the API is unreachable.
2. **DB overrides** (`ui_labels`) — per-`(locale, key)` rows the admin edits. They *override* the
   static default for that key+locale only.
3. **Merged catalog** — the API serves, per locale, the static defaults **overlaid with** the DB
   overrides as a flat `Record<string, string>` (`labelCatalogSchema`). Admin and bot consume the
   merged catalog so edits take effect immediately; if the fetch fails they fall back to the bundled
   static catalog.

Resolution of a single key (`t(catalog, key, params)` in `packages/i18n`):
`merged catalog value → static RU value → the key itself`, with `{param}` interpolation. Pure, unit-tested.

## Key-namespace layout (parallel-safe)

The static catalog is split so admin and bot keys live in **separate files**, and **each locale is
its own file** — 6 leaf files total. This lets the admin agent edit only `admin` files and the bot
agent only `bot` files with no merge conflicts.

```
packages/i18n/src/
  locales.ts                 Locale union, LOCALES, DEFAULT_LOCALE="ru", localeLabel, asLocale()
  catalogs/ru/admin.ts       admin.* keys (RU, authoritative)   ← admin agent
  catalogs/ru/bot.ts         bot.*   keys (RU, authoritative)   ← bot agent
  catalogs/sr/admin.ts       admin.* mirrored (machine-translated)  ← admin agent
  catalogs/sr/bot.ts         bot.*   mirrored (machine-translated)  ← bot agent
  catalogs/en/admin.ts       admin.* mirrored (machine-translated)  ← admin agent
  catalogs/en/bot.ts         bot.*   mirrored (machine-translated)  ← bot agent
  catalog.ts                 merges namespaces per locale → getStaticCatalog(locale); KEY_REGISTRY (from RU)
  resolve.ts                 t(catalog, key, params): string  (pure, interpolation + RU fallback)
  index.ts                   barrel
```

Keys are dotted and namespaced by surface: `admin.*` in admin files, `bot.*` in bot files. RU is the
single source of truth for which keys exist; SR/EN must mirror the same keys (placeholder = RU value
until the Translations phase). Any key missing in SR/EN resolves via RU fallback.

## Contracts (`packages/types`, `i18n-contracts.ts`)

- `localeSchema` — `z.enum(["ru","sr","en"])`, `Locale` type. Mirrors `@beosand/i18n` and the DB
  `locale` enum.
- `labelSchema` — `{ locale, key, value }` (`.strict`), a served override row.
- `updateLabelSchema` — `{ locale, key, value }` (`.strict`), the admin upsert body.
- `labelCatalogSchema` — `Record<string,string>`, the merged catalog the API serves per locale.
- `labelEntrySchema` — `{ key, defaultValue, override: string | null }` (`.strict`), one row of the
  admin label editor.
- `clientSchema` gains `language: localeSchema` (per-user bot locale; default `"ru"` server-side).

## DB (`packages/db`, migration `0003_third_rocket_racer.sql`)

- New enum `locale` = `('ru','sr','en')`.
- New table `ui_labels(id uuid pk, locale locale not null, key text not null, value text not null,
  updated_at timestamptz default now() not null)` with `UNIQUE(locale, key)`.
- `clients.language locale NOT NULL DEFAULT 'ru'`.

## Language switch

- **Admin:** header locale selector; selection persisted in `sessionStorage`; the chosen locale is
  the catalog the admin fetches and renders. (frontend follow-up)
- **Bot:** per-user — a `/language` (or menu) flow updates `clients.language` via the API; subsequent
  bot renders use that client's locale. The bot resolves the caller's client by telegram id, reads
  `language`, fetches/uses the merged catalog for it. (API + bot follow-up)

## Milestones

1. **Foundation (this change):** `packages/i18n` package (locales, 6 catalog leaf files seeded with a
   small proof-of-shape RU key set mirrored into SR/EN, catalog assembly + key registry, pure
   resolver + tests); `packages/types` i18n contracts + `client.language`; `packages/db` `locale`
   enum, `ui_labels` table, `clients.language` column + committed migration.
2. **Key extraction (parallel):** admin agent extracts every admin string into `catalogs/*/admin.ts`;
   bot agent extracts every bot string into `catalogs/*/bot.ts`. RU authoritative, mirrored to SR/EN.
3. **API:** `i18n`/`labels` module — `GET` merged catalog per locale (defaults ⊕ overrides),
   `GET` label-entry list per locale (default + override), admin-gated `PUT` upsert override;
   `clients` gains a set-language endpoint. All admin writes gated by `ADMIN_TELEGRAM_IDS`.
4. **Admin console:** header locale selector (sessionStorage), `t()` wired through the app, label
   editor screen (list + inline edit, save → `PUT`).
5. **Bot:** language selection flow writing `clients.language`; bot renders via merged catalog with
   static fallback.
6. **Translations:** native review fills SR/EN (replace machine placeholders).

## Acceptance

- API serves a per-locale catalog = static defaults overlaid with DB overrides; an edited label
  changes what admin and bot render without a deploy.
- A missing SR/EN key (or missing override) falls back to the RU static string; an unknown key
  renders as its key (never a crash).
- Admin language selector switches all rendered admin strings and persists across reloads in the tab.
- Each bot user sees the bot in their own `clients.language`; default is RU for new clients.
- Admin label edits are admin-only (server-enforced); `updateLabelSchema` rejects unknown fields.
- Money stays RSD, computed server-side; localization changes no money/availability/capacity logic.

## Verification

- `pnpm --filter @beosand/i18n build typecheck test`, `pnpm --filter @beosand/types build typecheck
  test`, `pnpm --filter @beosand/db typecheck` green (foundation).
- Full gate before done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (plain `pnpm`),
  then end-to-end: edit a label in admin → see it change in admin and in the bot; switch admin
  language; switch bot language per user.

## Follow-ups / open questions

- **SR/EN are machine-translated placeholders and need native review** before launch (Milestone 6).
- Real admin browser auth is a separate follow-up; until then the label editor is a trusted-network
  tool, write still gated by `ADMIN_TELEGRAM_IDS` server-side.
- Decide cache/invalidation for the merged catalog in admin/bot (e.g. react-query staleness, bot
  in-memory TTL) when wiring Milestones 4–5; not part of the foundation.
- Exact bot entry point for language change (`/language` command vs. main-menu button) decided in
  Milestone 5.
