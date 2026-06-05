import { z } from "zod";
import { localeSchema } from "./i18n-contracts";

/**
 * Admin web-console auth seam (admin-console brief, M0). The browser proves
 * identity via the Telegram Login Widget; the API verifies the widget HMAC,
 * confirms the id is an admin, and issues a short-lived session JWT. These are
 * the wire contracts shared by apps/api and apps/admin — no domain logic here.
 */

/**
 * Raw Telegram Login Widget payload posted to POST /auth/telegram. Keys are the
 * widget's own snake_case fields (do NOT rename) because the API rebuilds the
 * data-check-string from exactly these keys before verifying `hash`. `.strict()`
 * so an injected/unknown field can't slip past verification.
 */
export const telegramLoginPayloadSchema = z
  .object({
    id: z.number().int(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().optional(),
    auth_date: z.number().int(),
    hash: z.string()
  })
  .strict();
export type TelegramLoginPayload = z.infer<typeof telegramLoginPayloadSchema>;

/** Resolved admin identity the console shows as "logged in as". */
export const adminMeSchema = z
  .object({
    telegramId: z.number().int(),
    name: z.string(),
    username: z.string().optional()
  })
  .strict();
export type AdminMe = z.infer<typeof adminMeSchema>;

/** Response of POST /auth/telegram: the session JWT plus the admin identity. */
export const adminSessionSchema = z
  .object({
    token: z.string(),
    admin: adminMeSchema
  })
  .strict();
export type AdminSession = z.infer<typeof adminSessionSchema>;

/**
 * Telegram Mini App auth seam (miniapp FOUNDATION). Kept deliberately SEPARATE
 * from the admin schemas above so the two seams can't drift: the Mini App proves
 * identity with `initData` (validated with the WebApp HMAC, NOT the Login Widget
 * algorithm) and is always issued a `scope:"client"` session — never admin.
 */

/**
 * Raw Telegram WebApp `initData` query string posted to POST /auth/miniapp. The
 * API rebuilds the data-check-string from these key=value pairs and verifies the
 * `hash` server-side; the SPA never parses or trusts it. `.strict()` so no extra
 * field can ride along.
 */
export const miniappAuthSchema = z
  .object({
    initData: z.string().min(1)
  })
  .strict();
export type MiniappAuth = z.infer<typeof miniappAuthSchema>;

/** Resolved Mini App client identity (from the verified initData `user` field). */
export const miniappMeSchema = z
  .object({
    telegramId: z.number().int(),
    name: z.string(),
    username: z.string().optional(),
    /** Telegram `language_code`, narrowed to a supported locale when possible. */
    language: localeSchema.optional()
  })
  .strict();
export type MiniappMe = z.infer<typeof miniappMeSchema>;

/** Response of POST /auth/miniapp: the client session JWT plus the identity. */
export const miniappSessionSchema = z
  .object({
    token: z.string(),
    user: miniappMeSchema
  })
  .strict();
export type MiniappSession = z.infer<typeof miniappSessionSchema>;
