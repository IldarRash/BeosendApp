import { useEffect, useState } from "react";
import { Button, Modal } from "@telegram-apps/telegram-ui";
import type { DayOfWeek, Level, TimeOfDay, Trainer } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { OptionList, type Option } from "./OptionList";
import { timeOfDayKey, weekdayFullKey } from "./format";

/**
 * The browse filter selection — a UI model, NOT a domain contract, so it lives in
 * the design layer. Every field is optional ("any"); the screen maps a set
 * selection onto the `AvailableSlotsQuery` (weekday/timeOfDay/trainerId/levelId)
 * and clears the field when the value is unset. The `Today` toggle and date window
 * are owned by the screen, not this sheet.
 */
export interface SlotFilters {
  weekday?: DayOfWeek;
  timeOfDay?: TimeOfDay;
  trainerId?: string;
  levelId?: string;
}

/** A sentinel option value for "any / no constraint" on a single-select picker. */
const ANY = "";

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The filters currently applied to the list (the sheet opens seeded from these). */
  value: SlotFilters;
  trainers: ReadonlyArray<Trainer>;
  levels: ReadonlyArray<Level>;
  /** Apply the draft to the list (and close). */
  onApply: (next: SlotFilters) => void;
  /** Clear every filter at once (and close). */
  onReset: () => void;
}

/**
 * The slot filter as a native bottom-sheet Modal: single-select pickers for
 * weekday, time-of-day, trainer, and level (each an {@link OptionList} with a real
 * Radio so selection is keyboard- and AT-accessible, not color-only). Edits are
 * staged in a local draft and only committed on "Применить", so half-set filters
 * never refetch the list mid-edit; "Сбросить" clears all. The coral accent appears
 * only on the primary Apply button and the selected rows' tint.
 */
export function FilterSheet({
  open,
  onOpenChange,
  value,
  trainers,
  levels,
  onApply,
  onReset
}: FilterSheetProps): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState<SlotFilters>(value);

  // Re-seed the draft from the applied filters each time the sheet opens, so a
  // cancelled edit (close without Apply) doesn't leak into the next open.
  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  const weekdayOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...([1, 2, 3, 4, 5, 6, 7] as DayOfWeek[]).map((d) => ({
      value: String(d),
      label: t(weekdayFullKey(d))
    }))
  ];

  const timeOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...(["morning", "afternoon", "evening"] as TimeOfDay[]).map((band) => ({
      value: band,
      label: t(timeOfDayKey(band))
    }))
  ];

  const trainerOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...trainers.map((tr) => ({ value: tr.id, label: tr.name }))
  ];

  const levelOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...levels.map((lvl) => ({ value: lvl.id, label: lvl.name }))
  ];

  const pick = <K extends keyof SlotFilters>(key: K, raw: string): void => {
    hapticSelection();
    setDraft((prev) => ({ ...prev, [key]: raw === ANY ? undefined : (raw as SlotFilters[K]) }));
  };

  // Weekday options carry stringified numbers; coerce back to DayOfWeek on select.
  const pickWeekday = (raw: string): void => {
    hapticSelection();
    setDraft((prev) => ({ ...prev, weekday: raw === ANY ? undefined : (Number(raw) as DayOfWeek) }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      header={<Modal.Header>{t("miniapp.browse.filter.title")}</Modal.Header>}
    >
      <div className="filter-sheet">
        <OptionList
          name="filter-weekday"
          header={t("miniapp.browse.filter.weekday")}
          options={weekdayOptions}
          selected={draft.weekday != null ? String(draft.weekday) : ANY}
          onSelect={pickWeekday}
        />
        <OptionList
          name="filter-time-of-day"
          header={t("miniapp.browse.filter.timeOfDay")}
          options={timeOptions}
          selected={draft.timeOfDay ?? ANY}
          onSelect={(v) => pick("timeOfDay", v)}
        />
        <OptionList
          name="filter-trainer"
          header={t("miniapp.browse.filter.trainer")}
          options={trainerOptions}
          selected={draft.trainerId ?? ANY}
          onSelect={(v) => pick("trainerId", v)}
        />
        <OptionList
          name="filter-level"
          header={t("miniapp.browse.filter.level")}
          options={levelOptions}
          selected={draft.levelId ?? ANY}
          onSelect={(v) => pick("levelId", v)}
        />

        <div className="filter-sheet__actions">
          <Button size="l" mode="plain" stretched onClick={onReset}>
            {t("miniapp.browse.filter.reset")}
          </Button>
          <Button size="l" stretched onClick={() => onApply(draft)}>
            {t("miniapp.browse.filter.apply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
