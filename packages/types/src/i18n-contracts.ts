import { z } from "zod";

/**
 * Localization contracts. The supported locales mirror @beosand/i18n
 * (`Locale = "ru" | "sr" | "en"`, fallback "ru"). Declared here (not imported
 * from @beosand/i18n) so the Zod contract layer stays dependency-free, the same
 * way common.ts owns its primitives.
 */
export const localeSchema = z.enum(["ru", "sr", "en"]);
export type Locale = z.infer<typeof localeSchema>;

/** A persisted per-(locale, key) label override row served by the API. */
export const labelSchema = z
  .object({
    locale: localeSchema,
    key: z.string().min(1),
    value: z.string()
  })
  .strict();
export type Label = z.infer<typeof labelSchema>;

/** Admin write to upsert a single override (PUT body). */
export const updateLabelSchema = z
  .object({
    locale: localeSchema,
    key: z.string().min(1),
    value: z.string()
  })
  .strict();
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

/**
 * The merged catalog the API serves for one locale: static defaults overlaid
 * with DB overrides, as a flat dotted-key → string map. Consumed by both the
 * admin console and the bot.
 */
export const labelCatalogSchema = z.record(z.string(), z.string());
export type LabelCatalog = z.infer<typeof labelCatalogSchema>;

/**
 * One row in the admin label editor: the canonical default plus the current
 * override (null when none exists, so the editor can show "using default").
 */
export const labelEntrySchema = z
  .object({
    key: z.string().min(1),
    defaultValue: z.string(),
    override: z.string().nullable()
  })
  .strict();
export type LabelEntry = z.infer<typeof labelEntrySchema>;
