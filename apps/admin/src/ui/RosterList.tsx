import { useEffect, useState, type ReactNode } from "react";
import type { BookingStatus, RosterParticipant } from "@beosand/types";
import { DataTable, type Column } from "./DataTable";

type Translate = (key: string, params?: Record<string, string | number>) => string;

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase("ru") || "?";
}

function AvatarNameCell({ name, photoUrl }: { name: string; photoUrl?: string | null }): JSX.Element {
  const [imageState, setImageState] = useState<"pending" | "loaded" | "failed">(
    photoUrl ? "pending" : "failed"
  );

  useEffect(() => {
    setImageState(photoUrl ? "pending" : "failed");
  }, [photoUrl]);

  return (
    <span className="admin-person">
      <span className="admin-avatar" aria-hidden="true">
        {photoUrl && imageState !== "failed" ? (
          <img
            className={
              imageState === "loaded"
                ? "admin-avatar__image"
                : "admin-avatar__image admin-avatar__image--pending"
            }
            src={photoUrl}
            alt=""
            onLoad={() => setImageState("loaded")}
            onError={() => setImageState("failed")}
          />
        ) : null}
        <span
          className={
            imageState === "loaded"
              ? "admin-avatar__fallback admin-avatar__fallback--hidden"
              : "admin-avatar__fallback"
          }
        >
          {avatarInitial(name)}
        </span>
      </span>
      <span className="admin-person__name">{name}</span>
    </span>
  );
}

/** Catalog key for the booking status the API returns (never recomputed here). */
function bookingStatusLabel(status: BookingStatus, t: Translate): string {
  return t(`admin.attendance.booking.${status}`);
}

/** Tag modifier per booking status — tint only; the rendered value stays the API's. */
function statusTagClass(status: BookingStatus): string {
  if (status === "attended") return "tag tag--ok";
  if (status === "no_show") return "tag tag--warn";
  return "tag";
}

/**
 * Drop-in vs. monthly subscription, decided by the server's `bookingType`. The
 * `groupSubscriptionId` (null for a drop-in) is the same signal and would agree;
 * we render the badge from the explicit type and never recompute the distinction.
 */
function participationTag(p: RosterParticipant, t: Translate): JSX.Element {
  const isDropIn = p.bookingType === "single";
  return (
    <span className={isDropIn ? "tag tag--muted" : "tag tag--info"}>
      {isDropIn ? t("admin.roster.dropIn") : t("admin.roster.subscription")}
    </span>
  );
}

interface RosterListProps {
  /** Server-decided participants, already validated against the contract. */
  participants: RosterParticipant[];
  t: Translate;
  /** Accessible table caption (visually hidden). */
  caption: string;
  /** Shown when the roster is empty. */
  emptyLabel: string;
  /**
   * Optional per-row trailing actions (e.g. the attendance mark buttons on the
   * Посещаемость screen). When omitted the table shows name / status / kind only.
   */
  actions?: {
    header: string;
    render: (p: RosterParticipant) => ReactNode;
  };
}

/**
 * Shared attendee list for a single training session: client name, the API's
 * booking status, and a badge distinguishing a drop-in ("Разовое") from a
 * monthly-subscription booking ("Абонемент"). Pure presentation — it renders the
 * server's decided values and computes no domain math. Reused by the Trainings
 * detail view, the calendar detail modal, and the Посещаемость roster (which
 * supplies attendance-mark actions).
 */
export function RosterList({
  participants,
  t,
  caption,
  emptyLabel,
  actions
}: RosterListProps): JSX.Element {
  const columns: Column<RosterParticipant>[] = [
    {
      key: "name",
      header: t("admin.attendance.colClient"),
      render: (p) => (
        <AvatarNameCell name={p.clientName} photoUrl={p.telegramPhotoUrl} />
      )
    },
    {
      key: "kind",
      header: t("admin.roster.colKind"),
      render: (p) => participationTag(p, t)
    },
    {
      key: "status",
      header: t("admin.attendance.colAttendance"),
      render: (p) => (
        <span className={statusTagClass(p.bookingStatus)}>
          {bookingStatusLabel(p.bookingStatus, t)}
        </span>
      )
    },
    ...(actions
      ? [
          {
            key: "actions",
            header: actions.header,
            render: actions.render
          } satisfies Column<RosterParticipant>
        ]
      : [])
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={participants}
      rowKey={(p) => p.bookingId}
      emptyLabel={emptyLabel}
    />
  );
}
