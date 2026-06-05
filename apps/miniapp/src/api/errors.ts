import type { TranslateFn } from "../i18n/LanguageProvider";
import { ConflictError } from "./client";

/**
 * The one place that turns a mutation/query error into a user-facing message,
 * shared by every screen so the conflict/error idiom can't drift:
 *
 *   - a {@link ConflictError} (409) → its server message verbatim, or, when the
 *     body carried none, the caller's localized conflict fallback (if supplied);
 *   - any other Error → its message verbatim;
 *   - anything else (or no error) → undefined (nothing to show).
 *
 * Interaction layer only: it never invents domain text — the server's message
 * wins, and `conflictFallbackKey` is a localized last resort for an empty 409.
 */
export function resolveErrorMessage(
  error: unknown,
  t: TranslateFn,
  conflictFallbackKey?: string
): string | undefined {
  if (error instanceof ConflictError) {
    return error.message || (conflictFallbackKey ? t(conflictFallbackKey) : undefined);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
}
