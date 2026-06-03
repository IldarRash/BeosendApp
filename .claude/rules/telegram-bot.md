# Rule: Telegram bot (apps/bot)

- The bot is an **interaction layer only**. Handlers parse the update, call the `ApiClient`, and
  render a message/keyboard. No domain logic, no DB, no money or availability math in the bot.
- All data the bot shows comes from `apps/api` and is validated against a `packages/types` contract in
  the `ApiClient` before use.
- Identify the user by **Telegram ID** (numeric). Username is optional context; the bot must work for
  users without one. Never key anything off username.
- Keep core client journeys to **2–3 taps** (UX section 16): open → pick → confirm. Always offer a
  way back to the main menu.
- Callback-data actions are namespaced constants (e.g. `menu:available`, `book:confirm:<trainingId>`);
  don't scatter raw strings. Keep payloads small (Telegram caps callback_data at 64 bytes) — pass IDs,
  not blobs.
- Show only **bookable** slots to clients (status `open` + free seats). For a full slot, offer the
  waitlist, not a normal booking.
- Court clients choose a **time and duration only** — never render or accept a court number before
  admin confirmation. Prices shown are RSD and come from the API.
- Role-gated flows (trainer / manager) check role via the API (`ADMIN_TELEGRAM_IDS`, or trainer
  `telegram_id`) before showing the UI.
