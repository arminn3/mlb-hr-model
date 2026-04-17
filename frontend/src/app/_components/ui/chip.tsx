"use client";

import { X } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type Size = "sm" | "md";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  onRemove?: () => void;
  count?: number;
  size?: Size;
}

const SIZE: Record<Size, string> = {
  sm: "h-6 px-2 text-[11px] gap-1 rounded-full",
  md: "h-7 px-3 text-[12px] gap-1.5 rounded-full",
};

export function Chip({
  selected,
  onRemove,
  count,
  size = "md",
  className,
  children,
  onClick,
  ...rest
}: ChipProps) {
  const base =
    "inline-flex items-center font-medium whitespace-nowrap " +
    "transition-colors duration-[var(--duration-fast)] " +
    "cursor-pointer " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  const state = selected
    ? "bg-accent/15 text-accent border border-accent/30 font-semibold"
    : "bg-[var(--surface-2)] text-muted border border-[var(--border-subtle)] hover:text-foreground hover:border-[var(--border-strong)]";

  return (
    <button
      {...rest}
      onClick={onClick}
      className={base + " " + SIZE[size] + " " + state + (className ? " " + className : "")}
    >
      <span>{children}</span>
      {typeof count === "number" && (
        <span className="font-mono opacity-70">{count}</span>
      )}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="inline-flex items-center justify-center opacity-70 hover:opacity-100"
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}
