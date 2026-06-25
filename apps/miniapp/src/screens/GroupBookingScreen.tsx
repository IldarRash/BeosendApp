import { useMemo, useState } from "react";
import { Placeholder } from "@telegram-apps/telegram-ui";
import type { Group, GroupBookingResult, WaitlistAdminItem } from "@beosand/types";
import { resolveErrorMessage } from "../api/errors";
import {
  useCreateGroupBooking,
  useGroupMembers,
  useGroups,
  useLevels,
  useMyWaitlist,
  useTrainers
} from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { useNav } from "../router/NavProvider";
import { hapticSelection, hapticSuccess, useMainButton } from "../tg/buttons";
import { Chip, ChipBar } from "../ui/Chips";
import { FallbackButton } from "../ui/FallbackButton";
import { GroupFilterSheet } from "../ui/GroupFilterSheet";
import {
  activeGroupFilterCount,
  matchesGroupFilter,
  type GroupFilters
} from "../ui/group-filter";
import { SecondaryButton } from "../ui/SecondaryButton";
import { OptionList, type Option } from "../ui/OptionList";
import { ParticipantsRow } from "../ui/ParticipantsRow";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import {
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  monthKey,
  offeredMonths,
  weekdayFullKey,
  weekdayShortKey,
  type OfferedMonth
} from "../ui/format";

/**
 * The monthly group-subscription journey (S7). One screen, three local sub-states:
 *
 *   list    → pick an active group
 *   detail  → review the group's facts + pick one of two offered months
 *   confirm → review group + month + monthly price, then subscribe
 *   result  → the server's GroupBookingResult (created count + skipped dates)
 *
 * Interaction layer only: every value rendered is the API's. The two month options
 * are display-only ints ({@link offeredMonths}); the SERVER computes the month's
 * training instances, the prices, capacity, and which dates are skipped (full) — the
 * Mini App never computes a price or which dates exist. `clientId` is supplied by the
 * hook from the cached session, never client-asserted.
 *
 * The native BackButton is owned by the shell and pops the whole route; in-screen
 * "back" steps are local state transitions. There is exactly one native MainButton
 * per sub-state (none on the bare list).
 */
export function GroupBookingScreen(): JSX.Element {
  const groups = useGroups();
  const [selected, setSelected] = useState<Group | null>(null);

  if (selected) {
    return <GroupFlow group={selected} />;
  }

  return (
    <GroupList
      groups={groups.data}
      isLoading={groups.isLoading}
      errorMessage={groups.error instanceof Error ? groups.error.message : undefined}
      onPick={(group) => {
        hapticSelection();
        setSelected(group);
      }}
    />
  );
}

/** The group list sub-state: one tappable card per active group (no MainButton). */
function GroupList({
  groups,
  isLoading,
  errorMessage,
  onPick
}: {
  groups: Group[] | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onPick: (group: Group) => void;
}): JSX.Element {
  const t = useT();
  const levels = useLevels();
  const trainers = useTrainers();
  // The group-list level/trainer/weekday filter, narrowed client-side (the API
  // returns every active group; filtering is pure presentation, no domain math).
  const [filters, setFilters] = useState<GroupFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="screen screen__center">
        <LoadingState />
      </div>
    );
  }
  if (errorMessage !== undefined || groups === undefined) {
    return (
      <div className="screen screen__center">
        <ErrorState message={errorMessage} />
      </div>
    );
  }

  // The endpoint returns active groups; defensive filter keeps the list bookable-only.
  const active = groups.filter((group) => group.status === "active");
  if (active.length === 0) {
    return (
      <div className="screen screen__center">
        <EmptyState titleKey="miniapp.group.none" bodyKey="miniapp.group.noneBody" />
      </div>
    );
  }

  const levelName = (levelId: string): string =>
    levels.data?.find((level) => level.id === levelId)?.name ?? "";

  const activeCount = activeGroupFilterCount(filters);
  const visible = active.filter((group) => matchesGroupFilter(group, filters));

  const applyAndClose = (next: GroupFilters): void => {
    setFilters(next);
    setSheetOpen(false);
  };
  const resetAndClose = (): void => {
    setFilters({});
    setSheetOpen(false);
  };

  return (
    <div className="screen">
      <div className="tg-sech">{t("miniapp.group.listTitle")}</div>

      <ChipBar label={t("miniapp.group.filtersAria")}>
        <Chip
          label={t("miniapp.group.filter.title")}
          glyph="filter"
          active={activeCount > 0}
          badge={activeCount}
          onClick={() => setSheetOpen(true)}
        />
      </ChipBar>

      {visible.length === 0 ? (
        <EmptyState titleKey="miniapp.group.filterEmpty" bodyKey="miniapp.group.filterEmptyBody" />
      ) : (
        <div className="card">
          {visible.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              levelName={levelName(group.levelId)}
              onPick={() => onPick(group)}
            />
          ))}
        </div>
      )}

      <GroupFilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        value={filters}
        trainers={trainers.data ?? []}
        levels={levels.data ?? []}
        onApply={applyAndClose}
        onReset={resetAndClose}
      />
    </div>
  );
}

