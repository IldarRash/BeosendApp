import { z } from "zod";
import { entityStatus, uuid } from "./common";

// --- Clients (3.1) ---
export const clientSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  levelId: uuid.nullable(),
  registeredAt: z.string().datetime(),
  status: entityStatus
});
export const onboardClientSchema = z.object({
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable().optional(),
  name: z.string().min(1),
  levelId: uuid.nullable().optional()
});
export type Client = z.infer<typeof clientSchema>;
export type OnboardClientInput = z.infer<typeof onboardClientSchema>;
