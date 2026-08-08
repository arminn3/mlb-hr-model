"use client";

import { useMemo } from "react";
import { Star } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflGame, NflPlayer } from "./types";
import { fmtPct, fmtPct1, fmtOdds, scoreColor, posColor, dvpColor } from "./format";

function PlayerRow({
  p, rank, fav, onToggleFavorite,
}: {
  p: NflPlayer; rank: number; fav: boolean; onToggleFavorite: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
      <span className="w-4 text-[11px] font-mono text-right shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>{rank}</span>
      <button onClick={() => onToggleFavorite(p.gsis_id)} className="cursor-pointer shrink-0" aria-label="favorite">
        <Star size={13} fill={fav ? color.yellow : "none"} stroke={fav ? color.yellow : "rgba(255,255,255,0.22)"} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-foreground truncate">{p.name}</span>
          <span className="text-[10px] font-bold shrink-0" style={{ color: posColor(p.pos) }}>{p.pos}</span>
        </div>
        <div className="text-[10px] flex items-center gap-2 mt-0.5" style={{ color: color.muted }}>
          <span>RZ {fmtPct(p.rz_opp_share)}</span>
          <span style={{ color: dvpColor(p.dvp_rank) }}>DvP #{p.dvp_rank || "—"}</span>
          <span>Hit {fmtPct(p.hit_rate_season)}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[14px] font-bold font-mono" style={{ color: scoreColor(p.score) }}>{fmtPct1(p.score)}</div>
        <div className="text-[10px] font-mono" style={{ color: color.muted }}>{fmtOdds(p.fair_odds)}</div>
      </div>
    </div>
  );
}

function TeamColumn({
  team, implied, players, favorites, onToggleFavorite,
}: {
  team: string; implied: number; players: NflPlayer[];
  favorites: Set<string>; onToggleFavorite: (id: string) => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2 px-2">
        <span className="text-[13px] font-bold text-foreground">{team}</span>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: color.muted }}>
          implied <span className="font-mono" style={{ color: color.foreground }}>{implied}</span>
        </span>
      </div>
      <div className="space-y-1">
        {players.slice(0, 6).map((p, i) => (
          <PlayerRow key={p.gsis_id} p={p} rank={i + 1} fav={favorites.has(p.gsis_id)} onToggleFavorite={onToggleFavorite} />
        ))}
      </div>
    </div>
  );
}

function GameCard({
  game, favorites, onToggleFavorite,
}: {
  game: NflGame; favorites: Set<string>; onToggleFavorite: (id: string) => void;
}) {
  const away = game.players.filter((p) => p.team === game.away_team);
  const home = game.players.filter((p) => p.team === game.home_team);
  return (
    <div className="rounded-xl p-4" style={CARD.elevated}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[14px] font-bold text-foreground">
          {game.away_team} <span style={{ color: color.muted }}>@</span> {game.home_team}
        </span>
        <span className="text-[11px] flex items-center gap-3" style={{ color: color.muted }}>
          <span>O/U <span className="font-mono" style={{ color: color.foreground }}>{game.total_line}</span></span>
          {game.roof && game.roof !== "outdoors" && (
            <span className="uppercase tracking-wider text-[10px]">{game.roof}</span>
          )}
        </span>
      </div>
      <div className="flex gap-4">
        <TeamColumn team={game.away_team} implied={game.away_implied} players={away} favorites={favorites} onToggleFavorite={onToggleFavorite} />
        <div className="w-px self-stretch" style={{ background: "rgba(255,255,255,0.08)" }} />
        <TeamColumn team={game.home_team} implied={game.home_implied} players={home} favorites={favorites} onToggleFavorite={onToggleFavorite} />
      </div>
    </div>
  );
}

export function CheatSheet({
  slate, favorites, onToggleFavorite,
}: {
  slate: NflSlate; favorites: Set<string>; onToggleFavorite: (id: string) => void;
}) {
  // Highest-total games first — the most TD opportunity on the slate.
  const games = useMemo(
    () => [...slate.games].sort((a, b) => (b.away_implied + b.home_implied) - (a.away_implied + a.home_implied)),
    [slate],
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {games.map((g) => (
        <GameCard key={g.game_id} game={g} favorites={favorites} onToggleFavorite={onToggleFavorite} />
      ))}
    </div>
  );
}
