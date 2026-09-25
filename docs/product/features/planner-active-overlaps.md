# Active operational-period overlaps

## Goal

Planning a later operational period must acknowledge only source plans that
still contain real work in the shared date range. Historical cancelled or
deleted generated trainings must not keep an old period active.

## Contract

The server derives the overlap list, its fingerprint, the preview entries, and
the generation acknowledgement requirement from one effective-overlap set.

An intersecting source plan is effective only when it has at least one entry
inside the date intersection that is not `cancelled`. If the source has already
been generated, that entry must also retain its generated training mapping.
An ungenerated draft entry is retained because it is planned work. Source plans
with no effective entries are absent from the overlap warning and fingerprint.

## Invariants

- Cancellation remains historical: no monthly-plan row is deleted or rewritten.
- A deleted generated training is treated as no surviving source entry.
- Hidden active trainings remain effective blockers.
- Active generated or draft work still requires an exact acknowledgement of
  the effective plan IDs before generation; the returned fingerprint is derived
  from that same effective set.
- Period boundaries alone never create a warning or acknowledgement.

## Acceptance checks

- Empty plans, all-cancelled entries, removed generated trainings, and entries
  outside the shared dates do not appear as overlaps.
- Mixed source plans retain their active intersecting entries.
- A group can generate its later plan after the old trainings are cancelled.
- An active old training remains a blocking collision even after overlap
  acknowledgement.
