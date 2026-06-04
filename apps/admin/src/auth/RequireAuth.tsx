import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthError } from "../api/client";
import { useApiClient } from "../api/ApiProvider";
import { useMe } from "../hooks/useSession";
import { LOGIN_PATH } from "../routes";

/**
 * Route guard for every domain route. Redirects to /login when there is no
 * session token, or when the server rejects the session (AuthError → 401), after
 * clearing the stale token. Domain routes are unreachable without a valid session.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const api = useApiClient();
  const location = useLocation();
  const me = useMe();

  const hasToken = api.getSession() !== null;
  const rejected = me.error instanceof AuthError;

  useEffect(() => {
    if (rejected) {
      api.clearSession();
    }
  }, [rejected, api]);

  if (!hasToken || rejected) {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
