"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { User } from "lucide-react";
import type {
  NflGame, RusherRow, ReceiverRow, AgainstRoleStats, OffenseSplitYear,
} from "./types";
import { teamLogo, playerHeadshot, matchupColor, heatFill } from "./format";
import { Toggle, sortedYears } from "./toggle";

// Same dark-card tokens as Lineups/Matchup Factors (Figma node 6:1043).
const CARD_BG = "#1b1b1b";
const BORDER = "#343434";
const CELL_BORDER = "1px solid #1b1b1b";
const HEAD = "#ccc";

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden flex-1 min-w-[320px]" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      {children}
    </div>
  );
}

function CardHeader({ team, title, right }: { team?: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 flex-wrap" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2">
        {team && <img src={teamLogo(team)} alt={team} className="w-5 h-5 object-contain" />}
        <span className="text-[14px] font-semibold text-white">{title}</span>
      </div>
      {right}
    </div>
  );
}

// ── Offense split card ────────────────────────────────────────────────────
function OffenseSplitCard({ team, splitByYear }: { team: string; splitByYear: Record<string, OffenseSplitYear> }) {
  const years = useMemo(() => sortedYears(Object.keys(splitByYear)), [splitByYear]);
  const [year, setYear] = useState(years[0]);
  const raw = splitByYear[year] ?? splitByYear[years[0]];
  // A season with no games yet is a real (present) but EMPTY {} entry — not
  // undefined — so it must be checked explicitly, or every field silently
  // computes NaN instead of falling into the "no data" row.
  const s = raw && raw.pass_att !== undefined ? raw : null;

  return (
    <Card>
      <CardHeader team={team} title={`${team} Offense`} right={<Toggle options={years} value={year} onChange={setYear} />} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: HEAD }}>
              <th className="text-left px-3 py-2" style={{ borderRight: CELL_BORDER }}>Split</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>RZ Pass Att</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>RZ Rush Att</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Pass Att</th>
              <th className="text-center px-3 py-2">Rush Att</th>
            </tr>
          </thead>
          <tbody className="font-semibold text-white">
            {!s ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center" style={{ color: HEAD }}>No data.</td></tr>
            ) : (
              <tr>
                <td className="px-3 py-2" style={{ color: HEAD, borderRight: CELL_BORDER }}>All</td>
                <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER }}>{s.rz_pass_att} <span style={{ color: HEAD }}>{Math.round(s.rz_pass_att_pct * 100)}%</span></td>
                <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER, background: "rgba(58,84,213,0.15)" }}>{s.rz_rush_att} <span style={{ color: HEAD }}>{Math.round(s.rz_rush_att_pct * 100)}%</span></td>
                <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER }}>{s.pass_att} <span style={{ color: HEAD }}>{Math.round(s.pass_att_pct * 100)}%</span></td>
                <td className="px-3 py-2 text-center">{s.rush_att} <span style={{ color: HEAD }}>{Math.round(s.rush_att_pct * 100)}%</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Against-stats depth card ─────────────────────────────────────────────
const DEPTH_ROLES = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1", "TE2"];
const DEPTH_LABEL: Record<string, string> = { QB: "QB1" }; // display only — model's single QB tier is "QB"

function RankCell({ value, rank, total, decimals = 2 }: { value: number | null; rank: number | null; total: number; decimals?: number }) {
  if (value == null) return <span style={{ color: HEAD }}>--</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-white">{value.toFixed(decimals)}</span>
      {rank != null && <span className="text-[10px] font-semibold" style={{ color: matchupColor(rank, total) }}>{ordinal(rank)}</span>}
    </span>
  );
}

