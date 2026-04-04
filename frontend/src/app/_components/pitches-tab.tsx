"use client";

import { useState } from "react";
import type { PlayerData, PitchTypeSeason } from "./types";

function statColor(val: number, thresholds: [number, number], invert = false): string {
  const good = invert ? val <= thresholds[0] : val >= thresholds[1];
  const ok = invert ? val <= thresholds[1] : val >= thresholds[0];
  if (good) return "bg-accent-green/70 text-background";
  if (ok) return "bg-accent-green/25 text-foreground";
  if (val > 0) return "bg-accent-red/25 text-foreground";
  return "text-muted";
}

function StatsTable({
  label,
  hand,
  stats,
  isPitcher = false,
}: {
  label: string;
  hand: string;
  stats: Record<string, PitchTypeSeason>;
  isPitcher?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  // Sort by usage descending
  const allEntries = Object.entries(stats).sort((a, b) => b[1].usage_pct - a[1].usage_pct);
  if (allEntries.length === 0) {
    return <p className="text-xs text-muted py-2">No data available.</p>;
  }

  // For pitcher view: only show pitches >= 5% usage by default (main arsenal)
  // For batter view: show all since they face whatever comes
  const threshold = isPitcher ? 5 : 3;
  const mainEntries = allEntries.filter(([, s]) => s.usage_pct >= threshold);
  const entries = showAll ? allEntries : mainEntries;
  const hasHidden = allEntries.length > mainEntries.length;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-card-border text-muted">
          {hand}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-left py-1.5 pr-3">Type</th>
              <th className="text-center py-1.5 px-1.5">#</th>
              <th className="text-center py-1.5 px-1.5">%</th>
              <th className="text-center py-1.5 px-1.5">BA</th>
              <th className="text-center py-1.5 px-1.5">wOBA</th>
              <th className="text-center py-1.5 px-1.5">SLG</th>
              <th className="text-center py-1.5 px-1.5">ISO</th>
              <th className="text-center py-1.5 px-1.5">HR</th>
              <th className="text-center py-1.5 px-1.5">K%</th>
              <th className="text-center py-1.5 px-1.5">Whiff%</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([code, s]) => (
              <tr key={code} className="border-b border-card-border/30 last:border-0">
                <td className="py-1.5 pr-3 font-medium text-foreground">{s.type_name}</td>
                <td className="text-center py-1.5 px-1.5 font-mono text-muted">{s.count}</td>
                <td className="text-center py-1.5 px-1.5 font-mono text-muted">{s.usage_pct}%</td>
                <td className="text-center py-1.5 px-1.5">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${statColor(s.ba, [0.230, 0.280])}`}>
                    {s.ba.toFixed(3)}
                  </span>
                </td>
                <td className="text-center py-1.5 px-1.5">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${statColor(s.woba, [0.310, 0.370])}`}>
                    {s.woba.toFixed(3)}
                  </span>
                </td>
                <td className="text-center py-1.5 px-1.5">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${statColor(s.slg, [0.380, 0.480])}`}>
                    {s.slg.toFixed(3)}
                  </span>
                </td>
                <td className="text-center py-1.5 px-1.5">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${statColor(s.iso, [0.140, 0.200])}`}>
                    {s.iso.toFixed(3)}
                  </span>
                </td>
                <td className="text-center py-1.5 px-1.5 font-mono text-foreground">{s.hr}</td>
                <td className="text-center py-1.5 px-1.5 font-mono text-muted">{s.k_pct}%</td>
                <td className="text-center py-1.5 px-1.5 font-mono text-muted">{s.whiff_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasHidden && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-[10px] text-accent hover:text-accent/80 cursor-pointer font-medium uppercase tracking-wider"
        >
          Show All Pitches ({allEntries.length})
        </button>
      )}
      {showAll && hasHidden && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-2 text-[10px] text-muted hover:text-foreground cursor-pointer font-medium uppercase tracking-wider"
        >
          Show Main Arsenal
        </button>
      )}
    </div>
  );
}

export function PitchesTab({ player }: { player: PlayerData }) {
  const seasons = Object.keys(player.season_stats || {}).sort().reverse();
  const [season, setSeason] = useState(seasons[0] || "2026");

  const data = player.season_stats?.[season];
  if (!player.season_stats || seasons.length === 0) {
    return <p className="text-xs text-muted py-2">No season pitch data available.</p>;
  }

  return (
    <div>
      {/* Season toggle */}
      <div className="flex items-center gap-1 mb-4 bg-background/50 rounded-lg p-1 w-fit">
        {seasons.map((s) => (
          <button
            key={s}
            onClick={() => setSeason(s)}
            className={`px-3 py-1 text-xs font-mono rounded cursor-pointer transition-colors ${
              season === s
                ? "bg-accent/15 text-accent font-semibold"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {data ? (
        <>
          <StatsTable
            label={`${player.opp_pitcher}`}
            hand={`${player.pitcher_hand}HP vs ${player.batter_hand}HB`}
            stats={data.pitcher}
            isPitcher
          />
          <StatsTable
            label={player.name}
            hand={`${player.batter_hand}HB vs ${player.pitcher_hand}HP`}
            stats={data.batter}
          />
        </>
      ) : (
        <p className="text-xs text-muted py-2">No data for {season}.</p>
      )}
    </div>
  );
}
