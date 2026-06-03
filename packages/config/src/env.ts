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
  MANAGER_CONTACT: z.string().min(1).default("@beosand_manager")
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

export function isAdmin(env: Pick<Env, "ADMIN_TELEGRAM_IDS">, telegramId: number | string): boolean {
  return env.ADMIN_TELEGRAM_IDS.includes(String(telegramId));
}