function AgainstStatsCard({ team, opp, againstByYear }: { team: string; opp: string; againstByYear: Record<string, Record<string, AgainstRoleStats>> }) {
  const years = useMemo(() => sortedYears(Object.keys(againstByYear)), [againstByYear]);
  const [year, setYear] = useState(years[0]);
  const [depth, setDepth] = useState(true);
  const data = againstByYear[year] ?? {};
  const roles = ["All", ...(depth ? DEPTH_ROLES : [])];

  return (
    <Card>
      <CardHeader
        team={team}
        title={`${team} Against Stats`}
        right={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDepth((d) => !d)}
              className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer"
              style={{ color: depth ? "#fff" : HEAD }}
            >
              Depth
              <span className="inline-flex w-8 h-[18px] rounded-full items-center px-0.5" style={{ background: depth ? "#3a54d5" : "#333" }}>
                <span className="w-[14px] h-[14px] rounded-full bg-white transition-transform" style={{ transform: depth ? "translateX(14px)" : "translateX(0)" }} />
              </span>
            </button>
            <Toggle options={years} value={year} onChange={setYear} />
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: HEAD }}>
              <th className="text-left px-3 py-2" style={{ borderRight: CELL_BORDER }}>Split</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>TD</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush TDs</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rec TDs</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush Yds</th>
              <th className="text-center px-3 py-2">Rec Yds</th>
            </tr>
          </thead>
          <tbody className="font-semibold">
            {Object.keys(data).length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center" style={{ color: HEAD }}>No completed games that season.</td></tr>
            ) : roles.map((role) => {
              const r = data[role];
              if (!r) return null;
              return (
                <tr key={role}>
                  <td className="px-3 py-2 text-white" style={{ borderRight: CELL_BORDER }}>{DEPTH_LABEL[role] ?? role}</td>
                  <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{r.td.toFixed(2)}</td>
                  <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER }}><RankCell value={r.rush_td} rank={r.rush_td_rank} total={r.rank_total} /></td>
                  <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER }}><RankCell value={r.rec_td} rank={r.rec_td_rank} total={r.rank_total} /></td>
                  <td className="px-3 py-2 text-center" style={{ borderRight: CELL_BORDER }}><RankCell value={r.rush_yds} rank={r.rush_yds_rank} total={r.rank_total} decimals={1} /></td>
                  <td className="px-3 py-2 text-center"><RankCell value={r.rec_yds} rank={r.rec_yds_rank} total={r.rank_total} decimals={1} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px]" style={{ color: HEAD, opacity: 0.7 }}>vs {opp}&apos;s offense — real per-game rates allowed, ranked 1-32 (higher = softer matchup)</p>
    </Card>
  );
}

// ── Rusher / Receiver stat tables ────────────────────────────────────────
type Mode = "Per game" | "Totals";

function PlayerCell({ name, role }: { name: string; role: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: "#333" }}>
        <User size={13} className="text-white/40" />
      </span>
      <span className="text-white truncate">{name}</span>
      <span className="text-[10px] font-semibold shrink-0" style={{ color: HEAD }}>{DEPTH_LABEL[role] ?? role}</span>
    </span>
  );
}

const per = (total: number, gp: number, mode: Mode) => (mode === "Per game" && gp > 0 ? total / gp : total);
const fmt = (v: number, mode: Mode) => (mode === "Per game" ? v.toFixed(1) : Math.round(v).toString());

