"use client";

export function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    pct >= 65
      ? "bg-accent-green"
      : pct >= 45
        ? "bg-accent-yellow"
        : "bg-accent-red";

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-card-border overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted">{value.toFixed(3)}</span>
    </div>
  );
}
