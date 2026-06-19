"use client";

import type { PlayerData } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { BatterTable, type BatterRowInfo } from "./batter-table";

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
  awayTeam,
  homeTeam,
  pitcherMix,
  parkFactor,
  posted,
  favorites,
  onToggleFavorite,
  onSelect,
}: {
  rows: BatterRowInfo[];
  lookback: UILookback;
  awayTeam: string;
  homeTeam: string;
  pitcherMix?: { vs_lhb: Record<string, number>; vs_rhb: Record<string, number> };
  parkFactor?: number;
  posted: boolean;
  favorites?: Set<string>;
  onToggleFavorite?: (name: string) => void;
  onSelect: (row: BatterRowInfo) => void;
}) {
  const top3 = rows
    .map((r) => ({ row: r, score: adjustedScore(r.p, lookback) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    // Overwrite the batting order with the top-3 rank (1, 2, 3). The team batter
    // tables below still get the real lineup order — this is local to the top-3.
    .map((x, i) => ({ ...x.row, order: i + 1 }));

  if (top3.length === 0) return null;

  // Side label — both teams' best bats often mix, so badge by team abbr in the row
  // (BatterTable already shows team via teamAbbr prop, so use a neutral label).
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-accent-green/80">
          Top 3 HR Candidates · {lookback}
        </span>
        <span className="text-[9px] text-muted/60">
          Confidence-weighted composite across both lineups
        </span>
      </div>
      <BatterTable
        teamAbbr={`${awayTeam} / ${homeTeam}`}
        batters={top3}
        lookback={lookback}
        posted={true}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        pitcherMix={pitcherMix}
        parkFactor={parkFactor}
        onSelect={onSelect}
      />
    </div>
  );
}
