"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  GameData,
  PAHistoryEntry,
  TeamPitchMixBatter,
  TeamPitchMixSide,
} from "./types";
import {
  TABLE_BG,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
  tableClass,
  tableWrapperClass,
  tableWrapperStyle,
} from "./table-styles";
import { Chip } from "./ui/chip";

// Human-readable pitch type names.
const PITCH_NAMES: Record<string, string> = {
  FF: "Four-seam FB", FT: "Two-seam FB", SI: "Sinker", FC: "Cutter",
  SL: "Slider", ST: "Sweeper", SV: "Slurve", CU: "Curveball",
  KC: "Knuckle Curve", CS: "Slow Curve", CH: "Changeup", FS: "Splitter",
  FO: "Forkball", KN: "Knuckleball", EP: "Eephus", SC: "Screwball",
};

type RangeChoice = "Season" | "L5" | "L10" | "L15" | "L20" | "L25";
type TypeChoice = "Games" | "Plate Appearances" | "Batted Ball Events";
type HandFilter = "all" | "R" | "L";

interface Filter {
  season: number;
  range: RangeChoice;
  type: TypeChoice;
  pitcherHand: HandFilter;
  selectedPitchTypes: Set<string>;
  startersOnly: boolean;
}

interface RowStats {
  PA: number;
  AB: number;
  H: number;
  HR: number;
  BB: number;
  K: number;
  TB: number;
  HBP: number;
  SF: number;
  BBE: number;
  BARRELS: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  iso: number | null;
  woba: number | null;
  k_pct: number | null;
  bb_pct: number | null;
  avg_ev: number | null;
  barrel_pct: number | null;
  hh_pct: number | null;   // hard-hit % of BBE
  la_ss_pct: number | null; // sweet-spot LA% of BBE (8°-32°)
  bat_spd: number | null;   // avg bat speed (mph) across rows where measured
  fb_pct: number | null;    // fly-ball % of BBE (LA 25°-50°)
}

// ── Aggregation ─────────────────────────────────────────────────────────
const HIT_RESULTS = new Set(["single", "double", "triple", "home_run"]);
const NON_AB_RESULTS = new Set([
  "walk", "hit_by_pitch", "sac_fly", "sac_bunt",
  "intent_walk", "catcher_interf", "sac_fly_double_play",
]);
const K_RESULTS = new Set(["strikeout", "strikeout_double_play"]);

function applyRangeType(
  sorted: PAHistoryEntry[], range: RangeChoice, type: TypeChoice,
): PAHistoryEntry[] {
  if (range === "Season") return sorted;
  const n = parseInt(range.slice(1), 10);
  if (type === "Games") {
    const dates: string[] = [];
    const seen = new Set<string>();
    for (const r of sorted) {
      if (!seen.has(r.date)) { seen.add(r.date); dates.push(r.date); }
      if (dates.length >= n) break;
    }
    const keep = new Set(dates);
    return sorted.filter((r) => keep.has(r.date));
  }
  if (type === "Batted Ball Events") {
    const out: PAHistoryEntry[] = [];
    for (const r of sorted) {
      if (r.is_bbe) out.push(r);
      if (out.length >= n) break;
    }
    return out;
  }
  // Plate Appearances
  return sorted.slice(0, n);
}

