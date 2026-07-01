import type { Client } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { useTg } from "../tg/TgSdkProvider";
import { TgAvatar } from "./TgAvatar";

/**
 * The persistent top app bar for the authenticated shell. A three-column `.tg-head`
 * with the brand title centred and the current client avatar chip in the right slot
 * (Google-account-chip style). Tapping the chip opens the Profile screen.
 *
 * The chip renders the validated Client record when present. The SDK user is only a
 * temporary display fallback before the client record exists; it is not domain truth.
 * The button is reachable by keyboard and screen reader.
 */
export function AppHeader({
  client = null,
  onProfile
}: {
  client?: Pick<Client, "name" | "telegramPhotoUrl"> | null;
  onProfile: () => void;
}): JSX.Element {
  const t = useT();
  const { user } = useTg();

  return (
    <header className="tg-head">
      <span aria-hidden="true" />
      <span className="tg-head__title">BeoSand</span>
      <span className="tg-head__right">
        <button
          type="button"
          className="tg-avatar-btn"
          onClick={onProfile}
          aria-label={t("miniapp.profile.title")}
        >
          <TgAvatar client={client} fallbackUser={user} size="header" />
        </button>
      </span>
    </header>
  );
}
