"use client";

import { useState, useMemo } from "react";
import type { GameData, LookbackKey } from "./types";
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

export function BvPPage({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string>("hrs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Build flat list of all BvP matchups
  const matchups = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{
      batter: string;
      pitcher: string;
      game: string;
      hand: string;
      abs: number;
      hits: number;
      hrs: number;
      ba: number;
      slg: number;
      iso: number;
      k_pct: number;
      composite: number;
      recentCount: number;
    }> = [];

    for (const game of games) {
      for (const player of game.players) {
        const key = `${player.name}-${player.opp_pitcher}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const bvp = player.bvp_stats?.career;
        const score = player.scores[lookback]?.composite ?? 0;

        rows.push({
          batter: player.name,
          pitcher: player.opp_pitcher,
          game: `${game.away_team}@${game.home_team}`,
          hand: `${player.batter_hand}v${player.pitcher_hand}`,
          abs: bvp?.abs ?? 0,
          hits: bvp?.hits ?? 0,
          hrs: bvp?.hrs ?? 0,
          ba: bvp?.ba ?? 0,
          slg: bvp?.slg ?? 0,
          iso: bvp?.iso ?? 0,
          k_pct: bvp?.k_pct ?? 0,
          composite: score,
          recentCount: player.bvp_stats?.recent_abs?.length ?? 0,
        });
      }
    }
    return rows;
  }, [games, lookback]);

  // Filter by search
  const filtered = search
    ? matchups.filter(
        (m) =>
          m.batter.toLowerCase().includes(search.toLowerCase()) ||
          m.pitcher.toLowerCase().includes(search.toLowerCase()) ||
          m.game.toLowerCase().includes(search.toLowerCase())
      )
    : matchups;

  // Split into has history vs no history, sort each group
  const sorted = useMemo(() => {
    const withHistory = filtered.filter(m => m.abs > 0);
    const noHistory = filtered.filter(m => m.abs === 0);

    const sortFn = (a: typeof filtered[0], b: typeof filtered[0]) => {
      const aVal = (a as Record<string, unknown>)[sortCol] as number;
      const bVal = (b as Record<string, unknown>)[sortCol] as number;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    };

    withHistory.sort(sortFn);
    noHistory.sort((a, b) => b.composite - a.composite);

    return [...withHistory, ...noHistory];
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ col, label }: { col: string; label: string; className?: string }) => (
    <th
      className={`${headerCellClass} cursor-pointer hover:text-white transition-colors ${sortCol === col ? "text-white" : ""}`}
      style={headerCellStyle}
      onClick={() => toggleSort(col)}
    >
      {label} {sortCol === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">Batter vs Pitcher</h2>
          <p className="text-xs text-muted mt-0.5">
            {matchups.filter(m => m.abs > 0).length} matchups with history, {matchups.filter(m => m.abs === 0).length} with no history. Career head-to-head stats.
          </p>
        </div>
        <div className="relative w-full md:w-64">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search player or pitcher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card/50 border border-card-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-foreground placeholder-muted"
          />
        </div>
      </div>

      {/* Mobile sort chips */}
      <div className="md:hidden flex flex-wrap gap-1.5 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-muted self-center mr-1">Sort:</span>
        {([
          { col: "hrs", label: "HR" },
          { col: "abs", label: "AB" },
          { col: "ba", label: "AVG" },
          { col: "slg", label: "SLG" },
          { col: "iso", label: "ISO" },
          { col: "k_pct", label: "K%" },
          { col: "composite", label: "Score" },
        ]).map((s) => (
          <button
            key={s.col}
            onClick={() => toggleSort(s.col)}
            className={`px-2.5 py-1 text-[10px] rounded-full cursor-pointer transition-colors ${
              sortCol === s.col
                ? "bg-accent/15 text-accent border border-accent/30 font-semibold"
                : "bg-card/50 text-muted border border-card-border"
            }`}
          >
            {s.label}{sortCol === s.col ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
          </button>
        ))}
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {sorted.map((m, i) => {
          const isFirstNoHistory = m.abs === 0 && (i === 0 || sorted[i - 1].abs > 0);
          return (
            <div key={`${m.batter}-${m.pitcher}`}>
              {isFirstNoHistory && (
                <div className="text-[10px] uppercase tracking-wider text-muted mt-4 mb-2 px-1">No Head-to-Head History</div>
              )}
              <div className={`rounded-lg px-3 py-2.5 ${m.abs === 0 ? "bg-background/15 opacity-60" : "bg-background/30"}`}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{m.batter}</span>
                      {m.abs === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-card-border text-muted">No History</span>}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">vs {m.pitcher} &middot; {m.game}</div>
                  </div>
                  <span className="font-mono text-sm font-bold text-foreground shrink-0 ml-2">{m.composite.toFixed(3)}</span>
                </div>
                {m.abs > 0 && (
                  <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                    <span className="font-mono text-muted">{m.abs} AB</span>
                    <span className={`font-mono ${m.hrs > 0 ? "text-accent-green font-bold" : "text-muted"}`}>{m.hrs} HR</span>
                    <span className={`font-mono ${m.ba >= 0.300 ? "text-accent-green" : "text-foreground"}`}>{m.ba.toFixed(3)} AVG</span>
                    <span className={`font-mono ${m.iso >= 0.200 ? "text-accent-green" : "text-foreground"}`}>{m.iso.toFixed(3)} ISO</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table view */}
      <div className={`hidden md:block ${tableWrapperClass}`} style={tableWrapperStyle}>
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={headerCellClass} style={headerCellStyle}>Batter</th>
              <th className={headerCellClass} style={headerCellStyle}>Pitcher</th>
              <th className={headerCellClass} style={headerCellStyle}>Game</th>
              <th className={headerCellClass} style={headerCellStyle}>Hand</th>
              <SortHeader col="abs" label="AB" />
              <SortHeader col="hits" label="H" />
              <SortHeader col="hrs" label="HR" />
              <SortHeader col="ba" label="AVG" />
              <SortHeader col="slg" label="SLG" />
              <SortHeader col="iso" label="ISO" />
              <SortHeader col="k_pct" label="K%" />
              <SortHeader col="composite" label="Score" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              // Cell color helpers — green/red/neutral on notable stats only.
              const hrStyle = m.hrs > 0
                ? { ...cellStyle, color: "#22c55e", fontWeight: 700 }
                : cellStyle;
              const baStyle = m.abs > 0 && m.ba >= 0.300
                ? { ...cellStyle, color: "#22c55e", fontWeight: 600 }
                : m.abs > 0 && m.ba < 0.200
                ? { ...cellStyle, color: "#ef4444" }
                : cellStyle;
              const slgStyle = m.abs > 0 && m.slg >= 0.500
                ? { ...cellStyle, color: "#22c55e", fontWeight: 600 }
                : cellStyle;
              const isoStyle = m.abs > 0 && m.iso >= 0.200
                ? { ...cellStyle, color: "#22c55e", fontWeight: 600 }
                : cellStyle;
              const kStyle = m.abs > 0 && m.k_pct >= 30
                ? { ...cellStyle, color: "#ef4444", fontWeight: 600 }
                : m.abs > 0 && m.k_pct <= 15
                ? { ...cellStyle, color: "#22c55e", fontWeight: 600 }
                : cellStyle;
              const scoreStyle = m.composite >= 0.6
                ? { ...cellStyle, color: "#22c55e", fontWeight: 700 }
                : m.composite >= 0.4
                ? { ...cellStyle, color: "#eab308", fontWeight: 600 }
                : m.composite < 0.2
                ? { ...cellStyle, color: "#ef4444" }
                : cellStyle;
              return (
                <tr key={`${m.batter}-${m.pitcher}`} style={{ backgroundColor: TABLE_BG, opacity: m.abs === 0 ? 0.5 : 1 }}>
                  <td className={cellClass} style={cellStyle}>{m.batter}</td>
                  <td className={cellClass} style={cellStyle}>{m.pitcher}</td>
                  <td className={cellClass} style={cellStyle}>{m.game}</td>
                  <td className={cellClass} style={cellStyle}>{m.hand}</td>
                  <td className={cellClass} style={cellStyle}>{m.abs || "-"}</td>
                  <td className={cellClass} style={cellStyle}>{m.hits || "-"}</td>
                  <td className={cellClass} style={hrStyle}>{m.hrs || "-"}</td>
                  <td className={cellClass} style={baStyle}>{m.abs > 0 ? m.ba.toFixed(3) : "-"}</td>
                  <td className={cellClass} style={slgStyle}>{m.abs > 0 ? m.slg.toFixed(3) : "-"}</td>
                  <td className={cellClass} style={isoStyle}>{m.abs > 0 ? m.iso.toFixed(3) : "-"}</td>
                  <td className={cellClass} style={kStyle}>{m.abs > 0 ? `${m.k_pct.toFixed(0)}%` : "-"}</td>
                  <td className={cellClass} style={scoreStyle}>{m.composite.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <p className="text-center text-muted py-8">
          {search ? "No matches found." : "No BvP data available. Run the model to generate matchup history."}
        </p>
      )}
    </div>
  );
}
