"use client";

import { useMemo } from "react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflGame } from "./types";
import { PlayerBlock } from "./player-research";
import { teamLogo } from "./format";

// Order role-holders within a team the way the reference stacks them.
const ROLE_ORDER = ["QB", "RB1", "RB2", "RB3+", "WR1", "WR2", "WR3", "WR4+", "TE1", "TE2+", "FB1+"];
const roleIdx = (r: string) => {
  const i = ROLE_ORDER.indexOf(r);
  return i < 0 ? 99 : i;
};

const Logo = ({ team, size = 20 }: { team: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={teamLogo(team)} alt={team} width={size} height={size} className="object-contain shrink-0" style={{ width: size, height: size }} />
);

/** Favored team + line, e.g. "PHI -7.5". spread_line > 0 = home favored. */
function spreadLabel(g: NflGame): string {
  if (!g.spread_line) return "PK";
  const fav = g.spread_line > 0 ? g.home_team : g.away_team;
  return `${fav} -${Math.abs(g.spread_line)}`;
}

function TeamSection({ game, team }: { game: NflGame; team: string }) {
  const players = useMemo(
    () => game.players.filter((p) => p.team === team).sort((a, b) => roleIdx(a.role) - roleIdx(b.role)),
    [game, team],
  );
  const opp = team === game.home_team ? game.away_team : game.home_team;
  const imp = team === game.home_team ? game.home_implied : game.away_implied;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 sticky top-0 z-10 py-2 -mx-1 px-1" style={{ background: color.background }}>
        <Logo team={team} size={22} />
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
      <aside className="lg:w-56 shrink-0">
        <div className="text-[10px] uppercase tracking-wider mb-2 px-1" style={{ color: color.muted }}>Games</div>
        <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1">
          {games.map((g) => {
            const on = g.game_id === game.game_id;
            return (
              <button
                key={g.game_id}
                onClick={() => onSelectGame(g.game_id)}
                className="text-left px-3 py-2 rounded-lg cursor-pointer shrink-0 transition-colors w-[180px] lg:w-auto"
                style={on
                  ? { background: "rgba(96,165,250,0.14)", border: "1px solid rgba(96,165,250,0.45)" }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid #2c2c2e" }}
              >
                <div className="flex items-center gap-1.5">
                  <Logo team={g.away_team} size={18} />
                  <span className="text-[12px] font-semibold text-foreground">{g.away_team}</span>
                  <span className="text-[10px]" style={{ color: color.muted }}>@</span>
                  <Logo team={g.home_team} size={18} />
                  <span className="text-[12px] font-semibold text-foreground">{g.home_team}</span>
                </div>
                <div className="text-[10px] mt-0.5 flex items-center gap-2" style={{ color: color.muted }}>
                  <span>O/U {g.total_line}</span>
                  <span>·</span>
                  <span>{spreadLabel(g)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* main — matchup banner + both teams' role-holders stacked */}
      <div className="min-w-0 flex-1 space-y-6">
        <div className="rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-3" style={CARD.elevated}>
          <div className="flex items-center gap-2.5">
            <Logo team={game.away_team} size={30} />
            <span className="text-[18px] font-bold text-foreground">{game.away_team}</span>
            <span className="text-[13px]" style={{ color: color.muted }}>@</span>
            <span className="text-[18px] font-bold text-foreground">{game.home_team}</span>
            <Logo team={game.home_team} size={30} />
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <div className="text-center">
              <div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>Spread</div>
              <div className="font-mono font-semibold text-foreground">{spreadLabel(game)}</div>
            </div>
            <div className="text-center">
              <div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>O/U</div>
              <div className="font-mono font-semibold text-foreground">{game.total_line}</div>
            </div>
            <div className="text-center">
              <div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>Implied</div>
              <div className="font-mono font-semibold text-foreground">{game.away_implied} / {game.home_implied}</div>
            </div>
          </div>
        </div>

        <TeamSection game={game} team={game.away_team} />
        <TeamSection game={game} team={game.home_team} />
      </div>
    </div>
  );
}
