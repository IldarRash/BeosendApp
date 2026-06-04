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
import { TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useTrainings } from "../hooks/useTrainings";
import { useMarkAttendance, useRoster } from "../hooks/useRoster";

/** RU labels for the booking status the API returns (never recomputed here). */
const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Записан",
  cancelled: "Отменён",
  attended: "Пришёл",
  no_show: "Не пришёл",
  waitlist: "Лист ожидания"
};

/** RU labels for a training's status, used in the candidate picker. */
const TRAINING_STATUS_LABEL: Record<TrainingStatus, string> = {
  open: "Открыта",
  full: "Заполнена",
  cancelled: "Отменена",
  completed: "Завершена"
};

/** Tag modifier per booking status — tint only; the rendered value stays the API's. */
function statusTagClass(status: BookingStatus): string {
  if (status === "attended") return "tag tag--ok";
  if (status === "no_show") return "tag tag--warn";
  return "tag";
}

/** Today's date as an ISO `yyyy-mm-dd` string for the default range. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию.";
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
            `${participant.clientName}: ${BOOKING_STATUS_LABEL[status]}.`,
            "success"
          ),
        onError: (error) => notify(errorText(error), "error")
      }
    );
  }

  const trainingColumns: Column<Training>[] = [
    { key: "date", header: "Дата", render: (t) => t.date },
    { key: "time", header: "Время", render: (t) => `${t.startTime}–${t.endTime}` },
    {
      key: "occupancy",
      header: "Занятость",
      numeric: true,
      render: (t) => `${t.bookedCount} / ${t.capacity}`
    },
    { key: "status", header: "Статус", render: (t) => TRAINING_STATUS_LABEL[t.status] },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <Button
          variant={t.id === selectedId ? "primary" : "ghost"}
          onClick={() => setSelectedId(t.id)}
          aria-pressed={t.id === selectedId}
        >
          {t.id === selectedId ? "Выбрана" : "Ростер"}
        </Button>
      )
    }
  ];

  const rosterColumns: Column<RosterParticipant>[] = [
    { key: "name", header: "Клиент", render: (p) => p.clientName },
    {
      key: "status",
      header: "Посещаемость",
      render: (p) => (
        <span className={statusTagClass(p.bookingStatus)}>
          {BOOKING_STATUS_LABEL[p.bookingStatus]}
        </span>
      )
    },
    {
      key: "actions",
      header: "Отметить",
      render: (p) => (
        <div className="cluster">
          <Button
            variant="ghost"
            disabled={isFuture || mark.isPending || p.bookingStatus === "attended"}
            onClick={() => markBooking(p, "attended")}
          >
            Пришёл
          </Button>
          <Button
            variant="ghost"
            disabled={isFuture || mark.isPending || p.bookingStatus === "no_show"}
            onClick={() => markBooking(p, "no_show")}
          >
            Не пришёл
          </Button>
        </div>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Посещаемость</h1>
          <p>Выберите тренировку и отметьте каждого записанного клиента.</p>
        </div>
      </header>

      <div className="stack">
        <form
          aria-label="Фильтр тренировок"
          onSubmit={(e) => e.preventDefault()}
          className="cluster"
        >
          <TextField
            label="С даты"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label="По дату"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </form>

        {query === null ? (
          <p className="state">Укажите период, чтобы увидеть тренировки.</p>
        ) : trainings.isPending ? (
          <p className="state">Загрузка тренировок…</p>
        ) : trainings.isError ? (
          <p className="state state--error" role="alert">
            {errorText(trainings.error)}
          </p>
        ) : (
          <DataTable
            caption="Тренировки за выбранный период"
            columns={trainingColumns}
            rows={trainings.data}
            rowKey={(t) => t.id}
            emptyLabel="За выбранный период тренировок нет."
          />
        )}

        {selectedId === null ? (
          <p className="state">Выберите тренировку, чтобы открыть её ростер.</p>
        ) : roster.isPending ? (
          <p className="state">Загрузка ростера…</p>
        ) : roster.isError ? (
          <p className="state state--error" role="alert">
            {errorText(roster.error)}
          </p>
        ) : (
          <section className="stack" aria-label="Ростер тренировки">
            <h2>
              Ростер — {roster.data.date} {roster.data.startTime}–{roster.data.endTime},{" "}
              {roster.data.levelName}
            </h2>
            {isFuture ? (
              <p className="state" role="note">
                Тренировка ещё не прошла — отметить посещаемость можно в день тренировки или позже.
              </p>
            ) : null}
            <DataTable
              caption="Записанные клиенты"
              columns={rosterColumns}
              rows={roster.data.participants}
              rowKey={(p) => p.bookingId}
              emptyLabel="На эту тренировку никто не записан."
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}
