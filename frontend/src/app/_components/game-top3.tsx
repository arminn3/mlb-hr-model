"use client";

import type { PlayerData } from "./types";
import { scoreFor, type UILookback } from "./score-utils";

type Row = { p: PlayerData; mlbId?: number; order: number | null };

// Same confidence multiplier the main rankings use — tiny-sample bats can't
// fake their way into a top-3 spot just because they had one good BBE.
function adjustedScore(p: PlayerData, lookback: UILookback): number {
  const s = scoreFor(p, lookback);
  if (!s) return 0;
  const abs = s.recent_abs?.length ?? 0;
  const reliability = Math.min(1, abs / 10);
  return s.composite * reliability;
}

export function GameTop3({
  rows,
  lookback,
  onSelect,
}: {
  rows: Row[];
  lookback: UILookback;
  onSelect: (row: Row) => void;
}) {
  const ranked = rows
    .map((r) => ({ row: r, score: adjustedScore(r.p, lookback), s: scoreFor(r.p, lookback) }))
    .filter((x) => x.score > 0 && x.s)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl p-4" style={{
      background: "linear-gradient(180deg, rgba(74,222,128,0.05) 0%, rgba(255,255,255,0.02) 100%)",
      border: "1px solid rgba(74,222,128,0.15)",
    }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/70">
          Top 3 HR Candidates · {lookback}
        </span>
        <span className="text-[9px] text-muted/60">
          Confidence-weighted composite
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {ranked.map((x, i) => {
          const s = x.s!;
          return (
            <button
              key={x.row.p.name}
              onClick={() => onSelect(x.row)}
              className="text-left rounded-lg p-3 cursor-pointer transition-colors hover:bg-white/[0.04]"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-[10px] font-mono font-bold text-accent-green">#{i + 1}</span>
                <span className="text-[11px] font-mono font-bold text-foreground">{s.composite.toFixed(3)}</span>
              </div>
              <div className="text-[13px] font-semibold text-foreground truncate mb-2">
                {x.row.p.name}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted">
                <span>{s.exit_velo}EV</span>
                <span>·</span>
                <span>{s.barrel_pct}%Brl</span>
                <span>·</span>
                <span>{s.fb_pct}%FB</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
