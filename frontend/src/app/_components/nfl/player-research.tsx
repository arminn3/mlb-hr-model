"use client";

import { useMemo } from "react";
import { CARD, color } from "../../_design";
import type { NflPlayer, GameLogRow } from "./types";
import { fmtPct1, scoreColor, posColor, matchupColor, teamLogo, heatFill } from "./format";

type ColDef = { key: keyof GameLogRow; label: string };

// Position-adaptive columns (ATD always leads).
const QB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "pass_att", label: "ATT" }, { key: "cmp", label: "CMP" },
  { key: "pass_yds", label: "P.YDS" }, { key: "pass_td", label: "P.TD" }, { key: "pass_int", label: "INT" },
  { key: "rush_att", label: "R.ATT" }, { key: "rush_yds", label: "R.YDS" },
];
const RB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "rush_att", label: "R.ATT" }, { key: "rush_yds", label: "R.YDS" },
  { key: "rush_td", label: "R.TD" }, { key: "targets", label: "TGT" }, { key: "rec", label: "REC" },
  { key: "rec_yds", label: "RC.YDS" }, { key: "rec_td", label: "RC.TD" },
];
const REC_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "targets", label: "TGT" }, { key: "rec", label: "REC" },
  { key: "rec_yds", label: "RC.YDS" }, { key: "rec_td", label: "RC.TD" },
  { key: "rush_att", label: "R.ATT" }, { key: "rush_yds", label: "R.YDS" },
];
const colsFor = (pos: string): ColDef[] =>
  pos === "QB" ? QB_COLS : pos === "RB" || pos === "FB" ? RB_COLS : REC_COLS;

// Relative heat: high = green, low = red, within the shown rows.
const heatBg = (v: number, lo: number, hi: number): string =>
  hi <= lo ? "transparent" : heatFill((v - lo) / (hi - lo));

function LogTable({
  title, subtitle, subColor, rows, cols, showName,
}: {
  title: string; subtitle?: string; subColor?: string;
  rows: GameLogRow[]; cols: ColDef[]; showName?: boolean;
}) {
  const ranges = useMemo(() => {
    const r: Record<string, [number, number]> = {};
    for (const c of cols) {
      const vals = rows.map((x) => Number(x[c.key] ?? 0));
      r[c.key as string] = [Math.min(0, ...vals), Math.max(0, ...vals)];
    }
    return r;
  }, [rows, cols]);

  const avg = (k: keyof GameLogRow) =>
    rows.length ? rows.reduce((s, x) => s + Number(x[k] ?? 0), 0) / rows.length : 0;
  const hits = rows.filter((x) => x.atd > 0).length;

  return (
    <div className="rounded-xl overflow-hidden" style={CARD.elevated}>
      <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="text-[13px] font-bold text-foreground">{title}</div>
        {subtitle && <div className="text-[11px] mt-0.5" style={{ color: subColor ?? color.muted }}>{subtitle}</div>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ minWidth: showName ? 540 : 430 }}>
          <thead>
            <tr className="text-[9px] uppercase tracking-wider" style={{ color: color.muted }}>
              <th className="text-left py-1.5 pl-3 pr-2">Date</th>
              {showName && <th className="text-left py-1.5 px-2">Player</th>}
              <th className="text-center py-1.5 px-2">Opp</th>
              {cols.map((c) => <th key={c.key} className="text-center py-1.5 px-2">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + (showName ? 3 : 2)} className="py-6 text-center text-[12px]" style={{ color: color.muted }}>No games yet.</td></tr>
            )}
            {rows.map((x, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <td className="py-1.5 pl-3 pr-2 whitespace-nowrap font-mono text-[11px]" style={{ color: color.muted }}>{x.date.slice(5)}</td>
                {showName && <td className="py-1.5 px-2 whitespace-nowrap text-foreground/85 text-[11px]">{x.name}</td>}
                <td className="py-1.5 px-2 whitespace-nowrap" style={{ color: color.muted }}>
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px]">{x.home ? "" : "@"}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={teamLogo(x.opp)} alt={x.opp} className="w-4 h-4 object-contain" />
                    {x.opp}
                  </span>
                </td>
                {cols.map((c) => {
                  const v = Number(x[c.key] ?? 0);
                  const [lo, hi] = ranges[c.key as string];
                  return (
                    <td key={c.key} className="py-1.5 px-2 text-center font-mono text-foreground/90" style={{ background: heatBg(v, lo, hi) }}>{v}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 text-[11px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.14)" }}>
                <td className="py-1.5 pl-3 pr-2 uppercase tracking-wider" style={{ color: color.muted }}>Avg</td>
                {showName && <td />}<td />
                {cols.map((c) => (
                  <td key={c.key} className="py-1.5 px-2 text-center font-mono text-foreground">
                    {avg(c.key).toFixed(c.key === "atd" ? 2 : 1)}
                  </td>
                ))}
              </tr>
              <tr className="text-[11px] font-semibold">
                <td className="py-1.5 pl-3 pr-2 uppercase tracking-wider" style={{ color: color.muted }}>Hit</td>
                {showName && <td />}<td />
                {cols.map((c) => (
                  <td key={c.key} className="py-1.5 px-2 text-center font-mono">
                    {c.key === "atd" ? (
                      <span style={{ color: hits / rows.length >= 0.5 ? color.green : color.foreground }}>
                        {Math.round((hits / rows.length) * 100)}%
                        <span className="ml-1" style={{ color: color.muted }}>{hits}/{rows.length}</span>
                      </span>
                    ) : (
                      <span style={{ color: "rgba(255,255,255,0.18)" }}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// One role-holder's block: headline + [player game log | role-vs-defense].
// Stacked by GameResearch for every role-holder on both teams of a game.
export function PlayerBlock({ player }: { player: NflPlayer }) {
  const cols = colsFor(player.pos);
  const mColor = matchupColor(player.opp_rank_vs_role, player.opp_rank_total);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={CARD.simple}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-foreground truncate">{player.name}</span>
            <span className="text-[11px] font-bold px-1.5 rounded" style={{ color: posColor(player.pos), background: "rgba(255,255,255,0.06)" }}>{player.role}</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: color.muted }}>
            {player.team} vs {player.opponent}
            <span className="mx-1.5">·</span>
            <span style={{ color: mColor, fontWeight: 600 }}>#{player.opp_rank_vs_role}/{player.opp_rank_total} vs {player.role}</span>
            <span className="mx-1.5">·</span>imp {player.implied_team_total}
          </div>
        </div>
        <div className="text-right shrink-0 pl-3">
          <div className="text-[18px] font-bold font-mono leading-none" style={{ color: scoreColor(player.score) }}>{fmtPct1(player.score)}</div>
          <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: color.muted }}>TD prob</div>
        </div>
      </div>
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
        <LogTable
          title={`${player.name} — Game Log`}
          subtitle={`${player.game_log.length} games · ${Math.round(player.hit_rate_season * 100)}% ATD season`}
          rows={player.game_log}
          cols={cols}
        />
        <LogTable
          title={`${player.role}s vs ${player.opponent} Defense`}
          subtitle={`how ${player.role}s produce vs ${player.opponent} · #${player.opp_rank_vs_role}/${player.opp_rank_total} vs ${player.role}`}
          subColor={mColor}
          rows={player.role_vs_def_log}
          cols={cols}
          showName
        />
      </div>
    </div>
  );
}
