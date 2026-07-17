# Same-day freed-slot automatic broadcast

## Goal

Automatically notify a manager-selected Telegram audience when a booking owner explicitly cancels their own booking and leaves usable capacity in a public group training later that same Europe/Belgrade calendar day. The training does not need to have been full before the cancellation. The automation is disabled until a manager configures and enables it, and the existing manual `freed-up` broadcast is unchanged.

The smallest end-to-end slice is: persist one global policy, handle booking-owner self-cancellation through the successful `POST /bookings/:id/cancel` path, honor existing waitlist priority, create at most one event and automatic broadcast per training occurrence with dedicated delivery records, perform one event-level eligibility recheck, and make at most one intentional Telegram send attempt per selected recipient.

## Spec refs

- `docs/product/feature-roadmap.md` is absent at planning time, so there is no roadmap slice to cite.
- Source requirements are the approved analyst and architecture decisions captured in this brief.
- The existing manual today/tomorrow/week/`freed-up` broadcasts are separate behavior. Their filters, audience resolution, and manual send flow do not change in this slice.

## Contracts & tables

Contract names are logical names; implementation should follow existing repository naming conventions.

- Add shared settings contracts for the global freed-slot automation policy:
  - `enabled: boolean`, default `false`;
  - `audienceSegment`, using the existing broadcast audience vocabulary;
  - enabling without a valid selected audience is rejected.
- Persist the policy in the global `app_settings` singleton. Do not create per-manager, per-group, or per-tenant policy rows.
- Reuse the existing Telegram training CTA and booking contracts. The notification does not reserve capacity or introduce a second booking path.
- Add a dedicated freed-slot event table containing the triggering cancellation/booking identity, training occurrence identity, creation time, event status, and immutable snapshots of the selected audience, occurrence date, start time, capacity, and booked count. Enforce one event per training occurrence with a unique `trainingId`; later qualifying cancellations for that occurrence do not create another event or broadcast.
- Add a dedicated freed-slot delivery table containing the event identity, recipient identity, Telegram outcome metadata, and an outcome of `claimed`, `sent`, `failed`, or `ambiguous`. Enforce one delivery record per `(event_id, recipient_id)`.
- The event and delivery tables are audit and one-shot dispatch state, not a retry outbox. They must not support a sweep that rediscovers events or intentionally retries failed/ambiguous sends.
- Sanitize persisted and logged delivery errors: redact URLs, Telegram chat identifiers, bot tokens and token-shaped credentials; collapse control whitespace; trim; and bound the stored text length. Sanitized diagnostics must not expose secrets or recipient identifiers.
- Existing booking, training capacity, group visibility, and waitlist data remain authoritative. No stored capacity snapshot becomes a second source of truth.

## API

### Admin policy

- `GET /settings/freed-slot-automation`
  - authorization: existing manager/admin settings guard;
  - response: the persisted global freed-slot automation settings contract, defaulting to disabled when not yet configured.
- `PATCH /settings/freed-slot-automation`
  - authorization: existing manager/admin settings guard;
  - request: `enabled` and an audience from the existing segment contract;
  - response: the fully persisted settings contract;
  - validation: enabling without a recognized configured audience is rejected.

### Cancellation trigger

- Only a successful explicit `POST /bookings/:id/cancel` request in which the authenticated booking owner cancels their own booking may create this automatic event.
- Event work starts after the cancellation transaction commits, so notification failures cannot undo the cancellation.
- There is no public or internal "send freed slot" endpoint and no periodic recovery or discovery sweep.
- An admin/roster fallback cancellation, individual-session cancellation, manager decline, booking transfer, capacity edit, schedule edit, and any other path that happens to increase capacity do not trigger this automation.

The existing booking endpoint remains the CTA target and performs the final capacity, eligibility, and authorization checks.

## Admin flow

