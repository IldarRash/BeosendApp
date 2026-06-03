# T1.6 — Client onboarding

**Goal.** On first `/start`, greet the user, ask their name, let them pick a level, and create the
client card. No phone number (ТЗ §7).

**Spec refs.** ТЗ §7; UX §1.

**Contracts & tables.** `onboardClientSchema`, `clientSchema` (`packages/types`); `clients` table
(unique `telegram_id`).

**API.** `apps/api/src/modules/clients/`:
- `GET /clients/by-telegram/:telegramId` → existing client or 404.
- `POST /clients/onboard` → `{ telegramId, telegramUsername?, name, levelId? }` creates the client.
  Idempotent on `telegram_id` (returns the existing one).

**Bot flow.** `/start`: if the client exists → main menu (T1.7). Else welcome → ask name (text) →
level keyboard (Beginner/Intermediate/Advanced/"Не знаю" → null level) → create → main menu.

**Invariants.** Identity is `telegram_id`; username is optional and stored separately; works without a
username. The bot holds the multi-step state; the API owns persistence.

**Acceptance criteria.**
- New user is greeted, enters name, picks level, lands on the main menu with a saved client.
- A user without a username completes onboarding.
- Re-running `/start` does not duplicate the client.

**Tests.** Service onboard idempotency; "Не знаю" → null level; contract validation. Bot: state
transitions (mocked API).

**Dependencies.** T1.1 (levels), T1.7 (menu).

**Open questions.** None.
