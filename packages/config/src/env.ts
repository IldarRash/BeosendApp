import { z } from "zod";

/**
 * Environment contract for every BeoSand process.
 *
 * Loading is fail-closed: an invalid/missing required variable throws at
 * startup rather than letting a process boot in an undefined state.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  API_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Secret used to sign/verify admin web-console session JWTs (Telegram Login
   * Widget seam). Required and fail-closed: a process must not boot able to
   * mint/accept admin sessions without a configured secret. Never logged.
   */
  ADMIN_SESSION_SECRET: z.string().min(16),
  /** Comma-separated Telegram numeric IDs that act as managers/admins. */
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ),
  /** Contact handle/text shown by the bot's "Связаться с менеджером" action. */
  MANAGER_CONTACT: z.string().min(1).default("@beosand_manager"),
  /** Comma-separated browser origins allowed to call the API in production. */
  ADMIN_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ),
  /**
   * HTTPS URL of the Telegram Mini App. The bot points its menu button and
   * web_app inline buttons here. Dev-tolerant (optional) so the bot still boots
   * over a tunnel-less local setup; the bot guards on it being set. In
   * production it must be a real HTTPS origin (Telegram requires HTTPS).
   */
  MINIAPP_URL: z.string().url().optional(),
  /**
   * Base URL of the admin web console (apps/admin). Used to build a deep link in
   * the operational admin DM sent when a new court request is created. Optional
   * (the DM omits the button when unset); never a secret.
   */
  ADMIN_URL: z.string().url().optional(),
  /**
   * Comma-separated browser origins allowed to call the API in production from
   * the Mini App (the tunnel/host origin serving apps/miniapp). Sibling to
   * ADMIN_ALLOWED_ORIGINS; both are merged into the API CORS allow-list.
   */
  MINIAPP_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ),

  // --- External connectors (all optional: a missing provider is a normal
  // "disabled" state, not a boot failure; but a malformed value still fails
  // closed at startup). None is ever logged. See docs/product/features/connectors.md §4.

  // Calendar
  /** HMAC key for signed .ics feed tokens; min length so the signature has entropy. */
  CALENDAR_FEED_SECRET: z.string().min(16).optional(),
  /** Absolute base URL used to build the feed URLs shown to users. */
  PUBLIC_BASE_URL: z.string().url().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  /** Raw JSON or base64 of a Google service account; shared with Sheets. */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // Email
  /** Absent => the email channel is disabled. */
  EMAIL_PROVIDER: z.enum(["smtp", "sendgrid"]).optional(),
  EMAIL_FROM: z.string().email().optional(),
  /** smtp(s)://user:pass@host:port */
  SMTP_URL: z.string().url().optional(),
  SENDGRID_API_KEY: z.string().optional(),

  // SMS (Twilio)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Webhooks / Sheets
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  GOOGLE_SHEETS_ID: z.string().optional()
  // (Google service account reused from GOOGLE_SERVICE_ACCOUNT_JSON)
}).superRefine((env, ctx) => {
  // A half-configured email channel must not boot: a chosen provider requires its
  // creds and a from-address. (The channel adapter's isEnabled() gates on the same
  // vars at runtime; this keeps a partial config from passing startup.)
  if (env.EMAIL_PROVIDER === "smtp") {
    if (!env.SMTP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_URL"],
        message: "SMTP_URL is required when EMAIL_PROVIDER is 'smtp'"
      });
    }
    if (!env.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM is required when EMAIL_PROVIDER is 'smtp'"
      });
    }
  }
  if (env.EMAIL_PROVIDER === "sendgrid") {
    if (!env.SENDGRID_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SENDGRID_API_KEY"],
        message: "SENDGRID_API_KEY is required when EMAIL_PROVIDER is 'sendgrid'"
      });
    }
    if (!env.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM is required when EMAIL_PROVIDER is 'sendgrid'"
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Process-level set of admin Telegram ids sourced from the DATABASE (the editable
 * `managers` table), kept alongside the static env ids. Populated by the API's
 * AdminRegistryService at startup and after every managers write; empty in every
 * other context (bot, tests) so behaviour is env-only unless explicitly enabled.
 * Stays here, next to `isAdmin`, so the single synchronous admin check is the
 * union of env + DB without making 75 call sites async or DB-aware. No DB import:
 * the API hands us the resolved ids.
 */
let dbAdminIds: ReadonlySet<string> = new Set();

/** Replace the DB-sourced admin id set (idempotent; ids normalized to strings). */
export function setDbAdminIds(ids: Iterable<number | string>): void {
  dbAdminIds = new Set([...ids].map((id) => String(id)));
}

/** True if the id is a static env admin OR an active DB-backed manager. */
export function isAdmin(env: Pick<Env, "ADMIN_TELEGRAM_IDS">, telegramId: number | string): boolean {
  const id = String(telegramId);
  return env.ADMIN_TELEGRAM_IDS.includes(id) || dbAdminIds.has(id);
}

/**
 * The numeric Telegram ids of every admin — the de-duped UNION of the static env
 * ids and the DB-backed managers. This is the single recipient source for the
 * operational admin DMs (new court request, pending booking/subscription,
 * individual-session request): a list, where `isAdmin` is the membership test.
 * Returns numbers (Telegram chat ids); a non-numeric id is dropped defensively.
 */
export function adminTelegramIds(env: Pick<Env, "ADMIN_TELEGRAM_IDS">): number[] {
  const ids = new Set<string>([...env.ADMIN_TELEGRAM_IDS, ...dbAdminIds]);
  return [...ids].map((id) => Number(id)).filter((id) => Number.isFinite(id));
}
