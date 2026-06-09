import { useMemo, useState } from "react";
import type {
  BookingStatus,
  ListTrainingsQuery,
  MarkAttendanceInput,
  RosterParticipant,
  Training,
  TrainingStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { RosterList } from "../ui/RosterList";
import { TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useTrainings } from "../hooks/useTrainings";
import { useMarkAttendance, useRoster } from "../hooks/useRoster";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for the booking status the API returns (never recomputed here). */
function bookingStatusLabel(status: BookingStatus, t: Translate): string {
  return t(`admin.attendance.booking.${status}`);
}

/** Catalog key for a training's status, used in the candidate picker. */
function trainingStatusLabel(status: TrainingStatus, t: Translate): string {
  return t(`admin.attendance.training.${status}`);
}

/** Today's date as an ISO `yyyy-mm-dd` string for the default range. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.attendance.opFailed");
}

/**
 * M2 — Посещаемость. Pick a training within a date range (defaulted to today,
 * past dates allowed), load its roster from the API (useRoster), and mark each
 * booked client attended/no_show via useMarkAttendance. Headcounts and statuses
 * come straight from the contract — never recomputed here. The server is the
 * authority on whether a session is markable (past/today) and on the
 * trainer/admin gate; its errors are surfaced. Controls are disabled for clearly
 * future trainings only as a UX affordance, not as an enforced rule.
 */
export function Attendance(): JSX.Element {
  const t = useT();
  const { notify } = useToast();

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query: ListTrainingsQuery | null = from && to ? { from, to } : null;
  const trainings = useTrainings(query);
  const roster = useRoster(selectedId);
  const mark = useMarkAttendance();

  const selectedTraining = useMemo<Training | null>(() => {
    if (!selectedId) return null;
    return (trainings.data ?? []).find((t) => t.id === selectedId) ?? null;
  }, [selectedId, trainings.data]);

  // UX affordance only: a training strictly after today is not yet markable.
  // The server remains authoritative and will reject an early mark regardless.
  const isFuture = selectedTraining ? selectedTraining.date > todayIso() : false;

  function markBooking(participant: RosterParticipant, status: MarkAttendanceInput["status"]): void {
    if (!selectedId) return;
    mark.mutate(
      { bookingId: participant.bookingId, trainingId: selectedId, input: { status } },
      {
        onSuccess: () =>
          notify(
            t("admin.attendance.markNotice", {
              client: participant.clientName,
              status: bookingStatusLabel(status, t)
            }),
            "success"
          ),
        onError: (error) => notify(errorText(error, t), "error")
      }
    );
  }

  const trainingColumns: Column<Training>[] = [
    { key: "date", header: t("admin.attendance.colDate"), render: (row) => row.date },
    { key: "time", header: t("admin.attendance.colTime"), render: (row) => `${row.startTime}–${row.endTime}` },
    {
      key: "occupancy",
      header: t("admin.attendance.colOccupancy"),
      numeric: true,
      render: (row) => `${row.bookedCount} / ${row.capacity}`
    },
    { key: "status", header: t("admin.attendance.colStatus"), render: (row) => trainingStatusLabel(row.status, t) },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <Button
          variant={row.id === selectedId ? "primary" : "ghost"}
          onClick={() => setSelectedId(row.id)}
          aria-pressed={row.id === selectedId}
        >
          {row.id === selectedId ? t("admin.attendance.selected") : t("admin.attendance.roster")}
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.attendance.title")}</h1>
          <p>{t("admin.attendance.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <form
          aria-label={t("admin.attendance.filterLabel")}
          onSubmit={(e) => e.preventDefault()}
          className="cluster"
        >
          <TextField
            label={t("admin.field.fromDate")}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label={t("admin.field.toDate")}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </form>

        {query === null ? (
          <p className="state">{t("admin.attendance.pickRange")}</p>
        ) : trainings.isPending ? (
          <p className="state">{t("admin.attendance.loading")}</p>
        ) : trainings.isError ? (
          <p className="state state--error" role="alert">
            {errorText(trainings.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t("admin.attendance.caption")}
            columns={trainingColumns}
            rows={trainings.data}
            rowKey={(row) => row.id}
            emptyLabel={t("admin.attendance.empty")}
          />
        )}

        {selectedId === null ? (
          <p className="state">{t("admin.attendance.pickTraining")}</p>
        ) : roster.isPending ? (
          <p className="state">{t("admin.attendance.rosterLoading")}</p>
        ) : roster.isError ? (
          <p className="state state--error" role="alert">
            {errorText(roster.error, t)}
          </p>
        ) : (
          <section className="stack" aria-label={t("admin.attendance.rosterLabel")}>
            <h2>
              {t("admin.attendance.rosterHeading", {
                date: roster.data.date,
                start: roster.data.startTime,
                end: roster.data.endTime,
                level: roster.data.levelName
              })}
            </h2>
            {isFuture ? (
              <p className="state" role="note">
                {t("admin.attendance.futureNote")}
              </p>
            ) : null}
            <RosterList
              participants={roster.data.participants}
              t={t}
              caption={t("admin.attendance.rosterCaption")}
              emptyLabel={t("admin.attendance.rosterEmpty")}
              actions={{
                header: t("admin.attendance.colMark"),
                render: (p) => (
                  <div className="cluster">
                    <Button
                      variant="ghost"
                      disabled={isFuture || mark.isPending || p.bookingStatus === "attended"}
                      onClick={() => markBooking(p, "attended")}
                    >
                      {t("admin.attendance.markAttended")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={isFuture || mark.isPending || p.bookingStatus === "no_show"}
                      onClick={() => markBooking(p, "no_show")}
                    >
                      {t("admin.attendance.markNoShow")}
                    </Button>
                  </div>
                )
              }}
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}
