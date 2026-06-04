/**
 * Console routes. Each domain gets a path now; M1–M4 flip `live` to true as the
 * screen lands. `/login` is public; everything else sits behind RequireAuth.
 */
export interface NavItem {
  path: string;
  label: string;
  live: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", label: "Обзор", live: true },
  { path: "/groups", label: "Группы", live: true },
  { path: "/trainings", label: "Тренировки", live: true },
  { path: "/trainers", label: "Тренеры", live: true },
  { path: "/levels", label: "Уровни", live: true },
  { path: "/attendance", label: "Посещаемость", live: true },
  { path: "/clients", label: "Клиенты", live: true },
  { path: "/court-requests", label: "Заявки на корты", live: true },
  { path: "/court-blocks", label: "Блокировки кортов", live: true },
  { path: "/court-load", label: "Загрузка кортов", live: true },
  { path: "/broadcasts", label: "Рассылки", live: true },
  { path: "/analytics", label: "Аналитика", live: true }
] as const;

export const LOGIN_PATH = "/login";
