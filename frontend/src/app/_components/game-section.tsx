"use client";

import type { GameData, LookbackKey, PlayerData, TeamPitchMixSide } from "./types";
import { GameHeader } from "./game-header";
import { PitcherProfileCard } from "./pitcher-profile-card";
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
  lookback: LookbackKey,
): BatterRowInfo[] {
  const rows: BatterRowInfo[] = players.map((p) => {
    const info = lookup.get(p.name);
    return { p, order: posted ? (info?.order ?? null) : null, mlbId: info?.id };
  });
  if (posted) {
    return rows
      .filter(({ order }) => order != null && order >= 1 && order <= 9)
      .sort((a, b) => a.order! - b.order!);
  }
  return rows.sort(
    (a, b) => (b.p.scores[lookback]?.composite ?? 0) - (a.p.scores[lookback]?.composite ?? 0),
  );
}

export type SelectedBatter = {
  player: PlayerData;
  mlbId?: number;
  battingOrder: number | null;
  teamAbbr: string;
};

export function GameSection({
  game,
  lookback,
  onSelectBatter,
}: {
  game: GameData;
  lookback: LookbackKey;
  onSelectBatter: (s: SelectedBatter) => void;
}) {
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
  );
  const awayBatters = sortBatters(
    game.players.filter((p) => p.batter_side === "away"),
    awayLookup,
    awayPosted,
    lookback,
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
        <PitcherProfileCard pitcher={game.away_pitcher} side="away" />
        <PitcherProfileCard pitcher={game.home_pitcher} side="home" />
      </div>

      {/* Batter tables */}
      <div className="mt-8 space-y-4">
        <BatterTable
          teamAbbr={game.away_team}
          batters={awayBatters}
          lookback={lookback}
          posted={awayPosted}
          onSelect={(row) =>
            onSelectBatter({
              player: row.p,
              mlbId: row.mlbId,
              battingOrder: row.order,
              teamAbbr: game.away_team,
            })
          }
        />
        <BatterTable
          teamAbbr={game.home_team}
          batters={homeBatters}
          lookback={lookback}
          posted={homePosted}
          onSelect={(row) =>
            onSelectBatter({
              player: row.p,
              mlbId: row.mlbId,
              battingOrder: row.order,
              teamAbbr: game.home_team,
            })
          }
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
