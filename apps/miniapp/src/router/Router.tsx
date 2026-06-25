import { useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import type { Client } from "@beosand/types";
import { useApi } from "../api/ApiProvider";
import { useClient } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { useTg } from "../tg/TgSdkProvider";
import { useBackButton } from "../tg/buttons";
import { CalendarScreen } from "../screens/CalendarScreen";
import { CourtRequestScreen } from "../screens/CourtRequestScreen";
import { GroupBookingScreen } from "../screens/GroupBookingScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { MyBookingsScreen } from "../screens/MyBookingsScreen";
import { OnboardingWizard } from "../screens/OnboardingWizard";
import { ProfileScreen } from "../screens/ProfileScreen";
import { TrainerRequestScreen } from "../screens/TrainerRequestScreen";
import { AppHeader } from "../ui/AppHeader";
import { NavProvider, useNav } from "./NavProvider";
import { HOME_SECTIONS, resolveStartTarget, toRouteId } from "./routes";

/**
 * The Mini App's navigation shell. Boot + onboarding gate exactly as S1:
 *
 *   boot auth (no-telegram / pending / error) → status screen
 *   → resolve the caller's Client by verified Telegram id
 *     → 404 (not onboarded) → OnboardingWizard
 *     → 200                 → NavShell (Home menu + typed route stack)
 *
 * Once onboarded, the S1 `wizard | landing` state machine is gone: the shell
 * mounts a {@link NavProvider} (seeded from the deep-link `startParam`) wrapping a
 * {@link RouteView} that switches on the current route. Every RouteId now resolves
 * to a real screen; the switch's default arm is only a defensive Home fallback.
 */
export function Router(): JSX.Element {
  const { status } = useApi();
  const t = useT();

  if (status === "no-telegram") {
    return centered(<Placeholder header="BeoSand" description={t("miniapp.common.notTelegram")} />);
  }
  if (status === "pending") {
    return centered(
      <>
        <Spinner size="l" />
        <span className="muted">{t("miniapp.common.authPending")}</span>
      </>
    );
  }
  if (status === "error") {
    return centered(
      <Placeholder header={t("miniapp.common.error")} description={t("miniapp.common.authError")} />
    );
  }

  return <AuthedRouter />;
}

/** Routes once boot authentication is ready and the session identity exists. */
function AuthedRouter(): JSX.Element {
  const t = useT();
  const clientQuery = useClient();

  if (clientQuery.isError && !clientQuery.notOnboarded) {
    const message =
      clientQuery.error instanceof Error ? clientQuery.error.message : t("miniapp.common.error");
    return centered(<Placeholder header={t("miniapp.common.error")} description={message} />);
  }

  if (clientQuery.notOnboarded) {
    // A not-onboarded caller sees the wizard before the Home menu ever renders.
    // The mutation seeds the client cache, so onboarding success re-renders into NavShell.
    return (
      <OnboardingWizard
        onDone={() => {
          void clientQuery.refetch();
        }}
      />
    );
  }

  if (!clientQuery.data) {
    return centered(
      <>
        <Spinner size="l" />
        <span className="muted">{t("miniapp.common.loading")}</span>
      </>
    );
  }

  return <NavShell client={clientQuery.data} />;
}

/**
 * Mounts the route stack for an onboarded client, seeded from the deep-link
 * `startParam` (read once on boot; unknown/unreachable → Home, never an error).
 */
function NavShell({ client }: { client: Client }): JSX.Element {
  const { startParam } = useTg();
  // Read the deep link once: a later startParam change must not re-seed the stack.
  const [target] = useState(() => resolveStartTarget(startParam));
  return (
    <NavProvider initial={target.route}>
      <RouteView client={client} />
    </NavProvider>
  );
}

/**
 * Renders the screen for the current route under a persistent top app bar, and wires
 * the native BackButton once: shown on any sub-screen (pops to Home), hidden on Home
 * (the stack root). The header's avatar chip pushes the Profile route.
 */
function RouteView({ client }: { client: Client }): JSX.Element {
  const { current, canPop, pop, push } = useNav();
  useBackButton(canPop, pop);

  const onSelect = (routeId: string): void => {
    const id = toRouteId(routeId);
    if (id) {
      push(id);
    }
  };

  return (
    <>
      <AppHeader onProfile={() => push("profile")} />
      {renderRoute()}
    </>
  );

  function renderRoute(): JSX.Element {
    switch (current) {
    case "home":
      return <HomeScreen sections={HOME_SECTIONS} onSelect={onSelect} />;
    case "my-bookings":
      return <MyBookingsScreen onBrowse={() => push("calendar")} />;
    case "group":
      return <GroupBookingScreen />;
    case "individual":
      return <TrainerRequestScreen />;
    case "court":
      return <CourtRequestScreen />;
    case "calendar":
      return <CalendarScreen />;
    case "profile":
      return <ProfileScreen client={client} />;
    default:
      // Exhaustive: every RouteId has an explicit case above. This arm is unreachable;
      // it keeps the switch total and falls back to Home defensively rather than
      // rendering nothing.
      return <HomeScreen sections={HOME_SECTIONS} onSelect={onSelect} />;
    }
  }
}

function centered(children: JSX.Element): JSX.Element {
  return <div className="screen screen__center">{children}</div>;
}
