"use client";

import { useEffect, useState } from "react";
import type { PitcherInfo, PitcherStatRow } from "./types";

const DASH = "—";
const OFFSPEED = new Set(["CH", "FS", "FO", "SC"]);
const BREAKING = new Set(["SL", "CU", "KC", "ST", "SV", "CS"]);

type SplitKey = "season" | "vs_L" | "vs_R";

function veloColor(velo: number, type: string): string {
  const isOff = OFFSPEED.has(type);
  const isBrk = BREAKING.has(type);
  if (isOff || isBrk) {
    if (velo >= 90) return "text-accent-green font-semibold";
    if (velo >= 83) return "text-foreground";
    return "text-muted";
  }
  if (velo >= 96) return "text-accent-green font-semibold";
  if (velo >= 93) return "text-foreground";
  return "text-muted";
}

function whiffColor(w: number): string {
  if (w >= 35) return "text-accent-green font-semibold";
  if (w >= 22) return "text-foreground";
  if (w > 0) return "text-accent-red/80";
  return "text-muted";
}

function statCell(
  value: number | null | undefined,
  lo: number,
  hi: number,
  invert = false,
): string {
  if (value == null) return "text-muted";
  const above = invert ? value <= lo : value >= hi;
  const mid = invert ? value <= hi : value >= lo;
  if (above) return "text-accent-green font-semibold";
  if (mid) return "text-foreground";
  return "text-accent-red/80";
}

function fmt(v: number | null | undefined, opts: { digits?: number; ba?: boolean; pct?: boolean } = {}): string {
  if (v == null || isNaN(v as number)) return DASH;
  if (opts.ba) return (v as number).toFixed(3).replace(/^0/, "");
  if (opts.pct) return `${(v as number).toFixed(opts.digits ?? 1)}%`;
  return (v as number).toFixed(opts.digits ?? 1);
}

interface StatCard {
  label: string;
  key: keyof PitcherStatRow;
  format: (v: number | null | undefined) => string;
  lo: number;
  hi: number;
  invert?: boolean;
}

const STAT_CARDS: StatCard[] = [
  { label: "wOBA",    key: "woba",        format: (v) => fmt(v, { ba: true }),        lo: 0.295, hi: 0.330, invert: false },
  { label: "BAA",     key: "baa",         format: (v) => fmt(v, { ba: true }),        lo: 0.225, hi: 0.260, invert: false },
  { label: "SLG",     key: "slg",         format: (v) => fmt(v, { ba: true }),        lo: 0.360, hi: 0.420, invert: false },
  { label: "ISO",     key: "iso",         format: (v) => fmt(v, { ba: true }),        lo: 0.135, hi: 0.180, invert: false },
  { label: "HR",      key: "hr",          format: (v) => v == null ? DASH : String(v), lo: 0, hi: 0 },
  { label: "HR/9",    key: "hr_per_9",    format: (v) => fmt(v, { digits: 2 }),       lo: 1.00, hi: 1.40, invert: false },
  { label: "BB%",     key: "bb_pct",      format: (v) => fmt(v, { pct: true }),       lo: 6.5, hi: 9.5, invert: false },
  { label: "K%",      key: "k_pct",       format: (v) => fmt(v, { pct: true }),       lo: 26, hi: 18, invert: true },
  { label: "Whiff%",  key: "whiff_pct",   format: (v) => fmt(v, { pct: true }),       lo: 28, hi: 22, invert: true },
  { label: "Barrel%", key: "barrel_pct",  format: (v) => fmt(v, { pct: true }),       lo: 5, hi: 9, invert: false },
  { label: "HH%",     key: "hard_hit_pct",format: (v) => fmt(v, { pct: true }),       lo: 32, hi: 40, invert: false },
  { label: "FB%",     key: "fb_pct",      format: (v) => fmt(v, { pct: true }),       lo: 30, hi: 36, invert: false },
  { label: "HR/FB%",  key: "hr_fb_pct",   format: (v) => fmt(v, { pct: true }),       lo: 9, hi: 14, invert: false },
  { label: "WHIP",    key: "whip",        format: (v) => fmt(v, { digits: 2 }),       lo: 1.05, hi: 1.30, invert: false },
];

