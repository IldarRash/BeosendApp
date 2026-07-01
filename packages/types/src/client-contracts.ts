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
  /** Optional Telegram-provided profile photo URL, synced only from verified Mini App identity. */
  telegramPhotoUrl: z.string().url().nullable(),
  levelId: uuid.nullable(),
  /** "telegram" (bot-onboarded) or "walk_in" (created manually by an admin). */
  source: clientSource,
  /** Optional walk-in contact details. */
  phone: z.string().nullable(),
  /** Optional email (connectors): walk-ins may have email/phone/both/neither. */
  email: z.string().email().nullable(),
  note: z.string().nullable(),
  /** Per-user UI locale for the bot; defaults to "ru" server-side. */
  language: localeSchema,
  registeredAt: z.string().datetime(),
  /**
   * When the client accepted the personal-data-processing consent, stamped
   * server-side on first onboard. Null for walk-ins (admin-created) and clients
   * registered before consent was introduced.
   */
  consentGivenAt: z.string().datetime().nullable(),
  status: entityStatus,
  /**
   * Admin-honoured bonus-training balance: granted when a monthly subscription
   * waitlists a date, redeemed by an admin. Server-managed (never accepted on
   * create/update).
   */
  bonusTrainingCredits: z.number().int().nonnegative()
});
export const onboardClientSchema = z
  .object({
    telegramId: z.number().int(),
    telegramUsername: z.string().nullable().optional(),
    name: z.string().min(1),
    levelId: uuid.nullable().optional(),
    /**
     * Explicit affirmative consent to personal-data processing (must be literally
     * true). Onboarding is refused without it; the server stamps `consentGivenAt`.
     */
    consentAccepted: z.literal(true)
  })
  .strict();
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
 * Admin client edit: a partial patch of the editable profile fields (name, level,
 * phone, note). Identity (`telegramId`/`source`) and the bot-owned `language` are
 * never editable here. `name` keeps its non-empty rule; `levelId`/`phone`/`note`
 * stay nullable so a null clears them. Strict so stray fields are rejected. Empty
 * patch is allowed (a no-op, handled server-side). Admin-only, enforced server-side.
 */
export const updateClientSchema = clientSchema
  .pick({ name: true, levelId: true, phone: true, email: true, note: true })
  .partial()
  .strict();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/**
 * Admin walk-in creation (Feature 5): a client by name with no Telegram id.
 * Phone/note optional. Strict so stray fields are rejected.
 */
export const createWalkInSchema = z
  .object({
    name: z.string().min(1),
    phone: z.string().min(1).optional(),
    /** Optional email so a walk-in can be reached over the email channel. */
    email: z.string().email().optional(),
    note: z.string().min(1).optional()
  })
  .strict();
export type CreateWalkInInput = z.infer<typeof createWalkInSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
