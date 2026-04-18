"use client";

import { useState, useMemo } from "react";
import type { GameData, LookbackKey } from "./types";
import { RatingBadge } from "./rating-badge";
import { ScoreBar } from "./score-bar";
import { Badge } from "./ui/badge";

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
    // Confidence-weighted ranking: ghost-sample players (Peters with
    // 4 BIP and one lucky barrel) can't ride a tiny sample to top 5.
    // A player's composite gets scaled by how much we trust the sample:
    //   10+ recent BIP → full credit (100% of composite)
    //   5 BIP  → 50% credit
    //   0 BIP  → 0% credit
    // This doesn't filter anyone out — they still show, just ranked
    // fairly against their actual sample size.
    const adjustedScore = (p: typeof all[number]) => {
      const s = p.player.scores[lookback];
      if (!s) return 0;
      const abs = s.recent_abs?.length ?? 0;
      const reliability = Math.min(1, abs / 10);
      return s.composite * reliability;
    };
    return all.sort((a, b) => {
      const diff = adjustedScore(b) - adjustedScore(a);
      if (diff !== 0) return diff;
      return a.player.name.localeCompare(b.player.name);
    });
  }, [games, lookback]);

  const top = filter === 0 ? sorted : sorted.slice(0, filter);
  if (top.length === 0) return null;

  return (
    <div
      className="rounded-[12px] p-6 mb-6"
      style={{ background: "#1c1c1e", border: "1px solid #2c2c2e" }}
    >
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="text-[15px] leading-[20px] font-semibold tracking-[-0.005em] text-foreground">
            HR Rankings
          </h2>
          <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-0.5">
            Top HR plays by composite score
          </p>
        </div>
        <div
          className="inline-flex items-center rounded-full p-0.5"
          style={{ background: "#141416", border: "1px solid #2c2c2e" }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1 text-[11px] font-medium rounded-full cursor-pointer transition-colors ${
                filter === opt.value
                  ? "bg-accent text-background font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {top.map(({ player, game }, i) => {
          const s = player.scores[lookback];
          if (!s) return null;
          return (
            <div
              key={player.name}
              className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5"
              style={{ background: "var(--surface-sunken)" }}
            >
              <span className="text-[13px] font-bold text-accent font-mono w-7 text-center shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{player.name}</span>
                  <RatingBadge composite={s.composite} />
                </div>
                <div className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-0.5">
                  {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px]">
                  <span className="text-foreground font-mono">{s.exit_velo} EV</span>
                  <span className={`font-mono ${s.barrel_pct > 0 ? "text-accent-green" : "text-muted"}`}>{s.barrel_pct}% bar</span>
                  <span className={`font-mono ${s.fb_pct >= 40 ? "text-accent-green" : "text-muted"}`}>{s.fb_pct}% fb</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono text-[14px] font-bold text-foreground">{s.composite.toFixed(3)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
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
                      <span className="ml-1.5 inline-block align-middle">
                        <Badge variant="accent" size="sm">NEW</Badge>
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
