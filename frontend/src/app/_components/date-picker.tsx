"use client";

import { useEffect, useState } from "react";

function formatShort(d: string): string {
  // "2026-04-07" → "Apr 7"
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${months[m] ?? parts[1]} ${day}`;
}

export function DatePicker({
  currentDate,
  onChange,
}: {
  currentDate: string;
  onChange: (date: string) => void;
}) {
  const [dates, setDates] = useState<string[]>([]);

  useEffect(() => {
    fetch("/data/index.json")
      .then((r) => (r.ok ? r.json() : { dates: [] }))
      .then((data) => setDates(data.dates || []))
      .catch(() => {});
  }, []);

  if (dates.length <= 1) return null;

  const idx = dates.indexOf(currentDate);
  const canPrev = idx < dates.length - 1;
  const canNext = idx > 0;

  const arrowClass =
    "w-8 h-8 flex items-center justify-center text-foreground " +
    "bg-card/60 border border-card-border rounded-lg " +
    "hover:bg-accent/10 hover:border-accent/40 hover:text-accent " +
    "active:scale-95 " +
    "disabled:opacity-30 disabled:bg-card/30 disabled:border-card-border " +
    "disabled:hover:text-foreground disabled:hover:bg-card/30 disabled:hover:border-card-border " +
    "disabled:active:scale-100 " +
    "cursor-pointer disabled:cursor-default transition-all duration-150";

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => { if (canPrev) onChange(dates[idx + 1]); }}
        disabled={!canPrev}
        aria-label="Previous date"
        className={arrowClass}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Full date on desktop, short on mobile */}
      <select
        value={currentDate}
        onChange={(e) => onChange(e.target.value)}
        className="hidden md:block bg-card/50 border border-card-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground cursor-pointer"
      >
        {dates.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {/* Mobile: compact date display */}
      <select
        value={currentDate}
        onChange={(e) => onChange(e.target.value)}
        className="md:hidden bg-card/50 border border-card-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground cursor-pointer min-w-0"
      >
        {dates.map((d) => (
          <option key={d} value={d}>{formatShort(d)}</option>
        ))}
      </select>

      <button
        onClick={() => { if (canNext) onChange(dates[idx - 1]); }}
        disabled={!canNext}
        aria-label="Next date"
        className={arrowClass}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
