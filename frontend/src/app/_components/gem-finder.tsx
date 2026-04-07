"use client";

import { useMemo } from "react";
import type { GameData, LookbackKey } from "./types";

interface Gem {
  name: string;
  game: string;
  opp_pitcher: string;
  batter_hand: string;
  pitcher_hand: string;
  composite: number;
  barrel_pct: number;
  fb_pct: number;
  hard_hit_pct: number;
  exit_velo: number;
  total_bip: number;
  pitcher_hr9: number;
  pitcher_hrfb: number;
  env_score: number;
  reason: string;
}

export function GemFinder({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const gems = useMemo(() => {
    const candidates: Gem[] = [];
    const seen = new Set<string>();

    for (const game of games) {
      const envScore = game.environment?.env_score ?? 0.5;

      for (const player of game.players) {
        if (seen.has(player.name)) continue;
        seen.add(player.name);

        const scores = player.scores[lookback];
        if (!scores) continue;

        const pitcherStats = player.pitcher_stats;
        const composite = scores.composite;

        // Gem criteria: NOT a top-ranked player but has power signals
        // Skip anyone in the top 30 — those aren't gems, they're expected
        if (composite > 0.50) continue;

        // Must show at least ONE power indicator
        const hasBarrel = scores.barrel_pct >= 15;
        const hasEV = scores.exit_velo >= 90;
        const hasFB = scores.fb_pct >= 40;
        const hasHardHit = scores.hard_hit_pct >= 45;
        const pitcherVulnerable = (pitcherStats?.hr_per_9 ?? 0) >= 1.5 || (pitcherStats?.hr_fb_rate ?? 0) >= 12;
        const goodEnv = envScore >= 0.5;

        // Need at least 2 power signals
        const signals = [hasBarrel, hasEV, hasFB, hasHardHit, pitcherVulnerable, goodEnv];
        const signalCount = signals.filter(Boolean).length;
        if (signalCount < 2) continue;

        // Build reason string
        const reasons: string[] = [];
        if (hasBarrel) reasons.push(`${scores.barrel_pct}% barrel`);
        if (hasEV) reasons.push(`${scores.exit_velo} mph EV`);
        if (hasFB) reasons.push(`${scores.fb_pct}% FB rate`);
        if (hasHardHit) reasons.push(`${scores.hard_hit_pct}% hard hit`);
        if (pitcherVulnerable) reasons.push(`pitcher ${pitcherStats?.hr_per_9 ?? 0} HR/9`);
        if (goodEnv) reasons.push(`env ${Math.round(envScore * 100)}`);

        candidates.push({
          name: player.name,
          game: `${game.away_team}@${game.home_team}`,
          opp_pitcher: player.opp_pitcher,
          batter_hand: player.batter_hand,
          pitcher_hand: player.pitcher_hand,
          composite,
          barrel_pct: scores.barrel_pct,
          fb_pct: scores.fb_pct,
          hard_hit_pct: scores.hard_hit_pct,
          exit_velo: scores.exit_velo,
          total_bip: 0, // would need from model data
          pitcher_hr9: pitcherStats?.hr_per_9 ?? 0,
          pitcher_hrfb: pitcherStats?.hr_fb_rate ?? 0,
          env_score: envScore,
          reason: reasons.join(" | "),
        });
      }
    }

    // Sort by composite descending — best gems first
    candidates.sort((a, b) => b.composite - a.composite);
    return candidates.slice(0, 30);
  }, [games, lookback]);

  if (gems.length === 0) {
    return <p className="text-center text-muted py-12">No gems found today.</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-foreground">Gem Finder</h2>
        <p className="text-xs text-muted mt-0.5">
          Low-profile players showing sneaky power signals in favorable matchups.
          These aren&apos;t top-ranked plays — they&apos;re dark horses with upside.
        </p>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {gems.map((g, i) => (
          <div key={g.name} className="bg-card/40 border border-accent-yellow/20 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-accent-yellow font-mono w-6">{i + 1}</span>
                <div>
                  <span className="text-sm font-semibold text-foreground">{g.name}</span>
                  <div className="text-[10px] text-muted">{g.game} vs {g.opp_pitcher}</div>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-foreground">{g.composite.toFixed(3)}</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {g.barrel_pct >= 15 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green">{g.barrel_pct}% bar</span>}
              {g.exit_velo >= 90 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green">{g.exit_velo} EV</span>}
              {g.fb_pct >= 40 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green">{g.fb_pct}% FB</span>}
              {g.pitcher_hr9 >= 1.5 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-yellow/15 text-accent-yellow">P {g.pitcher_hr9} HR/9</span>}
              {g.env_score >= 0.5 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green">env {Math.round(g.env_score * 100)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-center py-2 w-8">#</th>
              <th className="text-left py-2">Player</th>
              <th className="text-left py-2">Matchup</th>
              <th className="text-center py-2">Hand</th>
              <th className="text-center py-2">Barrel%</th>
              <th className="text-center py-2">FB%</th>
              <th className="text-center py-2">Hard Hit%</th>
              <th className="text-center py-2">EV</th>
              <th className="text-center py-2">P HR/9</th>
              <th className="text-center py-2">Env</th>
              <th className="text-center py-2">Score</th>
              <th className="text-left py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {gems.map((g, i) => (
              <tr key={g.name} className="border-b border-card-border/30 hover:bg-card/40">
                <td className="text-center py-2 font-bold text-accent-yellow font-mono">{i + 1}</td>
                <td className="py-2 font-medium text-foreground">{g.name}</td>
                <td className="py-2 text-muted">{g.game} vs {g.opp_pitcher}</td>
                <td className="text-center py-2 font-mono text-muted">{g.batter_hand}v{g.pitcher_hand}</td>
                <td className="text-center py-2"><span className={`font-mono ${g.barrel_pct >= 15 ? "text-accent-green font-semibold" : ""}`}>{g.barrel_pct}%</span></td>
                <td className="text-center py-2"><span className={`font-mono ${g.fb_pct >= 40 ? "text-accent-green font-semibold" : ""}`}>{g.fb_pct}%</span></td>
                <td className="text-center py-2"><span className={`font-mono ${g.hard_hit_pct >= 45 ? "text-accent-green font-semibold" : ""}`}>{g.hard_hit_pct}%</span></td>
                <td className="text-center py-2"><span className={`font-mono ${g.exit_velo >= 90 ? "text-accent-green font-semibold" : ""}`}>{g.exit_velo}</span></td>
                <td className="text-center py-2"><span className={`font-mono ${g.pitcher_hr9 >= 1.5 ? "text-accent-green font-semibold" : ""}`}>{g.pitcher_hr9}</span></td>
                <td className="text-center py-2"><span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${g.env_score >= 0.5 ? "bg-accent-green/15 text-accent-green" : "text-muted"}`}>{Math.round(g.env_score * 100)}</span></td>
                <td className="text-center py-2 font-mono">{g.composite.toFixed(3)}</td>
                <td className="py-2 text-[10px] text-muted max-w-xs">{g.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-[10px] text-muted">
        Gems are players ranked outside the top tier but showing 2+ power signals:
        barrel% {"\u2265"}15, exit velo {"\u2265"}90mph, FB% {"\u2265"}40, hard hit% {"\u2265"}45,
        vulnerable pitcher (HR/9 {"\u2265"}1.5), or favorable environment (50+).
      </div>
    </div>
  );
}
