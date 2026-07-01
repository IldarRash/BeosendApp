import type { GroupMember } from "@beosand/types";
import { useState } from "react";

type RosterMember = GroupMember & {
  telegramPhotoUrl?: string | null;
};

interface ParticipantsRowProps {
  /** The client-narrowed roster (first name + avatar initial per member). */
  members: ReadonlyArray<GroupMember>;
  /** The server-computed participant count, shown next to the title. */
  count: number;
  /** Section heading (e.g. "Кто записан"). */
  title: string;
  /** Calm empty-state label when no one has signed up yet. */
  emptyLabel: string;
}

/**
 * "Кто записан" — a shared presentational roster row reused by both the group-month
 * preview and the single-training confirm step. Renders the heading "{title} · {count}"
 * and a horizontal row of avatar chips (Telegram photo when present, otherwise a
 * coral-tint circle with each member's `avatarInitial` + their `firstName`), or
 * a calm empty state.
 *
 * Interaction layer only: every value is the API's, client-narrowed — a Mini App caller
 * only ever receives a first name + initial, never another client's id or full name. No
 * counting or identity math here; it renders what the server returned.
 */
export function ParticipantsRow({
  members,
  count,
  title,
  emptyLabel
}: ParticipantsRowProps): JSX.Element {
  return (
    <section className="roster" aria-label={title}>
      <div className="tg-sech">{`${title} · ${count}`}</div>
      {members.length === 0 ? (
        <div className="roster__empty">{emptyLabel}</div>
      ) : (
        <ul className="roster__row">
          {members.map((member, index) => (
            <li className="roster__chip" key={`${member.firstName}-${index}`}>
              <ParticipantAvatar member={member} />
              <span className="roster__name">{member.firstName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ParticipantAvatar({ member }: { member: RosterMember }): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const photoSrc = member.telegramPhotoUrl ?? null;

  if (photoSrc && photoSrc !== failedSrc) {
    return (
      <span className="roster__avatar" aria-hidden="true">
        <img
          className="roster__avatar-img"
          src={photoSrc}
          alt=""
          onError={() => setFailedSrc(photoSrc)}
        />
      </span>
    );
  }

  return (
    <span className="roster__avatar" aria-hidden="true">
      {member.avatarInitial}
    </span>
  );
}
