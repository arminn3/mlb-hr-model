"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo } from "react";
import { CARD, color } from "../../_design";
import type { NflPlayer, GameLogRow } from "./types";
import { matchupColor, teamLogo, playerHeadshot, lineHeat } from "./format";

type ColDef = { key: keyof GameLogRow; label: string; invert?: boolean };

// Position-adaptive columns (ATD leads). INT is lower-is-better.
const QB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "pass_att", label: "Pass Att" }, { key: "cmp", label: "Pass Comp" },
  { key: "pass_yds", label: "Pass Yds" }, { key: "pass_td", label: "Pass TD" }, { key: "pass_int", label: "Pass INT", invert: true },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" },
];
const RB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" }, { key: "rush_td", label: "Rush TD" },
  { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yds" }, { key: "rec_td", label: "Rec TD" },
];
const REC_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yds" }, { key: "rec_td", label: "Rec TD" },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yds" },
];
const colsFor = (pos: string): ColDef[] => (pos === "QB" ? QB_COLS : pos === "RB" || pos === "FB" ? RB_COLS : REC_COLS);

// Placeholder "line" until live book lines are wired: the season average, rounded
// to a prop-style half-point (ATD is a fixed 0.5). Drives the green/red + hit rate.
const roundLine = (v: number, key: string) => (key === "atd" ? 0.5 : Math.round(v * 2) / 2);

function LineTable({ header, rows, cols, showName }: {
  header: React.ReactNode; rows: GameLogRow[]; cols: ColDef[]; showName?: boolean;
}) {
  const { avg, line } = useMemo(() => {
    const avg: Record<string, number> = {}, line: Record<string, number> = {};
    for (const c of cols) {
      const vals = rows.map((r) => Number(r[c.key] ?? 0));
      const a = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
      avg[c.key as string] = a;
      line[c.key as string] = roundLine(a, c.key as string);
    }
    return { avg, line };
  }, [rows, cols]);

  const hit = (c: ColDef) => {
    if (!rows.length) return null;
    const L = line[c.key as string];
    const n = rows.filter((r) => { const v = Number(r[c.key] ?? 0); return c.invert ? v < L : v > L; }).length;
    return { n, pct: Math.round((n / rows.length) * 100) };
  };

  return (
    <div className="rounded-xl overflow-hidden" style={CARD.elevated}>
      {header}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ minWidth: showName ? 560 : 480 }}>
          <thead>
            <tr className="text-[9px] uppercase tracking-wider" style={{ color: color.muted }}>
              <th className="text-left py-2 pl-3 pr-2">Date</th>
              {showName && <th className="text-left py-2 px-2">Player</th>}
              <th className="text-left py-2 px-2">Opp</th>
              {cols.map((c) => <th key={c.key} className="text-center py-2 px-2 whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + (showName ? 3 : 2)} className="py-6 text-center text-[12px]" style={{ color: color.muted }}>No games yet.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <td className="py-2 pl-3 pr-2 whitespace-nowrap font-mono text-[11px]" style={{ color: color.muted }}>{r.date.slice(5)}</td>
                {showName && <td className="py-2 px-2 whitespace-nowrap text-foreground/85 text-[11px]">{r.name}</td>}
                <td className="py-2 px-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1" style={{ color: color.muted }}>
                    <span className="text-[10px]">{r.home ? "" : "@"}</span>
                    <img src={teamLogo(r.opp)} alt={r.opp} className="w-4 h-4 object-contain" />{r.opp}
                  </span>
                </td>
                {cols.map((c) => {
                  const v = Number(r[c.key] ?? 0);
                  return <td key={c.key} className="py-2 px-2 text-center font-mono text-foreground/90" style={{ background: lineHeat(v, line[c.key as string], c.invert) }}>{v}</td>;
                })}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 text-[11px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.14)" }}>
                <td className="py-2 pl-3 pr-2 uppercase tracking-wider" style={{ color: color.muted }}>Avg</td>
                {showName && <td />}<td />
                {cols.map((c) => <td key={c.key} className="py-2 px-2 text-center font-mono text-foreground">{avg[c.key as string].toFixed(c.key === "atd" ? 2 : 1)}</td>)}
              </tr>
              <tr className="text-[11px] font-semibold">
                <td className="py-2 pl-3 pr-2 uppercase tracking-wider" style={{ color: color.muted }}>Hit</td>
                {showName && <td />}<td />
                {cols.map((c) => { const h = hit(c); return (
                  <td key={c.key} className="py-2 px-2 text-center font-mono">
                    {h ? <span style={{ color: h.pct >= 50 ? color.green : color.red }}>{h.pct}%<span className="ml-1" style={{ color: color.muted }}>{h.n}/{rows.length}</span></span> : "—"}
                  </td>
                ); })}
              </tr>
              <tr className="text-[10px]" style={{ background: "rgba(255,255,255,0.02)" }}>
                <td className="py-2 pl-3 pr-2 uppercase tracking-wider" style={{ color: color.muted }} title="Placeholder line = season average. Live book lines wire in-season.">Best lines*</td>
                {showName && <td />}<td />
                {cols.map((c) => <td key={c.key} className="py-2 px-2 text-center font-mono" style={{ color: color.muted }}>{line[c.key as string]}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Chip({ children, dropdown }: { children: React.ReactNode; dropdown?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid #2c2c2e", color: color.muted }}>
      {children}{dropdown && <span className="text-[9px]">▾</span>}
    </span>
  );
}

// One role-holder: LEFT = the defense they face vs this role; RIGHT = the player.
export function PlayerBlock({ player }: { player: NflPlayer }) {
  const cols = colsFor(player.pos);
  const head = playerHeadshot(player.espn_id);
  const mColor = matchupColor(player.opp_rank_vs_role, player.opp_rank_total);

  const offHeader = (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      {/* player identity */}
      <div className="flex items-center gap-3 p-3">
        {head
          ? <img src={head} alt={player.name} className="w-16 h-16 rounded-lg object-cover shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />
          : <div className="w-16 h-16 rounded-lg shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />}
        <div className="min-w-0">
          <div className="text-[18px] font-bold text-foreground truncate">{player.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "rgba(96,165,250,0.15)", color: color.accent }}>
              <img src={teamLogo(player.team)} alt={player.team} className="w-3.5 h-3.5 object-contain" />{player.team}
            </span>
            <span className="text-[11px] font-bold" style={{ color: color.muted }}>{player.role}</span>
          </div>
        </div>
      </div>
      {/* filter chips */}
      <div className="px-3 pb-3 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Chip dropdown>{"'25"}</Chip><Chip>vs {player.opponent}</Chip><Chip>{player.is_home ? "Home" : "Away"}</Chip><Chip>Primetime</Chip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip dropdown>Without Players</Chip><Chip dropdown>Filter Pass Attempts</Chip><Chip dropdown>Filter Rush Attempts</Chip>
        </div>
      </div>
    </div>
  );

  const defHeader = (
    <div className="p-3 border-b flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <img src={teamLogo(player.opponent)} alt={player.opponent} className="w-9 h-9 object-contain" />
      <div className="min-w-0">
        <div className="text-[15px] font-bold text-foreground">{player.opponent} vs {player.role}s</div>
        <div className="text-[11px]" style={{ color: mColor, fontWeight: 600 }}>#{player.opp_rank_vs_role}/{player.opp_rank_total} vs {player.role} — TDs/production allowed</div>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <LineTable header={defHeader} rows={player.role_vs_def_log} cols={cols} showName />
      <LineTable header={offHeader} rows={player.game_log} cols={cols} />
    </div>
  );
}
