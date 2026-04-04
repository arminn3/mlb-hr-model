"use client";

import { useState } from "react";

export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-[11px] text-foreground bg-card border border-card-border rounded-lg shadow-lg whitespace-nowrap z-50">
          {text}
        </span>
      )}
    </span>
  );
}
