"use client";

import { useMemo } from "react";
import { color } from "../../_design";
import type { NflSlate, NflGame } from "./types";
import { PlayerBlock } from "./player-research";

// Order role-holders within a team the way the reference stacks them.
const ROLE_ORDER = ["QB", "RB1", "RB2", "RB3+", "WR1", "WR2", "WR3", "WR4+", "TE1", "TE2+", "FB1+"];
const roleIdx = (r: string) => {
  const i = ROLE_ORDER.indexOf(r);
  return i < 0 ? 99 : i;
};

function TeamSection({ game, team }: { game: NflGame; team: string }) {
  const players = useMemo(
    () => game.players.filter((p) => p.team === team).sort((a, b) => roleIdx(a.role) - roleIdx(b.role)),
    [game, team],
  );
  const opp = team === game.home_team ? game.away_team : game.home_team;
  const imp = team === game.home_team ? game.home_implied : game.away_implied;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 sticky top-0 z-10 py-2" style={{ background: color.background }}>
        <span className="text-[16px] font-bold text-foreground">{team}</span>
        <span className="text-[11px]" style={{ color: color.muted }}>offense vs {opp} · implied {imp}</span>
      </div>
      {players.map((p) => <PlayerBlock key={p.gsis_id} player={p} />)}
    </div>
  );
}

export function GameResearch({
  slate, selectedGameId, onSelectGame,
}: {
  slate: NflSlate;
  selectedGameId: string | null;
  onSelectGame: (id: string) => void;
}) {
  const games = useMemo(
    () => [...slate.games].sort((a, b) => (b.away_implied + b.home_implied) - (a.away_implied + a.home_implied)),
    [slate],
  );
  const game = games.find((g) => g.game_id === selectedGameId) ?? games[0];
  if (!game) return null;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* left rail — pick a game */}
      <aside className="lg:w-52 shrink-0">
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: color.muted }}>Games</div>
        <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1">
          {games.map((g) => {
            const on = g.game_id === game.game_id;
            return (
              <button
                key={g.game_id}
                onClick={() => onSelectGame(g.game_id)}
                className="text-left px-3 py-2 rounded-lg cursor-pointer shrink-0 transition-colors"
                style={on
                  ? { background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)" }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid #2c2c2e" }}
              >
                <div className="text-[12px] font-semibold text-foreground whitespace-nowrap">{g.away_team} @ {g.home_team}</div>
                <div className="text-[10px]" style={{ color: color.muted }}>O/U {g.total_line}</div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* main — both teams' role-holders stacked */}
      <div className="min-w-0 flex-1 space-y-8">
        <TeamSection game={game} team={game.away_team} />
        <TeamSection game={game} team={game.home_team} />
      </div>
    </div>
  );
}
