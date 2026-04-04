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
  const parkFactor = (env?.park_factor ?? 100) / 100;

  const homePlayers = game.players.filter(p => p.batter_side === "home");
  const awayPlayers = game.players.filter(p => p.batter_side === "away");

  const awayPitcherStats = homePlayers[0]?.pitcher_stats;
  const homePitcherStats = awayPlayers[0]?.pitcher_stats;

  // League average: ~1.1 HR per team per game (2.2 total per game)
  const baseHRPerTeam = 1.1;

  // Pitcher adjustment: compare their HR/9 to league avg (1.25)
  // Cap at 2.0 max, floor at 0.5 — early season rates are noisy
  const leagueAvg = 1.25;
  const clampHR9 = (hr9: number, ip: number): number => {
    if (!hr9 || ip < 3) return leagueAvg;
    const capped = Math.min(Math.max(hr9, 0.5), 2.0);
    if (ip < 15) {
      const trust = ip / 15;
      return capped * trust + leagueAvg * (1 - trust);
    }
    return capped;
  };

  const awayPHR9 = clampHR9(awayPitcherStats?.hr_per_9 ?? 0, awayPitcherStats?.ip ?? 0);
  const homePHR9 = clampHR9(homePitcherStats?.hr_per_9 ?? 0, homePitcherStats?.ip ?? 0);

  // Scale base by pitcher HR tendency relative to league avg
  let homeExpected = baseHRPerTeam * (awayPHR9 / leagueAvg);
  let awayExpected = baseHRPerTeam * (homePHR9 / leagueAvg);

  // Park factor adjustment
  homeExpected *= parkFactor;
  awayExpected *= parkFactor;

  // Small env boost (wind, temp) — capped to prevent runaway
  const windBoost = env?.wind_score ? Math.max(0, env.wind_score) * 0.005 : 0;
  const tempBoost = env?.temperature_f && env.temperature_f > 75 ? (env.temperature_f - 75) * 0.002 : 0;
  const envBoost = 1 + Math.min(windBoost + tempBoost, 0.15); // max 15% boost

  homeExpected *= envBoost;
  awayExpected *= envBoost;

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
    expectedHRs: homeExpected + awayExpected,
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
            <p className="text-xs text-muted">{projections.length} games</p>
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
                  {p.game.game_time && (
                    <span className="text-xs text-muted ml-2">{p.game.game_time}</span>
                  )}
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
        Based on pitcher HR/9 rates (blended with league avg for small samples), park factors, and weather.
        League average: ~2.2 HRs per game.
      </div>
    </div>
  );
}
