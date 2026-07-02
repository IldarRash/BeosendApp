# Feature brief: Request logging toggle

Slug: `request-logging-toggle`

## Goal

Let admins turn detailed API request logging on from the web console for short operational
debugging windows, while ordinary mode stays low-noise and no log mode can expose credentials,
session tokens, cookies, photos, or similar sensitive fields.

## Spec refs

- Accepted operational plan: admin-toggleable API request logging.
- Roadmap active initiative: `admin-console` as the manager/admin web interaction layer.
- `docs/product/features/admin-console.md`: admin settings/connectors surface and typed ApiClient.
- `docs/product/features/connectors.md`: Connectors page as the operational settings area.
- Architecture refs: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, and
  `docs/architecture/database.md`.
- Product invariants: API is the source of truth; admin UI is interaction-only; shared contracts live
  in `packages/types`; schema lives in `packages/db`; secrets must never be logged.

## Contracts & tables

- `packages/types/src/settings-contracts.ts`:
  - Add `requestLoggingSettingsSchema = z.object({ detailed: z.boolean() }).strict()`.
  - Add `updateRequestLoggingSettingsSchema = z.object({ detailed: z.boolean() }).strict()`.
  - Export `RequestLoggingSettings` and `UpdateRequestLoggingSettingsInput`.
- `packages/db/src/schema.ts`: reuse existing `app_settings(key, value, updated_at, updated_by)`.
  - Key: `request_logging_detailed`.
  - Stored value: `"true"` or `"false"`.
  - Default: missing key means `{ detailed: false }`.
  - No new table and no migration.
- `apps/api/src/modules/settings`: extend `SettingsService`/`SettingsRepository`; keep DB access in
  the repository and the admin gate in the service.
- Add one central request logging sanitizer/helper in `apps/api`; do not duplicate masking logic per
  controller.

## API

| Method | Endpoint | Request | Response | Auth |
| --- | --- | --- | --- | --- |
| `GET` | `/settings/request-logging` | none | `requestLoggingSettingsSchema` | Admin by default |
| `PATCH` | `/settings/request-logging` | `updateRequestLoggingSettingsSchema` | `requestLoggingSettingsSchema` | Admin-only via `SettingsService` admin gate |

Implementation notes:

- Controllers stay thin: parse actor from the existing bridged `x-telegram-id`, Zod-validate the body,
  and call `SettingsService`.
- The admin ApiClient validates both request and response with the new contracts.
- A non-admin or missing/invalid actor on `PATCH` must not change the setting.

## Bot flow

No bot UI is added. Bot-originated HTTP calls to `apps/api` are covered by the same global API logging
path and identify the actor from the same request identity headers used today.

## Invariants

- Logs never include raw values for keys matching sensitive names, case-insensitively and at any depth:
  `authorization`, `cookie`, `set-cookie`, `password`, `token`, `secret`, `hash`, `session`, `jwt`,
  `adminSession`, `photoUrl`, and similar nested keys. Arrays and nested objects are sanitized
  recursively.
- Ordinary mode logs only route invocation, actor/user identity when available, status, duration, and
  essential route info. It must not log query, body, or headers.
- Detailed mode logs every `apps/api` HTTP endpoint with method, path, query, sanitized body,
  sanitized selected headers, actor/user, status, and duration.
- The middleware/interceptor reads the current setting through one central service/helper; no
  per-controller logging branches.
- Logging is observational only: sanitizer or log write failures must not change API responses,
  bookings, court availability, money, notifications, or connector delivery behavior.
- The admin console remains interaction-only and imports contracts from `@beosand/types`, not server
  config.

## Acceptance criteria

1. With no `request_logging_detailed` row, `GET /settings/request-logging` returns
   `{ detailed: false }`.
2. An admin can toggle the setting from the Connectors page operational settings block; the toggle
   persists in `app_settings` and reflects after reload.
3. A non-admin update path is rejected and leaves the stored value unchanged.
4. Ordinary mode emits one low-noise log for each handled HTTP request with route/method, actor/user,
   status, duration, and no body/query/header values.
5. Detailed mode emits method, path, query, sanitized body, sanitized selected headers, actor/user,
   status, and duration for every `apps/api` HTTP endpoint.
6. Sensitive fields are masked in request bodies, query objects, and headers, including nested keys
   and case variants such as `Authorization`, `adminSession`, `photoUrl`, and `jwt`.
7. The logging layer records failed requests with their final status/duration and does not swallow or
   replace the original exception.
8. No database migration is generated for this feature.

## Tests

- Contracts: valid/invalid `requestLoggingSettingsSchema` and
  `updateRequestLoggingSettingsSchema`; unknown keys rejected.
- API settings:
  - default false when the key is absent;
  - admin `PATCH` writes `"true"`/`"false"` and returns `{ detailed }`;
  - forbidden non-admin path does not write;
  - invalid body is `400`.
- Sanitizer/logging:
  - masks sensitive header/body/query keys case-insensitively and recursively;
  - preserves non-sensitive fields;
  - ordinary mode excludes query/body/headers;
  - detailed mode includes sanitized query/body/selected headers;
  - logs success and thrown-error responses with status and duration.
- Admin:
  - ApiClient methods validate request/response;
  - hook reads and updates `["settings", "request-logging"]`;
  - Connectors page toggle renders loading/error/current states and calls update on change.

## Dependencies

- Existing `app_settings` table and `SettingsRepository`.
- Existing `SettingsService` admin gate and session bridge into `x-telegram-id`.
- Existing admin Connectors page, typed ApiClient, React Query hooks, and shared i18n.
- Nest global middleware/interceptor registration in `apps/api`.

## Open questions

1. Should `GET /settings/request-logging` be public like manager contact? Default: no; treat it as an
   operational admin setting and require the same admin identity path as `PATCH`.
2. How fresh must the middleware setting read be? Default: central service cache with a short
   implementation-owned TTL or PATCH invalidation is acceptable; absent/unreadable state falls back to
   ordinary mode (`false`).
3. Which headers are "selected" in detailed mode? Default: include diagnostics headers such as
   `content-type`, `user-agent`, `origin`, `referer`, `x-request-id`, `x-forwarded-for`,
   `x-telegram-id`, and `x-client-telegram-id`; include any sensitive selected header only as
   `[masked]`.
4. What is the log format? Default: use the existing Nest logger sink with structured object fields
   under a stable event name, not ad hoc string concatenation.