function aggregate(history: PAHistoryEntry[], filter: Filter): RowStats {
  // Backend delivers rows already sorted newest-first by (game_date,
  // at_bat_number). Preserve that order — re-sorting by date alone loses
  // within-day chronology and can produce non-deterministic L{N} PA subsets.
  const filtered = history
    .filter((r) => r.season === filter.season)
    .filter(
      (r) =>
        filter.pitcherHand === "all" ||
        r.pitcher_hand === filter.pitcherHand,
    )
    .filter(
      (r) =>
        filter.selectedPitchTypes.size === 0 ||
        (r.pitch_type !== null && filter.selectedPitchTypes.has(r.pitch_type)),
    );
  const limited = applyRangeType(filtered, filter.range, filter.type);

  const PA = limited.length;
  const H = limited.filter((r) => HIT_RESULTS.has(r.result)).length;
  const AB = limited.filter((r) => !NON_AB_RESULTS.has(r.result)).length;
  const BB = limited.filter((r) => r.result === "walk" || r.result === "intent_walk").length;
  const HBP = limited.filter((r) => r.result === "hit_by_pitch").length;
  const SF = limited.filter((r) => r.result === "sac_fly" || r.result === "sac_fly_double_play").length;
  const HR = limited.filter((r) => r.result === "home_run").length;
  const K = limited.filter((r) => K_RESULTS.has(r.result)).length;
  const TB = limited.reduce((s, r) => s + r.bases, 0);
  const bbe = limited.filter((r) => r.is_bbe);
  const BARRELS = bbe.filter((r) => r.is_barrel).length;
  const HARD_HITS = bbe.filter((r) => r.is_hard_hit).length;
  const SS_HITS = bbe.filter((r) => r.la !== null && r.la >= 8 && r.la <= 32).length;
  const FB_HITS = bbe.filter((r) => r.la !== null && r.la >= 25 && r.la <= 50).length;
  const wobaSum = limited.reduce((s, r) => s + (r.woba_value ?? 0), 0);
  const wobaDenom = AB + BB + HBP + SF;
  // Bat speed: use swings where measured (2023+ Statcast). Approximate by
  // taking bbe rows with bat_speed populated.
  const bs = limited.filter((r) => r.bat_speed !== null && r.bat_speed > 0);

  return {
    PA, AB, H, HR, BB, K, TB, HBP, SF,
    BBE: bbe.length, BARRELS,
    avg: AB >= 3 ? H / AB : null,
    obp: wobaDenom >= 3 ? (H + BB + HBP) / wobaDenom : null,
    slg: AB >= 3 ? TB / AB : null,
    iso: AB >= 3 ? (TB - H) / AB : null,
    woba: wobaDenom >= 3 ? wobaSum / wobaDenom : null,
    k_pct: PA >= 3 ? K / PA : null,
    bb_pct: PA >= 3 ? BB / PA : null,
    avg_ev: bbe.length >= 2 ? bbe.reduce((s, r) => s + (r.ev ?? 0), 0) / bbe.length : null,
    barrel_pct: bbe.length >= 2 ? BARRELS / bbe.length : null,
    hh_pct: bbe.length >= 2 ? HARD_HITS / bbe.length : null,
    la_ss_pct: bbe.length >= 2 ? SS_HITS / bbe.length : null,
    bat_spd: bs.length >= 2 ? bs.reduce((s, r) => s + (r.bat_speed ?? 0), 0) / bs.length : null,
    fb_pct: bbe.length >= 2 ? FB_HITS / bbe.length : null,
  };
}

// ── Heat-map coloring ───────────────────────────────────────────────────
// Returns a color hex or null (for neutral white text).
function heat(value: number | null, lo: number, hi: number, invert = false): string | null {
  if (value === null || !isFinite(value)) return null;
  const low = invert ? hi : lo;
  const high = invert ? lo : hi;
  if (value >= high) return "#22c55e";   // green
  if (value <= low) return "#ef4444";    // red
  return null;
}

function heatStyle(color: string | null): React.CSSProperties {
  if (!color) return { color: "#ffffff" };
  // Tinted background like PropFinder
  return {
    color,
    backgroundColor: color + "22",
    fontWeight: 600,
  };
}

// ── Formatters ──────────────────────────────────────────────────────────
const fmt3 = (v: number | null) => (v === null ? "—" : v.toFixed(3).replace(/^0/, ""));
const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
const fmtInt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));

// ── Switch-hitter routing: bat opposite pitcher hand ────────────────────
function effectiveHand(batter: TeamPitchMixBatter, pitcherHand: string): "R" | "L" {
  const h = (batter.batter_hand || "R").toUpperCase();
  if (h === "S") return pitcherHand.toUpperCase() === "R" ? "L" : "R";
  return h === "L" ? "L" : "R";
}

