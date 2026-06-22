"use client";

import { useState, useMemo } from "react";
import type { GameData, PitcherStatRow } from "./types";

type Split = "season" | "vs_L" | "vs_R";
type Window = "season" | "last_10" | "last_7" | "last_5" | "last_3" | "last_1";
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

type CellHeat = "green" | "red" | null;

// Returns the heat level from the HR-prop bettor's perspective:
// invert=true  → high = green (HR/9, ISO, wOBA…)
// invert=false → low = green (K%, Whiff%)
function cellHeat(v: number | null | undefined, lo: number, hi: number, invert = false): CellHeat {
  if (v == null) return null;
  if (invert) {
    if (v >= hi) return "green";
    if (v < lo)  return "red";
    return null;
  }
  if (v <= lo) return "green";
  if (v > hi)  return "red";
  return null;
}

const HEAT_BG: Record<"green" | "red", React.CSSProperties> = {
  green: { background: "rgba(34,197,94,0.20)",  border: "1px solid rgba(34,197,94,0.35)",  color: "rgb(134,239,172)", fontWeight: 600 },
  red:   { background: "rgba(239,68,68,0.18)",  border: "1px solid rgba(239,68,68,0.30)",  color: "rgb(252,165,165)", fontWeight: 600 },
};

interface ColDef {
  key: SortKey;
  label: string;
  render: (row: PitcherStatRow) => string;
  heat?: (row: PitcherStatRow) => CellHeat;
}

// All coloring is from the HR-prop bettor's perspective:
// GREEN = pitcher is vulnerable (high HR/9, ISO, wOBA etc.)
// RED   = pitcher is dominant (high K%, Whiff%)
const COLUMNS: ColDef[] = [
  { key: "hr_per_9",     label: "HR/9",   render: r => fmtNum(r.hr_per_9),      heat: r => cellHeat(r.hr_per_9, 0.90, 1.30, true) },
  { key: "iso",          label: "ISO",    render: r => fmtBa(r.iso),            heat: r => cellHeat(r.iso, 0.130, 0.175, true) },
  { key: "hr_fb_pct",   label: "HR/FB%", render: r => fmtPct(r.hr_fb_pct),     heat: r => cellHeat(r.hr_fb_pct, 8, 13, true) },
  { key: "woba",         label: "wOBA",   render: r => fmtBa(r.woba),           heat: r => cellHeat(r.woba, 0.295, 0.330, true) },
  { key: "slg",          label: "SLG",    render: r => fmtBa(r.slg),            heat: r => cellHeat(r.slg, 0.350, 0.420, true) },
  { key: "barrel_pct",   label: "Brl%",   render: r => fmtPct(r.barrel_pct),    heat: r => cellHeat(r.barrel_pct, 5, 8, true) },
  { key: "hard_hit_pct", label: "HH%",    render: r => fmtPct(r.hard_hit_pct),  heat: r => cellHeat(r.hard_hit_pct, 30, 38, true) },
  { key: "fb_pct",       label: "FB%",    render: r => fmtPct(r.fb_pct),        heat: r => cellHeat(r.fb_pct, 28, 36, true) },
  { key: "baa",          label: "BAA",    render: r => fmtBa(r.baa),            heat: r => cellHeat(r.baa, 0.220, 0.260, true) },
  { key: "whip",         label: "WHIP",   render: r => fmtNum(r.whip),          heat: r => cellHeat(r.whip, 1.10, 1.35, true) },
  { key: "hr",           label: "HR",     render: r => String(r.hr) },
  { key: "bb_pct",       label: "BB%",    render: r => fmtPct(r.bb_pct),        heat: r => cellHeat(r.bb_pct, 6.5, 9.5, true) },
  { key: "k_pct",        label: "K%",     render: r => fmtPct(r.k_pct),         heat: r => cellHeat(r.k_pct, 20, 27) },
  { key: "whiff_pct",    label: "Whiff%", render: r => fmtPct(r.whiff_pct),     heat: r => cellHeat(r.whiff_pct, 22, 30) },
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
  const [windowKey, setWindowKey] = useState<Window>("season");
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
        if (profile) {
          // Window selector overrides the L/R split — windows are overall only.
          // Falls back to season if the window data isn't available.
          if (windowKey !== "season") {
            row = profile.windows?.[windowKey] ?? profile.rows?.season ?? null;
          } else if (profile.rows) {
            row = split === "vs_L" ? profile.rows.vs_L
                : split === "vs_R" ? profile.rows.vs_R
                : profile.rows.season;
          }
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
  }, [games, split, windowKey, sortKey, sortDir]);

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

  const WINDOWS: { key: Window; label: string }[] = [
    { key: "season",  label: "Season" },
    { key: "last_10", label: "Last 10" },
    { key: "last_7",  label: "Last 7" },
    { key: "last_5",  label: "Last 5" },
    { key: "last_3",  label: "Last 3" },
    { key: "last_1",  label: "Last 1" },
  ];

  // Selecting a non-season window forces the L/R split back to season (the
  // window stats are overall only — we don't compute L/R splits per window).
  const onWindowChange = (k: Window) => {
    setWindowKey(k);
    if (k !== "season") setSplit("season");
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Window selector — Season / Last N starts (overall, no L/R) */}
        <div className="flex items-center gap-1">
          {WINDOWS.map(w => (
            <button
              key={w.key}
              onClick={() => onWindowChange(w.key)}
              className={
                "px-3 py-1.5 text-[12px] font-semibold rounded-[var(--radius-md)] cursor-pointer transition-colors " +
                (windowKey === w.key
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "bg-transparent text-muted border border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]")
              }
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* Split toggle — disabled when a Last-N window is active */}
        <div className="flex items-center gap-1">
          {SPLITS.map(s => {
            const disabled = windowKey !== "season";
            return (
              <button
                key={s.key}
                onClick={() => !disabled && setSplit(s.key)}
                disabled={disabled}
                title={disabled ? "L/R splits unavailable inside Last N windows" : undefined}
                className={
                  "px-3 py-1.5 text-[12px] font-semibold rounded-[var(--radius-md)] transition-colors " +
                  (disabled
                    ? "bg-transparent text-foreground/30 border border-[#2c2c2e] cursor-not-allowed"
                    : split === s.key
                      ? "bg-accent/15 text-accent border border-accent/40 cursor-pointer"
                      : "bg-transparent text-muted border border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e] cursor-pointer")
                }
              >
                {s.label}
              </button>
            );
          })}
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
                      <td key={col.key} className="text-center px-1.5 py-1.5">
                        <div className="px-2 py-1.5 text-center rounded" style={{ color: "var(--muted)" }}>{DASH}</div>
                      </td>
                    );
                  }
                  const val = col.render(entry.row);
                  const heat = col.heat ? col.heat(entry.row) : null;
                  return (
                    <td key={col.key} className="text-center px-1.5 py-1.5">
                      <div
                        className="px-2 py-1.5 text-center rounded text-xs font-mono"
                        style={heat ? { ...HEAT_BG[heat], borderRadius: 5 } : { color: "rgba(255,255,255,0.55)" }}
                      >
                        {val}
                      </div>
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
