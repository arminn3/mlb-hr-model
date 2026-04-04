"use client";

import { useState, useMemo } from "react";
import type { GameData, LookbackKey } from "./types";

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

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortCol] as number;
      const bVal = (b as Record<string, unknown>)[sortCol] as number;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ col, label, className = "" }: { col: string; label: string; className?: string }) => (
    <th
      className={`py-2 px-2 cursor-pointer hover:text-foreground transition-colors ${className} ${sortCol === col ? "text-accent" : ""}`}
      onClick={() => toggleSort(col)}
    >
      {label} {sortCol === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">Batter vs Pitcher</h2>
          <p className="text-xs text-muted mt-0.5">
            {matchups.length} matchups across today&apos;s slate. Click column headers to sort.
          </p>
        </div>
        <input
          type="text"
          placeholder="Search player or pitcher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-card/50 border border-card-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted w-64"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-left py-2 pr-3">Batter</th>
              <th className="text-left py-2 pr-3">Pitcher</th>
              <th className="text-left py-2 pr-3">Game</th>
              <th className="text-center py-2 px-1">Hand</th>
              <SortHeader col="abs" label="AB" className="text-center" />
              <SortHeader col="hits" label="H" className="text-center" />
              <SortHeader col="hrs" label="HR" className="text-center" />
              <SortHeader col="ba" label="AVG" className="text-center" />
              <SortHeader col="slg" label="SLG" className="text-center" />
              <SortHeader col="iso" label="ISO" className="text-center" />
              <SortHeader col="k_pct" label="K%" className="text-center" />
              <SortHeader col="composite" label="Score" className="text-center" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={`${m.batter}-${m.pitcher}`} className="border-b border-card-border/30 hover:bg-card/40">
                <td className="py-2 pr-3 font-medium text-foreground">{m.batter}</td>
                <td className="py-2 pr-3 text-muted">{m.pitcher}</td>
                <td className="py-2 pr-3 text-muted">{m.game}</td>
                <td className="text-center py-2 px-1 font-mono text-muted">{m.hand}</td>
                <td className="text-center py-2 font-mono">{m.abs || "-"}</td>
                <td className="text-center py-2 font-mono">{m.hits || "-"}</td>
                <td className="text-center py-2">
                  <span className={`font-mono ${m.hrs > 0 ? "text-accent-green font-bold" : ""}`}>
                    {m.hrs || "-"}
                  </span>
                </td>
                <td className="text-center py-2">
                  <span className={`font-mono ${m.ba >= 0.300 ? "text-accent-green" : m.ba > 0 ? "text-foreground" : "text-muted"}`}>
                    {m.abs > 0 ? m.ba.toFixed(3) : "-"}
                  </span>
                </td>
                <td className="text-center py-2">
                  <span className={`font-mono ${m.slg >= 0.500 ? "text-accent-green" : m.slg > 0 ? "text-foreground" : "text-muted"}`}>
                    {m.abs > 0 ? m.slg.toFixed(3) : "-"}
                  </span>
                </td>
                <td className="text-center py-2">
                  <span className={`font-mono ${m.iso >= 0.200 ? "text-accent-green" : m.iso > 0 ? "text-foreground" : "text-muted"}`}>
                    {m.abs > 0 ? m.iso.toFixed(3) : "-"}
                  </span>
                </td>
                <td className="text-center py-2 font-mono text-muted">
                  {m.abs > 0 ? `${m.k_pct.toFixed(0)}%` : "-"}
                </td>
                <td className="text-center py-2 font-mono">{m.composite.toFixed(3)}</td>
              </tr>
            ))}
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
