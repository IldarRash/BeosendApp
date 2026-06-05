import { AppShell } from "./ui/AppShell";
import { Router } from "./router/Router";

/**
 * The Mini App root. The provider stack (Telegram SDK → react-query → ApiClient →
 * i18n) is wired in main.tsx; here the native shell wraps the router, which gates
 * on boot auth and branches between onboarding and the authenticated landing.
 */
export function App(): JSX.Element {
  return (
    <AppShell>
      <Router />
    </AppShell>
  );
}
