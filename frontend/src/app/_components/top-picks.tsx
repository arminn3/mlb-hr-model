"use client";

import { useState, useMemo } from "react";
import type { GameData, LookbackKey } from "./types";
import { RatingBadge } from "./rating-badge";
import { ScoreBar } from "./score-bar";

const FILTER_OPTIONS = [
  { label: "Top 10", value: 10 },
  { label: "Top 20", value: 20 },
  { label: "Top 30", value: 30 },
  { label: "All", value: 0 },
] as const;

export function TopPicks({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [filter, setFilter] = useState<number>(10);

  // Memoize the full sorted list, deduplicated by player name
  const sorted = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: (typeof games)[0]["players"][0]; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!seen.has(player.name)) {
          seen.add(player.name);
          all.push({ player, game });
        }
      }
    }
    return all.sort((a, b) => {
      const diff =
        (b.player.scores[lookback]?.composite ?? 0) -
        (a.player.scores[lookback]?.composite ?? 0);
      if (diff !== 0) return diff;
      return a.player.name.localeCompare(b.player.name);
    });
  }, [games, lookback]);

  const top = filter === 0 ? sorted : sorted.slice(0, filter);
  if (top.length === 0) return null;

  return (
    <div className="border border-accent/20 rounded-xl bg-accent/5 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-accent uppercase tracking-wider">
          HR Rankings
        </h2>
        <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1 text-[11px] rounded cursor-pointer transition-colors ${
                filter === opt.value
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-center py-2 w-8">#</th>
              <th className="text-left py-2 pr-3">Player</th>
              <th className="text-left py-2 pr-3">Matchup</th>
              <th className="text-center py-2 px-2">Hand</th>
              <th className="text-center py-2 px-2">Barrel%</th>
              <th className="text-center py-2 px-2">FB%</th>
              <th className="text-center py-2 px-2">Hard Hit%</th>
              <th className="text-center py-2 px-2">EV</th>
              <th className="text-center py-2 px-2">Rating</th>
              <th className="text-center py-2 w-28">Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map(({ player, game }, i) => {
              const s = player.scores[lookback];
              if (!s) return null;
              return (
                <tr key={player.name} className="border-b border-card-border/30 last:border-0 hover:bg-card/40">
                  <td className="text-center py-2 font-bold text-accent font-mono">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-foreground">{player.name}</span>
                    {s.recent_abs.length <= 2 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20">
                        NEW
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                  </td>
                  <td className="text-center py-2 font-mono text-muted">
                    {player.batter_hand}v{player.pitcher_hand}
                  </td>
                  <td className="text-center py-2 font-mono">{s.barrel_pct}%</td>
                  <td className="text-center py-2 font-mono">{s.fb_pct}%</td>
                  <td className="text-center py-2 font-mono">{s.hard_hit_pct}%</td>
                  <td className="text-center py-2 font-mono">{s.exit_velo}</td>
                  <td className="text-center py-2"><RatingBadge composite={s.composite} /></td>
                  <td className="py-2"><ScoreBar value={s.composite} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
