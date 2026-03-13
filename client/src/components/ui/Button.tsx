import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  wide?: boolean;
}

export function Button({
  children,
  className = "",
  variant = "primary",
  wide = false,
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      {...props}
      className={`button button--${variant} ${wide ? "button--wide" : ""} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
