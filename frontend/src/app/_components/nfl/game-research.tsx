"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, ListOrdered, Zap, HeartPulse } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflGame, NflPlayer } from "./types";
import { PlayerBlock } from "./player-research";
import { teamLogo, fmtPct, fmtPct1, scoreColor, posColor, matchupColor, matchupLabel } from "./format";

// Order role-holders within a team the way the reference stacks them.
const ROLE_ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1", "TE2"];
const roleIdx = (r: string) => {
  const i = ROLE_ORDER.indexOf(r);
  return i < 0 ? 99 : i;
};
const byRole = (a: NflPlayer, b: NflPlayer) => roleIdx(a.role) - roleIdx(b.role);

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

// ── Player Props tab (default) — stacked role-holder blocks, both teams ───────
function TeamSection({ game, team }: { game: NflGame; team: string }) {
  const players = useMemo(() => game.players.filter((p) => p.team === team).sort(byRole), [game, team]);
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

function PlayerProps({ game }: { game: NflGame }) {
  return (
    <div className="space-y-8">
      <TeamSection game={game} team={game.away_team} />
      <TeamSection game={game} team={game.home_team} />
    </div>
  );
}

// ── Touchdowns tab — every role-holder ranked by anytime-TD probability ───────
function Touchdowns({ game }: { game: NflGame }) {
  const rows = useMemo(() => [...game.players].sort((a, b) => b.score - a.score), [game]);
  return (
    <div className="rounded-xl overflow-hidden" style={CARD.elevated}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" style={{ minWidth: 560 }}>
          <thead>
            <tr className="text-[9px] uppercase tracking-wider" style={{ color: color.muted }}>
              <th className="text-right py-2 pl-3 pr-2">#</th>
              <th className="text-left py-2 px-2">Player</th>
              <th className="text-left py-2 px-2">Team</th>
              <th className="text-right py-2 px-2">vs Role</th>
              <th className="text-right py-2 px-2">Hit% Szn</th>
              <th className="text-right py-2 px-3">TD%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.gsis_id} className="border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <td className="py-2 pl-3 pr-2 text-right font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{i + 1}</td>
                <td className="py-2 px-2">
                  <span className="font-semibold text-foreground">{p.name}</span>
                  <span className="ml-1.5 text-[10px] font-bold" style={{ color: posColor(p.pos) }}>{p.role}</span>
                </td>
                <td className="py-2 px-2">
                  <span className="inline-flex items-center gap-1.5"><Logo team={p.team} size={16} /><span style={{ color: color.muted }}>{p.team}</span></span>
                </td>
                <td className="py-2 px-2 text-right font-mono" style={{ color: matchupColor(p.opp_rank_vs_role, p.opp_rank_total) }}>
                  #{p.opp_rank_vs_role}/{p.opp_rank_total}
                </td>
                <td className="py-2 px-2 text-right font-mono text-foreground/85">{fmtPct(p.hit_rate_season)}</td>
                <td className="py-2 px-3 text-right font-mono font-bold" style={{ color: scoreColor(p.score) }}>{fmtPct1(p.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Game Overview tab — matchup summary + each team's top plays ───────────────
function TeamTop({ game, team }: { game: NflGame; team: string }) {
  const top = useMemo(
    () => game.players.filter((p) => p.team === team).sort((a, b) => b.score - a.score).slice(0, 5),
    [game, team],
  );
  const imp = team === game.home_team ? game.home_implied : game.away_implied;
  return (
    <div className="rounded-xl p-4" style={CARD.elevated}>
      <div className="flex items-center gap-2 mb-3">
        <Logo team={team} size={22} />
        <span className="text-[15px] font-bold text-foreground">{team}</span>
        <span className="text-[11px]" style={{ color: color.muted }}>implied {imp}</span>
      </div>
      <div className="space-y-1.5">
        {top.map((p) => {
          const m = matchupLabel(p.opp_rank_vs_role, p.opp_rank_total);
          const mc = matchupColor(p.opp_rank_vs_role, p.opp_rank_total);
          return (
            <div key={p.gsis_id} className="flex items-center gap-2 text-[13px]">
              <span className="font-semibold text-foreground flex-1 truncate">{p.name}</span>
              <span className="text-[10px] font-bold" style={{ color: posColor(p.pos) }}>{p.role}</span>
              <span className="text-[10px] font-bold w-12 text-right" style={{ color: mc }}>{m}</span>
              <span className="font-mono font-bold w-12 text-right" style={{ color: scoreColor(p.score) }}>{fmtPct1(p.score)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameOverview({ game }: { game: NflGame }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <TeamTop game={game} team={game.away_team} />
      <TeamTop game={game} team={game.home_team} />
    </div>
  );
}

function Injuries() {
  return (
    <div className="rounded-xl p-8 text-center text-[13px]" style={{ ...CARD.elevated, color: color.muted }}>
      Injury report isn&apos;t wired into the slate yet.<br />
      It&apos;s a quick nflverse pull (import_injuries) — say the word and I&apos;ll add it.
    </div>
  );
}

type GameTab = "overview" | "props" | "tds" | "injuries";
const GAME_TABS: [GameTab, string, typeof LayoutGrid][] = [
  ["overview", "Game Overview", LayoutGrid],
  ["props", "Player Props", ListOrdered],
  ["tds", "Touchdowns", Zap],
  ["injuries", "Injuries", HeartPulse],
];

export function GameResearch({
  slate, selectedGameId, onSelectGame,
}: {
  slate: NflSlate;
  selectedGameId: string | null;
  onSelectGame: (id: string) => void;
}) {
  const [gameTab, setGameTab] = useState<GameTab>("props");
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
                  <span>O/U {g.total_line}</span><span>·</span><span>{spreadLabel(g)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* main — matchup banner, per-game tabs, then the tab content */}
      <div className="min-w-0 flex-1">
        <div className="rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-3" style={CARD.elevated}>
          <div className="flex items-center gap-2.5">
            <Logo team={game.away_team} size={30} />
            <span className="text-[18px] font-bold text-foreground">{game.away_team}</span>
            <span className="text-[13px]" style={{ color: color.muted }}>@</span>
            <span className="text-[18px] font-bold text-foreground">{game.home_team}</span>
            <Logo team={game.home_team} size={30} />
          </div>
          <div className="flex items-center gap-5 text-[12px]">
            <div className="text-center"><div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>Spread</div><div className="font-mono font-semibold text-foreground">{spreadLabel(game)}</div></div>
            <div className="text-center"><div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>O/U</div><div className="font-mono font-semibold text-foreground">{game.total_line}</div></div>
            <div className="text-center"><div className="uppercase tracking-wider text-[9px]" style={{ color: color.muted }}>Implied</div><div className="font-mono font-semibold text-foreground">{game.away_implied} / {game.home_implied}</div></div>
          </div>
        </div>

        {/* per-game tabs */}
        <div className="flex items-center gap-1 mt-4 mb-4 border-b overflow-x-auto" style={{ borderColor: "#2c2c2e" }}>
          {GAME_TABS.map(([key, label, Ico]) => {
            const on = gameTab === key;
            return (
              <button
                key={key}
                onClick={() => setGameTab(key)}
                className="px-3 py-2 text-[13px] font-semibold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 -mb-px transition-colors"
                style={on
                  ? { color: color.foreground, borderColor: color.accent }
                  : { color: color.muted, borderColor: "transparent" }}
              >
                <Ico size={14} /> {label}
              </button>
            );
          })}
        </div>

        {gameTab === "overview" && <GameOverview game={game} />}
        {gameTab === "props" && <PlayerProps game={game} />}
        {gameTab === "tds" && <Touchdowns game={game} />}
        {gameTab === "injuries" && <Injuries />}
      </div>
    </div>
  );
}
