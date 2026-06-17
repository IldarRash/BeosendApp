import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LOCALES, localeLabel, type Locale } from "@beosand/i18n";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "../routes";
import { Button } from "./Button";
import { navIcon } from "./icons";
import { useLanguage } from "../i18n/LanguageProvider";
import { useLogout, useMe } from "../hooks/useSession";
import { useCourtRequests } from "../hooks/useCourtRequests";

interface AppShellProps {
  children: ReactNode;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const SIDEBAR_ID = "app-sidebar";

/**
 * The console frame: brand, grouped router-driven nav with leading icons, the
 * language switch, the logged-in admin (avatar + name), and logout. Nav labels and
 * chrome strings resolve through the active locale; the language selector persists
 * the choice in sessionStorage. The "Заявки на корт" item carries a pending-count
 * badge sourced from the existing court-requests queue read.
 *
 * On narrow viewports (≤1024px) the sidebar collapses into an off-canvas drawer
 * toggled by a burger in the top bar; the drawer closes on navigation, scrim click,
 * Esc, or route change, and locks body scroll while open. The top bar and scrim are
 * `display:none` on the desktop layout, so the desktop view is unchanged.
 */
export function AppShell({ children }: AppShellProps): JSX.Element {
  const me = useMe();
  const logout = useLogout();
  const { locale, setLocale, t } = useLanguage();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Pending court-requests count for the nav badge. Reuses the moderation queue
  // read (server owns the list); the badge only renders once a count is in hand.
  const pending = useCourtRequests("pending");
  const pendingCount = pending.data?.length ?? null;

  // Close the drawer on every route change so a tap on a nav item never leaves it open.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // While the drawer is open: lock body scroll, close on Esc, and restore focus to
  // the burger on close. No-ops on desktop where the drawer is never opened.
  useEffect(() => {
    if (!navOpen) return;
    const burger = burgerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setNavOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      burger?.focus();
    };
  }, [navOpen]);

  return (
    <div className={navOpen ? "app app--nav-open" : "app"}>
      <header className="topbar">
        <button
          ref={burgerRef}
          type="button"
          className="topbar__burger"
          aria-controls={SIDEBAR_ID}
          aria-expanded={navOpen}
          aria-label={t("admin.nav.toggle")}
          onClick={() => setNavOpen((open) => !open)}
        >
          {navIcon(navOpen ? "close" : "menu")}
        </button>
        <span className="brand__mark">
          Beo<em>Sand</em>
        </span>
      </header>
      <button
        type="button"
        className="sidebar__scrim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setNavOpen(false)}
      />
      <aside id={SIDEBAR_ID} className={navOpen ? "sidebar sidebar--open" : "sidebar"}>
        <div className="brand">
          <span className="brand__mark">
            Beo<em>Sand</em>
          </span>
        </div>
        <span className="brand__sub">{t("admin.brand.sub")}</span>
        <nav className="nav" aria-label={t("admin.nav.sectionsLabel")}>
          {NAV_GROUPS.map(({ group, labelKey }) => (
            <NavSection
              key={group}
              label={t(labelKey)}
              items={NAV_ITEMS.filter((item) => item.group === group)}
              pendingCount={pendingCount}
              t={t}
            />
          ))}
        </nav>
        <div className="sidebar__foot">
          <LanguageSelect
            locale={locale}
            onChange={setLocale}
            label={t("admin.lang.label")}
          />
          {me.data ? (
            <div className="who" title={me.data.username ? `@${me.data.username}` : undefined}>
              <span className="who__av" aria-hidden="true">
                {me.data.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <span className="who__name">{me.data.name}</span>
                {me.data.username ? <span className="who__handle">@{me.data.username}</span> : null}
              </div>
            </div>
          ) : null}
          <Button variant="ghost" onClick={logout}>
            {navIcon("logout")}
            {t("admin.shell.logout")}
          </Button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

interface NavSectionProps {
  label: string;
  items: NavItem[];
  pendingCount: number | null;
  t: Translate;
}

/** One labelled nav group: a mono-caps heading followed by its items. */
function NavSection({ label, items, pendingCount, t }: NavSectionProps): JSX.Element {
  return (
    <>
      <span className="nav__group-label">{label}</span>
      {items.map((item) => (
        <NavRow key={item.path} item={item} pendingCount={pendingCount} t={t} />
      ))}
    </>
  );
}

interface NavRowProps {
  item: NavItem;
  pendingCount: number | null;
  t: Translate;
}

/** A single nav entry: icon + label, plus a pending badge on court-requests. */
function NavRow({ item, pendingCount, t }: NavRowProps): JSX.Element {
  const badge =
    item.iconKey === "courtRequests" && pendingCount !== null && pendingCount > 0 ? (
      <span className="count">{pendingCount}</span>
    ) : null;

  if (!item.live) {
    return (
      <span className="nav__item" aria-disabled="true">
        {navIcon(item.iconKey)}
        {t(item.labelKey)}
        <span className="nav__soon">{t("admin.nav.soon")}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) => (isActive ? "nav__item nav__item--active" : "nav__item")}
    >
      {navIcon(item.iconKey)}
      {t(item.labelKey)}
      {badge}
    </NavLink>
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
