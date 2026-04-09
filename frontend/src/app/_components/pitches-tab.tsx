"use client";

import { useState } from "react";
import type { PlayerData, PitchTypeSeason } from "./types";
import {
  TABLE_BG,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
  tableClass,
  tableWrapperClass,
  tableWrapperStyle,
} from "./table-styles";

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
      {/* Mobile card view */}
      <div className="md:hidden space-y-1.5">
        {entries.map(([code, s]) => (
          <div key={code} className="bg-background/30 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{s.type_name}</span>
                <span className="text-[10px] text-muted font-mono">{s.usage_pct}%</span>
              </div>
              <span className="font-mono text-xs text-foreground">{s.hr} HR</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px]">
              <span className={`font-mono px-1 py-0.5 rounded ${statColor(s.ba, [0.230, 0.280])}`}>{s.ba.toFixed(3)} BA</span>
              <span className={`font-mono px-1 py-0.5 rounded ${statColor(s.slg, [0.380, 0.480])}`}>{s.slg.toFixed(3)} SLG</span>
              <span className={`font-mono px-1 py-0.5 rounded ${statColor(s.iso, [0.140, 0.200])}`}>{s.iso.toFixed(3)} ISO</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className={`hidden md:block ${tableWrapperClass}`} style={tableWrapperStyle}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={headerCellClass} style={headerCellStyle}>Type</th>
              <th className={headerCellClass} style={headerCellStyle}>#</th>
              <th className={headerCellClass} style={headerCellStyle}>%</th>
              <th className={headerCellClass} style={headerCellStyle}>BA</th>
              <th className={headerCellClass} style={headerCellStyle}>wOBA</th>
              <th className={headerCellClass} style={headerCellStyle}>SLG</th>
              <th className={headerCellClass} style={headerCellStyle}>ISO</th>
              <th className={headerCellClass} style={headerCellStyle}>HR</th>
              <th className={headerCellClass} style={headerCellStyle}>K%</th>
              <th className={headerCellClass} style={headerCellStyle}>Whiff%</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([code, s]) => (
              <tr key={code} style={{ backgroundColor: TABLE_BG }}>
                <td className={cellClass} style={cellStyle}>{s.type_name}</td>
                <td className={cellClass} style={cellStyle}>{s.count}</td>
                <td className={cellClass} style={cellStyle}>{s.usage_pct}%</td>
                <td className={cellClass} style={cellStyle}>{s.ba.toFixed(3)}</td>
                <td className={cellClass} style={cellStyle}>{s.woba.toFixed(3)}</td>
                <td className={cellClass} style={cellStyle}>{s.slg.toFixed(3)}</td>
                <td className={cellClass} style={cellStyle}>{s.iso.toFixed(3)}</td>
                <td className={cellClass} style={cellStyle}>{s.hr}</td>
                <td className={cellClass} style={cellStyle}>{s.k_pct}%</td>
                <td className={cellClass} style={cellStyle}>{s.whiff_pct}%</td>
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
