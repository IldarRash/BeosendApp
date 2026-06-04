import { TextField } from "./Field";

export interface DateRange {
  /** Inclusive start, ISO `yyyy-mm-dd`. */
  from: string;
  /** Inclusive end, ISO `yyyy-mm-dd`. */
  to: string;
}

interface DateRangeFilterProps {
  /** Current selection (both bounds are ISO date strings, possibly empty). */
  value: DateRange;
  /** Emits the next range when either bound changes. */
  onChange: (next: DateRange) => void;
  /** Accessible group label for the two date inputs. */
  legend?: string;
}

/**
 * A two-field inclusive date-range picker for the analytics reports. It only
 * collects `from`/`to` ISO strings — range validity (from<=to) and all aggregation
 * live on the server. Rendered as a labelled <form> group so the two date inputs
 * read as a single control to assistive tech.
 */
export function DateRangeFilter({
  value,
  onChange,
  legend = "Период"
}: DateRangeFilterProps): JSX.Element {
  return (
    <form
      className="cluster"
      aria-label={legend}
      onSubmit={(event) => event.preventDefault()}
    >
      <TextField
        label="С"
        type="date"
        value={value.from}
        max={value.to || undefined}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <TextField
        label="По"
        type="date"
        value={value.to}
        min={value.from || undefined}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
    </form>
  );
}
