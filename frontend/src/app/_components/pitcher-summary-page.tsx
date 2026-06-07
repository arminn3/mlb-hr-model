"use client";

import { useState, useMemo } from "react";
import type { GameData, PitcherStatRow } from "./types";

type Split = "season" | "vs_L" | "vs_R";
type SortDir = "asc" | "desc";
type SortKey =
  | "name" | "team" | "gameTime"
  | "ip" | "bf" | "baa" | "woba" | "slg" | "iso" | "whip"
  | "hr" | "hr_per_9" | "bb_pct" | "k_pct" | "whiff_pct"
  | "barrel_pct" | "hard_hit_pct" | "fb_pct" | "hr_fb_pct";

const DASH = "—";

function fmtBa(v: number | null | undefined): string {
  if (v == null) return DASH;
  return v.toFixed(3).replace(/^0/, "");
}
function fmtPct(v: number | null | undefined): string {
  if (v == null) return DASH;
  return `${v.toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined, d = 2): string {
  if (v == null) return DASH;
  return v.toFixed(d);
}

// invert=false → lower is better for pitcher (green when low, red when high)
// invert=true  → higher is better for pitcher (green when high, red when low)
function cellCls(v: number | null | undefined, lo: number, hi: number, invert = false): string {
  if (v == null) return "text-muted";
  if (invert) {
    if (v >= hi) return "text-accent-green font-semibold";
    if (v >= lo) return "text-foreground";
    return "text-accent-red/80";
  }
  if (v <= lo) return "text-accent-green font-semibold";
  if (v <= hi) return "text-foreground";
  return "text-accent-red/80";
}

interface ColDef {
  key: SortKey;
  label: string;
  render: (row: PitcherStatRow) => string;
  color?: (row: PitcherStatRow) => string;
}

// All coloring is from the HR-prop bettor's perspective:
// GREEN = pitcher is vulnerable (high HR/9, ISO, wOBA etc.)
// RED   = pitcher is dominant (high K%, Whiff%)
const COLUMNS: ColDef[] = [
  { key: "hr_per_9",     label: "HR/9",   render: r => fmtNum(r.hr_per_9),      color: r => cellCls(r.hr_per_9, 0.90, 1.30, true) },
  { key: "iso",          label: "ISO",    render: r => fmtBa(r.iso),            color: r => cellCls(r.iso, 0.130, 0.175, true) },
  { key: "hr_fb_pct",   label: "HR/FB%", render: r => fmtPct(r.hr_fb_pct),     color: r => cellCls(r.hr_fb_pct, 8, 13, true) },
  { key: "woba",         label: "wOBA",   render: r => fmtBa(r.woba),           color: r => cellCls(r.woba, 0.295, 0.330, true) },
  { key: "slg",          label: "SLG",    render: r => fmtBa(r.slg),            color: r => cellCls(r.slg, 0.350, 0.420, true) },
  { key: "barrel_pct",   label: "Brl%",   render: r => fmtPct(r.barrel_pct),    color: r => cellCls(r.barrel_pct, 5, 8, true) },
  { key: "hard_hit_pct", label: "HH%",    render: r => fmtPct(r.hard_hit_pct),  color: r => cellCls(r.hard_hit_pct, 30, 38, true) },
  { key: "fb_pct",       label: "FB%",    render: r => fmtPct(r.fb_pct),        color: r => cellCls(r.fb_pct, 28, 36, true) },
  { key: "baa",          label: "BAA",    render: r => fmtBa(r.baa),            color: r => cellCls(r.baa, 0.220, 0.260, true) },
  { key: "whip",         label: "WHIP",   render: r => fmtNum(r.whip),          color: r => cellCls(r.whip, 1.10, 1.35, true) },
  { key: "hr",           label: "HR",     render: r => String(r.hr) },
  { key: "bb_pct",       label: "BB%",    render: r => fmtPct(r.bb_pct),        color: r => cellCls(r.bb_pct, 6.5, 9.5, true) },
  { key: "k_pct",        label: "K%",     render: r => fmtPct(r.k_pct),         color: r => cellCls(r.k_pct, 20, 27) },
  { key: "whiff_pct",    label: "Whiff%", render: r => fmtPct(r.whiff_pct),     color: r => cellCls(r.whiff_pct, 22, 30) },
  { key: "ip",           label: "IP",     render: r => r.ip != null ? r.ip.toFixed(1) : DASH },
  { key: "bf",           label: "BF",     render: r => String(r.bf) },
];

interface PitcherEntry {
  name: string;
  id?: number | null;
  hand: string;
  team: string;
  opp: string;
  gameTime?: string;
  gameTimeSort?: number;
  row: PitcherStatRow | null;
}

function SortTh({
  col, active, dir, onSort,
}: {
  col: { key: string; label: string };
  active: boolean;
  dir: SortDir;
  onSort: () => void;
}) {
  return (
    <th
      className="text-center px-2 py-2 text-[9px] uppercase tracking-wider font-semibold cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground"
      style={{ color: active ? "var(--accent)" : "rgba(255,255,255,0.35)" }}
      onClick={onSort}
    >
      {col.label}
      {active && <span className="ml-0.5 text-[8px]">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

export function PitcherSummaryPage({ games }: { games: GameData[] }) {
  const [split, setSplit] = useState<Split>("season");
  const [sortKey, setSortKey] = useState<SortKey>("gameTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo<PitcherEntry[]>(() => {
    const entries: PitcherEntry[] = [];
    for (const game of games) {
      for (const [pitcher, team, opp] of [
        [game.away_pitcher, game.away_team, game.home_team],
        [game.home_pitcher, game.home_team, game.away_team],
      ] as [typeof game.away_pitcher, string, string][]) {
        if (!pitcher?.name) continue;
        const profile = pitcher.profile ?? null;
        let row: PitcherStatRow | null = null;
        if (profile?.rows) {
          row = split === "vs_L" ? profile.rows.vs_L
              : split === "vs_R" ? profile.rows.vs_R
              : profile.rows.season;
        }
        entries.push({
          name: pitcher.name,
          id: pitcher.id,
          hand: pitcher.hand,
          team,
          opp,
          gameTime: game.game_time,
          gameTimeSort: game.game_time_sort,
          row,
        });
      }
    }

    const textKeys: SortKey[] = ["name", "team"];
    return entries.sort((a, b) => {
      let va: number | string | null = null;
      let vb: number | string | null = null;

      if (sortKey === "name") { va = a.name; vb = b.name; }
      else if (sortKey === "team") { va = a.team; vb = b.team; }
      else if (sortKey === "gameTime") {
        va = a.gameTimeSort ?? 9999;
        vb = b.gameTimeSort ?? 9999;
      } else {
        va = (a.row?.[sortKey as keyof PitcherStatRow] as number | null) ?? null;
        vb = (b.row?.[sortKey as keyof PitcherStatRow] as number | null) ?? null;
      }

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const mult = sortDir === "asc" ? 1 : -1;
      if (typeof va === "string" && typeof vb === "string") return mult * va.localeCompare(vb);
      return mult * ((va as number) - (vb as number));
    });
  }, [games, split, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(["name", "team", "gameTime"].includes(key) ? "asc" : "desc");
    }
  }

  const SPLITS: { key: Split; label: string }[] = [
    { key: "season", label: "Season" },
    { key: "vs_L",   label: "vs LHB" },
    { key: "vs_R",   label: "vs RHB" },
  ];

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Split toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>
          {SPLITS.map(s => (
            <button
              key={s.key}
              onClick={() => setSplit(s.key)}
              className="px-3 py-1.5 text-xs font-semibold cursor-pointer transition-all"
              style={split === s.key
                ? { background: "var(--accent)", color: "#000" }
                : { background: "transparent", color: "var(--muted)" }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "rgba(74,222,128,0.8)" }} />
            HR-friendly
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "rgba(248,113,113,0.8)" }} />
            Pitcher dominant
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {/* Fixed left cols */}
              <SortTh col={{ key: "gameTime", label: "Time" }} active={sortKey === "gameTime"} dir={sortDir} onSort={() => handleSort("gameTime")} />
              <th className="text-left px-3 py-2 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: "rgba(255,255,255,0.35)" }}>
                Pitcher
              </th>
              <SortTh col={{ key: "team", label: "Team" }} active={sortKey === "team"} dir={sortDir} onSort={() => handleSort("team")} />
              <th className="text-center px-2 py-2 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: "rgba(255,255,255,0.35)" }}>
                VS
              </th>
              {/* Stat cols */}
              {COLUMNS.map(col => (
                <SortTh
                  key={col.key}
                  col={col}
                  active={sortKey === col.key}
                  dir={sortDir}
                  onSort={() => handleSort(col.key)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, i) => (
              <tr
                key={`${entry.team}-${entry.name}`}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                }}
              >
                {/* Time */}
                <td className="text-center px-2 py-2.5 whitespace-nowrap text-[11px]" style={{ color: "var(--muted)" }}>
                  {entry.gameTime ?? DASH}
                </td>
                {/* Pitcher name + hand */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {entry.id ? (
                      <img
                        src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${entry.id}/headshot/67/current`}
                        alt={entry.name}
                        className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
                    )}
                    <span className="text-sm font-semibold text-foreground">{entry.name}</span>
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.07)", color: "var(--muted)" }}
                    >
                      {entry.hand}HP
                    </span>
                  </div>
                </td>
                {/* Team */}
                <td className="text-center px-2 py-2.5 font-semibold text-foreground whitespace-nowrap">
                  {entry.team}
                </td>
                {/* Opp */}
                <td className="text-center px-2 py-2.5 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                  vs {entry.opp}
                </td>
                {/* Stat cells */}
                {COLUMNS.map(col => {
                  if (!entry.row) {
                    return (
                      <td key={col.key} className="text-center px-2 py-2.5 text-muted">
                        {DASH}
                      </td>
                    );
                  }
                  const val = col.render(entry.row);
                  const cls = col.color ? col.color(entry.row) : "text-foreground";
                  return (
                    <td key={col.key} className={`text-center px-2 py-2.5 ${cls}`}>
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4 + COLUMNS.length} className="text-center py-12 text-muted">
                  No pitcher data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
        Click any column header to sort · green = good for pitcher · red = pitcher is vulnerable
      </p>
    </div>
  );
}