1. A manager opens the existing settings area.
2. The manager selects an audience from the existing broadcast segment vocabulary, enables "Same-day freed slot", and saves. Enabling is blocked until an audience is selected.
3. Admin reloads the global policy through `GET /settings/freed-slot-automation` and shows the saved enabled/disabled state and audience.

Disabling the policy prevents new sends that have not passed their event-level pre-send recheck. It does not undo cancellations or already attempted sends. No manual preview/send action is added.

## Bot flow

1. An eligible recipient receives one Telegram DM naming the group training and indicating that a place may be available.
2. The recipient taps the existing training/booking CTA.
3. The existing booking flow evaluates current truth. If capacity remains, the recipient can book; if capacity is gone, the existing safe outcome reports the training unavailable or places the recipient on the waitlist according to existing booking behavior.

The message is informational: it is not a reservation or capacity promise.

## Invariants

- **Booking-owner self-cancellation only.** The automation is entered only after a successful `POST /bookings/:id/cancel` in which the authenticated booking owner cancels their own booking. Admin/roster fallback cancellation, incidental capacity changes, and all other excluded cancellation/decline/transfer paths are ignored.
- **Post-commit isolation.** The cancellation commits before event creation or delivery work. Any later failure leaves the cancellation intact.
- **Public group training only.** The occurrence must belong to a group that is publicly visible under the existing visibility rule. Individual sessions and non-public groups are ineligible.
- **Fixed timezone and time window.** The cancellation and training start must fall on the same calendar date in `Europe/Belgrade`, and the recheck must occur strictly before the training start. Worker-host timezone is never used.
- **Waitlist priority.** If any waitlist entry for the occurrence is in `waiting` or `notified` state, automatic broadcast is blocked. This automation never competes with or bypasses those recipients.
- **Usable capacity without prior-full gating.** After the cancellation commits, and again at the single event-level pre-send recheck, the occurrence must be bookable under the backend's authoritative capacity rules. Eligibility does not depend on whether the occurrence was full before the cancellation.
- **One automatic broadcast per occurrence.** `trainingId` is unique in the event table. The first qualifying booking-owner self-cancellation may claim the occurrence; every later cancellation for the same occurrence is suppressed even if its booking identity differs.
- **Immutable event audit context.** The event records the selected audience, occurrence date, start time, capacity, and booked count as immutable trigger-time context. These snapshots support audit only and do not replace current training state for eligibility or booking.
- **Recipient exclusions.** Audience resolution excludes the cancelling user, anyone already `booked` or `pending` for the occurrence, and anyone with a `waiting` or `notified` waitlist entry for it.
- **One event-level pre-send recheck.** Immediately before dispatch begins, recheck policy enabled state, public group visibility, Europe/Belgrade same-day/pre-start eligibility, usable capacity, and absence of blocking waitlist entries once for the whole event. Do not make per-recipient availability rechecks.
- **At-most-one intentional attempt.** Each selected recipient is claimed through a delivery record whose outcome moves from `claimed` to `sent`, `failed`, or `ambiguous`, and receives at most one intentional Telegram send call. A known Telegram HTTP response failure is definite and recorded as `failed`. A transport error, timeout, or inability to persist success after Telegram accepted the send is recorded as `ambiguous`. No failed or ambiguous attempt is retried, and no claim of exactly-once external delivery is made.
- **Sanitized diagnostics.** Delivery errors persisted or logged by this flow are sanitized to redact URLs, Telegram chat identifiers, bot tokens and token-shaped credentials, collapse control whitespace, trim, and limit length.
- **No recovery sweep.** There is no timer that rescans cancellations, events, capacity, or failed deliveries. A failure may mean a notification is missed; this is the accepted tradeoff for avoiding duplicate intentional sends.
- **Backend ownership.** Trigger qualification, timezone logic, waitlist blocking, capacity checks, audience exclusions, event claiming, and delivery state are backend decisions. Admin and bot only configure or render validated state.
- **Manual behavior unchanged.** The automatic event and the existing manual `freed-up` broadcast remain separate concepts; no manual filter, label, date range, endpoint, or delivery behavior changes.

