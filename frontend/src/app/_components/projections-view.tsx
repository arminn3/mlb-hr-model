"use client";

import { useMemo } from "react";
import type { GameData, LookbackKey } from "./types";

interface GameProjection {
  game: GameData;
  expectedHRs: number;
  awayExpected: number;
  homeExpected: number;
  topPlayer: string;
  topComposite: number;
  playerCount: number;
  envScore: number;
}

function estimateGameHRs(game: GameData, lookback: LookbackKey): GameProjection {
  const env = game.environment;
  const parkFactor = (env?.park_factor ?? 100) / 100; // normalize to multiplier
  const weatherBoost = env?.wind_score ? Math.max(0, env.wind_score) * 0.01 : 0; // wind out adds %
  const tempBoost = env?.temperature_f && env.temperature_f > 75 ? (env.temperature_f - 75) * 0.003 : 0;

  // Get pitcher HR rates from player data
  const homePlayers = game.players.filter(p => p.batter_side === "home");
  const awayPlayers = game.players.filter(p => p.batter_side === "away");

  // Away pitcher faces home batters, home pitcher faces away batters
  const awayPitcherStats = homePlayers[0]?.pitcher_stats;
  const homePitcherStats = awayPlayers[0]?.pitcher_stats;

  // Base expected HRs per team from pitcher HR/9 rate
  // Average starter goes ~5.5 innings, bullpen ~3.5 innings
  // Use pitcher HR/9 for starter portion, league avg (1.3 HR/9) for bullpen
  const leagueAvgHR9 = 1.3;
  const starterInnings = 5.5;
  const bullpenInnings = 3.5;

  // Cap HR/9 at 2.5 max — early season rates are inflated from tiny samples
  // If pitcher has < 10 IP, blend with league average
  const blendHR9 = (hr9: number, ip: number): number => {
    const capped = Math.min(hr9 || leagueAvgHR9, 2.5);
    if (ip < 10) {
      const weight = ip / 10; // 0-1 scale of how much to trust pitcher's rate
      return capped * weight + leagueAvgHR9 * (1 - weight);
    }
    return capped;
  };
  const awayPitcherHR9 = blendHR9(awayPitcherStats?.hr_per_9 ?? 0, awayPitcherStats?.ip ?? 0);
  const homePitcherHR9 = blendHR9(homePitcherStats?.hr_per_9 ?? 0, homePitcherStats?.ip ?? 0);

  // Home team expected HRs (facing away pitcher)
  let homeExpected = (awayPitcherHR9 * starterInnings / 9) + (leagueAvgHR9 * bullpenInnings / 9);
  // Away team expected HRs (facing home pitcher)
  let awayExpected = (homePitcherHR9 * starterInnings / 9) + (leagueAvgHR9 * bullpenInnings / 9);

  // Apply park and weather adjustments
  const envMultiplier = parkFactor * (1 + weatherBoost + tempBoost);
  homeExpected *= envMultiplier;
  awayExpected *= envMultiplier;

  // Boost based on batter quality — if top batters have high composites, add to expected
  const avgHomeComposite = homePlayers.length > 0
    ? homePlayers.reduce((s, p) => s + (p.scores[lookback]?.composite ?? 0), 0) / homePlayers.length
    : 0.3;
  const avgAwayComposite = awayPlayers.length > 0
    ? awayPlayers.reduce((s, p) => s + (p.scores[lookback]?.composite ?? 0), 0) / awayPlayers.length
    : 0.3;

  // Slight batter quality adjustment (keep it subtle — pitcher HR/9 already captures most of it)
  homeExpected *= (0.85 + avgHomeComposite * 0.5);
  awayExpected *= (0.85 + avgAwayComposite * 0.5);

  const totalExpected = homeExpected + awayExpected;

  // Find top player
  let topPlayer = "";
  let topComposite = 0;
  for (const p of game.players) {
    const c = p.scores[lookback]?.composite ?? 0;
    if (c > topComposite) {
      topComposite = c;
      topPlayer = p.name;
    }
  }

  return {
    game,
    expectedHRs: totalExpected,
    awayExpected,
    homeExpected,
    topPlayer,
    topComposite,
    playerCount: game.players.length,
    envScore: env?.env_score ?? 0.5,
  };
}

export function ProjectionsView({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const projections = useMemo(() => {
    return games
      .map((g) => estimateGameHRs(g, lookback))
      .sort((a, b) => b.expectedHRs - a.expectedHRs);
  }, [games, lookback]);

  const totalSlateHRs = projections.reduce((s, p) => s + p.expectedHRs, 0);

  if (projections.length === 0) {
    return <p className="text-center text-muted py-12">No games to project.</p>;
  }

  return (
    <div>
      {/* Slate total */}
      <div className="border border-accent/20 rounded-xl bg-accent/5 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm uppercase tracking-wider text-accent font-bold mb-1">
              Projected Slate Total
            </h2>
            <p className="text-xs text-muted">{projections.length} games today</p>
          </div>
          <div className="text-right">
            <span className="text-4xl font-bold font-mono text-accent">
              {totalSlateHRs.toFixed(1)}
            </span>
            <span className="text-sm text-muted ml-2">HRs</span>
          </div>
        </div>
      </div>

      {/* Per-game projections */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-left py-3 pr-4">Game</th>
              <th className="text-center py-3 px-3">Env</th>
              <th className="text-center py-3 px-3">Away HRs</th>
              <th className="text-center py-3 px-3">Home HRs</th>
              <th className="text-center py-3 px-3">Total HRs</th>
              <th className="text-left py-3 px-3">Top Player</th>
              <th className="text-center py-3 px-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {projections.map((p) => (
              <tr key={p.game.game_pk} className="border-b border-card-border/30 hover:bg-card/40">
                <td className="py-3 pr-4">
                  <span className="font-semibold text-foreground">
                    {p.game.away_team} @ {p.game.home_team}
                  </span>
                </td>
                <td className="text-center py-3 px-3">
                  <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                    p.envScore >= 0.5 ? "bg-accent-green/15 text-accent-green" :
                    p.envScore >= 0.35 ? "bg-accent-yellow/15 text-accent-yellow" :
                    "bg-accent-red/15 text-accent-red"
                  }`}>
                    {Math.round(p.envScore * 100)}
                  </span>
                </td>
                <td className="text-center py-3 px-3 font-mono">{p.awayExpected.toFixed(1)}</td>
                <td className="text-center py-3 px-3 font-mono">{p.homeExpected.toFixed(1)}</td>
                <td className="text-center py-3 px-3">
                  <span className={`text-lg font-bold font-mono ${
                    p.expectedHRs >= 3.0 ? "text-accent-green" :
                    p.expectedHRs >= 2.0 ? "text-foreground" :
                    "text-muted"
                  }`}>
                    {p.expectedHRs.toFixed(1)}
                  </span>
                </td>
                <td className="py-3 px-3 text-foreground">{p.topPlayer}</td>
                <td className="text-center py-3 px-3 font-mono text-xs">{p.topComposite.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-[10px] text-muted">
        Based on pitcher HR/9 rates, park factors, weather conditions, and batter composite quality.
        Starter ~5.5 IP, bullpen ~3.5 IP at league-average HR rate. Adjusted for environment.
      </div>
    </div>
  );
}
