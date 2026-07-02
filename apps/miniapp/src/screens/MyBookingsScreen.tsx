import { useState } from "react";
import type { MyBookingItem, MyBookingScope } from "@beosand/types";
import { useExportMyBookingsCalendar, useMyBookings, useMyWaitlist } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess, hapticWarning } from "../tg/buttons";
import { todayLocalDate } from "../ui/format";
import { MyBookingsView } from "../ui/MyBookingsView";
import { TrainingDetailView } from "../ui/TrainingDetailView";

interface MyBookingsScreenProps {
  /** Navigate to the Browse schedule from the empty Upcoming state. */
  onBrowse: () => void;
}

/**
 * The My-bookings journey: a segmented Upcoming/Past list plus the shared training
 * detail. Rows open detail; cancellation lives in detail and uses the existing
 * cancel endpoint. Monthly calendar export is a text/calendar handoff owned by
 * the API; the Mini App only downloads the returned payload.
 */
export function MyBookingsScreen({ onBrowse }: MyBookingsScreenProps): JSX.Element {
  const t = useT();
  const [scope, setScope] = useState<MyBookingScope>("upcoming");
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null);
  const [exportMonth, setExportMonth] = useState(() => {
    const today = todayLocalDate();
    return {
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7))
    };
  });

  const bookings = useMyBookings(scope);
  const waitlist = useMyWaitlist();
  const calendarExport = useExportMyBookingsCalendar();

  const listError =
    bookings.error instanceof Error
      ? bookings.error.message
      : bookings.isError
        ? t("miniapp.myBookings.errorBody")
        : undefined;

  const openDetail = (item: MyBookingItem): void => {
    hapticSelection();
    setSelectedTrainingId(item.trainingId);
  };

  const exportSelectedMonth = (): void => {
    calendarExport.reset();
    calendarExport.mutate(exportMonth, {
      onSuccess: (ics) => {
        downloadCalendarIcs(ics, exportMonth.year, exportMonth.month);
        hapticSuccess();
      },
      onError: () => {
        hapticWarning();
      }
    });
  };

  if (selectedTrainingId) {
    return (
      <TrainingDetailView
        trainingId={selectedTrainingId}
        onBack={() => setSelectedTrainingId(null)}
      />
    );
  }

  const exportError = resolveErrorMessage(calendarExport.error, t, "miniapp.calendar.errorBody");

  return (
    <MyBookingsView
      scope={scope}
      onScopeChange={setScope}
      items={bookings.data}
      waitlist={scope === "upcoming" ? waitlist.data : undefined}
      isLoading={bookings.isLoading}
      errorMessage={listError}
      onOpenBooking={openDetail}
      onBrowse={onBrowse}
      exportMonth={exportMonth}
      onExportMonthChange={(month) => {
        calendarExport.reset();
        setExportMonth(month);
      }}
      onExportMonth={exportSelectedMonth}
      isExportingMonth={calendarExport.isPending}
      exportErrorMessage={exportError}
    />
  );
}

export function downloadCalendarIcs(ics: string, year: number, month: number): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const filename = `beosand-bookings-${year}-${String(month).padStart(2, "0")}.ics`;
  if (typeof window.URL.createObjectURL !== "function") {
    window.location.assign(`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`);
    return;
  }
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}
