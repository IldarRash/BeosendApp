import { useState } from "react";
import type { Court } from "@beosand/types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SelectField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useReassignCourtBlock } from "../hooks/useCourtBlocks";

interface ReassignCourtDialogProps {
  /** The court-block to move (group auto-block or manual block). */
  blockId: string;
  /** Its current court — excluded from the targets (moving to itself is a no-op). */
  currentCourtId: string;
  /** Block span, shown in the hint when known (blocks page); the grid omits it. */
  startTime?: string;
  endTime?: string;
  /** Active courts offered as move targets. */
  courts: Court[];
  onClose: () => void;
}

/**
 * Move a court-block (group auto-block or manual block) to another court. Shared by
 * the blocks page and the load grid. The server re-checks the target court's freeness
 * and the 6-per-30-min limit for the block's own slots and rejects (409) a clash;
 * this dialog only collects the chosen court and renders the server's error — it
 * computes no availability itself.
 */
export function ReassignCourtDialog({
  blockId,
  currentCourtId,
  startTime,
  endTime,
  courts,
  onClose
}: ReassignCourtDialogProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const reassign = useReassignCourtBlock();

  // Offer every court except the block's current one (moving to itself is a no-op).
  const targets = courts.filter((c) => c.id !== currentCourtId);
  const [courtId, setCourtId] = useState(targets[0]?.id ?? "");

  const current = courts.find((c) => c.id === currentCourtId);
  const currentLabel =
    current === undefined ? "—" : t("admin.courtBlocks.court", { number: current.number });

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (courtId === "") return;
    reassign.mutate(
      { id: blockId, courtId },
      {
        onSuccess: () => {
          notify(t("admin.courtBlocks.courtChanged"), "success");
          onClose();
        }
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.courtBlocks.changeCourtTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reassign.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            type="submit"
            form="reassign-court-form"
            disabled={reassign.isPending || courtId === ""}
          >
            {reassign.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="reassign-court-form" onSubmit={handleSubmit} className="form">
        <p className="state">
          {startTime !== undefined && endTime !== undefined
            ? t("admin.courtBlocks.changeCourtHint", {
                court: currentLabel,
                start: startTime,
                end: endTime
              })
            : t("admin.courtBlocks.changeCourtHintSimple", { court: currentLabel })}
        </p>
        <SelectField
          label={t("admin.courtBlocks.colCourt")}
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          required
          options={targets.map((court) => ({
            value: court.id,
            label: t("admin.courtBlocks.court", { number: court.number })
          }))}
        />
        {reassign.error ? (
          <p className="state state--error" role="alert">
            {reassign.error instanceof Error
              ? reassign.error.message
              : t("admin.courtBlocks.opFailed")}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
