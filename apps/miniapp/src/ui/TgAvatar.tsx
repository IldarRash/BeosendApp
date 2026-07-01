import { useState } from "react";
import { avatarInitialOf, type Client } from "@beosand/types";
import type { TgUser } from "../tg/TgSdkProvider";

/**
 * The current client's avatar: a Google-account-chip style circle. Once a validated
 * Client record is available, its durable `telegramPhotoUrl` is the only photo source.
 * The SDK user can fill the boot gap, but it is never treated as domain truth.
 *
 * Display-only and identity-safe: these fields never participate in authorization.
 * Two sizes - `header` (small, in the top bar) and `large` (above the profile
 * controls) - share one circle. If the image fails, this render falls back to the
 * initial derived from `client.name`.
 */
export function TgAvatar({
  client,
  fallbackUser,
  size
}: {
  client: Pick<Client, "name" | "telegramPhotoUrl"> | null;
  fallbackUser?: TgUser | null;
  size: "header" | "large";
}): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displayName = client?.name ?? fallbackUser?.firstName ?? "";
  const imageSrc = client ? client.telegramPhotoUrl : fallbackUser?.photoUrl ?? null;
  const initial = avatarInitialOf(displayName);
  const className = size === "large" ? "tg-avatar tg-avatar--lg" : "tg-avatar";

  if (imageSrc && imageSrc !== failedSrc) {
    return (
      <span className={className}>
        <img
          className="tg-avatar__img"
          src={imageSrc}
          alt={displayName}
          onError={() => setFailedSrc(imageSrc)}
        />
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}
