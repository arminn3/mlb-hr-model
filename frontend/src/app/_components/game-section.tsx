"use client";

import type { GameData, LookbackKey, PlayerData, PitcherStats } from "./types";
import { GameHeader } from "./game-header";
import { PitcherCard } from "./pitcher-card";
import { BatterCard } from "./batter-card";

export function GameSection({
  game,
  lookback,
}: {
  game: GameData;
  lookback: LookbackKey;
}) {
  // Split players into home batters (facing away pitcher) and away batters (facing home pitcher)
  const homeBatters = game.players
    .filter((p) => p.batter_side === "home")
    .sort((a, b) => (b.scores[lookback]?.composite ?? 0) - (a.scores[lookback]?.composite ?? 0));

  const awayBatters = game.players
    .filter((p) => p.batter_side === "away")
    .sort((a, b) => (b.scores[lookback]?.composite ?? 0) - (a.scores[lookback]?.composite ?? 0));

  // Extract pitcher stats from first player on each side
  const awayPitcherStats = homeBatters[0]?.pitcher_stats ?? defaultPitcherStats;
  const homePitcherStats = awayBatters[0]?.pitcher_stats ?? defaultPitcherStats;
  const awayPitcherTypes = homeBatters[0]?.pitch_types ?? [];
  const homePitcherTypes = awayBatters[0]?.pitch_types ?? [];

  return (
    <div
      className="rounded-[var(--radius-lg)] p-5 mb-6"
      style={{ background: "var(--surface-sunken)" }}
    >
      <GameHeader
        awayTeam={game.away_team}
        homeTeam={game.home_team}
        gameTime={game.game_time}
        env={game.environment}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Side 1: Home batters vs Away pitcher */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/80 mb-3 pb-2 border-b border-(color:var(--border-subtle))">
            {game.home_team} Batters vs {game.away_pitcher.name} ({game.away_pitcher.hand}HP)
          </h3>
          <PitcherCard
            pitcher={game.away_pitcher}
            stats={awayPitcherStats}
            pitchTypes={awayPitcherTypes}
          />
          <div className="space-y-2">
            {homeBatters.map((p, i) => (
              <BatterCard key={p.name} player={p} lookback={lookback} rank={i + 1} />
            ))}
            {homeBatters.length === 0 && (
              <p className="text-xs text-muted py-4 text-center">No batters with HR props</p>
            )}
          </div>
        </div>

        {/* Side 2: Away batters vs Home pitcher */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/80 mb-3 pb-2 border-b border-(color:var(--border-subtle))">
            {game.away_team} Batters vs {game.home_pitcher.name} ({game.home_pitcher.hand}HP)
          </h3>
          <PitcherCard
            pitcher={game.home_pitcher}
            stats={homePitcherStats}
            pitchTypes={homePitcherTypes}
          />
          <div className="space-y-2">
            {awayBatters.map((p, i) => (
              <BatterCard key={p.name} player={p} lookback={lookback} rank={i + 1} />
            ))}
            {awayBatters.length === 0 && (
              <p className="text-xs text-muted py-4 text-center">No batters with HR props</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const defaultPitcherStats: PitcherStats = {
  fb_rate: 0,
  hr_fb_rate: 0,
  hr_per_9: 0,
  ip: 0,
  total_hrs: 0,
};
