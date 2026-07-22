"use client";

import type { LucideIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

/**
 * Flat button variants that mirror the styles ACTUALLY used across the app, so a
 * <Button> is visually identical to the rest of the platform (MLB today, NFL
 * going forward). This is the design-system source of truth for buttons.
 *
 * - primary   → solid accent CTA        (`bg-accent text-background`, e.g. selected filters)
 * - accent    → tinted accent / toggle  (`bg-accent/15 text-accent border`, e.g. active tabs)
 * - secondary → neutral control         (`bg-card/50 border`, e.g. dropdown triggers)
 * - ghost     → flat text
 * - danger/success → tinted red/green
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-background hover:bg-[#7cb6fb] active:bg-[#4d90e8]",
  accent:
    "bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25",
  secondary:
    "bg-card/50 text-foreground border border-card-border hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-muted hover:bg-[var(--surface-2)] hover:text-foreground active:bg-[var(--surface-sunken)]",
  danger:
    "bg-accent-red/15 text-accent-red border border-accent-red/30 hover:bg-accent-red/25",
  success:
    "bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
  lg: "h-11 px-5 text-[14px] gap-2 rounded-lg",
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
    "inline-flex items-center justify-center whitespace-nowrap font-semibold cursor-pointer " +
    "transition-colors duration-[120ms] active:translate-y-px " +
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
