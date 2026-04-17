"use client";

import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "ghost" | "solid";
type Size = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  variant?: Variant;
  size?: Size;
  /** Required — icon-only buttons have no readable label for screen readers. */
  "aria-label": string;
}

const VARIANT: Record<Variant, string> = {
  ghost:
    "bg-transparent text-muted " +
    "hover:bg-[var(--surface-2)] hover:text-foreground " +
    "active:bg-[var(--surface-sunken)] " +
    "disabled:opacity-30",
  solid:
    "bg-[var(--surface-2)] text-foreground border border-[var(--border-strong)] " +
    "hover:bg-[var(--surface-3)] " +
    "active:bg-[var(--surface-2)] " +
    "disabled:opacity-30",
};

const SIZE: Record<Size, string> = {
  sm: "w-7 h-7 rounded-[var(--radius-md)]",
  md: "w-9 h-9 rounded-[var(--radius-md)]",
  lg: "w-11 h-11 rounded-[var(--radius-lg)]",
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 16, lg: 18 };

export function IconButton({
  icon: Icon,
  variant = "ghost",
  size = "md",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      className={
        "inline-flex items-center justify-center " +
        "transition-colors duration-[var(--duration-fast)] " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
        "disabled:cursor-not-allowed cursor-pointer " +
        SIZE[size] + " " + VARIANT[variant] +
        (className ? " " + className : "")
      }
    >
      <Icon size={ICON_SIZE[size]} />
    </button>
  );
}
