import { useEffect, useState } from "react";
import { Button, Modal } from "@telegram-apps/telegram-ui";
import type { DayOfWeek, Level, Trainer } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { OptionList, type Option } from "./OptionList";
import { weekdayFullKey } from "./format";
import type { GroupFilters } from "./group-filter";

/** A sentinel option value for "any / no constraint" on a single-select picker. */
const ANY = "";

interface GroupFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The filters currently applied to the list (the sheet opens seeded from these). */
  value: GroupFilters;
  trainers: ReadonlyArray<Trainer>;
  levels: ReadonlyArray<Level>;
  /** Apply the draft to the list (and close). */
  onApply: (next: GroupFilters) => void;
  /** Clear every filter at once (and close). */
  onReset: () => void;
}

/**
 * The group-list filter as a native bottom-sheet Modal: single-select pickers for
 * weekday, level, and trainer (no time-of-day — a group's time is fixed, so the
 * browse band filter doesn't apply). Built on the same {@link Modal} + {@link
 * OptionList} primitives as the browse {@link FilterSheet} (a separate component
 * rather than a fork because the field set differs), and reuses the
 * `miniapp.browse.filter.*` keys it shares with browse. Edits stage in a local
 * draft committed only on "Применить", so a half-set filter never narrows the list
 * mid-edit; "Сбросить" clears all.
 */
export function GroupFilterSheet({
  open,
  onOpenChange,
  value,
  trainers,
  levels,
  onApply,
  onReset
}: GroupFilterSheetProps): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState<GroupFilters>(value);

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

  const levelOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...levels.map((lvl) => ({ value: lvl.id, label: lvl.name }))
  ];

  const trainerOptions: ReadonlyArray<Option<string>> = [
    { value: ANY, label: t("miniapp.browse.filter.any") },
    ...trainers.map((tr) => ({ value: tr.id, label: tr.name }))
  ];

  // Weekday options carry stringified numbers; coerce back to DayOfWeek on select.
  const pickWeekday = (raw: string): void => {
    hapticSelection();
    setDraft((prev) => ({ ...prev, weekday: raw === ANY ? undefined : (Number(raw) as DayOfWeek) }));
  };

  const pick = <K extends "levelId" | "trainerId">(key: K, raw: string): void => {
    hapticSelection();
    setDraft((prev) => ({ ...prev, [key]: raw === ANY ? undefined : raw }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      header={<Modal.Header>{t("miniapp.group.filter.title")}</Modal.Header>}
    >
      <div className="filter-sheet">
        <OptionList
          name="group-filter-weekday"
          header={t("miniapp.browse.filter.weekday")}
          options={weekdayOptions}
          selected={draft.weekday != null ? String(draft.weekday) : ANY}
          onSelect={pickWeekday}
        />
        <OptionList
          name="group-filter-level"
          header={t("miniapp.browse.filter.level")}
          options={levelOptions}
          selected={draft.levelId ?? ANY}
          onSelect={(v) => pick("levelId", v)}
        />
        <OptionList
          name="group-filter-trainer"
          header={t("miniapp.browse.filter.trainer")}
          options={trainerOptions}
          selected={draft.trainerId ?? ANY}
          onSelect={(v) => pick("trainerId", v)}
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
