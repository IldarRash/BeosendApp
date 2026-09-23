import { useMemo, useState } from "react";
import type { ClientRecord, MyBookingScope } from "@beosand/types";
import { useClientRecords } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { TrainingDetailView } from "../ui/TrainingDetailView";
import { formatDayMonth, formatRsd, formatTimeRange } from "../ui/format";

interface MyBookingsScreenProps { onBrowse: () => void; }

/** A single API-owned timeline of the caller's bookings, requests and outcomes. */
export function MyBookingsScreen({ onBrowse }: MyBookingsScreenProps): JSX.Element {
  const t = useT();
  const [scope, setScope] = useState<MyBookingScope>("upcoming");
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null);
  const records = useClientRecords(scope);
  const items = useMemo(() => {
    const byId = new Map<string, ClientRecord>();
    for (const page of records.data?.pages ?? []) for (const item of page.items) byId.set(item.id, item);
    return [...byId.values()];
  }, [records.data]);

  if (selectedTrainingId) return <TrainingDetailView trainingId={selectedTrainingId} onBack={() => setSelectedTrainingId(null)} />;
  if (records.isLoading) return <div className="screen screen__center"><LoadingState /></div>;
  if (records.isError) return <div className="screen screen__center"><ErrorState message={records.error instanceof Error ? records.error.message : undefined} /></div>;

  return <div className="screen">
    <h1 className="tg-sech">{t("miniapp.records.title")}</h1>
    <div className="seg" role="tablist" aria-label={t("miniapp.myBookings.tabsAria")}>
      {(["upcoming", "past"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={scope === value} className={scope === value ? "seg__item is-on" : "seg__item"} onClick={() => setScope(value)}>{t(value === "upcoming" ? "miniapp.records.upcoming" : "miniapp.records.past")}</button>)}
    </div>
    {items.length === 0 ? <EmptyState titleKey={scope === "upcoming" ? "miniapp.records.emptyUpcoming" : "miniapp.records.emptyPast"} bodyKey={scope === "upcoming" ? "miniapp.myBookings.emptyUpcomingBody" : "miniapp.myBookings.emptyPastBody"} actionKey={scope === "upcoming" ? "miniapp.myBookings.toBrowse" : undefined} onAction={scope === "upcoming" ? onBrowse : undefined} /> : <RecordsView items={items} onOpen={(record) => { if (record.kind === "booking" && record.canCancel && record.trainingId) { hapticSelection(); setSelectedTrainingId(record.trainingId); } }} />}
    {records.hasNextPage ? <FallbackButton text={t("miniapp.records.loadMore")} loading={records.isFetchingNextPage} onClick={() => { void records.fetchNextPage(); }} /> : null}
  </div>;
}

/** Pure records surface for the screen and fixture-based visual QA. */
export function RecordsView({ items, onOpen = () => {} }: { items: ClientRecord[]; onOpen?: (record: ClientRecord) => void }): JSX.Element {
  const grouped = new Map<string, ClientRecord[]>();
  const standalone: ClientRecord[] = [];
  for (const item of items) {
    if (item.groupSubscriptionId) grouped.set(item.groupSubscriptionId, [...(grouped.get(item.groupSubscriptionId) ?? []), item]);
    else standalone.push(item);
  }
  return <div className="card" role="list">
    {standalone.map((record) => <RecordRow key={record.id} record={record} onOpen={() => onOpen(record)} />)}
    {[...grouped.values()].map((records) => <section key={records[0]!.groupSubscriptionId} aria-label={records[0]!.title ?? ""}><div className="tg-sech">{records[0]!.title ?? ""}</div>{records.map((record) => <RecordRow key={record.id} record={record} onOpen={() => onOpen(record)} />)}</section>)}
  </div>;
}

function RecordRow({ record, onOpen }: { record: ClientRecord; onOpen: () => void }): JSX.Element {
  const t = useT();
  const title = record.title ?? t(`miniapp.records.kind.${record.kind}`);
  const dateTime = `${formatDayMonth(record.date)} · ${formatTimeRange(record.startTime, record.endTime)}`;
  const confirmedCourts = record.kind === "court" && record.status === "confirmed" && record.courtNumbers.length ? t("miniapp.records.courts", { courts: record.courtNumbers.join(", ") }) : null;
  const details = [record.trainerName, record.levelName, record.courtCount ? t("miniapp.myBookings.courtCount", { count: record.courtCount }) : null, confirmedCourts, record.priceRsd != null ? t("miniapp.records.price", { price: formatRsd(record.priceRsd) }) : null].filter(Boolean).join(" · ");
  const reason = record.reason ? `${t(`miniapp.records.reasonCode.${record.reason.code}`)}${record.reason.comment ? `: ${record.reason.comment}` : ""}` : null;
  // Actors disambiguate cancellations; a declined status already says it was a decision.
  const actor = record.status === "cancelled" && record.actor ? t(`miniapp.records.actor.${record.actor}`) : null;
  const content = <span className="lrow__main records-row__main"><span className="lrow__title">{title}</span><span className={`schip records-row__status schip--${statusVariant(record.status)}`}>{t(`miniapp.records.status.${record.status}`)}</span><span className="lrow__sub">{dateTime}</span>{details ? <span className="lrow__sub">{details}</span> : null}{record.waitlistPosition != null ? <span className="lrow__sub">{t("miniapp.records.position", { position: record.waitlistPosition })}</span> : null}{reason ? <span className="lrow__sub">{t("miniapp.records.reason", { reason })}</span> : null}{actor ? <span className="lrow__sub">{actor}</span> : null}{record.nextAction !== "none" ? <span className="lrow__sub">{t(`miniapp.records.next.${record.nextAction}`)}</span> : null}</span>;
  const editable = record.kind === "booking" && record.canCancel && record.trainingId != null;
  return editable ? <button type="button" className="lrow records-row" role="listitem" onClick={onOpen} aria-label={`${title}. ${dateTime}`}>{content}</button> : <div className="lrow records-row" role="listitem">{content}</div>;
}

function statusVariant(status: ClientRecord["status"]): "ok" | "warn" | "co" | "muted" {
  if (status === "confirmed" || status === "attended" || status === "completed") return "ok";
  if (status === "pending" || status === "waitlisted") return "warn";
  if (status === "declined") return "co";
  return "muted";
}
