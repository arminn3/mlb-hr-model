"use client";

import { useState } from "react";
import type { PlayerData, LookbackKey, PitchDetailEntry } from "./types";
import { teamLogoUrl, teamName } from "./game-header";

type SortCol = "score" | "ev" | "barrel" | "hh" | "gb" | "ld" | "fb" | "hrfb";
type SortDir = "desc" | "asc";

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(v: number): string {
  if (v >= 0.70) return "text-accent-green";
  if (v >= 0.50) return "text-accent-yellow";
  return "text-muted";
}

function statColor(value: number, lo: number, hi: number): string {
  if (value >= hi) return "text-accent-green font-semibold";
  if (value >= lo) return "text-foreground";
  return "text-muted";
}

function matchupPill(pitchDetail: Record<string, PitchDetailEntry>): { label: string; style: React.CSSProperties } {
  const entries = Object.entries(pitchDetail).filter(([, d]) => (d.usage_pct ?? 0) >= 12);
  if (!entries.length) return { label: "—", style: {} };
  let totalUsage = 0, weighted = 0;
  for (const [, d] of entries) {
    const u = (d.usage_pct ?? 0) / 100;
    const b = d.barrel_rate ?? 0;
    const e = d.avg_exit_velo ?? 88;
    weighted += u * (0.65 * Math.min(b / 25, 1) + 0.35 * Math.max(0, Math.min((e - 85) / 20, 1)));
    totalUsage += u;
  }
  const score = totalUsage > 0 ? weighted / totalUsage : 0.5;
  if (score >= 0.45) return {
    label: "GREAT",
    style: { background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--accent-green)" },
  };
  if (score >= 0.25) return {
    label: "DECENT",
    style: { background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)", color: "var(--accent-yellow)" },
  };
  return {
    label: "TOUGH",
    style: { background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.20)", color: "rgba(248,113,113,0.8)" },
  };
}

// ── BatterRow ────────────────────────────────────────────────────────────────

export type BatterRowInfo = { p: PlayerData; order: number | null; mlbId?: number };

export function BatterRow({
  row,
  lookback,
  posted,
  onSelect,
}: {
  row: BatterRowInfo;
  lookback: LookbackKey;
  posted: boolean;
  onSelect: () => void;
}) {
  const { p, order, mlbId } = row;
  const scores = p.scores[lookback] || p.scores.L5;

  const recentAbs = scores.recent_abs ?? [];
  const flyBalls  = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrCount   = recentAbs.filter((ab) => ab.result === "home_run").length;
  const hrFbPct   = flyBalls.length > 0 ? (hrCount / flyBalls.length) * 100 : null;

  const pill = matchupPill(p.pitch_detail || {});
  const isLowData = scores.recent_abs.length <= 2;
  const hasQualityWarn = !isLowData && scores.data_quality !== "OK";

  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="group cursor-pointer transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      {/* Order */}
      <td className="py-2.5 pl-4 pr-2 w-8 text-center">
        {posted && order !== null ? (
          <span className="text-xs font-bold text-accent font-mono">{order}</span>
        ) : (
          <span className="text-[10px] text-muted/30">—</span>
        )}
      </td>

      {/* Player */}
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2.5">
          {mlbId ? (
            <img
              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
              alt={p.name}
              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.06)" }}
              loading="lazy"
            />
          ) : (
            <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground leading-tight whitespace-nowrap">{p.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] font-mono text-muted/60">{p.batter_hand}HB</span>
              {isLowData && (
                <span className="px-1 py-0 text-[8px] font-bold rounded bg-accent/10 text-accent border border-accent/20">NEW</span>
              )}
              {hasQualityWarn && (
                <span className="px-1 py-0 text-[8px] rounded bg-accent-yellow/10 text-accent-yellow">
                  {scores.data_quality === "LOW_SAMPLE" ? "SMALL" : "P-SAMPLE"}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Score */}
      <td className="py-2.5 pr-4 w-24">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(scores.composite * 100)}%`,
                background: scores.composite >= 0.70
                  ? "var(--accent-green)"
                  : scores.composite >= 0.50
                  ? "var(--accent-yellow)"
                  : "rgba(255,255,255,0.25)",
              }}
            />
          </div>
          <span className={`text-xs font-mono font-bold w-10 text-right flex-shrink-0 ${scoreColor(scores.composite)}`}>
            {scores.composite.toFixed(2)}
          </span>
        </div>
      </td>

      {/* Pitch matchup */}
      <td className="py-2.5 pr-4 w-20">
        <span
          className="inline-block px-2 py-0.5 text-[9px] font-bold rounded-full uppercase tracking-wider"
          style={pill.style}
        >
          {pill.label}
        </span>
      </td>

      {/* Stats */}
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.exit_velo, 88, 93)}`}>{scores.exit_velo}</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.barrel_pct, 8, 15)}`}>{scores.barrel_pct}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.hard_hit_pct, 35, 50)}`}>{scores.hard_hit_pct}%</span>
      </td>
      {/* Contact breakdown: GB / LD / FB */}
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className="text-xs font-mono text-muted">{scores.gb_pct ?? "—"}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className="text-xs font-mono text-muted">{scores.ld_pct ?? "—"}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.fb_pct, 25, 40)}`}>{scores.fb_pct}%</span>
      </td>
      <td className="py-2.5 pr-4 w-16 text-center">
        <span className={`text-xs font-mono ${hrFbPct == null ? "text-muted" : statColor(hrFbPct, 10, 18)}`}>
          {hrFbPct == null ? "—" : `${hrFbPct.toFixed(0)}%`}
        </span>
      </td>

      {/* Chevron */}
      <td className="py-2.5 pr-3 w-6">
        <svg className="w-3.5 h-3.5 text-muted/30 group-hover:text-muted/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </td>
    </tr>
  );
}

// ── BatterTable ──────────────────────────────────────────────────────────────

function SortTh({
  label, col, active, dir, onClick, className,
}: {
  label: string; col: SortCol; active: SortCol; dir: SortDir;
  onClick: (c: SortCol) => void; className?: string;
}) {
  const isActive = active === col;
  return (
    <th
      onClick={() => onClick(col)}
      className={`py-2 text-[9px] uppercase tracking-widest font-semibold cursor-pointer select-none transition-colors ${isActive ? "text-accent" : "text-muted/50 hover:text-muted"} ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {isActive && (
          <svg className="w-2.5 h-2.5 flex-shrink-0" fill="currentColor" viewBox="0 0 10 10">
            {dir === "desc"
              ? <path d="M5 7L1 3h8z" />
              : <path d="M5 3l4 4H1z" />}
          </svg>
        )}
      </span>
    </th>
  );
}

