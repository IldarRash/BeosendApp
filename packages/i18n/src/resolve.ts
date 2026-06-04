import { DEFAULT_LOCALE } from "./locales";
import { getStaticCatalog } from "./catalog";

const RU_STATIC = getStaticCatalog(DEFAULT_LOCALE);

/** Replace {param} tokens with their (stringified) values. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/**
 * Resolve a key against the given catalog with {param} interpolation. Pure.
 *
 * Resolution order: the provided catalog → the static RU catalog → the key
 * itself. This makes a missing SR/EN key (or a missing override) fall back to
 * the authoritative RU string, and an entirely unknown key render as its key.
 */
export function t(
  catalog: Record<string, string>,
  key: string,
  params?: Record<string, string | number>
): string {
  const template = catalog[key] ?? RU_STATIC[key] ?? key;
  return interpolate(template, params);
}