// ── Pitch-mix pill row ──────────────────────────────────────────────────
function PitchMixPills({
  mix, selected, onToggle,
}: {
  mix: Record<string, number>;
  selected: Set<string>;
  onToggle: (pt: string) => void;
}) {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {entries.map(([pt, usage]) => (
        <Chip
          key={pt}
          size="sm"
          selected={selected.has(pt)}
          onClick={() => onToggle(pt)}
        >
          {PITCH_NAMES[pt] || pt} {(usage * 100).toFixed(0)}%
        </Chip>
      ))}
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────
// Compact density overrides — tighter than the default table-styles.ts so
// more fits on screen without horizontal scroll.
const compactCell = "py-1.5 px-2 text-[12px] font-medium whitespace-nowrap border-b border-r";
const compactHeader = "py-1.5 px-2 text-[11px] font-medium whitespace-nowrap border-b border-r select-none";

type SortKey =
  | "name" | "PA" | "avg" | "obp" | "slg" | "iso" | "woba"
  | "k_pct" | "bb_pct" | "HR" | "avg_ev" | "barrel_pct"
  | "hh_pct" | "la_ss_pct" | "bat_spd" | "fb_pct";

const COLS: ReadonlyArray<{
  key: SortKey | "hab";
  label: string;
  align: string;
  w: string;
  sortable: boolean;
}> = [
  { key: "name", label: "Player", align: "text-left", w: "min-w-[160px]", sortable: true },
  { key: "PA", label: "PA", align: "text-right", w: "w-10", sortable: true },
  { key: "hab", label: "H-AB", align: "text-right", w: "w-14", sortable: false },
  { key: "avg", label: "Avg", align: "text-right", w: "w-12", sortable: true },
  { key: "obp", label: "OBP", align: "text-right", w: "w-12", sortable: true },
  { key: "slg", label: "Slg", align: "text-right", w: "w-12", sortable: true },
  { key: "iso", label: "Iso", align: "text-right", w: "w-12", sortable: true },
  { key: "woba", label: "wOBA", align: "text-right", w: "w-14", sortable: true },
  { key: "k_pct", label: "K%", align: "text-right", w: "w-12", sortable: true },
  { key: "bb_pct", label: "BB%", align: "text-right", w: "w-12", sortable: true },
  { key: "HR", label: "HR", align: "text-right", w: "w-10", sortable: true },
  { key: "avg_ev", label: "Avg EV", align: "text-right", w: "w-14", sortable: true },
  { key: "barrel_pct", label: "Barrel%", align: "text-right", w: "w-16", sortable: true },
  { key: "hh_pct", label: "HH%", align: "text-right", w: "w-14", sortable: true },
  { key: "la_ss_pct", label: "LA SS%", align: "text-right", w: "w-14", sortable: true },
  { key: "bat_spd", label: "Bat Spd", align: "text-right", w: "w-14", sortable: true },
  { key: "fb_pct", label: "FB%", align: "text-right", w: "w-12", sortable: true },
];

// MLB headshot CDN. Falls back to a generic silhouette if the ID is unknown.
function headshotUrl(id: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
}

function PlayerRow({
  batter, stats,
}: {
  batter: TeamPitchMixBatter;
  stats: RowStats;
}) {
  const hab = stats.AB > 0 ? `${stats.H}-${stats.AB}` : "—";

  return (
    <tr>
      <td className={compactCell} style={cellStyle}>
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headshotUrl(batter.id)}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
            className="w-7 h-7 rounded-full shrink-0 bg-[var(--surface-2)] object-cover"
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-semibold text-white truncate">{batter.name}</span>
            <span className="text-[10px] text-muted">{batter.pos || "—"} | {batter.batter_hand}HB</span>
          </div>
        </div>
      </td>
      <td className={compactCell + " text-right font-mono text-white"} style={cellStyle}>{stats.PA}</td>
      <td className={compactCell + " text-right font-mono text-muted"} style={cellStyle}>{hab}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.avg, 0.220, 0.290)) }}>{fmt3(stats.avg)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.obp, 0.290, 0.350)) }}>{fmt3(stats.obp)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.slg, 0.360, 0.460)) }}>{fmt3(stats.slg)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.iso, 0.130, 0.200)) }}>{fmt3(stats.iso)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.woba, 0.300, 0.360)) }}>{fmt3(stats.woba)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.k_pct, 0.20, 0.28, true)) }}>{fmtPct(stats.k_pct)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.bb_pct, 0.06, 0.12)) }}>{fmtPct(stats.bb_pct)}</td>
      <td className={compactCell + " text-right font-mono text-white"} style={cellStyle}>{stats.HR > 0 ? stats.HR : "—"}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.avg_ev, 88, 93)) }}>{fmtNum(stats.avg_ev, 1)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.barrel_pct, 0.06, 0.12)) }}>{fmtPct(stats.barrel_pct)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.hh_pct, 0.30, 0.45)) }}>{fmtPct(stats.hh_pct)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.la_ss_pct, 0.28, 0.38)) }}>{fmtPct(stats.la_ss_pct)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.bat_spd, 68, 73)) }}>{fmtNum(stats.bat_spd, 1)}</td>
      <td className={compactCell + " text-right font-mono"} style={{ ...cellStyle, ...heatStyle(heat(stats.fb_pct, 0.25, 0.40)) }}>{fmtPct(stats.fb_pct)}</td>
    </tr>
  );
}