## Acceptance criteria

- The global policy reads as disabled before any manager configures it.
- A manager can select an existing audience segment, enable the policy, reload, and see the same global configuration.
- A non-manager cannot read or mutate the policy.
- A successful booking-owner self-cancellation through `POST /bookings/:id/cancel` for a public visible group training later on the same `Europe/Belgrade` date can create one freed-slot event after commit.
- No event is created for an admin/roster fallback cancellation, an individual session, a non-public group, a manager decline, a transfer, a capacity/schedule change, or any cancellation path other than the authenticated booking owner's explicit booking-cancel endpoint.
- A qualifying occurrence can trigger without having been full before cancellation; current usable capacity after commit is sufficient.
- A cancellation on another `Europe/Belgrade` date, or at/after the training start, sends nothing.
- Any `waiting` or `notified` waitlist entry blocks the broadcast.
- The resolved recipient set excludes the cancelling user and all users already booked, pending, waiting, or notified for the occurrence.
- Before any recipient dispatch begins, one event-level recheck confirms the policy is enabled and the occurrence still satisfies visibility, time, capacity, and waitlist conditions.
- If that recheck fails, no recipient send is attempted and the event records why it was skipped.
- If it passes, each delivery moves from `claimed` to `sent`, `failed`, or `ambiguous` after at most one intentional Telegram send call, with no retry.
- Once an event exists for a `trainingId`, reinvoking internal handling or processing any later cancellation for that occurrence does not create another event, broadcast, or intentional delivery attempt.
- Known Telegram HTTP failures are recorded as `failed`; transport errors, timeouts, and post-send persistence uncertainty are recorded as `ambiguous`.
- Persisted and logged delivery errors are sanitized so URLs, Telegram chat identifiers, bot tokens, token-shaped credentials, control whitespace, and excessive length cannot leak unsafe diagnostics.
- Telegram, audience-resolution, event-recording, or delivery-recording failure never reverts the committed cancellation.
- A recipient opening a stale CTA receives the existing unavailable/full outcome or existing waitlist option; capacity is never exceeded.
- Existing manual today/tomorrow/week/`freed-up` broadcasts behave exactly as before.

## Tests

### Contracts and settings API

- Parse disabled and enabled policies with each allowed existing audience segment.
- Reject an enabled policy with a missing or unknown audience segment.
- Verify manager read/update authorization and forbidden non-manager access.
- Verify global `app_settings` singleton round-trip and default-disabled behavior through `GET/PATCH /settings/freed-slot-automation`.

### Trigger and eligibility

- Successful booking-owner self-cancellation, public visible group, same `Europe/Belgrade` date, before start, free capacity, and no blocking waitlist: create one event after commit whether or not the occurrence was previously full.
- Disabled policy: cancellation succeeds but dispatch is skipped.
- Individual session and non-public group: do not create/send an event.
- Different local date, exactly at start, and after start: do not send.
- `waiting` waitlist entry and `notified` waitlist entry: each blocks dispatch.
- Admin/roster fallback cancellation, manager decline, transfer, capacity edit, schedule edit, and non-endpoint cancellation paths: do not trigger.
- Exercise Europe/Belgrade midnight and daylight-saving boundaries independently of the host timezone.

### Recipient resolution

- Exclude the cancelling user.
- Exclude users with booked or pending bookings for the occurrence.
- Exclude users with waiting or notified waitlist entries for the occurrence.
- Preserve all other restrictions of the configured existing audience segment.

### One-shot dispatch and races

