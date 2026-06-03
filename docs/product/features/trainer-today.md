# T2.3 — Trainer: today

**Goal.** A trainer sees their trainings for today with the roster and headcount, and can mark
attendance after the session.

**Spec refs.** ТЗ §13; UX §15.

## Smallest correct slice

A thin vertical slice in the existing `trainings` module (new `trainer-*` contracts in
`packages/types`, two reads + one attendance write in `trainings.service` with a trainer guard,
a trainer-roster repo read + attendance write reusing `bookings` patterns, and a new bot screen
"Мои тренировки сегодня" with roster + attendance buttons). No schema change — `bookings.status`
already has `attended`/`no_show`, `trainers.telegram_id` already exists, `trainings.trainer_id`
already links sessions to trainers.

## Contracts & tables

No DB schema change. Reuse `trainingSchema`, `bookingStatus` (`attended`/`no_show` already present),
`uuid`, `dateString`, `timeString`, `dayOfWeek` from `packages/types`.

New contracts in `packages/types/src/training-contracts.ts`:

- `trainerTodayItemSchema` — one of a trainer's today trainings with headcount:
  `{ trainingId, date, dayOfWeek, startTime, endTime, levelName, status (trainingStatus),
  bookedCount, capacity }`. `TrainerTodayItem = z.infer<...>`.
- `rosterParticipantSchema` — one roster row:
  `{ bookingId, clientId, clientName, bookingStatus }`. `RosterParticipant = z.infer<...>`.
- `trainingRosterSchema` — `{ trainingId, date, startTime, endTime, levelName,
  participants: rosterParticipantSchema[] }`. `TrainingRoster = z.infer<...>`.
- `markAttendanceSchema` — `z.object({ status: z.enum(["attended","no_show"]) }).strict()`.
  `MarkAttendanceInput = z.infer<...>`.
- `trainerTodayQuerySchema` — `z.object({ telegramId: z.coerce.number().int() }).strict()` for the
  `GET /trainers/me/today` query. `TrainerTodayQuery = z.infer<...>`.

Export all from the package index (it re-exports `training-contracts`).

## API — `apps/api/src/modules/trainings/`

All three endpoints live in `TrainingsController` (thin) → `TrainingsService` (owns all guard/logic)
→ `TrainingsRepository` (DB only). Actor is the numeric `x-telegram-id` header, parsed exactly as the
other controllers already do.

- `GET /trainers/me/today?telegramId=<n>` → `TrainerTodayItem[]`.
  Service resolves the trainer by `telegram_id`; if none, `403`. Returns today's trainings for that
  trainer with headcount. `telegramId` in the query must equal the `x-telegram-id` actor (or actor is
  admin) — never trust the query id alone.
- `GET /trainings/:id/roster` (trainer/admin) → `TrainingRoster`.
  Service loads the training; if missing, `404`. Authorizes: caller is admin, OR caller's resolved
  trainer id equals `training.trainerId`. Otherwise `403`. Roster lists bookings with status in
  (`booked`, `attended`, `no_show`) joined to client names; `cancelled`/`waitlist` are excluded.
- `POST /bookings/:id/attendance` (trainer/admin) → `Booking`.
  Lives here as a trainings-domain action but writes a booking; place the method on
  `TrainingsService` and inject `BookingsRepository` (already exported by `bookings.module`) for the
  write, OR add a thin `markAttendance` to `BookingsService` and call it. Prefer the latter to keep
  the booking-status transition next to the other booking writes; the controller route still reads
  best on `bookings`. Decision (default): add `POST /bookings/:id/attendance` to
  `BookingsController` delegating to a new `BookingsService.markAttendance`, with the
  trainer-ownership check done by resolving the booking's training's `trainerId` against the caller's
  trainer record.

### Attendance write rules (service, in a transaction)

1. Load booking by id (`404` if missing).
2. Load its training; authorize: admin OR caller's trainer id === `training.trainerId` (else `403`).
3. Reject if `training.date > today` — attendance is settable only for today/past sessions (`400`).
4. Reject if booking status is not in (`booked`, `attended`, `no_show`) — e.g. `cancelled`/`waitlist`
   cannot be marked (`409`).
