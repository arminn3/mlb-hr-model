import type { HTMLAttributes } from "react";

type Variant = "neutral" | "accent" | "success" | "warning" | "danger";
type Size = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT: Record<Variant, string> = {
  neutral:
    "bg-[var(--surface-2)] text-muted border border-(color:var(--border-subtle))",
  accent:
    "bg-accent/15 text-accent border border-accent/30",
  success:
    "bg-accent-green/15 text-accent-green border border-accent-green/30",
  warning:
    "bg-accent-yellow/15 text-accent-yellow border border-accent-yellow/30",
  danger:
    "bg-accent-red/15 text-accent-red border border-accent-red/30",
};

const SIZE: Record<Size, string> = {
  sm: "text-[10px] leading-[12px] px-1.5 py-0.5 rounded-[var(--radius-sm)]",
  md: "text-[11px] leading-[14px] px-2 py-1 rounded-[var(--radius-md)]",
};

export function Badge({
  variant = "neutral",
  size = "md",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={
        "inline-flex items-center gap-1 font-semibold uppercase tracking-[0.04em] whitespace-nowrap " +
        SIZE[size] + " " + VARIANT[variant] +
        (className ? " " + className : "")
      }
    >
      {children}
    </span>
  );
}