function RusherStatsCard({ team, rows, mode }: { team: string; rows: RusherRow[]; mode: Mode }) {
  const years = useMemo(() => sortedYears([...new Set(rows.flatMap((r) => Object.keys(r.by_year)))]), [rows]);
  const [year, setYear] = useState(years[0] ?? "");
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.by_year[year]?.rz_rush_share ?? -1) - (a.by_year[year]?.rz_rush_share ?? -1)),
    [rows, year],
  );

  return (
    <Card>
      <CardHeader team={team} title={`${team} Rusher Stats`} right={years.length > 0 && <Toggle options={years} value={year} onChange={setYear} />} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: HEAD }}>
              <th className="text-left px-3 py-2" style={{ borderRight: CELL_BORDER }}>Player</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>GP</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>TD</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush TD</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush RZ Att</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush RZ Share</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rush Yds</th>
              <th className="text-center px-3 py-2">Rush Att</th>
            </tr>
          </thead>
          <tbody className="font-semibold">
            {sorted.map((p) => {
              const v = p.by_year[year];
              if (!v) return null;
              const noData = v.games === 0;
              return (
                <tr key={p.gsis_id}>
                  <td className="px-3 py-2" style={{ borderRight: CELL_BORDER }}><PlayerCell name={p.name} role={p.role} /></td>
                  <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{noData ? "--" : v.games}</td>
                  {noData ? (
                    <td colSpan={6} className="px-3 py-2 text-center" style={{ color: HEAD }}>--</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.td, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.rush_td, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.rz_rush_att, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center font-bold" style={{ borderRight: CELL_BORDER, background: v.rz_rush_share != null ? heatFill(v.rz_rush_share) : undefined }}>
                        {v.rz_rush_share != null ? `${Math.round(v.rz_rush_share * 100)}%` : "--"}
                      </td>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.rush_yds, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center text-white">{fmt(per(v.rush_att, v.games, mode), mode)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ReceiverStatsCard({ team, rows, mode }: { team: string; rows: ReceiverRow[]; mode: Mode }) {
  const years = useMemo(() => sortedYears([...new Set(rows.flatMap((r) => Object.keys(r.by_year)))]), [rows]);
  const [year, setYear] = useState(years[0] ?? "");
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.by_year[year]?.rz_tgt_share ?? -1) - (a.by_year[year]?.rz_tgt_share ?? -1)),
    [rows, year],
  );

  return (
    <Card>
      <CardHeader team={team} title={`${team} Receiver Stats`} right={years.length > 0 && <Toggle options={years} value={year} onChange={setYear} />} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: HEAD }}>
              <th className="text-left px-3 py-2" style={{ borderRight: CELL_BORDER }}>Player</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>GP</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>TD</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rec TD</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rec RZ Tgt</th>
              <th className="text-center px-3 py-2" style={{ borderRight: CELL_BORDER }}>Rec RZ Tgt Share</th>
              <th className="text-center px-3 py-2">Rec Yds</th>
            </tr>
          </thead>
          <tbody className="font-semibold">
            {sorted.map((p) => {
              const v = p.by_year[year];
              if (!v) return null;
              const noData = v.games === 0;
              return (
                <tr key={p.gsis_id}>
                  <td className="px-3 py-2" style={{ borderRight: CELL_BORDER }}><PlayerCell name={p.name} role={p.role} /></td>
                  <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{noData ? "--" : v.games}</td>
                  {noData ? (
                    <td colSpan={5} className="px-3 py-2 text-center" style={{ color: HEAD }}>--</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.td, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.rec_td, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center text-white" style={{ borderRight: CELL_BORDER }}>{fmt(per(v.rz_targets, v.games, mode), mode)}</td>
                      <td className="px-3 py-2 text-center font-bold" style={{ borderRight: CELL_BORDER, background: v.rz_tgt_share != null ? heatFill(v.rz_tgt_share) : undefined }}>
                        {v.rz_tgt_share != null ? `${Math.round(v.rz_tgt_share * 100)}%` : "--"}
                      </td>
                      <td className="px-3 py-2 text-center text-white">{fmt(per(v.rec_yds, v.games, mode), mode)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TeamTdSection({
  team, opp, offenseSplit, against, rushers, receivers, mode, onModeChange,
}: {
  team: string; opp: string;
  offenseSplit: Record<string, OffenseSplitYear>; against: Record<string, Record<string, AgainstRoleStats>>;
  rushers: RusherRow[]; receivers: ReceiverRow[]; mode: Mode; onModeChange: (m: Mode) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={teamLogo(team)} alt={team} className="w-6 h-6 object-contain" />
          <span className="text-[18px] font-semibold text-white">{team} TDs</span>
        </div>
        <Toggle options={["Per game", "Totals"] as const} value={mode} onChange={onModeChange} />
      </div>
      <div className="flex flex-wrap gap-3 items-start">
        <OffenseSplitCard team={team} splitByYear={offenseSplit} />
        <AgainstStatsCard team={opp} opp={team} againstByYear={against} />
      </div>
      <RusherStatsCard team={team} rows={rushers} mode={mode} />
      <ReceiverStatsCard team={team} rows={receivers} mode={mode} />
    </div>
  );
}

export function Touchdowns({ game }: { game: NflGame }) {
  const [mode, setMode] = useState<Mode>("Per game");
  return (
    <div className="flex flex-col gap-8">
      <TeamTdSection
        team={game.away_team} opp={game.home_team}
        offenseSplit={game.away_offense_split} against={game.home_against}
        rushers={game.away_rushers} receivers={game.away_receivers}
        mode={mode} onModeChange={setMode}
      />
      <TeamTdSection
        team={game.home_team} opp={game.away_team}
        offenseSplit={game.home_offense_split} against={game.away_against}
        rushers={game.home_rushers} receivers={game.home_receivers}
        mode={mode} onModeChange={setMode}
      />
    </div>
  );
}
