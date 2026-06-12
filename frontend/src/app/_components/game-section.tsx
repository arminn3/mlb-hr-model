"use client";

import { useState } from "react";
import type { GameData, PitcherInfo, PlayerData, TeamPitchMixSide } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { GameHeader } from "./game-header";
import { PitcherProfileCard } from "./pitcher-profile-card";
import { PitcherStatsPanel } from "./pitcher-stats-panel";
import { BatterTable, type BatterRowInfo } from "./batter-table";
import { BullpenSection } from "./bullpen-section";

type LineupInfo = { order: number | null; id: number };

function buildLineupLookup(side?: TeamPitchMixSide): Map<string, LineupInfo> {
  const m = new Map<string, LineupInfo>();
  if (!side) return m;
  for (const b of side.batters) m.set(b.name, { order: b.order, id: b.id });
  return m;
}

function sortBatters(
  players: PlayerData[],
  lookup: Map<string, LineupInfo>,
  posted: boolean,
  lookback: UILookback,
  override?: Set<string> | null,
): BatterRowInfo[] {
  const rows: BatterRowInfo[] = players.map((p) => {
    const info = lookup.get(p.name);
    return { p, order: posted ? (info?.order ?? null) : null, mlbId: info?.id };
  });
  // Live-refresh override wins — show only players in the live MLB lineup.
  if (override && override.size > 0) {
    return rows.filter(({ p }) => override.has(p.name));
  }
  if (posted) {
    return rows
      .filter(({ order }) => order != null && order >= 1 && order <= 9)
      .sort((a, b) => a.order! - b.order!);
  }
  // Lineup not posted — preserve original API order (roster order from MLB)
  return rows;
}

export type SelectedBatter = {
  player: PlayerData;
  mlbId?: number;
  battingOrder: number | null;
  teamAbbr: string;
  parkFactor?: number;
};

export function GameSection({
  game,
  lookback,
  onSelectBatter,
  favorites,
  onToggleFavorite,
  lineupOverride,
}: {
  game: GameData;
  lookback: UILookback;
  onSelectBatter: (s: SelectedBatter) => void;
  favorites?: Set<string>;
  onToggleFavorite?: (name: string) => void;
  lineupOverride?: Set<string> | null;
}) {
  const [selectedPitcher, setSelectedPitcher] = useState<PitcherInfo | null>(null);
  const [selectedPitcherSide, setSelectedPitcherSide] = useState<"away" | "home">("away");

  const homeSide = game.team_pitch_mix?.home;
  const awaySide = game.team_pitch_mix?.away;
  const homeLookup = buildLineupLookup(homeSide);
  const awayLookup = buildLineupLookup(awaySide);
  const homePosted = homeSide?.lineup_status === "posted";
  const awayPosted = awaySide?.lineup_status === "posted";

  const homeBatters = sortBatters(
    game.players.filter((p) => p.batter_side === "home"),
    homeLookup,
    homePosted,
    lookback,
    lineupOverride,
  );
  const awayBatters = sortBatters(
    game.players.filter((p) => p.batter_side === "away"),
    awayLookup,
    awayPosted,
    lookback,
    lineupOverride,
  );

  return (
    <div className="mb-10">
      {/* Matchup hero */}
      <GameHeader
        awayTeam={game.away_team}
        homeTeam={game.home_team}
        gameTime={game.game_time}
        env={game.environment}
      />

      {/* Pitcher cards — 2-col side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        <PitcherProfileCard pitcher={game.away_pitcher} side="away" teamAbbr={game.away_team} onNameClick={() => { setSelectedPitcher(game.away_pitcher); setSelectedPitcherSide("away"); }} />
        <PitcherProfileCard pitcher={game.home_pitcher} side="home" teamAbbr={game.home_team} onNameClick={() => { setSelectedPitcher(game.home_pitcher); setSelectedPitcherSide("home"); }} />
      </div>

      {/* Pitcher stats panel — fixed overlay */}
      {selectedPitcher && (() => {
        // Batters facing this pitcher: home batters face away pitcher, away batters face home pitcher
        const facingBatters = game.players.filter(p => p.batter_side === (selectedPitcherSide === "away" ? "home" : "away"));
        const lhbPlayer = facingBatters.find(p => p.batter_hand !== "R");
        const rhbPlayer = facingBatters.find(p => p.batter_hand !== "L");
        return (
          <PitcherStatsPanel
            pitcher={selectedPitcher}
            zoneFreqLhb={lhbPlayer?.pitcher_zone_freq}
            zoneFreqRhb={rhbPlayer?.pitcher_zone_freq}
            onClose={() => setSelectedPitcher(null)}
          />
        );
      })()}

      {/* Batter tables */}
      <div className="mt-8 space-y-4">
        <BatterTable
          teamAbbr={game.away_team}
          batters={awayBatters}
          lookback={lookback}
          posted={awayPosted}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          pitcherMix={game.team_pitch_mix ? {
            vs_lhb: game.team_pitch_mix.away.pitcher.pitch_mix_vs_lhb,
            vs_rhb: game.team_pitch_mix.away.pitcher.pitch_mix_vs_rhb,
          } : undefined}
          onSelect={(row) =>
            onSelectBatter({
              player: row.p,
              mlbId: row.mlbId,
              battingOrder: row.order,
              teamAbbr: game.away_team,
              parkFactor: game.environment?.park_factor,
            })
          }
          parkFactor={game.environment?.park_factor}
        />
        <BatterTable
          teamAbbr={game.home_team}
          batters={homeBatters}
          lookback={lookback}
          posted={homePosted}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          pitcherMix={game.team_pitch_mix ? {
            vs_lhb: game.team_pitch_mix.home.pitcher.pitch_mix_vs_lhb,
            vs_rhb: game.team_pitch_mix.home.pitcher.pitch_mix_vs_rhb,
          } : undefined}
          onSelect={(row) =>
            onSelectBatter({
              player: row.p,
              mlbId: row.mlbId,
              battingOrder: row.order,
              teamAbbr: game.home_team,
              parkFactor: game.environment?.park_factor,
            })
          }
          parkFactor={game.environment?.park_factor}
        />
      </div>

      {/* Bullpen freshness — both teams side by side, after both batter tables */}
      {game.bullpen?.away?.arms && game.bullpen?.home?.arms && (
        <BullpenSection
          awayTeam={game.away_team}
          homeTeam={game.home_team}
          bullpen={game.bullpen}
        />
      )}
    </div>
  );
}
