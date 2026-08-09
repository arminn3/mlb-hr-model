"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, ListOrdered, Zap, HeartPulse, ChevronDown } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflGame, NflPlayer } from "./types";
import { PlayerBlock } from "./player-research";
import { teamLogo, teamName, fmtPct, fmtPct1, scoreColor, posColor, matchupColor, matchupLabel } from "./format";

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

const LEAGUE_LOGO: Record<string, string> = {
  NFL: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
  MLB: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
};

// The rail's league dropdown = the MLB <-> NFL model switcher.
function LeagueSwitcher() {
  const [open, setOpen] = useState(false);
  const leagues = [
    { key: "NFL", label: "NFL", href: "/nfl", current: true },
    { key: "MLB", label: "MLB", href: "/dashboard", current: false },
  ];
  return (
    <div className="relative w-[198px] shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg p-3 w-full cursor-pointer"
        style={{ background: "#1b1b1b", border: "1px solid #3a3a3a" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LEAGUE_LOGO.NFL} alt="NFL" className="w-6 h-6 object-contain" />
        <span className="flex-1 text-left text-[16px] font-bold text-white">NFL</span>
        <ChevronDown size={16} className="text-white/60 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg overflow-hidden" style={{ background: "#1b1b1b", border: "1px solid #3a3a3a" }}>
          {leagues.map((l) => (
            <a
              key={l.key}
              href={l.href}
              className="flex items-center gap-2 px-3 py-2.5 text-[14px] font-bold text-white hover:bg-white/[0.06]"
              style={l.current ? { background: "rgba(58,84,213,0.20)" } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LEAGUE_LOGO[l.key]} alt={l.label} className="w-5 h-5 object-contain" />{l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

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
      {/* left rail — game selection (copied from Figma node 3:65) */}
      <aside className="shrink-0">
        <div className="flex lg:flex-col gap-3 lg:gap-5 overflow-x-auto lg:overflow-visible pb-1">
          {/* league dropdown = MLB <-> NFL model switcher */}
          <LeagueSwitcher />
          {/* game cards */}
          <div className="flex lg:flex-col gap-3">
            {games.map((g) => {
              const on = g.game_id === game.game_id;
              return (
                <button
                  key={g.game_id}
                  onClick={() => onSelectGame(g.game_id)}
                  className="w-[198px] shrink-0 rounded-lg p-3 text-left cursor-pointer flex flex-col gap-2 transition-colors"
                  style={on
                    ? { background: "rgba(58,84,213,0.25)", border: "1px solid #3a54d5" }
                    : { background: "#1b1b1b", border: "1px solid #343434" }}
                >
                  <span className="text-[12px] font-semibold" style={{ color: "#ccc" }}>{g.kickoff}</span>
                  <div className="flex items-center gap-[9px]">
                    <span className="flex items-center gap-2"><Logo team={g.away_team} size={24} /><span className="text-[14px] font-bold text-white">{g.away_team}</span></span>
                    <span className="text-[16px] font-semibold text-white">@</span>
                    <span className="flex items-center gap-2"><Logo team={g.home_team} size={24} /><span className="text-[14px] font-bold text-white">{g.home_team}</span></span>
                  </div>
                  <div className="flex gap-1.5 text-[12px] font-semibold" style={{ color: "#7e7e7e" }}>
                    <span>{spreadLabel(g)}</span>
                    <span className="flex-1 text-right">OU {g.total_line}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* main — game header (node 6:1035), per-game tabs, then the tab content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-6 flex-wrap px-1 py-2">
          <div className="flex flex-col gap-3 items-start">
            <p className="text-[20px] font-medium text-white whitespace-nowrap">
              {teamName(game.away_team)} @ {teamName(game.home_team)}
            </p>
            <div className="flex flex-col gap-2 text-[12px] font-semibold" style={{ color: "#7e7e7e" }}>
              <span>{game.kickoff.split(" ")[0]}</span>
              <span>{game.kickoff.split(" ").slice(1).join(" ")}</span>
            </div>
          </div>
          <div className="flex flex-col gap-[9px] items-start justify-center">
            {([[game.away_team, game.away_record], [game.home_team, game.home_record]] as const).map(([t, rec]) => (
              <div key={t} className="flex items-center gap-2">
                <Logo team={t} size={24} />
                <span className="text-[14px] font-bold text-white">{t}</span>
                <span className="text-[14px] font-bold" style={{ color: "#7e7e7e" }}>{rec}</span>
              </div>
            ))}
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
