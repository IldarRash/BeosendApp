import { z } from "zod";
import { entityStatus, telegramUsername, uuid } from "./common";

/**
 * A manager (admin) record managed in the admin console. Authorization is the
 * union of env ADMIN_TELEGRAM_IDS and the active managers here whose numeric
 * telegramId is known. A manager may be added by @username before their id is
 * known; the id is backfilled when they first authenticate (Telegram Login
 * Widget / Mini App / bot), at which point their admin access becomes active.
 */
export const managerSchema = z.object({
  id: uuid,
  name: z.string().nullable(),
  telegramId: z.number().int().nullable(),
  /** Normalized @username (no "@"); the link target until telegramId is set. */
  telegramUsername: z.string().nullable(),
  status: entityStatus
});
export type Manager = z.infer<typeof managerSchema>;

/**
 * Create a manager by numeric id, by @username, or both — at least one identity
 * is required (a manager with no identity could never be matched). The username
 * is normalized (leading "@" stripped, lowercased) by the shared primitive.
 */
export const createManagerSchema = z
  .object({
    name: z.string().min(1).optional(),
    telegramId: z.number().int().positive().optional(),
    telegramUsername: telegramUsername.optional()
  })
  .refine((value) => value.telegramId != null || value.telegramUsername != null, {
    message: "Provide a Telegram id or @username",
    path: ["telegramUsername"]
  });
export type CreateManagerInput = z.infer<typeof createManagerSchema>;

/** Partial update; null clears an identity field (e.g. unlink a username). */
export const updateManagerSchema = z
  .object({
    name: z.string().min(1).nullable(),
    telegramId: z.number().int().positive().nullable(),
    telegramUsername: telegramUsername.nullable(),
    status: entityStatus
  })
  .partial();
export type UpdateManagerInput = z.infer<typeof updateManagerSchema>;
