import { useState } from "react";
import type { MyBookingItem, MyBookingScope } from "@beosand/types";
import { useMyBookings, useMyWaitlist } from "../api/hooks";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { MyBookingsView } from "../ui/MyBookingsView";
import { TrainingDetailView } from "../ui/TrainingDetailView";

interface MyBookingsScreenProps {
  /** Navigate to the Browse schedule from the empty Upcoming state. */
  onBrowse: () => void;
}

/**
 * The My-bookings journey: a segmented Upcoming/Past list plus the shared training
 * detail. Rows open detail; cancellation lives in detail and uses the existing
 * cancel endpoint.
 */
export function MyBookingsScreen({ onBrowse }: MyBookingsScreenProps): JSX.Element {
  const t = useT();
  const [scope, setScope] = useState<MyBookingScope>("upcoming");
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(null);

  const bookings = useMyBookings(scope);
  const waitlist = useMyWaitlist();

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

  if (selectedTrainingId) {
    return (
      <TrainingDetailView
        trainingId={selectedTrainingId}
        onBack={() => setSelectedTrainingId(null)}
      />
    );
  }

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
    />
  );
}
