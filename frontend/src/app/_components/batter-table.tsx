"use client";

import { useState } from "react";
import type { PlayerData, PitchDetailEntry } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { teamLogoUrl, teamName } from "./game-header";

type SortCol = "score" | "pitch" | "ev" | "barrel" | "hh" | "fb" | "hrfb" | "xwoba" | "sweet" | "swstr" | "pullbrl" | "bip" | "gb" | "ld" | null;
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

function matchupScore(pitchDetail: Record<string, PitchDetailEntry>): number {
  const entries = Object.entries(pitchDetail).filter(([, d]) => (d.usage_pct ?? 0) >= 12);
  if (!entries.length) return 0.5;
  let totalUsage = 0, weighted = 0;
  for (const [, d] of entries) {
    const u = (d.usage_pct ?? 0) / 100;
    const b = d.barrel_rate ?? 0;
    const e = d.avg_exit_velo ?? 88;
    weighted += u * (0.65 * Math.min(b / 25, 1) + 0.35 * Math.max(0, Math.min((e - 85) / 20, 1)));
    totalUsage += u;
  }
  return totalUsage > 0 ? weighted / totalUsage : 0.5;
}

function matchupPill(score: number): { label: string; style: React.CSSProperties } {
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

// ── BatterMobileCard ─────────────────────────────────────────────────────────

export type BatterRowInfo = { p: PlayerData; order: number | null; mlbId?: number };

function BatterMobileCard({
  row,
  lookback,
  posted,
  onSelect,
  isFavorited,
  onToggleFavorite,
}: {
  row: BatterRowInfo;
  lookback: UILookback;
  posted: boolean;
  onSelect: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: (name: string) => void;
}) {
  const { p, order, mlbId } = row;
  const scores = scoreFor(p, lookback) ?? scoreFor(p, "L5")!;
  const mScore = matchupScore(p.pitch_detail || {});
  const pill = matchupPill(mScore);
  const isLowData = scores.recent_abs.length <= 2;
  const hasQualityWarn = !isLowData && scores.data_quality !== "OK";

  // HR signals summary
  const sig = p.hr_signals;
  const sigHit = sig
    ? [sig.barrel_heat, sig.pull_power, sig.drought?.triggered, sig.pitcher_vulnerable, sig.park_friendly].filter(Boolean).length
    : 0;
  const sigTotal = sig ? (sig.drought !== null ? 5 : 4) : 0;
  const sigGold = sigTotal > 0 && sigHit === sigTotal;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="px-3 py-3 cursor-pointer active:bg-white/[0.05]"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
    >
      {/* Top row: headshot + name + score */}
      <div className="flex items-center gap-2.5">
        {/* Order number */}
        {posted && order !== null && (
          <span className="text-[11px] font-bold text-accent/70 font-mono w-4 flex-shrink-0 text-center">{order}</span>
        )}

        {/* Headshot */}
        {mlbId ? (
          <img
            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
            alt={p.name}
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.06)" }}
            loading="lazy"
          />
        ) : (
          <div className="w-9 h-9 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />
        )}

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground leading-tight truncate">{p.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] font-mono text-muted/50">{p.batter_hand}HB</span>
            {isLowData && <span className="px-1 text-[8px] font-bold rounded bg-accent/10 text-accent border border-accent/20">NEW</span>}
            {hasQualityWarn && <span className="px-1 text-[8px] rounded bg-accent-yellow/10 text-accent-yellow">SMALL</span>}
            {/* Matchup pill */}
            <span className="inline-block px-1.5 py-0 text-[8px] font-bold rounded-full uppercase tracking-wider" style={pill.style}>{pill.label}</span>
          </div>
        </div>

        {/* Score + signal */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-base font-mono font-bold ${scoreColor(scores.composite)}`}>{scores.composite.toFixed(2)}</span>
          {sig && (
            <div className="flex items-center gap-0.5">
              {Array.from({ length: sigTotal }).map((_, i) => {
                const flags = sig ? [sig.barrel_heat, sig.pull_power, sig.drought?.triggered ?? false, sig.pitcher_vulnerable, sig.park_friendly] : [];
                const on = flags[i];
                return (
                  <span
                    key={i}
                    className="block rounded-full"
                    style={{
                      width: 5, height: 5,
                      background: on ? (sigGold ? "rgba(251,191,36,0.9)" : "rgba(74,222,128,0.85)") : "rgba(255,255,255,0.12)",
                    }}
                  />
                );
              })}
              {sigGold && <span className="text-amber-400 text-[9px] leading-none ml-0.5">★</span>}
            </div>
          )}
        </div>

        {/* Favorite star */}
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(p.name); }}
            className="ml-1 flex-shrink-0"
            aria-label={isFavorited ? "Remove" : "Add to picks"}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFavorited ? "var(--accent-yellow)" : "none"} stroke={isFavorited ? "var(--accent-yellow)" : "rgba(255,255,255,0.2)"} strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mt-2 ml-0 pl-[calc(0.625rem+2.25rem+0.625rem)]">
        <StatPair label="EV" value={`${scores.exit_velo}`} color={statColor(scores.exit_velo, 88, 93)} />
        <StatPair label="Brl" value={`${scores.barrel_pct}%`} color={statColor(scores.barrel_pct, 8, 15)} />
        <StatPair label="HH" value={`${scores.hard_hit_pct}%`} color={statColor(scores.hard_hit_pct, 35, 50)} />
        <StatPair label="FB" value={`${scores.fb_pct}%`} color={statColor(scores.fb_pct, 25, 40)} />
        {scores.xwoba != null && scores.xwoba > 0 && (
          <StatPair label="xwOBA" value={scores.xwoba.toFixed(3)} color={statColor(scores.xwoba, 0.32, 0.40)} />
        )}
      </div>
    </div>
  );
}

function StatPair({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[8px] uppercase tracking-widest text-muted/40 font-semibold">{label}</span>
      <span className={`text-[11px] font-mono font-semibold leading-tight ${color}`}>{value}</span>
    </div>
  );
}

// ── BatterRow ────────────────────────────────────────────────────────────────

export function BatterRow({
  row,
  lookback,
  posted,
  onSelect,
  isFavorited,
  onToggleFavorite,
}: {
  row: BatterRowInfo;
  lookback: UILookback;
  posted: boolean;
  onSelect: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: (name: string) => void;
}) {
  const { p, order, mlbId } = row;
  const scores = scoreFor(p, lookback) ?? scoreFor(p, "L5")!;

  const recentAbs = scores.recent_abs ?? [];
  const flyBalls  = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrCount   = recentAbs.filter((ab) => ab.result === "home_run").length;
  const hrFbPct   = flyBalls.length > 0 ? (hrCount / flyBalls.length) * 100 : null;

  const mScore = matchupScore(p.pitch_detail || {});
  const pill = matchupPill(mScore);
  const isLowData = scores.recent_abs.length <= 2;
  const hasQualityWarn = !isLowData && scores.data_quality !== "OK";

  const xwoba = scores.xwoba ?? null;
  const sweet = scores.sweet_spot ?? null;
  const swstr = scores.swstr ?? p.matchup_swstr ?? null;
  const pullBrl = scores.pull_brl ?? null;

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

      {/* Core stats */}
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.exit_velo, 88, 93)}`}>{scores.exit_velo}</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.barrel_pct, 8, 15)}`}>{scores.barrel_pct}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.hard_hit_pct, 35, 50)}`}>{scores.hard_hit_pct}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className={`text-xs font-mono ${statColor(scores.fb_pct, 25, 40)}`}>{scores.fb_pct}%</span>
      </td>
      <td className="py-2.5 pr-4 w-16 text-center">
        <span className={`text-xs font-mono ${hrFbPct == null ? "text-muted" : statColor(hrFbPct, 10, 18)}`}>
          {hrFbPct == null ? "—" : `${hrFbPct.toFixed(0)}%`}
        </span>
      </td>

      {/* Advanced / display-only columns */}
      <td className="py-2.5 pr-3 w-16 text-center">
        <span className={`text-xs font-mono ${xwoba == null ? "text-muted" : statColor(xwoba, 0.32, 0.40)}`}>
          {xwoba == null || xwoba === 0 ? "—" : xwoba.toFixed(3)}
        </span>
      </td>
      <td className="py-2.5 pr-3 w-16 text-center">
        <span className={`text-xs font-mono ${sweet == null ? "text-muted" : statColor(sweet, 35, 50)}`}>
          {sweet == null || sweet === 0 ? "—" : `${sweet.toFixed(1)}%`}
        </span>
      </td>
      <td className="py-2.5 pr-3 w-16 text-center">
        <span className={`text-xs font-mono ${swstr == null || swstr === 0 ? "text-muted" : statColor(100 - swstr, 60, 75)}`}>
          {swstr == null || swstr === 0 ? "—" : `${swstr.toFixed(1)}%`}
        </span>
      </td>
      <td className="py-2.5 pr-3 w-16 text-center">
        <span className={`text-xs font-mono ${pullBrl == null ? "text-muted" : statColor(pullBrl, 4, 8)}`}>
          {pullBrl == null || pullBrl === 0 ? "—" : `${pullBrl.toFixed(1)}%`}
        </span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        {(() => {
          const bip = scores.bip ?? p.season_profile?.bip_count ?? 0;
          return (
            <span className={`text-xs font-mono ${bip >= 50 ? "text-foreground" : bip >= 20 ? "text-accent-yellow" : "text-muted"}`}>
              {bip > 0 ? bip : "—"}
            </span>
          );
        })()}
      </td>

      {/* Contact shape (less important — at the end) */}
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className="text-xs font-mono text-muted">{scores.gb_pct ?? "—"}%</span>
      </td>
      <td className="py-2.5 pr-3 w-14 text-center">
        <span className="text-xs font-mono text-muted">{scores.ld_pct ?? "—"}%</span>
      </td>

      {/* Star / favorite */}
      <td className="py-2.5 pr-2 w-8 text-center">
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(row.p.name); }}
            className="cursor-pointer transition-transform hover:scale-110 active:scale-95"
            aria-label={isFavorited ? "Remove from picks" : "Add to picks"}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFavorited ? "var(--accent-yellow)" : "none"} stroke={isFavorited ? "var(--accent-yellow)" : "rgba(255,255,255,0.25)"} strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
        )}
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
  label: string; col: Exclude<SortCol, null>; active: SortCol; dir: SortDir;
  onClick: (c: Exclude<SortCol, null>) => void; className?: string;
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
  favorites,
  onToggleFavorite,
}: {
  teamAbbr: string;
  batters: BatterRowInfo[];
  lookback: UILookback;
  posted: boolean;
  onSelect: (row: BatterRowInfo) => void;
  favorites?: Set<string>;
  onToggleFavorite?: (name: string) => void;
}) {
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (batters.length === 0) return null;

  function handleSort(col: Exclude<SortCol, null>) {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  function getVal(row: BatterRowInfo): number {
    const sc = scoreFor(row.p, lookback) ?? scoreFor(row.p, "L5")!;
    const recentAbs = sc.recent_abs ?? [];
    const fbs = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
    const hrs = recentAbs.filter((ab) => ab.result === "home_run").length;
    switch (sortCol) {
      case "score":   return sc.composite ?? 0;
      case "pitch":   return matchupScore(row.p.pitch_detail || {});
      case "ev":      return sc.exit_velo ?? 0;
      case "barrel":  return sc.barrel_pct ?? 0;
      case "hh":      return sc.hard_hit_pct ?? 0;
      case "fb":      return sc.fb_pct ?? 0;
      case "hrfb":    return fbs.length > 0 ? (hrs / fbs.length) * 100 : -1;
      case "xwoba":   return sc.xwoba ?? -1;
      case "sweet":   return sc.sweet_spot ?? -1;
      case "swstr":   return sc.swstr != null ? -(sc.swstr) : (row.p.matchup_swstr != null ? -(row.p.matchup_swstr) : 1);
      case "pullbrl": return sc.pull_brl ?? -1;
      case "bip":     return sc.bip ?? -1;
      case "gb":      return sc.gb_pct ?? 0;
      case "ld":      return sc.ld_pct ?? 0;
      default:        return 0;
    }
  }

  const sorted = sortCol === null
    ? [...batters]
    : [...batters].sort((a, b) => {
        const diff = getVal(a) - getVal(b);
        return sortDir === "desc" ? -diff : diff;
      });

  const thCls = (col: SortCol) => `pr-3 w-14 text-center`;
  const thWide = (col: SortCol) => `pr-3 w-16 text-center`;

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

      {/* Mobile card list (hidden on sm+) */}
      <div className="sm:hidden">
        {sorted.map((row) => (
          <BatterMobileCard
            key={row.p.name}
            row={row}
            lookback={lookback}
            posted={posted}
            onSelect={() => onSelect(row)}
            isFavorited={favorites?.has(row.p.name)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>

      {/* Desktop table (hidden below sm) */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <th className="py-2 pl-4 pr-2 text-[9px] uppercase tracking-widest text-muted/50 font-semibold text-center w-8">#</th>
              <th className="py-2 pr-4 text-[9px] uppercase tracking-widest text-muted/50 font-semibold text-left">Player</th>
              <SortTh label="Score"    col="score"   active={sortCol} dir={sortDir} onClick={handleSort} className="pr-4 w-24 text-left" />
              <SortTh label="Pitch"    col="pitch"   active={sortCol} dir={sortDir} onClick={handleSort} className="pr-4 w-20 text-left" />
              <SortTh label="EV"       col="ev"      active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("ev")} />
              <SortTh label="Brl%"     col="barrel"  active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("barrel")} />
              <SortTh label="HH%"      col="hh"      active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("hh")} />
              <SortTh label="FB%"      col="fb"      active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("fb")} />
              <SortTh label="HR/FB"    col="hrfb"    active={sortCol} dir={sortDir} onClick={handleSort} className="pr-4 w-16 text-center" />
              <SortTh label="xwOBA"    col="xwoba"   active={sortCol} dir={sortDir} onClick={handleSort} className={thWide("xwoba")} />
              <SortTh label="Sweet%"   col="sweet"   active={sortCol} dir={sortDir} onClick={handleSort} className={thWide("sweet")} />
              <SortTh label="SwStr%"   col="swstr"   active={sortCol} dir={sortDir} onClick={handleSort} className={thWide("swstr")} />
              <SortTh label="PullBrl%" col="pullbrl" active={sortCol} dir={sortDir} onClick={handleSort} className={thWide("pullbrl")} />
              <SortTh label="BIP"      col="bip"     active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("bip")} />
              <SortTh label="GB%"      col="gb"      active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("gb")} />
              <SortTh label="LD%"      col="ld"      active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("ld")} />
              <th className="w-8" />
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
                isFavorited={favorites?.has(row.p.name)}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
