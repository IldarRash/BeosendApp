import { Cell, Radio, Section } from "@telegram-apps/telegram-ui";
import type { ReactNode } from "react";

export interface Option<T> {
  /** A stable value identifying the option. */
  value: T;
  /** The visible label. */
  label: string;
}

interface OptionListProps<T> {
  /**
   * A unique radio-group name for THIS list. Required so two OptionLists on the same
   * screen (e.g. the four FilterSheet pickers) don't share one HTML radio group,
   * which would break native + assistive-tech single-select semantics.
   */
  name: string;
  header?: string;
  footer?: string;
  options: ReadonlyArray<Option<T>>;
  /** The currently selected value (compared by ===). */
  selected: T;
  onSelect: (value: T) => void;
}

/**
 * A single-select list of telegram-ui Cells with real <Radio> inputs, used by the
 * language and level pickers. Selection is announced to assistive tech via the
 * Radio + `aria-current`, never by color alone; the chosen row also carries a coral
 * tint + marker (ui/theme.css `.pick-row--selected`). The row is keyboard-focusable
 * and Enter/Space activates it.
 *
 * Selection is driven by a SINGLE handler on the Cell (`onClick`); the Radio is
 * presentational/aria-only (`readOnly`, no `onChange`) so a tap can't fire onSelect
 * twice. Each list passes a distinct `name` so its radios form their own group.
 */
export function OptionList<T extends string | number | undefined>({
  name,
  header,
  footer,
  options,
  selected,
  onSelect
}: OptionListProps<T>): JSX.Element {
  return (
    <Section header={header} footer={footer}>
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Cell
            key={String(option.value)}
            Component="label"
            className={isSelected ? "pick-row pick-row--selected" : "pick-row"}
            aria-current={isSelected || undefined}
            before={
              <Radio
                name={name}
                checked={isSelected}
                readOnly
                aria-label={option.label}
              />
            }
            after={isSelected ? marker : undefined}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </Cell>
        );
      })}
    </Section>
  );
}

const marker: ReactNode = <span className="pick-marker" aria-hidden="true" />;
