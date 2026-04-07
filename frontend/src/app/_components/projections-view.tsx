"use client";

import { useMemo, useEffect, useState } from "react";
import type { GameData, LookbackKey } from "./types";

interface ProjectionModel {
  intercept: number;
  coefficients: Record<string, number>;
  scaler_mean: Record<string, number>;
  scaler_scale: Record<string, number>;
  training_games: number;
  avg_hrs_per_game: number;
  mae: number;
}

interface GameProjection {
  game: GameData;
  expectedHRs: number;
  topPlayer: string;
  topComposite: number;
  envScore: number;
}

function predictHRs(game: GameData, _lookback: LookbackKey, model: ProjectionModel): number {
  const env = game.environment;
  const players = game.players;
  const homePlayers = players.filter(p => p.batter_side === "home");
  const awayPlayers = players.filter(p => p.batter_side === "away");
  const awayP = homePlayers[0]?.pitcher_stats || {};
  const homeP = awayPlayers[0]?.pitcher_stats || {};

  // Use average of L5 and L10 composites so projection doesn't change with toggle
  const composites = players.map(p => {
    const l5 = p.scores.L5?.composite ?? 0.3;
    const l10 = p.scores.L10?.composite ?? l5;
    return (l5 + l10) / 2;
  });

  // Build feature vector matching training
  const features: Record<string, number> = {
    park_factor: (env?.park_factor ?? 100) / 100,
    temperature: ((env?.temperature_f ?? 70) - 50) / 40,
    wind: ((env?.wind_score ?? 0) + 15) / 30,
    humidity: (env?.humidity ?? 50) / 100,
    pressure: (1030 - (env?.pressure_hpa ?? 1013)) / 50,
    pitcher_hr9: ((awayP.hr_per_9 ?? 1.25) + (homeP.hr_per_9 ?? 1.25)) / 2 / 2.0,
    pitcher_fb_rate: ((awayP.fb_rate ?? 30) + (homeP.fb_rate ?? 30)) / 2 / 100,
    pitcher_hr_fb: ((awayP.hr_fb_rate ?? 10) + (homeP.hr_fb_rate ?? 10)) / 2 / 100,
    avg_batter_composite: composites.reduce((a, b) => a + b, 0) / (composites.length || 1),
    max_batter_composite: Math.max(...composites, 0.3),
    num_batters: players.length / 30,
  };

  // Apply scaler (standardize) then multiply by coefficients
  let prediction = model.intercept;
  for (const [feat, coef] of Object.entries(model.coefficients)) {
    const raw = features[feat] ?? 0;
    const mean = model.scaler_mean[feat] ?? 0;
    const scale = model.scaler_scale[feat] ?? 1;
    const scaled = (raw - mean) / scale;
    prediction += scaled * coef;
  }

  // Floor at 0.5, cap at 6
  return Math.max(0.5, Math.min(6, prediction));
}

export function ProjectionsView({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [model, setModel] = useState<ProjectionModel | null>(null);

  useEffect(() => {
    fetch("/data/results/projection_model.json")
      .then(r => r.ok ? r.json() : null)
      .then(setModel)
      .catch(() => {});
  }, []);

  const projections = useMemo(() => {
    if (!model) return [];
    return games
      .map((game): GameProjection => {
        const expectedHRs = predictHRs(game, lookback, model);
        let topPlayer = "";
        let topComposite = 0;
        for (const p of game.players) {
          const l5 = p.scores.L5?.composite ?? 0;
          const l10 = p.scores.L10?.composite ?? l5;
          const c = (l5 + l10) / 2;
          if (c > topComposite) { topComposite = c; topPlayer = p.name; }
        }
        return { game, expectedHRs, topPlayer, topComposite, envScore: game.environment?.env_score ?? 0.5 };
      })
      .sort((a, b) => b.expectedHRs - a.expectedHRs);
  }, [games, lookback, model]);

  const totalSlateHRs = projections.reduce((s, p) => s + p.expectedHRs, 0);

  if (!model) {
    return <p className="text-center text-muted py-12">Loading projection model...</p>;
  }

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
            <p className="text-xs text-muted">
              {projections.length} games &middot; ML model trained on {model.training_games} games &middot; avg {model.avg_hrs_per_game} HR/game
            </p>
          </div>
          <div className="text-right">
            <span className="text-4xl font-bold font-mono text-accent">
              {totalSlateHRs.toFixed(1)}
            </span>
            <span className="text-sm text-muted ml-2">HRs</span>
          </div>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {projections.map((p) => (
          <div key={p.game.game_pk} className="bg-background/30 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-foreground">
                  {p.game.away_team} @ {p.game.home_team}
                </span>
                {p.game.game_time && (
                  <span className="text-[10px] text-muted ml-2">{p.game.game_time}</span>
                )}
              </div>
              <span className={`text-xl font-bold font-mono ${
                p.expectedHRs >= 3.0 ? "text-accent-green" :
                p.expectedHRs >= 2.0 ? "text-foreground" :
                "text-muted"
              }`}>
                {p.expectedHRs.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[10px]">
              <span className={`font-mono px-1.5 py-0.5 rounded ${
                p.envScore >= 0.5 ? "bg-accent-green/15 text-accent-green" :
                p.envScore >= 0.35 ? "bg-accent-yellow/15 text-accent-yellow" :
                "bg-accent-red/15 text-accent-red"
              }`}>
                Env {Math.round(p.envScore * 100)}
              </span>
              <span className="text-muted">Top: <span className="text-foreground">{p.topPlayer}</span></span>
              <span className="font-mono text-muted">{p.topComposite.toFixed(3)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-left py-3 pr-4">Game</th>
              <th className="text-center py-3 px-3">Env</th>
              <th className="text-center py-3 px-3">Projected HRs</th>
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
        ML projection model trained on {model.training_games} historical games.
        Mean absolute error: {model.mae} HRs/game. Model retrains daily.
      </div>
    </div>
  );
}
