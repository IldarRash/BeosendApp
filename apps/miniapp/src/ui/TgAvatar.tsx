import { avatarInitialOf } from "@beosand/types";
import type { TgUser } from "../tg/TgSdkProvider";

/**
 * The current user's own Telegram avatar — a Google-account-chip style circle. When
 * the verified initData carries a `photoUrl` it renders that as an `<img>`; otherwise
 * it falls back to a coral-tint circle with the first letter of the first name.
 *
 * Display-only and identity-safe: `user` is the caller's OWN verified Telegram profile
 * (TgSdkProvider), never another user's, and never authorization. Two sizes — `header`
 * (small, in the top bar) and `large` (above the profile controls) — share one circle.
 */
export function TgAvatar({
  user,
  size
}: {
  user: TgUser | null;
  size: "header" | "large";
}): JSX.Element {
  const initial = avatarInitialOf(user?.firstName ?? "");
  const className = size === "large" ? "tg-avatar tg-avatar--lg" : "tg-avatar";

  if (user?.photoUrl) {
    return (
      <span className={className}>
        <img className="tg-avatar__img" src={user.photoUrl} alt={user.firstName} />
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}
