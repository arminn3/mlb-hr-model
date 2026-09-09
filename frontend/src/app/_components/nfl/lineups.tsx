"use client";
/* eslint-disable @next/next/no-img-element */

import { User } from "lucide-react";
import type { NflGame, NflPlayer, LineupSplit } from "./types";
import { playerHeadshot, tileHeat } from "./format";

// Same dark-card tokens as the Research player cards (Figma node 6:1043) —
// this is the Game-Overview "Lineups" section, kept visually consistent.
const CARD_BG = "#1b1b1b";
const BORDER = "#343434";
const CELL_BORDER = "1px solid #1b1b1b";
const HEAD = "#ccc";

type ColDef = { key: keyof LineupSplit; label: string; invert?: boolean };

const QB_COLS: ColDef[] = [
  { key: "pass_att", label: "Pass Att" }, { key: "cmp", label: "Pass Comp" }, { key: "pass_yds", label: "Pass Yds" },
  { key: "pass_yd_a", label: "Yds/A" }, { key: "pass_td", label: "Pass TD" }, { key: "pass_int", label: "Pass INT", invert: true },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" }, { key: "td", label: "TD" },
];
const RB_COLS: ColDef[] = [
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" }, { key: "rush_yd_a", label: "Yds/A" }, { key: "rush_td", label: "Rush TD" },
  { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yds" }, { key: "td", label: "TD" },
];
const REC_COLS: ColDef[] = [
  { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yds" }, { key: "rec_td", label: "Rec TD" },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" }, { key: "td", label: "TD" },
];
const colsFor = (pos: string): ColDef[] => (pos === "QB" ? QB_COLS : pos === "RB" || pos === "FB" ? RB_COLS : REC_COLS);

function SplitRow({ label, row, cols, baseline }: { label: string; row: LineupSplit | null; cols: ColDef[]; baseline: LineupSplit | null }) {
  if (!row) {
    return (
      <tr>
        <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ background: CARD_BG, color: HEAD, borderRight: CELL_BORDER }}>{label}</td>
        <td className="px-3 py-2 text-center" style={{ background: CARD_BG, color: HEAD }} colSpan={cols.length + 1}>--</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ background: CARD_BG, color: HEAD, borderRight: CELL_BORDER }}>{label}</td>
      <td className="px-3 py-2 text-center text-white" style={{ background: CARD_BG, borderRight: CELL_BORDER }}>{row.games}</td>
      {cols.map((c) => {
        const v = row[c.key] as number;
        const base = baseline ? (baseline[c.key] as number) : v;
        const bg = baseline && row !== baseline ? tileHeat(v, base, c.invert) : CARD_BG;
        return <td key={c.key} className="px-3 py-2 text-center text-white whitespace-nowrap" style={{ background: bg, borderRight: CELL_BORDER }}>{v}</td>;
      })}
    </tr>
  );
}

function LineupTable({ player, opponent }: { player: NflPlayer; opponent: string }) {
  const cols = colsFor(player.pos);
  const head = player.headshot || playerHeadshot(player.espn_id);
  const s = player.lineup_splits;

  const rows: { label: string; row: LineupSplit | null }[] = s
    ? [
        { label: `'${String(s.season_year).slice(2)}`, row: s.season },
        { label: `'${String(s.season_year).slice(2)} Home`, row: s.home },
        { label: `vs ${opponent}`, row: s.vs_opp },
        { label: `'${String(s.last_season_year).slice(2)}`, row: s.last_season },
      ]
    : [];
  const baseline = s?.season ?? null;

  return (
    <div className="rounded-2xl overflow-hidden flex-1 min-w-0" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex gap-3 items-center p-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
        {head
          ? <img src={head} alt={player.name} className="w-12 h-12 rounded-lg object-cover object-top shrink-0" />
          : <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "#2a2a2a" }}><User size={22} className="text-white/40" /></div>}
        <div className="min-w-0">
          <p className="text-[16px] font-medium text-white truncate">{player.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="px-2 py-0.5 rounded text-[11px] font-medium text-white" style={{ background: "rgba(58,84,213,0.5)" }}>{player.team}</span>
            <span className="text-[11px] font-semibold text-white">{player.role}</span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto scroll-subtle">
        <table className="w-full border-collapse text-[12px]" style={{ minWidth: 560 }}>
          <thead>
            <tr className="font-semibold" style={{ color: HEAD }}>
              <th className="text-left px-3 py-1.5 whitespace-nowrap" style={{ background: CARD_BG, borderRight: CELL_BORDER }}>Split</th>
              <th className="text-center px-3 py-1.5 whitespace-nowrap" style={{ background: CARD_BG, borderRight: CELL_BORDER }}>GP</th>
              {cols.map((c) => (
                <th key={c.key} className="text-center px-3 py-1.5 whitespace-nowrap" style={{ background: CARD_BG, borderRight: CELL_BORDER }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-medium">
            {rows.map((r) => <SplitRow key={r.label} label={r.label} row={r.row} cols={cols} baseline={baseline} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LINEUP_ROLES = ["QB", "RB1", "WR1", "TE1"] as const;

export function Lineups({ game }: { game: NflGame }) {
  const pairs = LINEUP_ROLES.map((role) => ({
    role,
    away: game.players.find((p) => p.team === game.away_team && p.role === role) ?? null,
    home: game.players.find((p) => p.team === game.home_team && p.role === role) ?? null,
  })).filter((p) => p.away || p.home);

  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-[16px] font-semibold text-white">Lineups</h3>
      {pairs.map(({ role, away, home }) => (
        <div key={role} className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {away
            ? <LineupTable player={away} opponent={game.home_team} />
            : <div className="rounded-2xl p-4 text-[12px]" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, color: HEAD }}>No {role} data for {game.away_team}.</div>}
          {home
            ? <LineupTable player={home} opponent={game.away_team} />
            : <div className="rounded-2xl p-4 text-[12px]" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, color: HEAD }}>No {role} data for {game.home_team}.</div>}
        </div>
      ))}
    </div>
  );
}
