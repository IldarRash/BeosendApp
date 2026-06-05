import { Cell, List, Section, Title } from "@telegram-apps/telegram-ui";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { MenuIcon, type IconName } from "../ui/icons";

/**
 * One Home-menu cell: a client journey rendered as a tappable row with a coral
 * leading icon, a label, an optional one-line hint, and a trailing chevron.
 *
 * `routeId` is intentionally a bare `string` here so HomeScreen stays presentational
 * and does not import the router's closed `RouteId` union. The route table
 * (router/routes.ts, owned by the nav wiring) builds these items with real route
 * ids and hands them in; the design only renders + reports the tap.
 */
export interface HomeMenuItem {
  routeId: string;
  icon: IconName;
  /** i18n key for the row label, e.g. `miniapp.home.browse`. */
  labelKey: string;
  /** i18n key for the one-line subtitle under the label. */
  hintKey: string;
}

/** A titled group of menu rows (e.g. "Тренировки", "Корты", "Профиль"). */
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

/**
 * The Mini App's hub: a native section-list of the six client journeys. Home has
 * NO primary action, so it shows no MainButton (and no BackButton — it is the
 * stack root; the shell hides Back on Home). Each row fires a selection haptic
 * then asks the shell to push its route.
 *
 * The list is statically the client journeys — there is no role branch and no
 * admin/trainer row by construction (the held token is scope:"client").
 */
export function HomeScreen({ sections, onSelect }: HomeScreenProps): JSX.Element {
  const t = useT();

  const open = (routeId: string): void => {
    hapticSelection();
    onSelect(routeId);
  };

  return (
    <div className="screen screen--no-mainbutton">
      <header className="home-header">
        <Title level="1" weight="2">
          {t("miniapp.home.title")}
        </Title>
        <span className="muted">{t("miniapp.home.subtitle")}</span>
      </header>

      <List aria-label={t("miniapp.home.title")}>
        {sections.map((section) => (
          <Section key={section.headerKey} header={t(section.headerKey)}>
            {section.items.map((item) => (
              <Cell
                key={item.routeId}
                Component="button"
                type="button"
                className="menu-row"
                before={<MenuIcon name={item.icon} />}
                subtitle={t(item.hintKey)}
                after={
                  <span className="chevron" aria-hidden="true">
                    ›
                  </span>
                }
                onClick={() => open(item.routeId)}
              >
                {t(item.labelKey)}
              </Cell>
            ))}
          </Section>
        ))}
      </List>
    </div>
  );
}
