# Trainer individual visibility

## Goal

Let admins hide a trainer from the Mini App individual-training picker without deactivating the
trainer for groups, schedules, history, or direct individual-request compatibility.

## Spec refs

- Roadmap Stage 1 trainers reference data.
- Mini App individual request feature.
- User request: admins can turn off visibility in individual trainings so users do not choose a
  trainer by mistake.

## Contracts & tables

- `packages/db/src/schema.ts`
  - Add `trainers.individual_visible boolean not null default true`.
  - Generate and commit a Drizzle migration.
- `packages/types/src/training-contracts.ts`
  - Add `individualVisible: boolean` to `trainerSchema`.
  - Accept it in create/update trainer schemas.

## API

- `GET /trainers`
  - Existing default returns active trainers for reference/admin/group usage.
- `GET /trainers?scope=individual`
  - Returns only active trainers with `individualVisible = true`.
- `POST /trainers/:id/individual-request`
  - Stays compatible: an active hidden trainer can still be requested directly by id.
  - Individual requests notify admins/manager staff with the chosen trainer named; they do not DM the
    trainer directly.
- `POST /trainers` and `PATCH /trainers/:id`
  - Admin can set/update `individualVisible`.

## Admin and Mini App flow

- Admin `/trainers` table shows whether a trainer is visible in individual requests.
- Trainer create/edit dialog includes “Показывать в индивидуальных тренировках”.
- Mini App `TrainerRequestScreen` and the bot individual picker use `GET
  /trainers?scope=individual`.
- Group filter/picker usage keeps the default `GET /trainers`.

## Invariants

- `status = inactive` still removes a trainer from active reference reads.
- `individualVisible = false` only hides the trainer from the individual picker.
- Direct individual requests still require an onboarded client and an active trainer.
- Direct individual requests keep the admin/manager notification path and include the chosen trainer
  name.
- Admin writes remain admin-only.

## Acceptance criteria

- New trainers are visible in individual requests by default.
- Admin can hide/show a trainer from the trainers screen.
- Hidden active trainers do not appear in the Mini App or bot individual picker.
- Direct request by hidden active trainer id still follows the existing delivered/unavailable behavior.

## Tests

- Contract and schema tests cover `individualVisible`.
- API service/repository tests cover default active list vs individual-visible list.
- Admin page tests cover rendering and submitting the toggle.
- Mini App and bot tests cover hidden trainers not appearing in the individual picker.

## Dependencies

- Existing trainers API and Mini App individual request flow.

## Open questions

- Direct hidden-trainer request behavior: keep it allowed for compatibility.
