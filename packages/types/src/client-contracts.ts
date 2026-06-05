import { z } from "zod";
import { clientSource, entityStatus, uuid } from "./common";
import { localeSchema } from "./i18n-contracts";

// --- Clients (3.1) ---
export const clientSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  /** Null for walk-in clients (no Telegram account); set for bot-onboarded. */
  telegramId: z.number().int().nullable(),
  telegramUsername: z.string().nullable(),
  levelId: uuid.nullable(),
  /** "telegram" (bot-onboarded) or "walk_in" (created manually by an admin). */
  source: clientSource,
  /** Optional walk-in contact details. */
  phone: z.string().nullable(),
  note: z.string().nullable(),
  /** Per-user UI locale for the bot; defaults to "ru" server-side. */
  language: localeSchema,
  registeredAt: z.string().datetime(),
  status: entityStatus
});
export const onboardClientSchema = z.object({
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable().optional(),
  name: z.string().min(1),
  levelId: uuid.nullable().optional()
});
/**
 * Admin clients-list filter (GET /clients). `search` is a case-insensitive
 * substring matched against the client's name OR Telegram @username (the service
 * strips a leading "@" and treats blank as "no filter"); `status` narrows by
 * active/inactive. Unknown fields are rejected. Admin-only, enforced server-side.
 */
export const listClientsQuerySchema = z
  .object({
    search: z.string().trim().optional(),
    status: entityStatus.optional()
  })
  .strict();

export type Client = z.infer<typeof clientSchema>;
export type OnboardClientInput = z.infer<typeof onboardClientSchema>;

/**
 * Admin walk-in creation (Feature 5): a client by name with no Telegram id.
 * Phone/note optional. Strict so stray fields are rejected.
 */
export const createWalkInSchema = z
  .object({
    name: z.string().min(1),
    phone: z.string().min(1).optional(),
    note: z.string().min(1).optional()
  })
  .strict();
export type CreateWalkInInput = z.infer<typeof createWalkInSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
