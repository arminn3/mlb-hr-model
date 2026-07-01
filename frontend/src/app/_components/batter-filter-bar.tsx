"use client";

import type { ScoreSet } from "./types";
import type { UILookback } from "./score-utils";

/** HR-screening thresholds. Every threshold is optional — undefined = ignore.
 *  All are minimums (keep players AT OR ABOVE) except `maxGb`, which is a
 *  ceiling (keep players AT OR BELOW). `window` selects the BBE window the
 *  stats + criteria are evaluated over. */
export interface FilterCriteria {
  window: UILookback;
  minEv?: number;
  minHardHit?: number;
  minFb?: number;
  minBarrel?: number;
  minBlast?: number;
  minPullBrl?: number;
  maxGb?: number;
}

export const DEFAULT_CRITERIA: FilterCriteria = { window: "L10" };

/** The single source of truth for whether a batter's window stats clear the
 *  criteria. Undefined thresholds are skipped. Uses the same ScoreSet that's
 *  rendered in the row, so display === filter. */
export function passesCriteria(s: ScoreSet, c: FilterCriteria): boolean {
  if (c.minEv       != null && s.exit_velo             < c.minEv)       return false;
  if (c.minHardHit  != null && s.hard_hit_pct          < c.minHardHit)  return false;
  if (c.minFb       != null && s.fb_pct                < c.minFb)       return false;
  if (c.minBarrel   != null && s.barrel_pct            < c.minBarrel)   return false;
  if (c.minBlast    != null && (s.blast_pct ?? 0)      < c.minBlast)    return false;
  if (c.minPullBrl  != null && (s.pull_brl ?? 0)       < c.minPullBrl)  return false;
  if (c.maxGb       != null && s.gb_pct                > c.maxGb)       return false;
  return true;
}

/** True if any threshold is set (window alone doesn't count as filtering). */
export function hasActiveCriteria(c: FilterCriteria): boolean {
  return (
    c.minEv != null || c.minHardHit != null || c.minFb != null ||
    c.minBarrel != null || c.minBlast != null || c.minPullBrl != null ||
    c.maxGb != null
  );
}

const WINDOWS: UILookback[] = ["L5", "L10", "L15", "L20", "L25"];

/** Recommended HR-hunting thresholds per window. Anchored to league BBE
 *  benchmarks (barrel ~8% league / ~12% good / ~15% elite; hard-hit ~40/45/50;
 *  avg EV ~89/91/93) and loosened for short, noisy windows (L5 = 5 BBE, so
 *  rates come in coarse 20% steps) / tightened for longer, steadier ones. */
export const RECOMMENDED: Record<string, Omit<FilterCriteria, "window">> = {
  L5:  { minEv: 90, minHardHit: 40, minFb: 20, minBarrel: 10, minBlast: 10,                 maxGb: 50 },
  L10: { minEv: 90, minHardHit: 45, minFb: 25, minBarrel: 10, minBlast: 12, minPullBrl: 5,  maxGb: 45 },
  L15: { minEv: 90, minHardHit: 45, minFb: 25, minBarrel: 10, minBlast: 12, minPullBrl: 5,  maxGb: 42 },
  L20: { minEv: 91, minHardHit: 47, minFb: 28, minBarrel: 11, minBlast: 13, minPullBrl: 6,  maxGb: 40 },
  L25: { minEv: 91, minHardHit: 48, minFb: 30, minBarrel: 12, minBlast: 14, minPullBrl: 6,  maxGb: 40 },
};

type NumKey = Exclude<keyof FilterCriteria, "window">;
const FIELDS: Array<{ key: NumKey; label: string; dir: "≥" | "≤" }> = [
  { key: "minEv",      label: "EV",        dir: "≥" },
  { key: "minBarrel",  label: "Barrel%",   dir: "≥" },
  { key: "minBlast",   label: "Blast%",    dir: "≥" },
  { key: "minPullBrl", label: "Pull Brl%", dir: "≥" },
  { key: "minFb",      label: "FB%",       dir: "≥" },
  { key: "minHardHit", label: "Hard Hit%", dir: "≥" },
  { key: "maxGb",      label: "GB%",       dir: "≤" },
];

export function FilterBar({
  criteria,
  onChange,
}: {
  criteria: FilterCriteria;
  onChange: (c: FilterCriteria) => void;
}) {
  const setNum = (key: NumKey, raw: string) => {
    const v = raw.trim() === "" ? undefined : Number(raw);
    onChange({ ...criteria, [key]: v == null || Number.isNaN(v) ? undefined : v });
  };

  const inputCls =
    "w-full px-3 py-2 text-[15px] rounded-lg text-foreground bg-black/30 " +
    "border border-white/25 placeholder:text-muted/45 focus:outline-none " +
    "focus:border-accent focus:ring-1 focus:ring-accent/40";

  return (
    <div className="rounded-xl p-3.5"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}>
      {/* Responsive grid so every field stretches to fill the row width. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Window */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted/70">Window</span>
          <select
            value={criteria.window}
            onChange={(e) => onChange({ ...criteria, window: e.target.value as UILookback })}
            className={inputCls + " cursor-pointer"}
          >
            {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>

        {/* Thresholds */}
        {FIELDS.map(({ key, label, dir }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted/70 whitespace-nowrap">
              {label} <span className="text-accent">{dir}</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={criteria[key] ?? ""}
              onChange={(e) => setNum(key, e.target.value)}
              placeholder="any"
              className={inputCls}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onChange({ window: criteria.window, ...RECOMMENDED[criteria.window] })}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer"
        >
          Recommended ({criteria.window})
        </button>
        {hasActiveCriteria(criteria) && (
          <button
            onClick={() => onChange({ window: criteria.window })}
            className="px-3 py-1.5 text-[12px] rounded-lg text-accent-red/80 hover:text-accent-red hover:bg-white/5 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