export function PitcherStatsPanel({
  pitcher,
  onClose,
}: {
  pitcher: PitcherInfo;
  onClose: () => void;
}) {
  const [split, setSplit] = useState<SplitKey>("season");
  const profile = pitcher.profile ?? null;
  const rows = profile?.rows ?? null;
  const is2025 = (profile?.data_year ?? 2026) === 2025;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const row = rows?.[split] ?? null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-in panel from right */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden w-full max-w-lg"
        style={{
          background: "linear-gradient(180deg, rgba(15,15,20,0.98) 0%, rgba(10,10,15,0.99) 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "-12px 0 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          {pitcher.id ? (
            <img
              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${pitcher.id}/headshot/67/current`}
              alt={pitcher.name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.08)" }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground leading-tight">{pitcher.name}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded" style={{ background: "rgba(255,255,255,0.08)", color: "var(--muted)" }}>
                {pitcher.hand}HP
              </span>
              {profile && (
                <span className="text-[11px] font-mono" style={{ color: "var(--muted)" }}>
                  {profile.wins}-{profile.losses} · {profile.games_started} GS
                </span>
              )}
              {is2025 && (
                <span className="px-1.5 py-0.5 text-[9px] rounded" style={{ background: "rgba(251,191,36,0.10)", color: "rgba(251,191,36,0.80)", border: "1px solid rgba(251,191,36,0.20)" }}>
                  2025 data
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
          {!profile ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>No Statcast data available.</p>
          ) : (
            <>
              {/* ── Arsenal ───────────────────────────────────────────────── */}
              {profile.arsenal.length > 0 && (
                <section>
                  <h3 className="text-[9px] uppercase tracking-[0.12em] font-bold mb-3" style={{ color: "var(--muted)", opacity: 0.6 }}>
                    Arsenal
                  </h3>
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                        <tr className="text-[9px] uppercase tracking-wider" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" }}>
                          <th className="text-left font-medium py-1.5 pr-2 w-20">Type</th>
                          <th className="text-center font-medium py-1.5 px-1.5 w-10">#</th>
                          <th className="text-center font-medium py-1.5 px-1.5 w-12">%</th>
                          <th className="text-center font-medium py-1.5 px-1.5 w-14">Velo</th>
                          <th className="text-center font-medium py-1.5 px-1.5 w-14">Spin</th>
                          <th className="text-center font-medium py-1.5 px-1.5 w-16">Whiff%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...profile.arsenal]
                          .sort((a, b) => b.usage_pct - a.usage_pct)
                          .map((entry) => (
                            <tr key={entry.type} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-bold w-5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{entry.type}</span>
                                  <span className="text-xs text-foreground">{entry.name}</span>
                                </div>
                              </td>
                              <td className="text-center py-2 px-1.5" style={{ color: "var(--muted)" }}>{entry.count}</td>
                              <td className="text-center py-2 px-1.5 font-semibold text-foreground">{entry.usage_pct.toFixed(1)}%</td>
                              <td className={`text-center py-2 px-1.5 ${entry.avg_velo != null ? veloColor(entry.avg_velo, entry.type) : "text-muted"}`}>
                                {entry.avg_velo != null ? entry.avg_velo.toFixed(1) : DASH}
                              </td>
                              <td className="text-center py-2 px-1.5" style={{ color: "var(--muted)" }}>
                                {entry.avg_spin != null ? entry.avg_spin.toLocaleString() : DASH}
                              </td>
                              <td className={`text-center py-2 px-1.5 ${whiffColor(entry.whiff_pct)}`}>
                                {entry.whiff_pct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ── Season Splits ─────────────────────────────────────────── */}
              {rows && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[9px] uppercase tracking-[0.12em] font-bold" style={{ color: "var(--muted)", opacity: 0.6 }}>
                      Splits
                    </h3>
                    <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {(["season", "vs_L", "vs_R"] as SplitKey[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => setSplit(s)}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-all"
                          style={split === s
                            ? { background: "var(--accent)", color: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }
                            : { color: "var(--muted)" }}
                        >
                          {s === "season" ? "Season" : s === "vs_L" ? "vs LHB" : "vs RHB"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {row ? (
                    <>
                      {/* Summary line */}
                      <div className="text-[10px] font-mono mb-3" style={{ color: "var(--muted)" }}>
                        {row.ip != null ? `${row.ip.toFixed(1)} IP` : ""}{row.ip != null && row.bf ? " · " : ""}{row.bf ? `${row.bf} BF` : ""}
                      </div>

                      {/* Stat card grid */}
                      <div className="grid grid-cols-4 gap-2">
                        {STAT_CARDS.map(({ label, key, format, lo, hi, invert }) => {
                          const val = row[key] as number | null;
                          const colorCls = key === "hr" ? "text-foreground" : statCell(val, lo, hi, invert);
                          return (
                            <div
                              key={key}
                              className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg"
                              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                            >
                              <span className="text-[8px] uppercase tracking-[0.08em] font-semibold leading-none" style={{ color: "rgba(255,255,255,0.35)" }}>
                                {label}
                              </span>
                              <span className={`text-sm font-mono font-bold leading-none ${colorCls}`}>
                                {format(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs py-4 text-center" style={{ color: "var(--muted)" }}>No data for this split.</p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
