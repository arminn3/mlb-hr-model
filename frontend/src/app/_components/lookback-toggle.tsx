"use client";

import type { LookbackKey } from "./types";

const OPTIONS: LookbackKey[] = ["L5", "L10", "L15"];

export function LookbackToggle({
  value,
  onChange,
}: {
  value: LookbackKey;
  onChange: (v: LookbackKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
      {OPTIONS.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 text-xs font-mono rounded cursor-pointer transition-colors ${
            value === key
              ? "bg-accent/15 text-accent font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