function SideTable({
  title, pitchMix, batters, filter, onTogglePitchType,
  sortKey, sortDir, onSort,
}: {
  title: string;
  pitchMix: Record<string, number>;
  batters: Array<{ batter: TeamPitchMixBatter; stats: RowStats }>;
  filter: Filter;
  onTogglePitchType: (pt: string) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const topPitches = Object.entries(pitchMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pt]) => PITCH_NAMES[pt] || pt)
    .join(", ");

  // Team totals row (weighted by PA/BBE across displayed batters)
  const totals = batters.reduce(
    (acc, { stats }) => {
      acc.PA += stats.PA; acc.AB += stats.AB; acc.H += stats.H;
      acc.HR += stats.HR; acc.BB += stats.BB; acc.K += stats.K;
      acc.TB += stats.TB; acc.HBP += stats.HBP; acc.SF += stats.SF;
      acc.BBE += stats.BBE; acc.BARRELS += stats.BARRELS;
      acc.evSum += (stats.avg_ev ?? 0) * stats.BBE;
      acc.hhSum += (stats.hh_pct ?? 0) * stats.BBE;
      acc.ssSum += (stats.la_ss_pct ?? 0) * stats.BBE;
      acc.fbSum += (stats.fb_pct ?? 0) * stats.BBE;
      if (stats.bat_spd !== null) {
        acc.spdSum += stats.bat_spd * stats.BBE;
        acc.spdBBE += stats.BBE;
      }
      return acc;
    },
    { PA: 0, AB: 0, H: 0, HR: 0, BB: 0, K: 0, TB: 0, HBP: 0, SF: 0, BBE: 0,
      BARRELS: 0, evSum: 0, hhSum: 0, ssSum: 0, fbSum: 0, spdSum: 0, spdBBE: 0 },
  );
  const tDenom = totals.AB + totals.BB + totals.HBP + totals.SF;
  const totalStats: RowStats = {
    PA: totals.PA, AB: totals.AB, H: totals.H, HR: totals.HR, BB: totals.BB, K: totals.K,
    TB: totals.TB, HBP: totals.HBP, SF: totals.SF, BBE: totals.BBE, BARRELS: totals.BARRELS,
    avg: totals.AB >= 3 ? totals.H / totals.AB : null,
    obp: tDenom >= 3 ? (totals.H + totals.BB + totals.HBP) / tDenom : null,
    slg: totals.AB >= 3 ? totals.TB / totals.AB : null,
    iso: totals.AB >= 3 ? (totals.TB - totals.H) / totals.AB : null,
    woba: null,
    k_pct: totals.PA >= 3 ? totals.K / totals.PA : null,
    bb_pct: totals.PA >= 3 ? totals.BB / totals.PA : null,
    avg_ev: totals.BBE >= 2 ? totals.evSum / totals.BBE : null,
    barrel_pct: totals.BBE >= 2 ? totals.BARRELS / totals.BBE : null,
    hh_pct: totals.BBE >= 2 ? totals.hhSum / totals.BBE : null,
    la_ss_pct: totals.BBE >= 2 ? totals.ssSum / totals.BBE : null,
    bat_spd: totals.spdBBE >= 2 ? totals.spdSum / totals.spdBBE : null,
    fb_pct: totals.BBE >= 2 ? totals.fbSum / totals.BBE : null,
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 text-[12px] font-semibold text-foreground">
        <span>{title}</span>
        {topPitches && <span className="text-muted font-normal">· {topPitches}</span>}
      </div>
      <PitchMixPills mix={pitchMix} selected={filter.selectedPitchTypes} onToggle={onTogglePitchType} />
      <div className={tableWrapperClass} style={tableWrapperStyle}>
        <table className={tableClass}>
          <thead>
            <tr>
              {COLS.map((c) => {
                const isSorted = c.sortable && c.key === sortKey;
                const indicator = isSorted ? (sortDir === "desc" ? " ↓" : " ↑") : "";
                return (
                  <th
                    key={c.key}
                    className={
                      compactHeader + " " + c.align + " " + c.w +
                      " " + (c.sortable ? "cursor-pointer" : "") +
                      " " + (isSorted ? "text-accent" : "text-muted")
                    }
                    style={headerCellStyle}
                    onClick={() => c.sortable && onSort(c.key as SortKey)}
                  >
                    {c.label}{indicator}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {batters.length === 0 && (
              <tr>
                <td className={compactCell + " text-center text-muted"} colSpan={COLS.length} style={cellStyle}>
                  No PA history on file for any batter in the {title.toLowerCase()} under current filters.
                </td>
              </tr>
            )}
            {batters.map(({ batter, stats }) => (
              <PlayerRow key={batter.id} batter={batter} stats={stats} />
            ))}
            {batters.length > 0 && (
              <tr className="border-t-2" style={{ borderColor: "#3a3a3e" }}>
                <td className={compactCell} style={cellStyle}>
                  <span className="font-semibold text-muted">
                    {title.toLowerCase().startsWith("vs rhb") ? "RHB Avg" : "LHB Avg"}
                  </span>
                </td>
                <td className={compactCell + " text-right font-mono text-muted"} style={cellStyle}>{totalStats.PA}</td>
                <td className={compactCell + " text-right font-mono text-muted"} style={cellStyle}>{totalStats.H}-{totalStats.AB}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmt3(totalStats.avg)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmt3(totalStats.obp)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmt3(totalStats.slg)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmt3(totalStats.iso)}</td>
                <td className={compactCell + " text-right font-mono text-muted"} style={cellStyle}>—</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.k_pct)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.bb_pct)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{totalStats.HR > 0 ? totalStats.HR : "—"}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtNum(totalStats.avg_ev, 1)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.barrel_pct)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.hh_pct)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.la_ss_pct)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtNum(totalStats.bat_spd, 1)}</td>
                <td className={compactCell + " text-right font-mono"} style={cellStyle}>{fmtPct(totalStats.fb_pct)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dropdown primitive ──────────────────────────────────────────────────
function Select<T extends string | number>({
  label, value, options, onChange, format,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase text-muted tracking-[0.06em]">
      <span>{label}</span>
      <select
        value={value as string}
        onChange={(e) => onChange((e.target.value as unknown) as T)}
        className="h-8 px-2 min-w-[140px] rounded-[var(--radius-md)] text-foreground text-[13px] cursor-pointer"
        style={{ background: "#1c1c1e", border: "1px solid #3a3a3e" }}
      >
        {options.map((o) => (
          <option key={String(o)} value={o as string}>{format ? format(o) : String(o)}</option>
        ))}
      </select>
    </label>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export function TeamPitchMixPage({ games }: { games: GameData[] }) {
  // Memoize so the array reference is stable across renders — otherwise
  // the auto-select useEffect below fires after every click and resets
  // the user's manual pitch-pill toggles.
  const gamesWithData = useMemo(() => games.filter((g) => g.team_pitch_mix), [games]);

  // Initial selection: first game, away team
  const [gameIdx, setGameIdx] = useState(0);
  const [side, setSide] = useState<"away" | "home">("away");
  const [season, setSeason] = useState<number>(2026);
  const [range, setRange] = useState<RangeChoice>("Season");
  const [type, setType] = useState<TypeChoice>("Plate Appearances");
  const [pitcherHand, setPitcherHand] = useState<HandFilter>("all");
  const [startersOnly, setStartersOnly] = useState(true);
  // Pitch-type chips are independent per hand: RHB section's selection
  // does NOT affect LHB stats, and vice versa. Same pitcher usually throws
  // a different mix to each hand, so a "FF" pick vs RHBs shouldn't fold
  // LHBs' FF performance into the table either.
  const [selectedPitchTypesRhb, setSelectedPitchTypesRhb] = useState<Set<string>>(new Set());
  const [selectedPitchTypesLhb, setSelectedPitchTypesLhb] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("fb_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  // Reset game index if it overflows
  useEffect(() => {
    if (gameIdx >= gamesWithData.length) setGameIdx(0);
  }, [gamesWithData.length, gameIdx]);

  // Auto-select pitch-type pills ≥12% usage whenever the game or side
  // changes. Pills below the threshold still appear but start unselected.
  // Each hand's pills are seeded from its OWN pitch mix so the two
  // sections start in sync with the pitcher's actual usage against that hand.
  const PITCH_AUTOSELECT_THRESHOLD = 0.12;
  useEffect(() => {
    const g = gamesWithData[gameIdx];
    if (!g || !g.team_pitch_mix) return;
    const p = g.team_pitch_mix[side].pitcher;
    const pickRhb = new Set<string>();
    for (const [pt, u] of Object.entries(p.pitch_mix_vs_rhb || {})) {
      if (u >= PITCH_AUTOSELECT_THRESHOLD) pickRhb.add(pt);
    }
    const pickLhb = new Set<string>();
    for (const [pt, u] of Object.entries(p.pitch_mix_vs_lhb || {})) {
      if (u >= PITCH_AUTOSELECT_THRESHOLD) pickLhb.add(pt);
    }
    setSelectedPitchTypesRhb(pickRhb);
    setSelectedPitchTypesLhb(pickLhb);
    // Default the pitcher-hand filter to match today's starter. "vs All"
    // would fold the opposite-platoon history into the table and dilute
    // the matchup signal — not what anyone actually wants by default.
    const h = (p.hand || "").toUpperCase();
    setPitcherHand(h === "R" ? "R" : h === "L" ? "L" : "all");
  }, [gameIdx, side, gamesWithData]);

  if (gamesWithData.length === 0) {
    return (
      <div className="text-center text-muted py-12">
        <div className="text-lg font-semibold mb-2">No Team vs Pitch Mix data</div>
        <div className="text-sm">
          This tab needs slate data generated with the latest pipeline. Today&apos;s slate will populate on the next refresh.
        </div>
      </div>
    );
  }

  const game = gamesWithData[gameIdx];
  const tpm = game.team_pitch_mix!;
  const currentSide: TeamPitchMixSide = tpm[side];
  const pitcher = currentSide.pitcher;

  // Team display name: the batters we're viewing
  const viewingTeam = side === "away" ? game.away_team : game.home_team;
  const opposingTeam = side === "away" ? game.home_team : game.away_team;

  const rhbFilter: Filter = { season, range, type, pitcherHand, selectedPitchTypes: selectedPitchTypesRhb, startersOnly };
  const lhbFilter: Filter = { season, range, type, pitcherHand, selectedPitchTypes: selectedPitchTypesLhb, startersOnly };

  // Split batters into RHB and LHB tables. Each side aggregates with its
  // own pitch-type selection. Keep PA=0 batters visible — displaying them
  // with "—" is more honest than silently dropping them.
  const { rhbRows, lhbRows } = useMemo(() => {
    const rhb: Array<{ batter: TeamPitchMixBatter; stats: RowStats }> = [];
    const lhb: Array<{ batter: TeamPitchMixBatter; stats: RowStats }> = [];
    for (const b of currentSide.batters) {
      if (startersOnly && b.order === null) continue;
      const eff = effectiveHand(b, pitcher.hand);
      if (eff === "R") {
        rhb.push({ batter: b, stats: aggregate(b.pa_history, rhbFilter) });
      } else {
        lhb.push({ batter: b, stats: aggregate(b.pa_history, lhbFilter) });
      }
    }
    const dirMul = sortDir === "desc" ? -1 : 1;
    const cmp = (a: { batter: TeamPitchMixBatter; stats: RowStats },
                 b: { batter: TeamPitchMixBatter; stats: RowStats }) => {
      if (sortKey === "name") {
        return a.batter.name.localeCompare(b.batter.name) * dirMul;
      }
      const av = a.stats[sortKey] as number | null;
      const bv = b.stats[sortKey] as number | null;
      // Nulls sink to the bottom regardless of sortDir
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dirMul;
    };
    rhb.sort(cmp);
    lhb.sort(cmp);
    return { rhbRows: rhb, lhbRows: lhb };
  }, [currentSide, rhbFilter, lhbFilter, pitcher.hand, startersOnly, sortKey, sortDir]);

  const toggleRhbPitch = (pt: string) => {
    setSelectedPitchTypesRhb((prev) => {
      const next = new Set(prev);
      if (next.has(pt)) next.delete(pt); else next.add(pt);
      return next;
    });
  };
  const toggleLhbPitch = (pt: string) => {
    setSelectedPitchTypesLhb((prev) => {
      const next = new Set(prev);
      if (next.has(pt)) next.delete(pt); else next.add(pt);
      return next;
    });
  };

  const lineupBadge = {
    posted: { label: "Lineup Posted", color: "#22c55e" },
    projected: { label: "Projected Lineup", color: "#eab308" },
    tbd: { label: "Lineup TBD", color: "#ef4444" },
  }[currentSide.lineup_status];

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <Select
          label="Team"
          value={gameIdx + ":" + side}
          options={gamesWithData.flatMap((g, i) => [i + ":away", i + ":home"])}
          onChange={(v) => {
            const [gi, s] = v.split(":");
            setGameIdx(parseInt(gi, 10));
            setSide(s as "away" | "home");
            setSelectedPitchTypesRhb(new Set());
            setSelectedPitchTypesLhb(new Set());
          }}
          format={(v) => {
            const [gi, s] = (v as string).split(":");
            const g = gamesWithData[parseInt(gi, 10)];
            const team = s === "away" ? g.away_team : g.home_team;
            const opp = s === "away" ? `@ ${g.home_team}` : `vs ${g.away_team}`;
            const time = g.game_time ? ` ${g.game_time}` : "";
            return `${team}${time ? " —" + time : ""} ${opp}`;
          }}
        />
        <Select
          label="Season"
          value={season}
          options={[2026, 2025] as const}
          onChange={(v) => setSeason(Number(v))}
        />
        <Select
          label="Range"
          value={range}
          options={["Season", "L5", "L10", "L15", "L20", "L25"] as const}
          onChange={(v) => setRange(v as RangeChoice)}
        />
        <Select
          label="Type"
          value={type}
          options={["Games", "Plate Appearances", "Batted Ball Events"] as const}
          onChange={(v) => setType(v as TypeChoice)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase text-muted tracking-[0.06em]">Pitcher</span>
          <div className="flex gap-1 h-8">
            {(["all", "R", "L"] as const).map((h) => (
              <Chip
                key={h}
                size="sm"
                selected={pitcherHand === h}
                onClick={() => setPitcherHand(h)}
              >
                {h === "all" ? "vs All" : h === "R" ? "vs RHP" : "vs LHP"}
              </Chip>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={startersOnly}
            onChange={(e) => setStartersOnly(e.target.checked)}
            className="w-4 h-4 cursor-pointer accent-accent"
          />
          <span className="text-[13px] text-foreground">Starters Only</span>
        </label>
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-[var(--radius-md)]"
          style={{ background: lineupBadge.color + "22", color: lineupBadge.color }}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: lineupBadge.color }}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em]">{lineupBadge.label}</span>
        </div>
      </div>

      {/* Opposing pitcher context card */}
      <div
        className="mb-5 p-3 rounded-[var(--radius-md)] flex items-center gap-3"
        style={{ background: TABLE_BG, border: "1px solid #32333b" }}
      >
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] text-muted uppercase tracking-[0.06em]">Opposing Pitcher</span>
          <span className="text-[14px] font-semibold text-foreground">
            {pitcher.name}{" "}
            <span className="text-[11px] font-medium text-muted">({pitcher.hand}HP)</span>
          </span>
        </div>
        <div className="h-8 w-px" style={{ background: "#32333b" }} />
        <div className="text-[12px] text-muted">
          {viewingTeam} batters vs {opposingTeam}&apos;s starter.
        </div>
      </div>

      <SideTable
        title="vs RHB"
        pitchMix={pitcher.pitch_mix_vs_rhb}
        batters={rhbRows}
        filter={rhbFilter}
        onTogglePitchType={toggleRhbPitch}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
      />
      <SideTable
        title="vs LHB"
        pitchMix={pitcher.pitch_mix_vs_lhb}
        batters={lhbRows}
        filter={lhbFilter}
        onTogglePitchType={toggleLhbPitch}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
      />
    </div>
  );
}
