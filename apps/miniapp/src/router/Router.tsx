import { useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import type { Client } from "@beosand/types";
import { useApi } from "../api/ApiProvider";
import { useClient } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { useTg } from "../tg/TgSdkProvider";
import { OnboardingWizard } from "../screens/OnboardingWizard";
import { WeekExperience } from "../modern/WeekExperience";
import { NavProvider } from "./NavProvider";
import { resolveStartTarget } from "./routes";

/** Auth and onboarding remain the gate for every client screen. */
export function Router(): JSX.Element {
  const { status } = useApi();
  const t = useT();
  if (status === "no-telegram")
    return centered(<Placeholder header="BeoSand" description={t("miniapp.common.notTelegram")} />);
  if (status === "pending")
    return centered(
      <>
        <Spinner size="l" />
        <span className="muted">{t("miniapp.common.authPending")}</span>
      </>
    );
  if (status === "error")
    return centered(
      <Placeholder header={t("miniapp.common.error")} description={t("miniapp.common.authError")} />
    );
  return <AuthedRouter />;
}

function AuthedRouter(): JSX.Element {
  const t = useT();
  const clientQuery = useClient();
  if (clientQuery.isError && !clientQuery.notOnboarded) {
    const message =
      clientQuery.error instanceof Error ? clientQuery.error.message : t("miniapp.common.error");
    return centered(<Placeholder header={t("miniapp.common.error")} description={message} />);
  }
  if (clientQuery.notOnboarded)
    return (
      <OnboardingWizard
        onDone={() => {
          void clientQuery.refetch();
        }}
      />
    );
  if (!clientQuery.data)
    return centered(
      <>
        <Spinner size="l" />
        <span className="muted">{t("miniapp.common.loading")}</span>
      </>
    );
  return <NavShell client={clientQuery.data} />;
}

function NavShell({ client }: { client: Client }): JSX.Element {
  const { startParam } = useTg();
  const [target] = useState(() => resolveStartTarget(startParam));
  return (
    <NavProvider initial={target.route}>
      <WeekExperience client={client} />
    </NavProvider>
  );
}

function centered(children: JSX.Element): JSX.Element {
  return <div className="screen screen__center">{children}</div>;
}