/** One group as a `.lrow`: name, trainer · level, weekdays · time + month price, chevron. */
function GroupCard({
  group,
  levelName,
  onPick
}: {
  group: Group;
  levelName: string;
  onPick: () => void;
}): JSX.Element {
  const t = useT();

  const weekdays = group.daysOfWeek.map((day) => t(weekdayShortKey(day))).join(", ");
  const time = formatTimeRange(group.startTime, group.endTime);
  const subtitle = levelName ? `${group.trainerName} · ${levelName}` : group.trainerName;
  const priceLabel = t("miniapp.group.monthSubscription", {
    price: formatRsd(group.priceMonthRsd)
  });

  return (
    <button
      type="button"
      className="lrow"
      onClick={onPick}
      aria-label={`${group.name}. ${subtitle}. ${weekdays} · ${time}. ${priceLabel}. ${t(
        "miniapp.group.openAria"
      )}`}
    >
      <span className="lrow__main">
        <span className="lrow__title">{group.name}</span>
        <span className="lrow__sub">{subtitle}</span>
        <span className="group-card__meta">
          <span className="lrow__sub">{`${weekdays} · ${time}`}</span>
          <span className="group-price-chip">{priceLabel}</span>
        </span>
      </span>
      <span className="lrow__chev" aria-hidden="true">
        <Chevron />
      </span>
    </button>
  );
}

/**
 * The detail → confirm → result flow for a chosen group. Holds the selected month and
 * the confirm/result step locally; the write is {@link useCreateGroupBooking}.
 */
function GroupFlow({ group }: { group: Group }): JSX.Element {
  const t = useT();
  const nav = useNav();
  const create = useCreateGroupBooking();

  const months = useMemo(() => offeredMonths(), []);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  const monthByKey = useMemo(() => {
    const map = new Map<string, OfferedMonth>();
    for (const m of months) {
      map.set(monthValue(m), m);
    }
    return map;
  }, [months]);

  const chosen = selectedKey ? monthByKey.get(selectedKey) : undefined;

  if (create.isSuccess && create.data) {
    return (
      <GroupResult
        result={create.data}
        onMyBookings={() => nav.push("my-bookings")}
        onHome={() => nav.pop()}
      />
    );
  }

  if (confirming && chosen) {
    return (
      <GroupConfirm
        group={group}
        month={chosen}
        submitting={create.isPending}
        errorMessage={resolveErrorMessage(create.error, t, "miniapp.group.conflict")}
        onConfirm={() => {
          hapticSelection();
          create.mutate(
            { groupId: group.id, year: chosen.year, month: chosen.month },
            { onSuccess: () => hapticSuccess() }
          );
        }}
        onBack={() => {
          create.reset();
          setConfirming(false);
        }}
      />
    );
  }

  return (
    <GroupDetail
      group={group}
      months={months}
      selectedKey={selectedKey}
      onSelectMonth={(value) => {
        hapticSelection();
        setSelectedKey(value);
      }}
      onContinue={() => {
        if (chosen) {
          setConfirming(true);
        }
      }}
    />
  );
}