5. Set `bookings.status` to the requested `attended`/`no_show`. Idempotent re-marking to the same
   value is allowed. Do NOT touch `trainings.bookedCount` or `trainings.status` — attendance is
   orthogonal to capacity (the seat was already counted at booking time).
6. Return the updated booking (`bookingSchema`).

## Bot flow — `apps/bot`

New file `apps/bot/src/trainer-today.ts` (interaction only). New namespaced callbacks
(`trainer:today`, `trainer:roster:<trainingId>`, `attend:<bookingId>:<attended|no_show>`), parsed
like the existing `parse*` helpers; payloads carry ids only (≤64 bytes).

- Entry: a "Мои тренировки сегодня" button. Gate it by calling the API
  (`getTrainerToday(telegramId)`); show the button/section only if the call succeeds (caller is a
  trainer). Non-trainers never see it. Add to the menu as a role-gated entry (or a `/today` command),
  rendered after a successful trainer check.
- `trainer:today` → list today's trainings (time / level / `bookedCount`/`capacity`), each with a
  "Посмотреть список" button → `trainer:roster:<trainingId>`.
- `trainer:roster:<trainingId>` → participant names; each `booked` row gets "✅ Присутствовал"
  (`attend:<bookingId>:attended`) and "❌ Не пришёл" (`attend:<bookingId>:no_show`).
- Tapping an attendance button calls the API and re-renders the roster with the new status.
- Always offer back/home (`backHomeKeyboard`).

New `ApiClient` methods (validate responses against the new contracts):
- `getTrainerToday(telegramId): Promise<TrainerTodayItem[]>` → `GET /trainers/me/today` with
  `x-telegram-id` header + `telegramId` query.
- `getTrainingRoster(trainingId, actorTelegramId): Promise<TrainingRoster>` →
  `GET /trainings/:id/roster`.
- `markAttendance(bookingId, status, actorTelegramId): Promise<Booking>` →
  `POST /bookings/:id/attendance`.

## Invariants

- **Trainer scoping (the one this feature must protect):** a trainer sees and mutates only their own
  trainings/rosters. Reads filter by the trainer resolved from `telegram_id`; the attendance write is
  authorized by `booking → training.trainerId === caller's trainer id` (admins excepted). Enforced in
  the service, never in the bot.
- Attendance is settable only on the trainer's own trainings and only for today/past sessions.
- Attendance does not change capacity/status; the seat was counted at booking time.
- Clients never see rosters; the roster endpoint is trainer/admin only.

## Unsafe / forbidden path (must be tested and rejected)

Trainer A (or any non-trainer) marking attendance on a booking belonging to trainer B's training:
`POST /bookings/:id/attendance` where the booking's `training.trainerId` is not the caller's trainer
id and the caller is not admin → `403`, no status change. Same rejection for `GET /trainings/:id/roster`
on another trainer's training, and for `GET /trainers/me/today` with a `telegramId` mismatching the
`x-telegram-id` actor.

## Acceptance criteria

- A trainer with a set `telegram_id` sees only their today trainings and rosters.
- Marking attended/no-show updates the booking and is reflected in analytics (T3.1).
- A non-trainer / other trainer is forbidden (403) and changes nothing.

## Tests

- Service: today filter resolves the trainer by `telegram_id` and returns only their trainings.
- Service: roster ownership — other trainer / non-trainer → 403; admin allowed.
- Service: attendance transition `booked → attended` and `booked → no_show`; reject future-dated
  training (400); reject non-markable status e.g. `cancelled`/`waitlist` (409); capacity/status
  untouched.
- Service: authorization — attendance on another trainer's booking → 403, no write.
- Contracts: `markAttendanceSchema` rejects unknown status / extra fields; roster + today schemas
  parse the rendered shape.

## Dependencies

T1.2 (trainer `telegram_id`), T1.8/T1.9 (bookings). All present in the worktree.

## Open questions

None. (Default decisions recorded inline: attendance route on `BookingsController`/`BookingsService`;
trainer resolution via a new `TrainersRepository.findByTelegramId`; roster excludes
`cancelled`/`waitlist`.)
