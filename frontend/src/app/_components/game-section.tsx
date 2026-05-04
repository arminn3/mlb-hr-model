"use client";

import { useState } from "react";
import type { GameData, LookbackKey, PlayerData, TeamPitchMixSide } from "./types";
import { GameHeader } from "./game-header";
import { PitcherProfileCard } from "./pitcher-profile-card";
import { BatterCard } from "./batter-card";
import { BatterDrawer } from "./batter-drawer";

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
): { p: PlayerData; info?: LineupInfo }[] {
  const rows = players.map((p) => ({ p, info: lookup.get(p.name) }));
  if (posted) {
    return rows
      .filter(({ info }) => info?.order != null && info.order >= 1 && info.order <= 9)
      .sort((a, b) => (a.info!.order! - b.info!.order!));
  }
  return rows.sort(
    (a, b) => (b.p.scores[lookback]?.composite ?? 0) - (a.p.scores[lookback]?.composite ?? 0),
  );
}

type Selected = { player: PlayerData; mlbId?: number; battingOrder: number | null };

export function GameSection({
  game,
  lookback,
}: {
  game: GameData;
  lookback: LookbackKey;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);

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
    <>
      <div
        className="rounded-[var(--radius-lg)] p-5 mb-6 backdrop-blur-sm"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.015) 0%, rgba(255,255,255,0.005) 60%, rgba(0,0,0,0.10) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.03), 0 8px 24px -12px rgba(0,0,0,0.4)",
        }}
      >
        <GameHeader
          awayTeam={game.away_team}
          homeTeam={game.home_team}
          gameTime={game.game_time}
          env={game.environment}
        />

        <PitcherBlock
          title={`${game.home_team} Batters vs ${game.away_pitcher.name}`}
          pitcher={game.away_pitcher}
          batters={homeBatters}
          posted={homePosted}
          lookback={lookback}
          onSelect={setSelected}
        />
        <PitcherBlock
          title={`${game.away_team} Batters vs ${game.home_pitcher.name}`}
          pitcher={game.home_pitcher}
          batters={awayBatters}
          posted={awayPosted}
          lookback={lookback}
          onSelect={setSelected}
          className="mt-8"
        />
      </div>

      {selected && (
        <BatterDrawer
          player={selected.player}
          lookback={lookback}
          mlbId={selected.mlbId}
          battingOrder={selected.battingOrder}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function PitcherBlock({
  title,
  pitcher,
  batters,
  posted,
  lookback,
  onSelect,
  className = "",
}: {
  title: string;
  pitcher: GameData["away_pitcher"];
  batters: { p: PlayerData; info?: LineupInfo }[];
  posted: boolean;
  lookback: LookbackKey;
  onSelect: (s: Selected) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/80 mb-3 pb-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {title} ({pitcher.hand}HP)
      </h3>
      <PitcherProfileCard pitcher={pitcher} />
      <div className="space-y-3">
        {batters.map(({ p, info }) => {
          const battingOrder = posted ? (info?.order ?? null) : null;
          return (
            <BatterCard
              key={p.name}
              player={p}
              lookback={lookback}
              battingOrder={battingOrder}
              mlbId={info?.id}
              onSelect={() => onSelect({ player: p, mlbId: info?.id, battingOrder })}
            />
          );
        })}
        {batters.length === 0 && (
          <p className="text-xs text-muted py-4 text-center">No batters with HR props</p>
        )}
      </div>
    </div>
  );
}
