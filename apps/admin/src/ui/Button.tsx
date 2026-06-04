import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/**
 * The console's single button. Tokens-only styling (sand/ink/coral). Always a
 * real <button> with a visible focus ring; the variant only changes color.
 */
export function Button({
  variant = "primary",
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ["btn", `btn--${variant}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
