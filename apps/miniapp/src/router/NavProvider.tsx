import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { RouteId } from "./routes";

/**
 * The Mini App's navigation stack. `home` is always the floor, so the user can
 * never navigate "below" the hub. The native BackButton (wired once at the shell)
 * drives {@link NavApi.pop}; menu cells drive {@link NavApi.push}.
 */
export interface NavApi {
  /** The route currently on top of the stack — the screen being rendered. */
  current: RouteId;
  /** True on any sub-screen (stack depth > 1); false on Home. Drives BackButton visibility. */
  canPop: boolean;
  /** Push a sub-screen. Idempotent on the top entry (re-tapping the current route is a no-op). */
  push: (id: RouteId) => void;
  /** Pop the top entry. Guarded so it never empties the stack — Home is the floor. */
  pop: () => void;
}

const NavContext = createContext<NavApi | null>(null);

interface NavProviderProps {
  /**
   * The route to seed on boot (after the onboarding gate). Defaults to `home`; a
   * recognised deep link seeds its screen on top of Home so BackButton returns to
   * the hub. Read once on mount — later `startParam` changes don't re-seed.
   */
  initial?: RouteId;
  children: ReactNode;
}

/**
 * Holds the in-memory route stack and exposes {@link useNav}. A deep-linked
 * `initial` other than `home` seeds `["home", initial]` so the native BackButton
 * pops back to the hub rather than closing the app.
 */
export function NavProvider({ initial = "home", children }: NavProviderProps): JSX.Element {
  const [stack, setStack] = useState<RouteId[]>(() =>
    initial === "home" ? ["home"] : ["home", initial]
  );

  const push = useCallback((id: RouteId) => {
    setStack((prev) => (prev[prev.length - 1] === id ? prev : [...prev, id]));
  }, []);

  const pop = useCallback(() => {
    // Never empty the stack: Home is the floor. A double-fired Back can't blank the app.
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const value = useMemo<NavApi>(
    () => ({ current: stack[stack.length - 1], canPop: stack.length > 1, push, pop }),
    [stack, push, pop]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** Access the navigation stack. Throws if used outside <NavProvider>. */
export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within <NavProvider>");
  }
  return ctx;
}