/** Detail + two-option month picker. The MainButton advances once a month is chosen. */
function GroupDetail({
  group,
  months,
  selectedKey,
  onSelectMonth,
  onContinue
}: {
  group: Group;
  months: readonly [OfferedMonth, OfferedMonth];
  selectedKey: string | undefined;
  onSelectMonth: (value: string | undefined) => void;
  onContinue: () => void;
}): JSX.Element {
  const t = useT();
  const levels = useLevels();
  const levelName = levels.data?.find((level) => level.id === group.levelId)?.name ?? "";

  const weekdays = group.daysOfWeek.map((day) => t(weekdayFullKey(day))).join(", ");
  const time = formatTimeRange(group.startTime, group.endTime);
  const priceLabel = t("miniapp.group.monthSubscription", {
    price: formatRsd(group.priceMonthRsd)
  });

  const options: ReadonlyArray<Option<string | undefined>> = months.map((m) => ({
    value: monthValue(m),
    label: `${t(monthKey(m.month))} ${m.year}`
  }));

  // The roster is shown for the month currently previewed: the selected one, or —
  // before any pick — the first offered month, so "who signed up" is visible up front.
  const previewMonth = (selectedKey && months.find((m) => monthValue(m) === selectedKey)) || months[0];

  // The previewed month's roster — both "who signed up" AND whether the caller is
  // ALREADY subscribed for it (`callerSubscribed`), a server-decided flag the Mini App
  // only reflects: it disables a second subscribe before the API rejects it. The
  // server 409 remains the backstop via the confirm step's resolveErrorMessage path.
  const members = useGroupMembers(group.id, previewMonth.year, previewMonth.month);
  const alreadySubscribed = members.data?.callerSubscribed ?? false;

  // The MainButton only appears once a month is chosen — until then there is no
  // primary action to take (selection is the next step). It stays disabled when the
  // caller already holds this month's subscription (no double-booking).
  useMainButton({
    text: t("miniapp.group.confirm"),
    onClick: onContinue,
    isEnabled: selectedKey !== undefined && !alreadySubscribed
  });

  return (
    <div className="screen">
      <div className="tg-sech">{group.name}</div>
      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.group.daysLabel")}</span>
          <span className="sumrow__v">{weekdays}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
          <span className="sumrow__v">{time}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.trainerLabel")}</span>
          <span className="sumrow__v">{group.trainerName}</span>
        </div>
        {levelName && (
          <div className="sumrow">
            <span className="sumrow__k">{t("miniapp.booking.levelLabel")}</span>
            <span className="sumrow__v">{levelName}</span>
          </div>
        )}
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.group.priceLabel")}</span>
          <span className="sumrow__v sumrow__v--big">{priceLabel}</span>
        </div>
      </div>

      <OptionList
        name="group-month"
        header={t("miniapp.group.pickMonth")}
        options={options}
        selected={selectedKey}
        onSelect={onSelectMonth}
      />

      {members.data && (
        <ParticipantsRow
          members={members.data.members}
          count={members.data.memberCount}
          title={t("miniapp.group.roster.title")}
          emptyLabel={t("miniapp.group.roster.empty")}
        />
      )}

      <OwnWaitlistNote group={group} year={previewMonth.year} month={previewMonth.month} />

      {alreadySubscribed && (
        <div className="note" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>{t("miniapp.group.alreadySubscribed")}</span>
        </div>
      )}

      {selectedKey !== undefined && !alreadySubscribed && (
        <FallbackButton text={t("miniapp.group.confirm")} onClick={onContinue} />
      )}
    </div>
  );
}

/** Confirm sub-state: group + month + price summary, with the subscribe MainButton. */
function GroupConfirm({
  group,
  month,
  submitting,
  errorMessage,
  onConfirm,
  onBack
}: {
  group: Group;
  month: OfferedMonth;
  submitting: boolean;
  errorMessage?: string;
  onConfirm: () => void;
  onBack: () => void;
}): JSX.Element {
  const t = useT();
  const monthLabel = `${t(monthKey(month.month))} ${month.year}`;
  const priceLabel = t("miniapp.group.monthSubscription", {
    price: formatRsd(group.priceMonthRsd)
  });

  useMainButton({
    text: t("miniapp.group.confirm"),
    onClick: onConfirm,
    isLoading: submitting
  });

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <div className="tg-sech">{t("miniapp.group.confirm")}</div>
      <div className="card">
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.group.groupLabel")}</span>
          <span className="sumrow__v">{group.name}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.group.monthLabel")}</span>
          <span className="sumrow__v">{monthLabel}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.group.priceLabel")}</span>
          <span className="sumrow__v sumrow__v--big">{priceLabel}</span>
        </div>
      </div>
      <div className="note">
        {t("miniapp.group.confirmBody", {
          name: group.name,
          month: monthLabel,
          price: formatRsd(group.priceMonthRsd)
        })}
      </div>

      {errorMessage && (
        <div className="confirm-error" role="alert">
          {errorMessage}
        </div>
      )}

      <FallbackButton text={t("miniapp.group.confirm")} onClick={onConfirm} loading={submitting} />
      <SecondaryButton text={t("miniapp.group.back")} onClick={onBack} disabled={submitting} />
    </div>
  );
}

