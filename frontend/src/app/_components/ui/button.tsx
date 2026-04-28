"use client";

import type { LucideIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

interface VariantTokens {
  from: string;
  to: string;
  ring: string;
  text: string;
}

// 3D button colors per variant. The Figma source spec is the primary entry
// (#4476f5 → #3461d1, ring rgba(55,93,187,0.65)). Other variants follow the
// same lighter-top → darker-bottom gradient pattern with a tinted outer ring.
const VARIANT_TOKENS: Record<Exclude<Variant, "ghost">, VariantTokens> = {
  primary:   { from: "#60a5fa", to: "#3b82f6", ring: "rgba(29,78,216,0.65)",   text: "#ffffff" },
  success:   { from: "#22c55e", to: "#16a34a", ring: "rgba(21,128,61,0.65)",   text: "#ffffff" },
  danger:    { from: "#ef4444", to: "#dc2626", ring: "rgba(185,28,28,0.65)",   text: "#ffffff" },
  secondary: { from: "#3f3f46", to: "#27272a", ring: "rgba(63,63,70,0.65)",    text: "#ffffff" },
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

function Button3DLayers({ from, to }: { from: string; to: string }) {
  return (
    <>
      {/* gradient background */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{ backgroundImage: `linear-gradient(to bottom, ${from}, ${to})` }}
      />
      {/* inner top-highlight + bottom-shade — the depth cue */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{
          boxShadow:
            "inset 0 1px 0 0 rgba(255,255,255,0.18), inset 0 -1px 0 0 rgba(10,13,18,0.12)",
        }}
      />
    </>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
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

  const isGhost = variant === "ghost";
  const tokens = isGhost ? null : VARIANT_TOKENS[variant];

  const baseClasses =
    "relative inline-flex items-center justify-center whitespace-nowrap font-semibold cursor-pointer overflow-hidden " +
    "transition-transform duration-75 active:translate-y-px " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
    "disabled:cursor-not-allowed disabled:opacity-40 " +
    SIZE[size] +
    (fullWidth ? " w-full" : "") +
    (className ? " " + className : "");

  const flatGhostClasses =
    "bg-transparent text-muted hover:bg-[var(--surface-2)] hover:text-foreground active:bg-[var(--surface-sunken)]";

  const style: React.CSSProperties | undefined = tokens
    ? {
        color: tokens.text,
        boxShadow: `0 1px 2px 0 rgba(10,13,18,0.12), 0 0 0 1px ${tokens.ring}`,
      }
    : undefined;

  const inner = (
    <>
      {tokens && <Button3DLayers from={tokens.from} to={tokens.to} />}
      {LeadingIcon && !loading && (
        <LeadingIcon className="relative" size={ICON_SIZE[size]} />
      )}
      {loading && <Spinner size={ICON_SIZE[size]} />}
      {children != null && <span className="relative">{children}</span>}
      {TrailingIcon && (
        <TrailingIcon className="relative" size={ICON_SIZE[size]} />
      )}
    </>
  );

  if ("href" in props && props.href) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return (
      <a
        {...anchorRest}
        href={href}
        className={baseClasses + (isGhost ? " " + flatGhostClasses : "")}
        style={style}
      >
        {inner}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      {...buttonRest}
      disabled={buttonRest.disabled || loading}
      className={baseClasses + (isGhost ? " " + flatGhostClasses : "")}
      style={style}
    >
      {inner}
    </button>
  );
}
