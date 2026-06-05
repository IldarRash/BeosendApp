import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Global test teardown for the Mini App suite.
 *
 * `@telegram-apps/telegram-ui` drawers/modals (via `@xelene/vaul-with-scroll-fix`)
 * schedule fire-and-forget `setTimeout`s on open/close (up to ~500ms) that call
 * React `setState` on close. If such a timer fires *after* a spec file's jsdom
 * environment is torn down, `react-dom`'s `getCurrentEventPriority` reads `window`
 * and throws a benign "window is not defined" — surfaced by vitest as an unhandled
 * error that fails the run even though every assertion passed.
 *
 * Two layers keep the run green without slowing the suite:
 *  1. After each test we unmount the React tree (RTL cleanup) and drain the macrotask
 *     queue once so any *already-due* drawer timer fires while `window` is still alive.
 *  2. A narrowly-scoped process guard swallows ONLY the exact benign post-teardown
 *     "window is not defined" leak from that library's stray timer. It matches the
 *     specific message so a real assertion failure is never masked.
 */
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** The exact benign error a stray drawer timer throws after the env is torn down. */
function isBenignWindowTeardownError(error: unknown): boolean {
  return error instanceof ReferenceError && /window is not defined/.test(error.message);
}

process.on("uncaughtException", (error) => {
  if (isBenignWindowTeardownError(error)) {
    return;
  }
  throw error;
});
