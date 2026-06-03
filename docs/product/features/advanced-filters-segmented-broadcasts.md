# T3.2 — Advanced filters & segmented broadcasts

**Goal.** Add richer client-side filters and let managers target broadcasts at a segment instead of
everyone.

**Spec refs.** ТЗ §19 (stage 3).

**Contracts & tables.** Filter/segment query contracts (`packages/types`); reuses existing tables
(`clients.level_id`, booking history). Possibly a lightweight `segment` definition (level / activity /
last-seen) computed on the fly — no new persisted table required for MVP segmentation.

**API.** `apps/api`:
- Extend availability (T1.5) with filters: level, weekday, time-of-day, trainer.
- Extend broadcasts (T2.4) with an audience selector: by level, by activity (booked in last N days),
  or lapsed clients.

**Bot flow.** Client: optional filter chips on the slots screen. Manager: pick a segment before
sending a broadcast.

**Invariants.** Admin-only for segment sends. Segments are derived read-only from authoritative data;
the broadcast still funnels into the normal booking flow.

**Acceptance criteria.**
- Filtering slots by level/time returns only matching bookable slots.
- A segmented broadcast reaches only the intended audience and records the actual recipient count.

**Tests.** Service: filter correctness; segment membership; recipient count per segment.

**Dependencies.** T1.5, T2.4, T3.1.

**Open questions.** Segment definitions to ship first. Default: by level + "active in last 30 days".
