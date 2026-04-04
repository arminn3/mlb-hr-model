"use client";

import { useEffect, useState } from "react";

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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          const idx = dates.indexOf(currentDate);
          if (idx < dates.length - 1) onChange(dates[idx + 1]);
        }}
        disabled={dates.indexOf(currentDate) >= dates.length - 1}
        className="px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        &larr;
      </button>
      <select
        value={currentDate}
        onChange={(e) => onChange(e.target.value)}
        className="bg-card/50 border border-card-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground cursor-pointer"
      >
        {dates.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          const idx = dates.indexOf(currentDate);
          if (idx > 0) onChange(dates[idx - 1]);
        }}
        disabled={dates.indexOf(currentDate) <= 0}
        className="px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        &rarr;
      </button>
    </div>
  );
}
