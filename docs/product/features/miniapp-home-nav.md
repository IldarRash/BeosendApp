# Mini App — home menu & navigation shell (`apps/miniapp`, slice S2)

**Status.** Planned. Slice S2 of the Mini App plan (`giggly-gathering-bee.md`). Builds on the merged
FOUNDATION (scaffold, auth seam, `MiniappApiClient`, provider stack, native UI shell) and S1
(onboarding, `ProfileScreen`, `useClient()` + cached `clientId`, native button hooks). **No API or
contract change** — S2 is frontend-only and adds no endpoints, schemas, or DB tables.

## Goal

Replace S1's two-state boot machine (`router/Router.tsx`: `wizard | landing`) with the real
**navigation shell** for the Mini App:

1. A native, section-list **Home menu** that links to the six client journeys, with no primary
   action of its own (Home is a hub).
2. A small **typed route stack** supporting `push`/`pop` of sub-screens, with the native
   **BackButton** wired to `pop` (shown on any sub-screen, hidden on Home).
3. **Deep-link entry** via `useTg().startParam`: on boot, a recognised `startParam` prefix opens the
   matching screen (instead of Home); an unknown/absent param lands on Home — never an error.

The onboarding gate from S1 still runs **first**: a not-onboarded user sees the wizard before the
Home menu ever renders. S2 ships the six menu targets as **placeholders** except profile, which links
to the existing `ProfileScreen` from S1.

## Non-goal

No journey screens beyond placeholders (those are S3–S9). No API/contract/DB change. No bottom tab
bar or URL-based history (Telegram Mini Apps have no browser URL bar; navigation is the native
BackButton + an in-memory stack). No admin/trainer surfaces — the Mini App is client-only by
construction (the held token is `scope:"client"`).

## Spec refs

ТЗ §16 (UX: ≤3 taps, always a way back to the main menu); plan `giggly-gathering-bee.md` rows FND +
S1 + **S2** (and the "Native UX per slice" section); `.claude/rules/frontend.md`,
`.claude/rules/telegram-bot.md` (native MainButton/BackButton/haptics, ≤3 taps, never a court number,
never an admin-gated surface), `.claude/rules/zod-contracts.md`.

## Guardrails (non-negotiable)

- **Interaction layer only.** No domain/money/availability/capacity/status math in the Mini App. The
  shell only chooses which screen renders; decided values come from the API in later slices.
- **No new API.** S2 reads only the already-cached profile (`useClient()` from S1). It calls no new
  endpoint and adds no `MiniappApiClient` method.
- **Config via `import.meta.env` (`VITE_*`) only.** Never import `@beosand/config`. Shared deps stay
  `@beosand/types` (+ `@beosand/i18n`).
- **Client-only, no escalation.** The Home menu must never render an admin or trainer entry. The held
  token is `scope:"client"` (FOUNDATION barrier); even so, the menu is statically the six client
  journeys — there is no role branch that could surface an admin action.
- **UI strings via `@beosand/i18n`** (RU authoritative; SR/EN mirrored — `catalog-parity` spec
  enforces parity). Native Telegram look (`@telegram-apps/telegram-ui`), theme-adaptive light/dark,
  BeoSand coral accent on the menu icons/active states. Native **BackButton** for back-navigation;
  **MainButton** only on screens that have a primary action (Home has none, so Home shows no
  MainButton). `HapticFeedback` (selection) on every menu tap. ≤3 taps to any journey.

## Menu entries

The Home menu is a single native `List` of `Section`(s) of `Cell`s. Each cell is one client journey,
tappable, with a coral leading icon, a label, and a `›` chevron. Tapping a cell fires
`hapticSelection()` then `push(route)`.

| # | Menu entry (RU label key) | Route id | Built where | S2 renders |
|---|---|---|---|---|
| 1 | `miniapp.home.browse` — Расписание / Записаться | `browse` | S3 (browse/today slots) | **Placeholder** |
| 2 | `miniapp.home.myBookings` — Мои записи | `my-bookings` | S5 (my bookings + cancel) | **Placeholder** |
| 3 | `miniapp.home.group` — Абонемент (группа) | `group` | S7 (monthly group) | **Placeholder** |
| 4 | `miniapp.home.individual` — Индивидуальная тренировка | `individual` | S8 (individual request) | **Placeholder** |
| 5 | `miniapp.home.court` — Аренда корта | `court` | S9 (court rental request) | **Placeholder** |
| 6 | `miniapp.home.profile` — Профиль и язык | `profile` | S1 (existing) | **`ProfileScreen`** |

