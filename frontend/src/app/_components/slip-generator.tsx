"use client";

import { useMemo, useState } from "react";
import type { GameData, LookbackKey } from "./types";
import { RatingBadge } from "./rating-badge";

interface SlipPlayer {
  name: string;
  composite: number;
  game: string;
  gamePk: number;
  opp_pitcher: string;
  batter_hand: string;
  pitcher_hand: string;
}

interface Slip {
  players: SlipPlayer[];
  avgComposite: number;
  gameCount: number;
}

function buildSlips(
  games: GameData[],
  lookback: LookbackKey,
  legCount: 2 | 3
): Slip[] {
  // Collect all players with their game context
  const allPlayers: SlipPlayer[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    for (const player of game.players) {
      if (seen.has(player.name)) continue;
      seen.add(player.name);
      const composite = player.scores[lookback]?.composite ?? 0;
      if (composite < 0.25) continue; // skip low-rated players
      allPlayers.push({
        name: player.name,
        composite,
        game: `${game.away_team}@${game.home_team}`,
        gamePk: game.game_pk,
        opp_pitcher: player.opp_pitcher,
        batter_hand: player.batter_hand,
        pitcher_hand: player.pitcher_hand,
      });
    }
  }

  // Sort by composite descending
  allPlayers.sort((a, b) => b.composite - a.composite);

  // Take top 30 candidates to generate combos from
  const candidates = allPlayers.slice(0, 30);
  const slips: Slip[] = [];

  if (legCount === 2) {
    // Generate pairs — prefer different games
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const p1 = candidates[i];
        const p2 = candidates[j];
        const diffGames = p1.gamePk !== p2.gamePk;
        const avg = (p1.composite + p2.composite) / 2;
        slips.push({
          players: [p1, p2],
          avgComposite: avg,
          gameCount: diffGames ? 2 : 1,
        });
      }
    }
  } else {
    // Generate trios — prefer 2-3 different games
    for (let i = 0; i < Math.min(candidates.length, 20); i++) {
      for (let j = i + 1; j < Math.min(candidates.length, 25); j++) {
        for (let k = j + 1; k < Math.min(candidates.length, 30); k++) {
          const p1 = candidates[i];
          const p2 = candidates[j];
          const p3 = candidates[k];
          const uniqueGames = new Set([p1.gamePk, p2.gamePk, p3.gamePk]).size;
          if (uniqueGames < 2) continue; // require at least 2 different games
          const avg = (p1.composite + p2.composite + p3.composite) / 3;
          slips.push({
            players: [p1, p2, p3],
            avgComposite: avg,
            gameCount: uniqueGames,
          });
        }
      }
    }
  }

  // Sort by: game diversity first, then avg composite
  slips.sort((a, b) => {
    if (b.gameCount !== a.gameCount) return b.gameCount - a.gameCount;
    return b.avgComposite - a.avgComposite;
  });

  return slips.slice(0, 20); // top 20 slips
}

export function SlipGenerator({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [legCount, setLegCount] = useState<2 | 3>(2);

  const slips = useMemo(
    () => buildSlips(games, lookback, legCount),
    [games, lookback, legCount]
  );

  if (games.length === 0) {
    return <p className="text-center text-muted py-12">No games available.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-foreground">Slip Generator</h2>
          <p className="text-xs text-muted mt-0.5">
            Best HR parlay combinations based on model rankings. Diversified across games.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-card/50 border border-card-border rounded-lg p-1">
          <button
            onClick={() => setLegCount(2)}
            className={`px-4 py-1.5 text-xs rounded cursor-pointer transition-colors ${
              legCount === 2 ? "bg-accent/15 text-accent font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            Pairs
          </button>
          <button
            onClick={() => setLegCount(3)}
            className={`px-4 py-1.5 text-xs rounded cursor-pointer transition-colors ${
              legCount === 3 ? "bg-accent/15 text-accent font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            Trios
          </button>
        </div>
      </div>

      {/* Slips */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slips.map((slip, i) => (
          <div
            key={i}
            className="border border-card-border rounded-xl bg-card/40 p-4 hover:bg-card/60 transition-colors"
          >
            {/* Slip header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">
                  {i + 1}
                </span>
                <span className="text-[10px] text-muted uppercase">
                  {slip.gameCount} game{slip.gameCount > 1 ? "s" : ""}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-muted">Avg Score </span>
                <span className="font-mono font-bold text-foreground">{slip.avgComposite.toFixed(3)}</span>
              </div>
            </div>

            {/* Players */}
            <div className="space-y-2">
              {slip.players.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between bg-background/30 rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{p.name}</span>
                      <RatingBadge composite={p.composite} />
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {p.game} vs {p.opp_pitcher} ({p.pitcher_hand}HP)
                    </div>
                  </div>
                  <span className="font-mono text-xs text-foreground">{p.composite.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-[10px] text-muted">
        Slips prioritize game diversity — picks are spread across different games to reduce correlation risk.
        Players rated Average or above ({">"}0.25 composite) are eligible. Top 20 combinations shown.
      </div>
    </div>
  );
}
