import type { HTMLAttributes } from "react";

type Variant = "default" | "raised" | "sunken" | "outline";
type Padding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: Padding;
  /** Adds hover lift. Do NOT enable on cards that contain a table — the
   *  row hover + card hover will double-animate. */
  interactive?: boolean;
}

const VARIANT: Record<Variant, string> = {
  default:
    "bg-[var(--surface-1)] border border-(color:var(--border-subtle))",
  raised:
    "bg-[var(--surface-2)] border border-(color:var(--border-strong)) shadow-[var(--shadow-md)]",
  sunken:
    "bg-[var(--surface-sunken)] border border-(color:var(--border-subtle))",
  outline:
    "bg-transparent border border-(color:var(--border-subtle))",
};

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  variant = "default",
  padding = "md",
  interactive,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={
        "rounded-[var(--radius-lg)] " +
        VARIANT[variant] + " " +
        PADDING[padding] +
        (interactive
          ? " transition-colors duration-[var(--duration-base)] hover:bg-[var(--surface-2)] cursor-pointer"
          : "") +
        (className ? " " + className : "")
      }
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={
        "flex items-start justify-between gap-3 mb-3" +
        (className ? " " + className : "")
      }
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      {...rest}
      className={
        "text-[18px] leading-[24px] font-semibold tracking-[-0.005em] text-foreground" +
        (className ? " " + className : "")
      }
    >
      {children}
    </h3>
  );
}

export function CardMeta({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      {...rest}
      className={
        "text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-1" +
        (className ? " " + className : "")
      }
    >
      {children}
    </p>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={className}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={
        "flex items-center justify-end gap-2 mt-4 pt-3 border-t border-(color:var(--border-subtle))" +
        (className ? " " + className : "")
      }
    >
      {children}
    </div>
  );
}