export function BatterTable({
  teamAbbr,
  batters,
  lookback,
  posted,
  onSelect,
}: {
  teamAbbr: string;
  batters: BatterRowInfo[];
  lookback: LookbackKey;
  posted: boolean;
  onSelect: (row: BatterRowInfo) => void;
}) {
  const [sortCol, setSortCol] = useState<SortCol>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (batters.length === 0) return null;

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  function getVal(row: BatterRowInfo): number {
    const sc = row.p.scores[lookback] || row.p.scores.L5;
    const recentAbs = sc.recent_abs ?? [];
    const fbs = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
    const hrs = recentAbs.filter((ab) => ab.result === "home_run").length;
    switch (sortCol) {
      case "score":  return sc.composite ?? 0;
      case "ev":     return sc.exit_velo ?? 0;
      case "barrel": return sc.barrel_pct ?? 0;
      case "hh":     return sc.hard_hit_pct ?? 0;
      case "gb":     return sc.gb_pct ?? 0;
      case "ld":     return sc.ld_pct ?? 0;
      case "fb":     return sc.fb_pct ?? 0;
      case "hrfb":   return fbs.length > 0 ? (hrs / fbs.length) * 100 : -1;
      default:       return 0;
    }
  }

  const sorted = [...batters].sort((a, b) => {
    const diff = getVal(a) - getVal(b);
    return sortDir === "desc" ? -diff : diff;
  });

  const thCls = (col: SortCol, extra: string) =>
    `pr-3 w-14 text-center ${extra}`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Team header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}
      >
        <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-7 h-7 object-contain" />
        <span className="font-bold text-foreground text-base">{teamName(teamAbbr)}</span>
        <span className="text-xs text-muted/60 ml-auto">{batters.length} batters</span>
        {!posted && (
          <span className="text-[9px] text-muted/40 uppercase tracking-wider">projected order</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <th className="py-2 pl-4 pr-2 text-[9px] uppercase tracking-widest text-muted/50 font-semibold text-center w-8">#</th>
              <th className="py-2 pr-4 text-[9px] uppercase tracking-widest text-muted/50 font-semibold text-left">Player</th>
              <SortTh label="Score"  col="score"  active={sortCol} dir={sortDir} onClick={handleSort} className="pr-4 w-24 text-left" />
              <th className="py-2 pr-4 text-[9px] uppercase tracking-widest text-muted/50 font-semibold text-left w-20">Pitch</th>
              <SortTh label="EV"     col="ev"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("ev", "")} />
              <SortTh label="Brl%"   col="barrel" active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("barrel", "")} />
              <SortTh label="HH%"    col="hh"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("hh", "")} />
              <SortTh label="GB%"    col="gb"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("gb", "")} />
              <SortTh label="LD%"    col="ld"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("ld", "")} />
              <SortTh label="FB%"    col="fb"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("fb", "")} />
              <SortTh label="HR/FB"  col="hrfb"   active={sortCol} dir={sortDir} onClick={handleSort} className="pr-4 w-16 text-center" />
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <BatterRow
                key={row.p.name}
                row={row}
                lookback={lookback}
                posted={posted}
                onSelect={() => onSelect(row)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
