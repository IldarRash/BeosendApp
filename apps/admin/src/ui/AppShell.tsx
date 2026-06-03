import type { ReactNode } from "react";

/** The admin console nav. Only the dashboard is live; domain screens land later. */
const NAV_ITEMS = [
  { key: "dashboard", label: "Обзор", live: true },
  { key: "groups", label: "Группы", live: false },
  { key: "trainings", label: "Тренировки", live: false },
  { key: "trainers", label: "Тренеры", live: false },
  { key: "courts", label: "Корты", live: false },
  { key: "broadcasts", label: "Рассылки", live: false },
  { key: "analytics", label: "Аналитика", live: false }
] as const;

interface AppShellProps {
  current: string;
  children: ReactNode;
}

export function AppShell({ current, children }: AppShellProps): JSX.Element {
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
          {NAV_ITEMS.map((item) => (
            <span
              key={item.key}
              className="nav__item"
              aria-current={item.key === current ? "true" : undefined}
              aria-disabled={item.live ? undefined : "true"}
            >
              {item.label}
              {item.live ? null : <span className="nav__soon">скоро</span>}
            </span>
          ))}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
