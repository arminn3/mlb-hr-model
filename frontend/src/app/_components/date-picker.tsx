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

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => { if (canPrev) onChange(dates[idx + 1]); }}
        disabled={!canPrev}
        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-default rounded-lg hover:bg-card/50"
      >
        &larr;
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
        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-default rounded-lg hover:bg-card/50"
      >
        &rarr;
      </button>
    </div>
  );
}
