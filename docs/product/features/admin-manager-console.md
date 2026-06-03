# A1 — Manager / admin console

**Goal.** Give the manager bot-based control over the catalogue and schedule: groups, month
generation, trainers, capacity, cancel a training, view rosters, run broadcasts, and see fill status.

**Spec refs.** ТЗ §14, §15.

**Contracts & tables.** Reuses contracts/tables from T1.1–T1.5, T2.4, T3.1; adds a
`cancelTrainingSchema` and `changeCapacitySchema`.

**API.** Admin-guarded endpoints across modules:
- groups: create/edit (T1.3); trainings: generate month (T1.4), `POST /trainings/:id/cancel`,
  `PATCH /trainings/:id/capacity`, `GET /trainings/:id/roster`; trainers: add/edit (T1.2);
  broadcasts: send (T2.4); analytics summaries (T3.1); fill overview `GET /trainings?from&to` with
  booked/capacity.

**Bot flow.** A manager menu (shown only to `ADMIN_TELEGRAM_IDS`): создать/редактировать группу ·
сгенерировать расписание на месяц · добавить тренера · изменить capacity · отменить тренировку ·
список записанных · рассылки · обзор заполненности.

**Invariants.** Every action is admin-gated in the service. Cancelling a training sets status
`cancelled`, notifies booked clients (T2.2), and never silently deletes bookings (they move to a
cancelled/affected state). Capacity change recomputes status; lowering below `booked_count` is
rejected or guided, never left inconsistent.

**Acceptance criteria.**
- Only admins see/operate the manager menu.
- Generating a month, cancelling a training (with client notifications), and changing capacity all
  reflect immediately in client-facing availability.
- Roster and fill overview show correct numbers.

**Tests.** Service: admin gate on every action; cancel → notify + status; capacity change recompute and
the below-booked guard.

**Dependencies.** T1.1–T1.5, T2.2, T2.4, T3.1.

**Open questions.** Whether to add a web admin later. **Decided: yes** — a React + Vite console
(`apps/admin`) has been scaffolded as the web counterpart to the bot menu (the API is already
web-ready). The scaffold is a shell wired to `GET /health`; the admin-facing API endpoints above and
the browser auth they require (no token/session auth exists today — admin is `ADMIN_TELEGRAM_IDS`
checked with a telegram_id) are a separate follow-up feature. Bot-based manager control remains the
MVP path and must keep working regardless.
