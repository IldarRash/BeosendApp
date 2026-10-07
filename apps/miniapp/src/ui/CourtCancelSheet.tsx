import { Button, Modal } from "@telegram-apps/telegram-ui";
import type { ClientRecord } from "@beosand/types";
import { useLayoutEffect, useRef } from "react";
import { useT } from "../i18n/LanguageProvider";
import { formatDayMonth, formatRsd, formatTimeRange } from "./format";

type CancellableCourt = Pick<
  ClientRecord,
  "date" | "startTime" | "endTime" | "courtCount" | "priceRsd"
>;

interface CourtCancelSheetProps {
  item: (CancellableCourt & { id: string }) | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  submitting: boolean;
  errorMessage?: string;
}

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
} as const;

/** Links the Modal's generated dialog ids to meaningful title and description text. */
function DialogMetadata({ title, description }: { title: string; description: string }): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const dialog = titleRef.current?.closest<HTMLElement>("[role='dialog']");
    const titleId = dialog?.getAttribute("aria-labelledby");
    const descriptionId = dialog?.getAttribute("aria-describedby");
    if (titleId && titleRef.current) titleRef.current.id = titleId;
    if (descriptionId && descriptionRef.current) descriptionRef.current.id = descriptionId;
  }, []);
  return <><h2 ref={titleRef} style={visuallyHidden}>{title}</h2><p ref={descriptionRef} style={visuallyHidden}>{description}</p></>;
}

/**
 * Confirmation for an API-authorized court cancellation. The caller supplies an
 * item only after reading the server's `canCancel` flag; this component merely
 * presents its facts and never infers cancellation eligibility locally.
 */
export function CourtCancelSheet({
  item,
  onOpenChange,
  onConfirm,
  submitting,
  errorMessage
}: CourtCancelSheetProps): JSX.Element {
  const t = useT();
  const title = t("miniapp.records.cancelCourtTitle");
  const description = t("miniapp.records.cancelCourtBody");
  return (
    <Modal
      open={item != null}
      onOpenChange={(open) => { if (!submitting) onOpenChange(open); }}
      header={<Modal.Header>{title}</Modal.Header>}
    >
      <div className="cancel-sheet">
        <DialogMetadata title={title} description={description} />
        {item ? (
          <>
            <div className="card">
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
                <span className="sumrow__v">{formatDayMonth(item.date)}</span>
              </div>
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
                <span className="sumrow__v">{formatTimeRange(item.startTime, item.endTime)}</span>
              </div>
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.records.kind.court")}</span>
                <span className="sumrow__v">
                  {t("miniapp.myBookings.courtCount", { count: item.courtCount ?? 1 })}
                  {item.priceRsd != null ? ` · ${t("miniapp.records.price", { price: formatRsd(item.priceRsd) })}` : ""}
                </span>
              </div>
            </div>
            <p className="note">{description}</p>
          </>
        ) : null}
        {errorMessage ? <div className="confirm-error" role="alert">{errorMessage}</div> : null}
        <div className="cancel-sheet__actions">
          <Button size="l" mode="plain" stretched disabled={submitting} onClick={() => onOpenChange(false)}>
            {t("miniapp.records.cancelCourtKeep")}
          </Button>
          <Button size="l" mode="outline" stretched disabled={submitting} loading={submitting} onClick={onConfirm}>
            {t("miniapp.records.cancelCourtConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

