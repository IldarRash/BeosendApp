# Admin Table Controls

## Goal

Add sorting and per-column filtering to the admin Trainings and Clients tables so managers can scan
the rows they already loaded without changing backend query behavior.

## Spec refs

- `docs/product/feature-roadmap.md`: active `admin-console` initiative.
- `docs/product/features/admin-console.md`: M1 Trainings and M2 Clients as interaction-layer screens.
- `docs/product/design-plan.md`: admin screens #3 Trainings and #7 Clients.
- `docs/admin-guide.md`: daily Trainings workflow and Clients roster workflow.

## Contracts & tables

- No Zod contract changes.
- Reuse `Training`, `ListTrainingsQuery`, `Client`, and `ListClientsQuery` from `packages/types`.
- No Drizzle schema or migration changes.
- Existing tables only: `trainings`, `clients`, plus joined/reference data already read by the UI
  (`groups`, `trainers`, `levels`).

## API

- No API contract, route, request, response, pagination, or query changes.
- Keep existing server filters:
  - `GET /trainings?from&to&groupId?` returns the currently loaded Trainings table rows.
  - `GET /clients?search?&status?` returns the currently loaded Clients rows.
- Client-side table controls only sort/filter the loaded arrays returned by the existing hooks.

## Admin flow

1. Admin opens Trainings table or Clients.
2. Existing server filters still define the loaded dataset: Trainings date/group; Clients search/status.
3. Admin uses column filters to narrow the loaded rows with AND semantics across columns.
4. Admin clicks a sortable header to cycle `none -> asc -> desc -> none`; one active sort column at a
   time.
5. Clearing table controls restores the loaded rows to the API order without refetching.
6. Existing row actions continue to act on the underlying row id after sorting/filtering.

## Invariants

- Browser remains an interaction layer only: no capacity, status, money, availability, booking, or
  authorization decisions move client-side.
- Client-side filters may only narrow loaded rows; they must not imply hidden rows do not exist.
- API response validation stays in `ApiClient`; table controls operate after validation.
- Existing server date/group/status filters remain authoritative for the fetched dataset.
- Sorting/filtering must not mutate cached query data or change row action targets.

## Acceptance criteria

- Trainings table supports sortable/filterable visible columns for date, time, group, trainer, price,
  occupancy, and status.
- Clients table supports sortable/filterable visible columns for name, username, Telegram ID, level,
  status, consent date, and bonus credits.
- Filters combine with AND semantics and show an empty state when no loaded rows match.
- Sorting is stable, handles null/empty display values, and keeps numeric/date/time columns in logical
  order.
- Existing Trainings date/group and Clients search/status server filters continue to call the same API
  methods with no new query keys or params.
- Row actions still open/mutate the correct row after any sort/filter combination.
- Table controls are keyboard accessible and expose sort state via table header semantics.

## Tests

- Unit-test the reusable table-control logic for stable sort, clear/reset, null handling, numeric/date
  ordering, text matching, exact-select matching, and AND filter semantics.
- Trainings page tests: server date/group filters still drive `useTrainings`; per-column filters and
  sorting do not refetch; actions target the sorted/filtered row id.
- Clients page tests: server search/status filters still drive `useClientsList`; per-column filters and
  sorting do not add API query params; edit/bonus actions target the sorted/filtered row id.
- Accessibility test coverage for header sort buttons, `aria-sort`, labeled filter inputs, and clear
  controls.

## Dependencies

- Requires the existing admin console M1 Trainings and M2 Clients screens.
- Reuses the current `DataTable`, field controls, i18n, React Query hooks, and `ApiClient`.
- No backend, bot, database, migration, or contract dependency.

## Open questions with defaults

- Should controls persist across reloads? Default: no persistence, no URL params, no localStorage.
- Should multiple sort columns be supported? Default: single active sort column.
- How should filters match? Default: case-insensitive contains for text, exact select for enums and
  reference labels, numeric min/max for numeric columns, and exact/range controls for dates.
- Should this apply to the Trainings calendar view or other admin tables now? Default: no; only
  Trainings table view and Clients in this slice.
- Should filtering happen before sorting? Default: yes, filter loaded rows first, then sort visible rows.
