import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { type IconName } from "../ui/icons";

/**
 * One Home-menu tile: a client journey rendered as a `.tile` in the 2-column grid
 * with a coral icon chip (`.tile__ic`), a label, and an optional one-line hint.
 *
 * `routeId` is intentionally a bare `string` here so HomeScreen stays presentational
 * and does not import the router's closed `RouteId` union.
 */
export interface HomeMenuItem {
  routeId: string;
  icon: IconName;
  /** i18n key for the tile label. */
  labelKey: string;
  /** i18n key for the one-line subtitle below the label. */
  hintKey: string;
}

/** A titled group of menu tiles (e.g. "Тренировки", "Корты", "Аккаунт"). */
export interface HomeMenuSection {
  /** i18n key for the section header. */
  headerKey: string;
  items: ReadonlyArray<HomeMenuItem>;
}

interface HomeScreenProps {
  sections: ReadonlyArray<HomeMenuSection>;
  /** Push the chosen journey's route. The shell owns the stack; Home only reports. */
  onSelect: (routeId: string) => void;
}

/** Inline SVGs per icon — drawn at 24×24, inheriting `currentColor` from `.tile__ic`. */
function TileIcon({ name }: { name: IconName }): JSX.Element {
  const icons: Record<IconName, JSX.Element> = {
    browse: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
        <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
      </svg>
    ),
    schedule: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
        <path d="M7 13h2M7 16.5h2M11.5 13h5.5M11.5 16.5h5.5" />
      </svg>
    ),
    myBookings: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="5" y="4.5" width="14" height="16" rx="2.5" />
        <path d="M9 4.5a3 3 0 0 1 6 0" />
        <path d="M8.5 11l1.4 1.4 2.6-2.8M8.5 16l1.4 1.4 2.6-2.8" />
        <path d="M14.5 11h2M14.5 16h2" />
      </svg>
    ),
    group: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="2.6" />
        <path d="M4 19a5 5 0 0 1 10 0" />
        <circle cx="16.5" cy="9.5" r="2" />
        <path d="M14.5 14.2A4.3 4.3 0 0 1 20 18.4" />
      </svg>
    ),
    individual: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="11" cy="8" r="3" />
        <path d="M5 19a6 6 0 0 1 12 0" />
        <path d="M18.5 4.5v3M17 6h3" />
      </svg>
    ),
    court: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
        <path d="M12 6v12" />
        <path d="M3.5 12h17" strokeDasharray="2 2.4" />
      </svg>
    ),
    calendar: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
        <path d="M7.5 13h0.01M12 13h0.01M16.5 13h0.01M7.5 16.5h0.01M12 16.5h0.01M16.5 16.5h0.01" />
      </svg>
    ),
    profile: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="10" r="2.6" />
        <path d="M6.8 18a5.4 5.4 0 0 1 10.4 0" />
      </svg>
    )
  };
  return icons[name];
}

/**
 * The Mini App's hub: a coral welcome banner + 2-column tile grid of the six client
 * journeys, grouped in 3 sections (Trainings / Courts / Account) with `.tg-sech`
 * headers. Home has NO primary action, so it shows no MainButton (and no BackButton —
 * it is the stack root; the shell hides Back on Home).
 *
 * The tile grid uses `.tilegrid` / `.tile` / `.tile__ic` (handoff classes). Each tile
 * fires a selection haptic then asks the shell to push its route.
 */
export function HomeScreen({ sections, onSelect }: HomeScreenProps): JSX.Element {
  const t = useT();

  const open = (routeId: string): void => {
    hapticSelection();
    onSelect(routeId);
  };

  return (
    <div className="screen screen--no-mainbutton" aria-label={t("miniapp.home.title")}>
      {/* Coral welcome banner */}
      <div className="home-banner" role="banner">
        <div className="home-banner__title">{t("miniapp.home.title")}</div>
        <div className="home-banner__sub">{t("miniapp.home.subtitle")}</div>
      </div>

      {/* Tile-grid sections */}
      {sections.map((section) => (
        <section key={section.headerKey} aria-label={t(section.headerKey)}>
          <div className="tg-sech">{t(section.headerKey)}</div>
          <div className="tilegrid">
            {section.items.map((item) => (
              <button
                key={item.routeId}
                type="button"
                className="tile"
                onClick={() => open(item.routeId)}
                aria-label={t(item.labelKey)}
              >
                <div className="tile__ic" aria-hidden="true">
                  <TileIcon name={item.icon} />
                </div>
                <div className="tile__title">{t(item.labelKey)}</div>
                <div className="tile__sub">{t(item.hintKey)}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
