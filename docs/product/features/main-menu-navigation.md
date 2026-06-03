# T1.7 — Main menu & navigation

**Goal.** The main menu and consistent back/home routing tying every client flow together.

**Spec refs.** ТЗ §6; UX §2, §16.

**Contracts & tables.** None new (uses the bot's keyboard layer; `mainMenuKeyboard` already exists).

**API.** None.

**Bot flow.** After onboarding/`/start`, show the menu: 🏐 Доступные тренировки · 📅 Свободные места
сегодня · 👥 Записаться в группу · 📋 Мои записи · ℹ️ Связаться с менеджером. Every sub-screen offers
"⬅️ Назад" and a way to "🏠 Главное меню". (Optional later: расписание на неделю, мой уровень.)

**Invariants.** Core journeys stay within 2–3 taps. Callback-data actions are namespaced constants.
Unknown/expired callbacks fall back to the menu, not an error.

**Acceptance criteria.**
- All five actions are present and route to their flows (stubs until each lands).
- Back/home is reachable from every sub-screen.
- "Связаться с менеджером" shows the manager contact.

**Tests.** Keyboard renders all five actions (already covered for the main menu); routing dispatch
table maps each action.

**Dependencies.** Foundation (skeleton already wires `/start` + menu).

**Open questions.** Manager contact source. Default: a configurable handle/text (env or config).
