"use client";

import type { LucideIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

/**
 * Button variants copied verbatim from the buttons ACTUALLY rendered across the
 * app, so a <Button> is visually identical to the rest of the platform (MLB
 * today, NFL going forward). Each maps to a real on-screen button:
 *
 * - primary   → solid-accent CTA   (dashboard.tsx:100 "View Live Feed" / Unlock)
 * - secondary → neutral control    (date-picker.tsx:64 date select / arrows)
 * - accent    → selected segment   (lookback-toggle.tsx:22 active L5/L10 pill)
 * - ghost     → unselected segment (lookback-toggle.tsx:23 inactive pill)
 * - danger/success → tinted red/green (matches the app's tinted pill convention)
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-background font-semibold hover:bg-accent/90",
  secondary:
    "bg-card/50 text-foreground border border-card-border hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)]",
  accent:
    "bg-accent/15 text-accent font-semibold hover:bg-accent/25",
  ghost:
    "bg-transparent text-muted hover:text-foreground",
  danger:
    "bg-accent-red/15 text-accent-red border border-accent-red/30 hover:bg-accent-red/25",
  success:
    "bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25",
};

// Sizing matches the app's real controls (text-xs, px-3 py-1.5 for the default).
const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[11px] gap-1.5 rounded-md",
  md: "px-3 py-1.5 text-xs gap-1.5 rounded-lg",
  lg: "px-4 py-2 text-xs gap-2 rounded-lg",
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 15, lg: 16 };

interface CommonProps {
  variant?: Variant;
  size?: Size;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export type ButtonProps =
  | (CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined })
  | (CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string });

function Spinner({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}

export function Button(props: ButtonProps) {
  const {
    variant = "secondary",
    size = "md",
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    loading,
    fullWidth,
    className,
    children,
    ...rest
  } = props;

  const classes =
    "inline-flex items-center justify-center whitespace-nowrap cursor-pointer " +
    "transition-colors duration-[120ms] " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
    "disabled:cursor-not-allowed disabled:opacity-40 " +
    VARIANT_CLASSES[variant] +
    " " +
    SIZE[size] +
    (fullWidth ? " w-full" : "") +
    (className ? " " + className : "");

  const inner = (
    <>
      {LeadingIcon && !loading && <LeadingIcon size={ICON_SIZE[size]} />}
      {loading && <Spinner size={ICON_SIZE[size]} />}
      {children != null && <span>{children}</span>}
      {TrailingIcon && <TrailingIcon size={ICON_SIZE[size]} />}
    </>
  );

  if ("href" in props && props.href) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return (
      <a {...anchorRest} href={href} className={classes}>
        {inner}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      {...buttonRest}
      disabled={buttonRest.disabled || loading}
      className={classes}
    >
      {inner}
    </button>
  );
}
