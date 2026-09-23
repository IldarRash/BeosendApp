import type { ClientRecord, Locale } from "@beosand/types";
import { renderNotificationTemplate } from "../notifications/notification-messages";

export function renderRecordStatus(record: ClientRecord, locale: Locale, override?: string): string {
  const copy = copyFor(locale, record.status);
  const kind = record.kind === "court" ? copy.court : record.kind === "individual-request" ? copy.individual : record.kind === "waitlist" ? copy.waitlist : copy.training;
  const title = `\n${kind}${record.title ? `: ${escapeHtml(record.title)}` : ""}`;
  const trainer = record.trainerName ? `\n${copy.trainer}: ${escapeHtml(record.trainerName)}` : "";
  // Pending court requests never reveal held/requested court numbers.
  const details = record.kind === "court" && record.status === "confirmed" && record.courtNumbers.length
    ? `\n${copy.courts}: ${record.courtNumbers.join(", ")}${record.priceRsd === null ? "" : ` · ${record.priceRsd} RSD`}`
    : record.waitlistPosition === null ? "" : `\n${copy.position}: ${record.waitlistPosition}`;
  const reason = record.reason
    ? `\n${copy.reason}: ${escapeHtml(reasonLabel(record.reason.code, locale))}${record.reason.comment ? ` — ${escapeHtml(record.reason.comment)}` : ""}`
    : "";
  const cancellation = record.status === "cancelled" ? `\n${record.actor === "client" ? copy.cancelledByClient : record.actor === "staff" ? copy.cancelledByStaff : ""}` : "";
  const authoritative = `${copy.heading}${title}\n${escapeHtml(record.date)} ${escapeHtml(record.startTime)}–${escapeHtml(record.endTime)}${trainer}${details}${reason}${cancellation}\n${actionFor(record.nextAction, copy)}`;
  if (!override) return authoritative;
  const editable = renderNotificationTemplate(override, {
    training: `${record.date} ${record.startTime}–${record.endTime}${record.trainerName ? ` · ${record.trainerName}` : ""}`,
    date: record.date,
    startTime: record.startTime,
    endTime: record.endTime,
    trainerName: record.trainerName ?? ""
  });
  return `${editable}\n\n${authoritative}`;
}

export function renderRecordStatusBatch(records: readonly ClientRecord[], locale: Locale): string {
  const heading = locale === "en" ? "Your booking results" : locale === "sr" ? "Rezultati vaših rezervacija" : "Результаты ваших записей";
  const sharedTitle = records.every((record) => record.title === records[0]?.title) ? records[0]?.title : null;
  const sharedReason = records[0]?.reason ?? null;
  const lines = records.map((record) => {
    const status = copyFor(locale, record.status).heading;
    // Batch notifications retain every date/status. Full title/reason stays in
    // the durable record detail/history notification, avoiding Telegram's 4096 cap.
    return `${record.date} ${record.startTime}–${record.endTime}: ${status}`;
  });
  const context = sharedTitle ? escapeHtml(bound(sharedTitle, 80)) : null;
  const reason = sharedReason
    ? `${copyFor(locale, records[0]?.status ?? "pending").reason}: ${escapeHtml(reasonLabel(sharedReason.code, locale))}${sharedReason.comment ? ` — ${escapeHtml(bound(sharedReason.comment, 300))}` : ""}`
    : null;
  // 20 controlled rows plus bounded shared context/reason remain below 4096 chars.
  return [heading, context, reason, ...lines].filter((value): value is string => value !== null).join("\n");
}

function bound(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function copyFor(locale: Locale, status: ClientRecord["status"]): RecordCopy {
  const statusText = locale === "en"
    ? { pending: "Request received", confirmed: "Confirmed", waitlisted: "On the waitlist", declined: "Request declined", cancelled: "Cancelled", attended: "Attended", no_show: "Missed", completed: "Completed" }
    : locale === "sr"
      ? { pending: "Zahtev je primljen", confirmed: "Potvrđeno", waitlisted: "Na listi čekanja", declined: "Zahtev je odbijen", cancelled: "Otkazano", attended: "Prisustvovali ste", no_show: "Niste prisustvovali", completed: "Završeno" }
      : { pending: "Заявка получена", confirmed: "Подтверждено", waitlisted: "В листе ожидания", declined: "Заявка отклонена", cancelled: "Отменено", attended: "Посещено", no_show: "Пропуск", completed: "Завершено" };
  return locale === "en"
    ? { heading: statusText[status], trainer: "Coach", reason: "Reason", court: "Court rental", training: "Training", individual: "Individual request", waitlist: "Waitlist", courts: "Courts", position: "Position", cancelledByClient: "Cancelled by you", cancelledByStaff: "Cancelled by organizer", wait: "Wait for a decision.", attend: "Your place is confirmed.", choose: "Choose another option in the app.", none: "Open the app for details." }
    : locale === "sr"
      ? { heading: statusText[status], trainer: "Trener", reason: "Razlog", court: "Iznajmljivanje terena", training: "Trening", individual: "Individualni zahtev", waitlist: "Lista čekanja", courts: "Tereni", position: "Pozicija", cancelledByClient: "Otkazali ste", cancelledByStaff: "Otkazao organizator", wait: "Sačekajte odluku.", attend: "Vaše mesto je potvrđeno.", choose: "Izaberite drugu opciju u aplikaciji.", none: "Otvorite aplikaciju za detalje." }
      : { heading: statusText[status], trainer: "Тренер", reason: "Причина", court: "Аренда корта", training: "Тренировка", individual: "Индивидуальная заявка", waitlist: "Лист ожидания", courts: "Корты", position: "Позиция", cancelledByClient: "Отменено вами", cancelledByStaff: "Отменено организатором", wait: "Ожидайте решения.", attend: "Ваше место подтверждено.", choose: "Выберите другой вариант в приложении.", none: "Откройте приложение, чтобы посмотреть детали." };
}

interface RecordCopy { heading: string; trainer: string; reason: string; court: string; training: string; individual: string; waitlist: string; courts: string; position: string; cancelledByClient: string; cancelledByStaff: string; wait: string; attend: string; choose: string; none: string; }
function actionFor(next: ClientRecord["nextAction"], copy: RecordCopy): string { return next === "wait" ? copy.wait : next === "attend" ? copy.attend : next === "choose-another" ? copy.choose : copy.none; }

function reasonLabel(code: "unavailable" | "schedule-change" | "staff-unavailable" | "other", locale: Locale): string {
  const labels = locale === "en" ? ["Unavailable", "Schedule changed", "Staff unavailable", "Other"]
    : locale === "sr" ? ["Nije dostupno", "Raspored je promenjen", "Osoblje nije dostupno", "Drugo"]
      : ["Недоступно", "Расписание изменилось", "Сотрудник недоступен", "Другое"];
  return labels[["unavailable", "schedule-change", "staff-unavailable", "other"].indexOf(code)];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
