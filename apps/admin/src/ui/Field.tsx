import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

interface FieldShellProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/** Label + control + optional hint/error wired together for accessibility. */
function FieldShell({ label, htmlFor, error, hint, children }: FieldShellProps): JSX.Element {
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined;
  return (
    <div className={error ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <span id={describedBy} className="field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={describedBy} className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
}

/** Single-line text/number/time input bound to a label. */
export function TextField({ label, error, hint, ...rest }: TextFieldProps): JSX.Element {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint}>
      <input
        id={id}
        className="input"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </FieldShell>
  );
}

interface NumberFieldProps extends Omit<TextFieldProps, "type" | "value" | "onChange"> {
  /** Current numeric value, or null/empty while the field is being cleared. */
  value: number | null;
  /** Emits the parsed integer, or null when the input is empty/invalid. */
  onValueChange: (value: number | null) => void;
}

/**
 * Integer input that emits a parsed number (or null when empty). The browser
 * shows a numeric keypad; parsing/validation of bounds is the server's job — this
 * primitive only marshals the value.
 */
export function NumberField({ value, onValueChange, ...rest }: NumberFieldProps): JSX.Element {
  return (
    <TextField
      type="number"
      inputMode="numeric"
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onValueChange(null);
          return;
        }
        const parsed = Number.parseInt(raw, 10);
        onValueChange(Number.isNaN(parsed) ? null : parsed);
      }}
      {...rest}
    />
  );
}

interface TimeFieldProps extends Omit<TextFieldProps, "type"> {
  /** "HH:MM" value (or empty). */
  value: string;
}

/**
 * 24h "HH:MM" time input (`<input type="time">`). Time-order validation lives on
 * the server — the field only collects the value.
 */
export function TimeField({ value, ...rest }: TimeFieldProps): JSX.Element {
  return <TextField type="time" value={value} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Render the option non-selectable (e.g. a group already fully generated). */
  disabled?: boolean;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: SelectOption[];
  error?: string;
  hint?: string;
}

/** Select bound to a label, options passed in (no local domain lists). */
export function SelectField({
  label,
  options,
  error,
  hint,
  ...rest
}: SelectFieldProps): JSX.Element {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint}>
      <select
        id={id}
        className="input"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
