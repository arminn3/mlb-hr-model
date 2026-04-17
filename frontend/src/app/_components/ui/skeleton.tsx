import type { HTMLAttributes } from "react";

type Shape = "text" | "rect" | "circle";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: Shape;
  w?: string | number;
  h?: string | number;
}

const SHAPE: Record<Shape, string> = {
  text: "rounded-[var(--radius-sm)] h-3",
  rect: "rounded-[var(--radius-md)]",
  circle: "rounded-full",
};

export function Skeleton({
  shape = "rect",
  w,
  h,
  className,
  style,
  ...rest
}: SkeletonProps) {
  const resolvedStyle: React.CSSProperties = {
    ...(w !== undefined ? { width: typeof w === "number" ? `${w}px` : w } : null),
    ...(h !== undefined ? { height: typeof h === "number" ? `${h}px` : h } : null),
    ...style,
  };
  return (
    <div
      {...rest}
      style={resolvedStyle}
      className={
        "bg-[var(--surface-2)] animate-pulse " +
        SHAPE[shape] +
        (className ? " " + className : "")
      }
    />
  );
}
