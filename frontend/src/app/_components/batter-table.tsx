"use client";

import { useState } from "react";
import type { PlayerData, PitchDetailEntry } from "./types";
import { scoreFor, type UILookback } from "./score-utils";
import { teamLogoUrl, teamName } from "./game-header";

type SortCol = "score" | "pitch" | "ev" | "barrel" | "blast" | "hh" | "fb" | "hrfb" | "xwoba" | "sweet" | "swstr" | "pullbrl" | "bip" | "gb" | "ld" | "bzm" | null;
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

// Inline badge pill — solid opaque green, white text
const PILL_BASE = "inline-flex items-center justify-center rounded font-mono text-xs min-w-[42px] px-2 py-0.5";
const PILL_BRIGHT = `${PILL_BASE} font-bold`;
const PILL_DIM    = `${PILL_BASE} font-semibold`;

// WCAG contrast: bright=5.2:1 (AA ✓), dim text=13.8:1 (AAA ✓), none=7.6:1 (AAA ✓)
const PILL_BRIGHT_STYLE: React.CSSProperties = { background: "#16a34a", color: "#fff" };
const PILL_DIM_STYLE:    React.CSSProperties = { background: "rgba(34,197,94,0.13)", border: "1px solid rgba(34,197,94,0.32)", color: "#86efac" };
const PILL_NONE_STYLE:   React.CSSProperties = { color: "rgba(255,255,255,0.60)" };
const PILL_MUTED_STYLE:  React.CSSProperties = { color: "rgba(255,255,255,0.25)" };

function heatPill(value: number | null | undefined, lo: number, hi: number, label: string): React.ReactNode {
  if (value == null) return <span className={PILL_BASE} style={PILL_MUTED_STYLE}>—</span>;
  if (value >= hi)   return <span className={PILL_BRIGHT} style={PILL_BRIGHT_STYLE}>{label}</span>;
  if (value >= lo)   return <span className={PILL_DIM}    style={PILL_DIM_STYLE}>{label}</span>;
  return               <span className={PILL_BASE}    style={PILL_NONE_STYLE}>{label}</span>;
}

// Keep for BZM/BIP non-numeric use
const HEAT_BRIGHT: React.CSSProperties = PILL_BRIGHT_STYLE;
const HEAT_NONE:   React.CSSProperties = PILL_NONE_STYLE;
const HEAT_MUTED:  React.CSSProperties = PILL_MUTED_STYLE;

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

