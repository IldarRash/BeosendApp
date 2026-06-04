import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../routes";
import { Button } from "./Button";
import { useLogout, useMe } from "../hooks/useSession";

interface AppShellProps {
  children: ReactNode;
}

/**
 * The console frame: brand, router-driven nav, the logged-in admin, and logout.
 * Non-live (M1–M4) routes render as disabled with a `скоро` badge.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  const me = useMe();
  const logout = useLogout();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">
            Beo<em>Sand</em>
          </span>
        </div>
        <span className="brand__sub">Admin console</span>
        <nav className="nav" aria-label="Разделы">
          {NAV_ITEMS.map((item) =>
            item.live ? (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) => (isActive ? "nav__item nav__item--active" : "nav__item")}
              >
                {item.label}
              </NavLink>
            ) : (
              <span key={item.path} className="nav__item" aria-disabled="true">
                {item.label}
                <span className="nav__soon">скоро</span>
              </span>
            )
          )}
        </nav>
        <div className="sidebar__foot">
          {me.data ? (
            <div className="who" title={me.data.username ? `@${me.data.username}` : undefined}>
              <span className="who__name">{me.data.name}</span>
              {me.data.username ? <span className="who__handle">@{me.data.username}</span> : null}
            </div>
          ) : null}
          <Button variant="ghost" onClick={logout}>
            Выйти
          </Button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
