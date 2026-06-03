# T1.5 — Available slots

**Goal.** Show clients only bookable trainings, each as a slot card (date, weekday, time, trainer,
level, free seats, price). This is the bot's headline feature (ТЗ §5).

**Spec refs.** ТЗ §5, §8; UX §3.

**Contracts & tables.** `slotCardSchema` (`packages/types`); `isBookable` / `freeSeats` helpers;
reads `trainings` + `groups` + `trainers` + `levels`.

**API.** `apps/api/src/modules/trainings/`:
- `GET /trainings/available?from?&to?&levelId?` → `SlotCard[]` for trainings that are `open` with
  `freeSeats > 0`, in the future, ordered by date/time.

**Bot flow.** Main menu → "🏐 Доступные тренировки" → list of slot-card buttons → "Записаться" per
slot → confirm (T1.8). Last button "⬅️ Назад".

**Invariants.** Only `open` + seats > 0 are returned (`isBookable`). Free seats and price come from the
server. Full/cancelled never appear here (full may be offered via waitlist in T2.1).

**Acceptance criteria.**
- A full training does not appear; freeing a seat makes it appear again.
- Cards show correct free seats, trainer, level, price, weekday.
- Past trainings are excluded.

**Tests.** Service filters by bookable + future; card mapping; ordering. Bot: card/keyboard render.

**Dependencies.** T1.4 (trainings exist), T1.7 (menu).

**Open questions.** Default window length. Default: next 14 days.
