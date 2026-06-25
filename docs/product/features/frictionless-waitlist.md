# Feature: Frictionless waitlist

**Slug:** `frictionless-waitlist` · **Branch:** `feature/frictionless-waitlist`

## Goal

Make the waitlist automatic and visible instead of a separate, manual opt-in.

- The client only decides "book / buy or not". If the group session is full they are
  queued **automatically** — no second "join the waitlist?" tap.
- When a seat frees (cancel/decline, or admin/trainer action) the next person is
  **auto-booked** and gets a **notification**. The 30-minute "confirm within…" window is
  removed.
- A subscription buyer sees the waitlisted dates immediately, and the subscription view
  shows that they are waitlisted on some dates.
- The waitlist is shown **under each training's roster** (client + admin).

## Non-negotiable constraints

- **Group trainings only.** A training is *group* when `trainings.groupId` is set,
  *individual* when null. Individual trainings have no waitlist and stay visible only to
  their creator.
- Capacity/status recompute (`open ↔ full`) stays server-side and must never oversell.
- Money stays RSD, computed server-side. Bot/miniapp/admin remain interaction layers.
- Client never sees other clients' ids/full names (privacy-narrowed roster, as today).

## Decisions (owner-confirmed)

1. Auto-book + notify on a freed seat (remove confirm window + `accept`).
2. Full single-training slots stay hidden; single-training waitlist only via the
   booking-race (409) path; subscriptions keep auto-queuing full dates.
3. Notify both the promoted client and the swap-displaced client.
4. Admin waitlist lives only under the roster; the per-group Waitlist page is removed.
5. Waitlist applies to group trainings only.

## Contracts / tables touched

- Notification enums (`notification_template_key`, `notification_type`): rename
  `waitlist-slot` → `waitlist-promoted`, add `waitlist-displaced` (+ placeholders,
  audience, default ru/sr/en bodies). New Drizzle migration.
- `waitlistStatus`: `notified`/`expired` + `notifiedAt` become unused legacy (left in
  the enum; no code reads/writes them).
- Subscription list item gains `waitlistedCount`; `myBookingItemSchema` carries
  `groupSubscriptionId`. Remove `groupWaitlistQuerySchema`, `WAITLIST_WINDOW_MINUTES`.

## Acceptance criteria

- Booking a full group session waitlists in one step (position shown); cancelling frees
  the seat → next person auto-booked + notified; never oversells.
- Admin promote/swap from under the roster notifies promoted (+ displaced on swap).
- Subscription with full dates: dates waitlisted at purchase (+ bonus credit) and shown
  as waitlisted in My Bookings and admin Subscriptions.
- Individual trainings never enter any waitlist flow.
- No separate admin Waitlist page remains; `pnpm typecheck && lint && test && build`
  green; live e2e verified.

Full execution detail: see the approved plan
(`~/.claude/plans/prancy-snuggling-pine.md`).