- Recheck once at event level immediately before dispatch; do not recheck per recipient.
- Recheck sees policy disabled, group hidden, start reached, no capacity, or a waiting/notified entry: make zero send attempts and persist the skip reason.
- Re-enter handling for the same cancellation, process a different later cancellation for the same `trainingId`, and race concurrent event creation: occurrence-level database uniqueness allows one event and one automatic broadcast for the training occurrence.
- Concurrently claim the same delivery: database uniqueness/atomic state allows one `claimed` record and at most one intentional send call per recipient.
- Verify the event stores immutable snapshots of the selected audience, occurrence date, start time, capacity, and booked count while current state remains authoritative for the pre-send recheck and CTA.
- Telegram success becomes `sent`; a known Telegram HTTP failure becomes `failed`; a transport error or timeout becomes `ambiguous`; failure to persist success after Telegram accepts the send also becomes `ambiguous`. None is retried.
- Verify enhanced diagnostic sanitization redacts URLs, Telegram chat identifiers, bot tokens and token-shaped credentials, collapses control whitespace, trims, and limits persisted/logged error text.
- Verify there is no sweep/recovery path that rediscovers skipped, failed, or ambiguous work.
- Event creation, audience resolution, and Telegram failures do not revert the committed cancellation.
- Capacity disappears after the event-level recheck but before CTA use: the existing booking endpoint returns unavailable/full or applies existing waitlist behavior without overbooking.

### Regression

- Existing cancellation and capacity recompute tests remain green.
- Existing booking/waitlist behavior remains green.
- Existing manual today/tomorrow/week/`freed-up` selection and delivery tests remain green without semantic changes.

## Dependencies

- Existing explicit `POST /bookings/:id/cancel` transaction and capacity recompute behavior.
- Existing global `app_settings` singleton and manager/admin authorization boundary.
- Existing public group visibility rule.
- Existing booking and waitlist states, including `booked`, `pending`, `waiting`, and `notified`.
- Existing manual broadcast audience segment vocabulary and recipient resolution.
- Existing Telegram DM delivery and booking CTA.

No dependency exists on a retry worker, periodic sweep, exactly-once delivery mechanism, changing waitlist behavior, or changing manual `freed-up` semantics.

## Open questions and chosen defaults

- **Where does the policy live?** Decision: the global `app_settings` singleton.
- **Which API owns it?** Decision: `GET/PATCH /settings/freed-slot-automation` under the existing manager/admin settings guard.
- **What is the initial audience?** Decision: none; the automation remains disabled until a manager selects a valid existing segment.
- **Which clock defines eligibility?** Decision: `Europe/Belgrade`; same local date and strictly before start.
- **Which cancellation triggers it?** Decision: only a successful `POST /bookings/:id/cancel` in which the authenticated booking owner cancels their own booking; admin/roster fallback cancellation does not.
- **Must the occurrence have been full?** Decision: no; only authoritative usable capacity after commit and at the pre-send recheck is required.
- **What is the anti-spam boundary?** Decision: one event and automatic broadcast per training occurrence, enforced by unique `trainingId`; deduplication is occurrence-scoped rather than cancellation-scoped.
- **How is waitlist priority protected?** Decision: any `waiting` or `notified` entry blocks the event send.
- **When is current state rechecked?** Decision: once per event immediately before dispatch begins, never once per recipient.
- **How are failures handled?** Decision: persist `claimed`, `sent`, `failed`, or `ambiguous`; known Telegram HTTP failures are definite, while transport/timeouts and post-send persistence uncertainty are ambiguous. Sanitize diagnostics and do not retry or sweep. External exactly-once delivery is not promised.
- **What happens when a CTA is stale?** Decision: the existing booking flow reports unavailable/full or offers/applies the existing waitlist behavior.
- **Does this alter manual `freed-up`?** Decision: no; manual behavior remains unchanged.
- **Should the full agent flow run?** Decision: yes; the user approved the full analyst/architect/implementer/test/review/run flow.
- **May implementation begin?** Decision: not yet. The implementation plan must be presented to and approved by the user before any implementer, tester, reviewer, migration, cleanup, or app-runner work starts.
