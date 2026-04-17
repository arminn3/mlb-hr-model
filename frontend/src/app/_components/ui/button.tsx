"use client";

import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-background font-semibold " +
    "hover:bg-accent/90 active:bg-accent/85 " +
    "disabled:bg-accent/40 disabled:text-background/60",
  secondary:
    "bg-[var(--surface-2)] text-foreground border border-(color:var(--border-strong)) " +
    "hover:bg-[var(--surface-3)] hover:border-(color:var(--border-strong)) " +
    "active:bg-[var(--surface-2)] " +
    "disabled:opacity-40",
  ghost:
    "bg-transparent text-muted " +
    "hover:bg-[var(--surface-2)] hover:text-foreground " +
    "active:bg-[var(--surface-sunken)] " +
    "disabled:opacity-40",
  danger:
    "bg-accent-red/15 text-accent-red border border-accent-red/30 " +
    "hover:bg-accent-red/25 " +
    "disabled:opacity-40",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-[var(--radius-md)]",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-[var(--radius-md)]",
  lg: "h-11 px-5 text-[14px] gap-2 rounded-[var(--radius-lg)]",
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 15, lg: 16 };

export function Button({
  variant = "secondary",
  size = "md",
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  loading,
  fullWidth,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={
        "inline-flex items-center justify-center whitespace-nowrap " +
        "transition-colors duration-[var(--duration-fast)] " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
        "disabled:cursor-not-allowed cursor-pointer " +
        SIZE[size] + " " + VARIANT[variant] +
        (fullWidth ? " w-full" : "") +
        (className ? " " + className : "")
      }
    >
      {LeadingIcon && !loading && <LeadingIcon size={ICON_SIZE[size]} />}
      {loading && (
        <span
          aria-hidden
          className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
          style={{ width: ICON_SIZE[size], height: ICON_SIZE[size] }}
        />
      )}
      {children}
      {TrailingIcon && <TrailingIcon size={ICON_SIZE[size]} />}
    </button>
  );
}
