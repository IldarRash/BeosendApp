/**
 * Capped exponential backoff for webhook retries (connectors §6). After an attempt
 * fails, the next attempt is scheduled `BASE * 2^(attempts-1)` from now, capped at
 * `MAX_DELAY_MS`. Once `attempts >= maxAttempts` the endpoint is exhausted and no
 * further retry is scheduled (`null`). Pure — unit-testable without Nest/DB/timers.
 */

/** First retry delay: 1 minute after the initial failure. */
const BASE_DELAY_MS = 60_000;
/** Cap so a long-dead endpoint doesn't push retries days out. */
const MAX_DELAY_MS = 60 * 60_000; // 1 hour

/**
 * Given the attempt count just recorded (1-based) and the configured cap, return the
 * next retry instant, or null when attempts are exhausted. `now` is injected so the
 * scheduler/dispatcher and tests share one clock.
 */
export function nextAttemptAt(attempts: number, maxAttempts: number, now: Date): Date | null {
  if (attempts >= maxAttempts) {
    return null;
  }
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
  return new Date(now.getTime() + delay);
}