function filteredPitchStats(pitchDetail: Record<string, PitchDetailEntry>, filter: Set<string>) {
  let totalCount = 0, wEv = 0, wBarrel = 0, wHH = 0, wFB = 0;
  for (const pt of filter) {
    const d = pitchDetail[pt];
    if (!d) continue;
    const c = d.count ?? 1;
    totalCount += c;
    wEv     += d.avg_exit_velo * c;
    wBarrel += d.barrel_rate * c;
    wHH     += d.hard_hit_rate * c;
    wFB     += d.fb_rate * c;
  }
  if (totalCount === 0) return null;
  return {
    exit_velo:    Math.round((wEv     / totalCount) * 10) / 10,
    barrel_pct:   Math.round((wBarrel / totalCount) * 10) / 10,
    hard_hit_pct: Math.round((wHH     / totalCount) * 10) / 10,
    fb_pct:       Math.round((wFB     / totalCount) * 10) / 10,
    bip: totalCount,
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
  const hasQualityWarn = !isLowData && scores.data_quality === "LOW_SAMPLE";

  // tags for BatterRow are not applicable (desktop only), skip for mobile card
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
          <div className={`text-sm font-semibold leading-tight truncate ${isLowData || scores.data_quality === "LOW_SAMPLE" ? "text-red-400" : "text-foreground"}`}>{p.name}</div>
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
  pitchFilter,
  parkFactor,
}: {
  row: BatterRowInfo;
  lookback: UILookback;
  posted: boolean;
  onSelect: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: (name: string) => void;
  pitchFilter?: Set<string>;
  parkFactor?: number;
}) {
  const { p, order, mlbId } = row;
  const scores = scoreFor(p, lookback) ?? scoreFor(p, "L5")!;

  const recentAbs = scores.recent_abs ?? [];
  const flyBalls  = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrCount   = recentAbs.filter((ab) => ab.result === "home_run").length;
  const hrFbPct   = flyBalls.length > 0 ? (hrCount / flyBalls.length) * 100 : null;

  const filtered = pitchFilter && pitchFilter.size > 0
    ? filteredPitchStats(p.pitch_detail || {}, pitchFilter)
    : null;

  const pitchDetailForMatchup = (pitchFilter && pitchFilter.size > 0)
    ? Object.fromEntries(Object.entries(p.pitch_detail || {}).filter(([pt]) => pitchFilter.has(pt)))
    : (p.pitch_detail || {});
  const mScore = matchupScore(pitchDetailForMatchup);
  const pill = matchupPill(mScore);
  const isLowData = scores.recent_abs.length <= 2;
  const hasQualityWarn = !isLowData && scores.data_quality === "LOW_SAMPLE";

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
            <div className={`text-sm font-semibold leading-tight whitespace-nowrap ${isLowData || scores.data_quality === "LOW_SAMPLE" ? "text-red-400" : "text-foreground"}`}>{p.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] font-mono text-muted/60">{p.batter_hand}HB</span>
              {isLowData && (
                <span className="px-1 py-0 text-[8px] font-bold rounded bg-accent/10 text-accent border border-accent/20">NEW</span>
              )}
              {hasQualityWarn && (
                <span className="px-1 py-0 text-[8px] rounded bg-accent-yellow/10 text-accent-yellow">
                  {scores.data_quality === "LOW_SAMPLE" ? "SMALL" : scores.data_quality === "LOW_PITCHER_IP" ? "LOW IP" : "SMALL"}
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

      {/* Core stats — use filtered pitch stats when a pitch filter is active */}
      <td className="py-2 pr-2 w-14 text-center">
        {heatPill(filtered ? filtered.exit_velo : scores.exit_velo, 88, 93, String(filtered ? filtered.exit_velo : scores.exit_velo))}
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        {heatPill(filtered ? filtered.barrel_pct : scores.barrel_pct, 8, 15, `${filtered ? filtered.barrel_pct : scores.barrel_pct}%`)}
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        {heatPill(scores.blast_pct ?? null, 10, 18, scores.blast_pct == null ? "—" : `${scores.blast_pct}%`)}
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        {heatPill(filtered ? filtered.hard_hit_pct : scores.hard_hit_pct, 35, 50, `${filtered ? filtered.hard_hit_pct : scores.hard_hit_pct}%`)}
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        {heatPill(filtered ? filtered.fb_pct : scores.fb_pct, 30, 45, `${filtered ? filtered.fb_pct : scores.fb_pct}%`)}
      </td>
      <td className="py-2 pr-3 w-16 text-center">
        {heatPill(hrFbPct, 10, 20, hrFbPct == null ? "—" : `${hrFbPct.toFixed(0)}%`)}
      </td>

      {/* Advanced / display-only columns */}
      <td className="py-2 pr-2 w-16 text-center">
        {heatPill(xwoba && xwoba !== 0 ? xwoba : null, 0.32, 0.40, xwoba == null || xwoba === 0 ? "—" : xwoba.toFixed(3))}
      </td>
      <td className="py-2 pr-2 w-16 text-center">
        {heatPill(sweet && sweet !== 0 ? sweet : null, 35, 50, sweet == null || sweet === 0 ? "—" : `${sweet.toFixed(1)}%`)}
      </td>
      <td className="py-2 pr-2 w-16 text-center">
        {heatPill(swstr && swstr !== 0 ? 100 - swstr : null, 60, 75, swstr == null || swstr === 0 ? "—" : `${swstr.toFixed(1)}%`)}
      </td>
      <td className="py-2 pr-2 w-16 text-center">
        {heatPill(pullBrl && pullBrl !== 0 ? pullBrl : null, 4, 8, pullBrl == null || pullBrl === 0 ? "—" : `${pullBrl.toFixed(1)}%`)}
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        {(() => {
          const bip = scores.bip ?? p.season_profile?.bip_count ?? 0;
          const style = bip >= 20 ? HEAT_NONE : HEAT_MUTED;
          const extra: React.CSSProperties = bip >= 20 && bip < 50 ? { color: "rgba(251,191,36,0.85)" } : {};
          return <span className={PILL_BASE} style={{ ...style, ...extra }}>{bip > 0 ? bip : "—"}</span>;
        })()}
      </td>

      {/* Contact shape (less important — at the end) */}
      <td className="py-2 pr-2 w-14 text-center">
        <span className={PILL_BASE} style={PILL_MUTED_STYLE}>{scores.gb_pct ?? "—"}%</span>
      </td>
      <td className="py-2 pr-2 w-14 text-center">
        <span className={PILL_BASE} style={PILL_MUTED_STYLE}>{scores.ld_pct ?? "—"}%</span>
      </td>

      {/* BZM */}
      <td className="py-2 pr-2 w-12 text-center">
        {(() => {
          const bz = Object.fromEntries((p.batter_zones ?? []).map(z => [z.zone, z]));
          const pz = Object.fromEntries((p.pitcher_zones ?? []).map(z => [z.zone, z]));
          let n = 0;
          for (let zone = 1; zone <= 9; zone++) {
            const b = bz[zone]; const pzz = pz[zone];
            if (b && pzz && b.bip >= 3 && pzz.bip >= 3 && b.barrel_rate >= 10 && pzz.barrel_rate >= 6) n++;
          }
          const pillStyle = n >= 3 ? PILL_BRIGHT_STYLE
            : n >= 1 ? { background: "#4a3a10", color: "rgba(251,191,36,0.95)" }
            : PILL_MUTED_STYLE;
          return <span className={n >= 3 ? PILL_BRIGHT : PILL_BASE} style={pillStyle}>{n}/9</span>;
        })()}
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
  pitcherMix,
  parkFactor,
}: {
  teamAbbr: string;
  batters: BatterRowInfo[];
  lookback: UILookback;
  posted: boolean;
  onSelect: (row: BatterRowInfo) => void;
  favorites?: Set<string>;
  onToggleFavorite?: (name: string) => void;
  pitcherMix?: { vs_lhb: Record<string, number>; vs_rhb: Record<string, number> };
  parkFactor?: number;
}) {
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [handFilter, setHandFilter] = useState<"all" | "LHB" | "RHB">("all");
  const [pitchFilter, setPitchFilter] = useState<Set<string>>(new Set());
  // Snapshot of row order taken at sort time — toggling lookback updates numbers
  // without reshuffling rows so users can compare the same batter across L5/L10/Season.
  const [lockedOrder, setLockedOrder] = useState<string[] | null>(null);

  if (batters.length === 0) return null;

  function getVal(row: BatterRowInfo, col: Exclude<SortCol, null>): number {
    const sc = scoreFor(row.p, lookback) ?? scoreFor(row.p, "L5")!;
    const recentAbs = sc.recent_abs ?? [];
    const fbs = recentAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
    const hrs = recentAbs.filter((ab) => ab.result === "home_run").length;
    const filt = pitchFilter.size > 0 ? filteredPitchStats(row.p.pitch_detail || {}, pitchFilter) : null;
    const pitchDetailForMatchup = pitchFilter.size > 0
      ? Object.fromEntries(Object.entries(row.p.pitch_detail || {}).filter(([pt]) => pitchFilter.has(pt)))
      : (row.p.pitch_detail || {});
    switch (col) {
      case "score":   return sc.composite ?? 0;
      case "pitch":   return matchupScore(pitchDetailForMatchup);
      case "ev":      return filt ? filt.exit_velo : (sc.exit_velo ?? 0);
      case "barrel":  return filt ? filt.barrel_pct : (sc.barrel_pct ?? 0);
      case "blast":   return sc.blast_pct ?? 0;
      case "hh":      return filt ? filt.hard_hit_pct : (sc.hard_hit_pct ?? 0);
      case "fb":      return filt ? filt.fb_pct : (sc.fb_pct ?? 0);
      case "hrfb":    return fbs.length > 0 ? (hrs / fbs.length) * 100 : -1;
      case "xwoba":   return sc.xwoba ?? -1;
      case "sweet":   return sc.sweet_spot ?? -1;
      case "swstr":   return sc.swstr != null ? -(sc.swstr) : (row.p.matchup_swstr != null ? -(row.p.matchup_swstr) : 1);
      case "pullbrl": return sc.pull_brl ?? -1;
      case "bip":     return filt ? filt.bip : (sc.bip ?? -1);
      case "gb":      return sc.gb_pct ?? 0;
      case "ld":      return sc.ld_pct ?? 0;
      case "bzm": {
        const bz = Object.fromEntries((row.p.batter_zones ?? []).map(z => [z.zone, z]));
        const pz = Object.fromEntries((row.p.pitcher_zones ?? []).map(z => [z.zone, z]));
        let n = 0;
        for (let zone = 1; zone <= 9; zone++) {
          const b = bz[zone]; const p = pz[zone];
          if (b && p && b.bip >= 3 && p.bip >= 3 && b.barrel_rate >= 10 && p.barrel_rate >= 6) n++;
        }
        return n;
      }
      default: return 0;
    }
  }

  function handleSort(col: Exclude<SortCol, null>) {
    const newDir: SortDir = col === sortCol ? (sortDir === "desc" ? "asc" : "desc") : "desc";
    setSortCol(col);
    setSortDir(newDir);
    // Freeze row order at this moment so lookback toggle won't reshuffle
    const currentFiltered = handFilter === "all"
      ? batters
      : batters.filter((r) => handFilter === "LHB" ? r.p.batter_hand !== "R" : r.p.batter_hand !== "L");
    const ordered = [...currentFiltered]
      .sort((a, b) => {
        const diff = getVal(a, col) - getVal(b, col);
        return newDir === "desc" ? -diff : diff;
      })
      .map((r) => r.p.name);
    setLockedOrder(ordered);
  }

  const handFiltered = handFilter === "all"
    ? batters
    : batters.filter((r) => handFilter === "LHB" ? r.p.batter_hand !== "R" : r.p.batter_hand !== "L");

  const sorted = lockedOrder && sortCol !== null
    ? [...handFiltered].sort((a, b) => {
        const ai = lockedOrder.indexOf(a.p.name);
        const bi = lockedOrder.indexOf(b.p.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    : [...handFiltered];

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

      {/* Pitcher pitch mix by hand */}
      {pitcherMix && (() => {
        const allPitchTypes = [...new Set([...Object.keys(pitcherMix.vs_lhb), ...Object.keys(pitcherMix.vs_rhb)])];
        const activeMix = handFilter === "LHB" ? pitcherMix.vs_lhb
          : handFilter === "RHB" ? pitcherMix.vs_rhb
          : Object.fromEntries(allPitchTypes.map((pt) => [pt, ((pitcherMix.vs_lhb[pt] ?? 0) + (pitcherMix.vs_rhb[pt] ?? 0)) / 2]));
        return (
        <div
          className="flex items-center gap-2 px-4 py-2 flex-wrap"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}
        >
          <span className="text-[9px] uppercase tracking-wider text-muted/40 mr-1">Pitch Mix</span>
          <div className="flex items-center rounded-xl p-[3px] gap-0.5 flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
            {(["all", "LHB", "RHB"] as const).map((h) => (
              <button key={h} onClick={() => { setHandFilter(h); setPitchFilter(new Set()); setLockedOrder(null); setSortCol(null); }}
                className={`px-2.5 py-0.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all ${handFilter === h ? "bg-accent text-white shadow-[0_1px_3px_0_rgba(0,0,0,0.4)]" : "text-muted hover:text-foreground"}`}>
                {h === "all" ? "All" : h}
              </button>
            ))}
          </div>
          {Object.entries(activeMix)
            .filter(([, pct]) => pct >= 0.04)
            .sort(([, a], [, b]) => b - a)
            .map(([pt, pct]) => {
              const active = pitchFilter.has(pt);
              return (
                <button key={pt}
                  onClick={() => { setLockedOrder(null); setSortCol(null); setPitchFilter((prev) => { const next = new Set(prev); if (next.has(pt)) next.delete(pt); else next.add(pt); return next; }); }}
                  className="px-2.5 py-1 text-[10px] font-mono rounded-full flex-shrink-0 cursor-pointer transition-all"
                  style={active
                    ? { background: "rgba(96,165,250,0.18)", border: "1px solid rgba(96,165,250,0.45)", color: "rgba(96,165,250,1)" }
                    : { background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.11)", color: "rgba(255,255,255,0.72)" }}>
                  {pt} {(pct * 100).toFixed(1)}%
                </button>
              );
            })
          }
          {pitchFilter.size > 0 && (
            <button onClick={() => { setPitchFilter(new Set()); setLockedOrder(null); setSortCol(null); }}
              className="px-2 py-1 text-[9px] font-mono rounded-full cursor-pointer transition-all ml-auto flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.4)" }}>
              clear
            </button>
          )}
        </div>
        );
      })()}

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
              <SortTh label="Blast%"   col="blast"   active={sortCol} dir={sortDir} onClick={handleSort} className={thCls("blast")} />
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
              <SortTh label="BZM"      col="bzm"     active={sortCol} dir={sortDir} onClick={handleSort} className="pr-3 w-12 text-center" />
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
                pitchFilter={pitchFilter.size > 0 ? pitchFilter : undefined}
                parkFactor={parkFactor}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
