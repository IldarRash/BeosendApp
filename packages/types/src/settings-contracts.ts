import { z } from "zod";
import { normalizeUsername } from "./common";

/** Manager contact shown to clients. Allows handles, phones, or short free text. */
export const managerContactValueSchema = z.string().trim().min(1).max(120);

export const managerContactSchema = z
  .object({
    contact: managerContactValueSchema,
    url: z.string().url().nullable()
  })
  .strict();
export type ManagerContact = z.infer<typeof managerContactSchema>;

export const updateManagerContactSchema = z
  .object({
    contact: managerContactValueSchema
  })
  .strict();
export type UpdateManagerContactInput = z.infer<typeof updateManagerContactSchema>;

export const requestLoggingSettingsSchema = z
  .object({
    detailed: z.boolean()
  })
  .strict();
export type RequestLoggingSettings = z.infer<typeof requestLoggingSettingsSchema>;

export const updateRequestLoggingSettingsSchema = z
  .object({
    detailed: z.boolean()
  })
  .strict();
export type UpdateRequestLoggingSettingsInput = z.infer<
  typeof updateRequestLoggingSettingsSchema
>;

/** Build a t.me link only for a valid Telegram username/handle; other contacts stay plain text. */
export function managerContactTelegramUrl(contact: string): string | null {
  const username = normalizeUsername(contact);
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    return null;
  }
  return `https://t.me/${username}`;
}