Single booking (S4) and waitlist (S6) are **not** menu entries — they are reached from inside the
browse flow (S3), so they are not part of the Home list. Suggested grouping for visual rhythm (final
layout owned by `ui-designer`): a "Тренировки" section (browse, my-bookings, group, individual), a
"Корты" section (court), and a "Профиль" section (profile). The exact sectioning is cosmetic; the six
routes are the contract.

**Placeholder screen.** A single reusable `PlaceholderScreen` component (one file), parameterised by a
title key and a "coming soon" body key (`miniapp.home.placeholderTitle` / `miniapp.home.placeholderBody`),
shown for routes 1–5. It renders the BackButton (sub-screen) and **no** MainButton. Later slices
replace each route's component in the route table — the placeholder is deleted when the last journey
lands (call it out in S9's cleanup so no dead placeholder lingers).

## Routing model (chosen: a tiny typed in-memory route stack — no router library)

**Decision: a hand-rolled typed stack in a small `NavProvider`, not `react-router` / TanStack Router.**
Justification:

- Telegram Mini Apps have **no browser URL/history bar**; back-navigation is the native BackButton, not
  the browser. A URL router buys nothing here and fights the native model.
- The whole surface is a shallow hub-and-spoke: Home → one journey screen, occasionally one more level
  (e.g. S3 → S4). A stack of `≤ ~3` entries covers it; we already wire the BackButton via the existing
  `useBackButton(visible, onBack)` hook from S1.
- It keeps the Mini App dependency-light (no extra lib in the bundle) and the model fully typed: a
  closed union of route ids means an unknown route is a **type error**, not a runtime 404.

Shape (in `apps/miniapp/src/router/`):

- `routes.ts` — the closed union and metadata:
  ```ts
  // The full set of client routes. "home" is the root; the rest are pushable screens.
  export type RouteId =
    | "home" | "browse" | "my-bookings" | "group" | "individual" | "court" | "profile";
  ```
  Plus a `MENU_ITEMS: ReadonlyArray<{ id: Exclude<RouteId,"home">; labelKey: string; icon: ... }>`
  describing the six Home cells (single source for the menu and the deep-link map).
- `NavProvider.tsx` — holds `stack: RouteId[]` in state (root `["home"]`), exposes
  `useNav(): { current, canPop, push(id), pop(), reset() }`. `push` is idempotent on the top entry
  (re-tapping the current route is a no-op). `pop` removes the top entry (never empties the stack —
  `home` is the floor). `reset()` returns to `["home"]`.
- `Router.tsx` (rewritten) — keeps S1's **boot-status + onboarding gate** exactly as today
  (`no-telegram | pending | error`, then `useClient()` → `notOnboarded` ⇒ `OnboardingWizard`), then,
  once onboarded, renders `<NavProvider>` wrapping a `<RouteView>` that switches on `useNav().current`
  to the screen component. The S1 `wizard | landing` local state machine is **removed** in the same
  change (no layering a new path beside the old one — per the Refactoring rule).
- `RouteView` wires `useBackButton(canPop, pop)` once at the shell level: BackButton is **shown on any
  sub-screen and hidden on Home** (`canPop === stack.length > 1`). Individual screens still own their
  own MainButton (Home shows none).

Deep-link mapping (`startParam` → initial stack):

- On first render after onboarding, read `useTg().startParam` **once** and seed the stack:
  a recognised prefix pushes its screen on top of `home` (so BackButton returns to Home); otherwise the
  stack stays `["home"]`.
- **Known prefixes (documented):**
  | `startParam` value / prefix | Opens | Notes |
  |---|---|---|
  | `home` (or empty/absent) | Home | default |
  | `browse` | browse (S3 placeholder in S2) | "записаться" deep link |
  | `mybookings` | my-bookings (S5 placeholder) | reminder notifications |
  | `group` | group (S7 placeholder) | — |
  | `individual` | individual (S8 placeholder) | — |
  | `court` | court (S9 placeholder) | — |
  | `profile` | profile (`ProfileScreen`) | — |
  | `waitlist_<entryId>` | browse → (S6 accept) | **S2: not yet a reachable screen → falls back to Home** |
  | `book_<trainingId>` | browse → (S4 confirm) | **S2: not reachable yet → falls back to Home** |
  - Any value not matching a route the user can currently reach maps to **Home** (see Unsafe path).
  - The id payload of `waitlist_<id>` / `book_<id>` is parsed and held for the target slice; in S2 there
    is no screen to consume it, so it is ignored and the app opens Home. Document the prefix table in
    `routes.ts` so later slices extend the same map.

## Contracts & data (reused — no change)

| Contract (`@beosand/types`) | Used for |
|---|---|
| `clientSchema` / `Client` (via S1 `useClient()`) | the cached profile passed to `ProfileScreen`; the menu does not need it |

No new Zod schemas, no DB/table change, no new `MiniappApiClient` method. `RouteId` is a local UI type
(navigation is not a domain contract); it lives in `apps/miniapp/src/router/routes.ts`, not in
`@beosand/types`.

## Endpoints

**None.** S2 adds no endpoint and calls none beyond S1's already-cached `useClient()` boot resolve.

## i18n

Add a `miniapp.home.*` group to `packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts` (RU authoritative,
SR/EN mirrored — parity spec enforces it): a Home title, the six menu labels, and the placeholder
title/body. Suggested keys: `miniapp.home.title`, `miniapp.home.browse`, `miniapp.home.myBookings`,
`miniapp.home.group`, `miniapp.home.individual`, `miniapp.home.court`, `miniapp.home.profile`,
`miniapp.home.placeholderTitle`, `miniapp.home.placeholderBody`. Reuse existing `miniapp.common.*` for
loading/error states; do not duplicate them.

## Invariants / behaviour to test

1. **Route changes render the right screen.** With the stack at `["home", route]`, `RouteView` renders
   that route's component (placeholder for 1–5, `ProfileScreen` for `profile`); `home` renders the menu.
2. **BackButton pops to Home and is hidden on Home.** On a sub-screen `canPop` is true → BackButton
   visible → tapping it pops back to Home; on Home `canPop` is false → BackButton hidden. (Assert via
   the `useBackButton(visible, onBack)` contract / a mock of the SDK button, as the S1 specs do.)
3. **Unknown `startParam` → Home.** Seeding the stack from an unrecognised value (or `null`) yields
   `["home"]` and renders the menu — no thrown error, no blank screen.
4. **Onboarding still gates first.** A `notOnboarded` client renders `OnboardingWizard`, never the Home
   menu; only an onboarded client reaches the nav shell (carry forward S1's boot test).
5. **No admin/trainer entry is ever rendered.** The Home menu renders exactly the six client routes;
   there is no role branch and no admin/trainer cell. (Assert the rendered menu item set equals
   `MENU_ITEMS` and contains no admin/trainer route.)
6. **≤3 taps to any journey.** Open (tap to launch) → Home → one cell tap reaches every journey
   screen; deep link reaches a journey in one open (0 in-app taps). Structural assertion on the menu +
   the deep-link seed.

## Unsafe / edge path to test

1. **Deep link to a screen the user can't reach yet lands on Home, never errors.** `startParam =
   waitlist_123` or `book_456` (target screens not built until S4/S6) — the boot seeds `["home"]`
   (the unreachable target is dropped) and renders the Home menu. No exception, no blank/placeholder
   crash, no leaked id.
2. **Malformed `startParam` is inert.** Garbage (`"%%%"`, an over-long string, a prefix with no
   payload like `waitlist_`) maps to Home; the id-parse is defensive (no `parseInt(NaN)` propagation,
   no throw). The 64-byte `callback_data`/`startapp` cap is respected by only ever emitting id-only
   deep links (producer side is the bot, S6/S10 — S2 only consumes defensively).
3. **`pop` never empties the stack.** Repeated `pop()` past Home keeps the stack at `["home"]`
   (BackButton hidden on Home means this is normally unreachable, but the reducer is guarded so a
   double-fire can't blank the app).
4. **No data leak / no escalation.** The shell renders no other user's data and no court number (there
   is no court data in S2 at all); the only token held is `scope:"client"`, and the menu exposes no
   admin-scoped destination.

## Acceptance criteria

- An onboarded client opening the Mini App lands on a native section-list **Home menu** with the six
  client journeys (coral accent, theme-adaptive light/dark), and **no MainButton** on Home.
- Tapping any menu cell (with a selection haptic) opens that journey screen in ≤1 in-app tap; profile
  opens the existing S1 `ProfileScreen`, the other five open the shared placeholder.
- The native **BackButton** appears on every sub-screen and returns to Home; it is **hidden on Home**.
- A recognised `startParam` deep-links straight into the matching screen on boot (BackButton returns to
  Home); an unknown/absent/malformed `startParam`, or one targeting a not-yet-built screen, opens
  **Home** without error.
- A **not-onboarded** client still sees the onboarding wizard first; the Home menu renders only after
  onboarding (S1 gate intact). The S1 `wizard | landing` state machine is **removed**, replaced by the
  stack-based router (no dead path left).
- No admin/trainer entry is rendered anywhere in the menu.
- All strings come from `@beosand/i18n` (RU/SR/EN at parity); no new API call or contract.
- Gate green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (plain `pnpm`; rebuild
  `@beosand/types` + `@beosand/i18n` first). Narrow loop:
  `pnpm --filter @beosand/miniapp typecheck lint test build`.
- Verified live in the Mini App inside Telegram (HTTPS tunnel): Home renders for an onboarded account;
  each cell opens its screen and BackButton returns to Home; a `?startapp=profile` deep link opens the
  profile and `?startapp=garbage` opens Home.

## Dependencies

FOUNDATION (merged) + S1 (merged): the onboarding gate, `useClient()`/cached `clientId`, `ProfileScreen`,
`useBackButton`/`useMainButton`/`hapticSelection`, `ui/theme.css` + `OptionList`. S2 unblocks S3, S5,
S7, S8, S9 (each replaces its placeholder route component) and the deep-link consumers S4/S6.

Shared touch points (ordered append only): `apps/miniapp/src/router/*` (the new stack + route table —
later slices append their route's screen, swapping out the placeholder) and the `miniapp.home.*` i18n
keys. No change to `MiniappApiClient` or `@beosand/types`.

## Open questions (with chosen defaults)

1. **Router approach?** Default (chosen): **a tiny typed in-memory route stack** (`NavProvider` +
   closed `RouteId` union), not a router library — Mini Apps have no URL bar and the surface is shallow
   hub-and-spoke, so a library adds bundle weight and an unused history model. Revisit only if a future
   slice needs deep multi-level history or shareable in-app URLs (neither is on the roadmap).
2. **Tab bar vs single-list Home?** Default: **single section-list Home + BackButton**, matching the
   plan's "native section-list home" and the bot's hub model; a bottom tab bar is more chrome than six
   shallow journeys need. Revisit if usage shows two or three journeys dominate.
3. **Placeholder screens or hide the five unbuilt entries until their slice lands?** Default: **show all
   six with a "coming soon" placeholder** so the menu shape and ≤3-tap navigation are testable now and
   the integration order is visible; each placeholder is replaced (not added beside) by its slice, and
   the shared placeholder component is deleted in S9 cleanup.
4. **Deep-link prefix syntax?** Default: **`<route>` for plain screens and `<noun>_<id>` for
   id-carrying targets** (`waitlist_<id>`, `book_<id>`), documented once in `routes.ts` and reused by
   the bot's notification deep links (S6/S10). Ids are parsed defensively; unknown/unreachable → Home.
5. **Where does the route stack live — `App.tsx` or a provider?** Default: a dedicated
   `router/NavProvider.tsx` exposing `useNav()`, so journey screens push/pop without prop-drilling and
   the BackButton is wired once at the shell. Consistent with the S1 provider stack.
