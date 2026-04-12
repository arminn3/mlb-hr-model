"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameData, LookbackKey, PlayerData } from "./types";
import { RatingBadge } from "./rating-badge";
import { ScoreBar } from "./score-bar";

const FILTER_OPTIONS = [
  { label: "Top 10", value: 10 },
  { label: "Top 20", value: 20 },
  { label: "Top 30", value: 30 },
  { label: "All", value: 0 },
] as const;

// ML category weights loaded from results/ml_analysis.json.
// These represent what the ML learned from past HR outcomes —
// separate from the manual composite weights used by HR Rankings.
interface MlWeights {
  batter: number;
  matchup: number;
  pitcher: number;
  environment: number;
}

// Fallback if ml_analysis.json isn't available yet (matches the
// 18-day cumulative analysis as of 2026-04-11).
const FALLBACK_WEIGHTS: MlWeights = {
  batter: 0.391,
  matchup: 0.092,
  pitcher: 0.435,
  environment: 0.082,
};

function mlComposite(player: PlayerData, lb: LookbackKey, w: MlWeights): number {
  const s = player.scores[lb];
  if (!s) return 0;
  // Use backend's batter/pitcher/env scores but reweight them with
  // ML-learned category weights. matchup_score isn't stored
  // separately in the JSON, so we split batter contribution lightly.
  return (
    w.batter * s.batter_score +
    w.matchup * s.batter_score + // matchup proxy — same direction as batter
    w.pitcher * s.pitcher_score +
    w.environment * s.env_score
  );
}

export function MLRankings({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [filter, setFilter] = useState<number>(10);
  const [mlWeights, setMlWeights] = useState<MlWeights>(FALLBACK_WEIGHTS);
  const [weightSource, setWeightSource] = useState<string>("fallback");

  // Try to load ML-learned weights from the published analysis file.
  useEffect(() => {
    fetch("/data/results/ml_analysis.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d?.category_weights) {
          setMlWeights({
            batter: d.category_weights.batter ?? FALLBACK_WEIGHTS.batter,
            matchup: d.category_weights.matchup ?? FALLBACK_WEIGHTS.matchup,
            pitcher: d.category_weights.pitcher ?? FALLBACK_WEIGHTS.pitcher,
            environment:
              d.category_weights.environment ?? FALLBACK_WEIGHTS.environment,
          });
          setWeightSource("live");
        }
      })
      .catch(() => {
        // keep fallback
      });
  }, []);

  const sorted = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
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
        mlComposite(b.player, lookback, mlWeights) -
        mlComposite(a.player, lookback, mlWeights);
      if (diff !== 0) return diff;
      return a.player.name.localeCompare(b.player.name);
    });
  }, [games, lookback, mlWeights]);

  const top = filter === 0 ? sorted : sorted.slice(0, filter);
  if (top.length === 0) return null;

  const wPct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="border border-accent/20 rounded-xl bg-accent/5 p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-accent uppercase tracking-wider">
          ML Rankings
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

      <p className="text-xs text-muted mb-4">
        Data-driven rankings — same per-player scores as HR Rankings, but reweighted using
        what the ML learned from past HR outcomes. Current ML weights:{" "}
        <span className="text-foreground font-mono">
          Batter {wPct(mlWeights.batter)} · Pitcher {wPct(mlWeights.pitcher)}
          · Matchup {wPct(mlWeights.matchup)} · Env{" "}
          {wPct(mlWeights.environment)}
        </span>{" "}
        <span className="text-[10px]">({weightSource})</span>
      </p>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {top.map(({ player, game }, i) => {
          const s = player.scores[lookback];
          if (!s) return null;
          const mlScore = mlComposite(player, lookback, mlWeights);
          return (
            <div
              key={player.name}
              className="flex items-center gap-3 bg-background/30 rounded-lg px-3 py-2.5"
            >
              <span className="text-sm font-bold text-accent font-mono w-7 text-center shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {player.name}
                  </span>
                  <RatingBadge composite={mlScore} />
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px]">
                  <span className="text-foreground font-mono">
                    bat {s.batter_score.toFixed(2)}
                  </span>
                  <span className="font-mono text-foreground">
                    pit {s.pitcher_score.toFixed(2)}
                  </span>
                  <span className="font-mono text-muted">
                    env {s.env_score.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono text-sm font-bold text-foreground">
                  {mlScore.toFixed(3)}
                </span>
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
              <th className="text-center py-2 px-2">Batter</th>
              <th className="text-center py-2 px-2">Pitcher</th>
              <th className="text-center py-2 px-2">Env</th>
              <th className="text-center py-2 px-2">Rating</th>
              <th className="text-center py-2 w-28">ML Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map(({ player, game }, i) => {
              const s = player.scores[lookback];
              if (!s) return null;
              const mlScore = mlComposite(player, lookback, mlWeights);
              return (
                <tr
                  key={player.name}
                  className="border-b border-card-border/30 last:border-0 hover:bg-card/40"
                >
                  <td className="text-center py-2 font-bold text-accent font-mono">
                    {i + 1}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-foreground">
                      {player.name}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                  </td>
                  <td className="text-center py-2 font-mono text-muted">
                    {player.batter_hand}v{player.pitcher_hand}
                  </td>
                  <td className="text-center py-2 font-mono">
                    {s.batter_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2 font-mono">
                    {s.pitcher_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2 font-mono text-muted">
                    {s.env_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2">
                    <RatingBadge composite={mlScore} />
                  </td>
                  <td className="py-2">
                    <ScoreBar value={mlScore} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