/**
 * The result screen, rendered straight from {@link GroupBookingResult}: the
 * confirmed count, the queued (waitlisted) dates when the month had full dates, and
 * the skipped (full/passed) dates. The queued and skipped buckets are calm
 * informational notes — never a red error. Queuing/skipping are facts reported by
 * the server, not failures.
 */
function GroupResult({
  result,
  onMyBookings,
  onHome
}: {
  result: GroupBookingResult;
  onMyBookings: () => void;
  onHome: () => void;
}): JSX.Element {
  const t = useT();

  // The server decides each created booking's status: `pending` when the group's
  // trainer must confirm, `booked` when auto-confirmed (trainer has no Telegram).
  // The Mini App only reflects it in the result copy; it never decides confirmation.
  const isPending = result.created.some((booking) => booking.status === "pending");

  // One primary affordance on the result: "to my bookings".
  useMainButton({
    text: t("miniapp.group.toMyBookings"),
    onClick: onMyBookings
  });

  return (
    <div className="screen" role="status" aria-live="polite">
      <Placeholder header={t(isPending ? "miniapp.group.pendingTitle" : "miniapp.group.resultTitle")}>
        <span className="success-badge" aria-hidden="true">
          ✓
        </span>
      </Placeholder>

      <span className="created-count">
        {t(isPending ? "miniapp.group.pendingCount" : "miniapp.group.createdCount", {
          count: result.created.length
        })}
      </span>

      {result.waitlisted.length > 0 && (
        <div className="skipped-block" role="note">
          <span className="skipped-block__header">
            {t("miniapp.group.waitlistedHeader", { count: result.waitlisted.length })}
          </span>
          <span className="skipped-block__item">{t("miniapp.group.waitlistedNote")}</span>
          {result.waitlisted.map((entry) => (
            <span key={entry.date} className="skipped-block__item">
              {formatDayMonth(entry.date)}
            </span>
          ))}
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="skipped-block" role="note">
          <span className="skipped-block__header">{t("miniapp.group.skippedHeader")}</span>
          {result.skipped.map((date) => (
            <span key={date} className="skipped-block__item">
              {formatDayMonth(date)}
            </span>
          ))}
        </div>
      )}

      <FallbackButton text={t("miniapp.group.toMyBookings")} onClick={onMyBookings} />
      <SecondaryButton text={t("miniapp.group.toHome")} onClick={onHome} />
    </div>
  );
}

/**
 * "Вы в листе ожидания" — the CURRENT client's OWN waitlist standing for this group's
 * previewed month, derived from {@link useMyWaitlist}. Privacy: it shows ONLY the
 * caller's own entries (the endpoint is self-scoped) — never another client's identity
 * or a global waitlist roster. Renders nothing when the client has no queued date for
 * this group/month, and stays quiet while loading / on error (it is supplementary).
 *
 * Matching is by the entry's `groupName` (the same name the group carries) AND the
 * previewed year+month parsed from the entry's date — both display-only fields the
 * server returned; the Mini App does no queue math.
 */
function OwnWaitlistNote({
  group,
  year,
  month
}: {
  group: Group;
  year: number;
  month: number;
}): JSX.Element | null {
  const t = useT();
  const waitlist = useMyWaitlist();

  if (waitlist.isLoading || waitlist.isError || !waitlist.data) {
    return null;
  }

  const mine = waitlist.data.filter(
    (entry: WaitlistAdminItem) =>
      entry.groupName === group.name && isInMonth(entry.date, year, month)
  );
  if (mine.length === 0) {
    return null;
  }

  const note =
    mine.length === 1
      ? t("miniapp.group.ownWaitlist.one", {
          date: formatDayMonth(mine[0].date),
          position: mine[0].position
        })
      : t("miniapp.group.ownWaitlist.many", { count: mine.length });

  return (
    <div className="note" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span>{note}</span>
    </div>
  );
}

/** True when an ISO `YYYY-MM-DD` date falls in the given year + 1-based month. */
function isInMonth(isoDate: string, year: number, month: number): boolean {
  return isoDate.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
}

/** A stable string key for a month option (year+month), used as the radio value. */
function monthValue(m: OfferedMonth): string {
  return `${m.year}-${m.month}`;
}

/** Trailing disclosure chevron for the `.lrow__chev` slot. */
function Chevron(): JSX.Element {
  return (
    <svg viewBox="0 0 8 14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1 1l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
