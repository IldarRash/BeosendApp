import { z } from "zod";
import { entityStatus, uuid } from "./common";
import { localeSchema } from "./i18n-contracts";

// --- Clients (3.1) ---
export const clientSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  levelId: uuid.nullable(),
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
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
