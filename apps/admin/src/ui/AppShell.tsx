import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LOCALES, localeLabel, type Locale } from "@beosand/i18n";
import { NAV_ITEMS } from "../routes";
import { Button } from "./Button";
import { useLanguage } from "../i18n/LanguageProvider";
import { useLogout, useMe } from "../hooks/useSession";

interface AppShellProps {
  children: ReactNode;
}

/**
 * The console frame: brand, router-driven nav, the language switch, the logged-in
 * admin, and logout. Nav labels and chrome strings resolve through the active
 * locale; the language selector persists the choice in sessionStorage.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  const me = useMe();
  const logout = useLogout();
  const { locale, setLocale, t } = useLanguage();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">
            Beo<em>Sand</em>
          </span>
        </div>
        <span className="brand__sub">{t("admin.brand.sub")}</span>
        <nav className="nav" aria-label={t("admin.nav.sectionsLabel")}>
          {NAV_ITEMS.map((item) =>
            item.live ? (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) => (isActive ? "nav__item nav__item--active" : "nav__item")}
              >
                {t(item.labelKey)}
              </NavLink>
            ) : (
              <span key={item.path} className="nav__item" aria-disabled="true">
                {t(item.labelKey)}
                <span className="nav__soon">{t("admin.nav.soon")}</span>
              </span>
            )
          )}
        </nav>
        <div className="sidebar__foot">
          <LanguageSelect
            locale={locale}
            onChange={setLocale}
            label={t("admin.lang.label")}
          />
          {me.data ? (
            <div className="who" title={me.data.username ? `@${me.data.username}` : undefined}>
              <span className="who__name">{me.data.name}</span>
              {me.data.username ? <span className="who__handle">@{me.data.username}</span> : null}
            </div>
          ) : null}
          <Button variant="ghost" onClick={logout}>
            {t("admin.shell.logout")}
          </Button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

interface LanguageSelectProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label: string;
}

/** Header language switch — a labelled native select, value persisted by the provider. */
function LanguageSelect({ locale, onChange, label }: LanguageSelectProps): JSX.Element {
  return (
    <label className="lang-select">
      <span className="visually-hidden">{label}</span>
      <select
        className="input"
        aria-label={label}
        value={locale}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        {LOCALES.map((value) => (
          <option key={value} value={value}>
            {localeLabel[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
