---
name: bot-flow-implementation
description: Implement a grammY bot flow in apps/bot (commands, keyboards, callback handlers, multi-step conversations) that calls apps/api via the typed ApiClient. Use when adding or changing what the Telegram user sees or does.
---

# Bot flow implementation

Wire a Telegram user journey to the API. The bot renders and routes; it never owns domain logic.

## Steps

1. Read the feature brief and the UX scenario it maps to (`docs/product/feature-roadmap.md` links the
   spec sections). Identify the screens, buttons, and the 2-3 tap happy path.
2. **ApiClient** - add typed methods in `apps/bot/src/api-client.ts` for the endpoints you need; parse
   responses with the matching `packages/types` contract.
3. **Keyboards/messages** - build `InlineKeyboard`s with namespaced callback-data constants (extend
   the `menu.ts` pattern). Keep payloads to IDs.
4. **Handlers** - `bot.command` / `bot.callbackQuery` / conversation steps that: read the update,
   resolve the user by `telegram_id`, call the API, render the next screen. Always `answerCallbackQuery`
   and always offer a path back to the main menu.
5. Show only bookable slots; offer waitlist when full; never render a court number pre-confirmation;
   show RSD prices from the API.
6. Role-gated flows (trainer/manager) check role via the API before rendering.

## Conventions

Follow `.codex/rules/telegram-bot.md`. No domain logic, DB access, or money math in `apps/bot`.

## Done

`pnpm --filter @beosand/bot typecheck lint test` green; keyboard/render logic unit-tested; the flow
works against a running API (use the `app-runner` / `run` skill).
