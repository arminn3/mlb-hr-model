"use client";

import { useEffect, useState } from "react";
import type { PitcherInfo, PitcherStatRow } from "./types";

type HandTab = "vs_L" | "vs_R";

const DASH = "—";
const OFFSPEED = new Set(["CH", "FS", "FO", "SC"]);
const BREAKING = new Set(["SL", "CU", "KC", "ST", "SV", "CS"]);

// ── Color helpers ─────────────────────────────────────────────────────────────

function veloColor(velo: number, type: string): string {
  const isOff = OFFSPEED.has(type) || BREAKING.has(type);
  if (isOff) return velo >= 90 ? "text-accent-green" : velo >= 83 ? "text-foreground" : "text-muted";
  return velo >= 96 ? "text-accent-green font-semibold" : velo >= 93 ? "text-foreground" : "text-muted";
}

function whiffColor(w: number): string {
  if (w >= 35) return "text-accent-green font-semibold";
  if (w >= 22) return "text-foreground";
  if (w > 0) return "text-accent-red/80";
  return "text-muted";
}

// direction: 1 = high is bad for pitcher (green when low), -1 = high is good for pitcher (green when high)
function statCell(value: number | null | undefined, lo: number, hi: number, invert = false): string {
  if (value == null) return "text-muted";
  const above = invert ? value <= lo : value >= hi;
  const mid = invert ? value <= hi : value >= lo;
  if (above) return "text-accent-green font-semibold";
  if (mid) return "text-foreground";
  return "text-accent-red/80";
}

function fmt(v: number | null | undefined, opts: { digits?: number; ba?: boolean; pct?: boolean } = {}): string {
  if (v == null || Number.isNaN(v as number)) return DASH;
  if (opts.ba) return (v as number).toFixed(3).replace(/^0/, "");
  if (opts.pct) return `${(v as number).toFixed(opts.digits ?? 1)}%`;
  return (v as number).toFixed(opts.digits ?? 1);
}

// ── Split stats strip ─────────────────────────────────────────────────────────

interface StatDef {
  label: string;
  key: keyof PitcherStatRow;
  render: (v: number | null | undefined) => string;
  lo: number; hi: number; invert?: boolean;
}

const STAT_STRIP: StatDef[] = [
  { label: "BAA",     key: "baa",         render: v => fmt(v, { ba: true }),        lo: 0.225, hi: 0.260 },
  { label: "wOBA",    key: "woba",        render: v => fmt(v, { ba: true }),        lo: 0.295, hi: 0.330 },
  { label: "SLG",     key: "slg",         render: v => fmt(v, { ba: true }),        lo: 0.360, hi: 0.420 },
  { label: "ISO",     key: "iso",         render: v => fmt(v, { ba: true }),        lo: 0.135, hi: 0.180 },
  { label: "HR",      key: "hr",          render: v => v == null ? DASH : String(v), lo: 0, hi: 0 },
  { label: "HR/9",    key: "hr_per_9",    render: v => fmt(v, { digits: 2 }),       lo: 1.00, hi: 1.40 },
  { label: "BB%",     key: "bb_pct",      render: v => fmt(v, { pct: true }),       lo: 6.5, hi: 9.5 },
  { label: "K%",      key: "k_pct",       render: v => fmt(v, { pct: true }),       lo: 26, hi: 18, invert: true },
  { label: "Whiff%",  key: "whiff_pct",   render: v => fmt(v, { pct: true }),       lo: 28, hi: 22, invert: true },
  { label: "Barrel%", key: "barrel_pct",  render: v => fmt(v, { pct: true }),       lo: 5, hi: 9 },
  { label: "HH%",     key: "hard_hit_pct",render: v => fmt(v, { pct: true }),       lo: 32, hi: 40 },
  { label: "FB%",     key: "fb_pct",      render: v => fmt(v, { pct: true }),       lo: 30, hi: 36 },
  { label: "HR/FB%",  key: "hr_fb_pct",   render: v => fmt(v, { pct: true }),       lo: 9, hi: 14 },
];

function SplitStrip({ row }: { row: PitcherStatRow }) {
  const allStats = [
    ...STAT_STRIP,
    { label: "IP",  key: "ip"  as keyof PitcherStatRow, render: (v: number | null | undefined) => v != null ? v.toFixed(1) : DASH, lo: 0, hi: 0 },
    { label: "BF",  key: "bf"  as keyof PitcherStatRow, render: (v: number | null | undefined) => v != null ? String(v) : DASH,   lo: 0, hi: 0 },
  ];
  return (
    <div className="grid grid-cols-5 gap-2">
      {allStats.map(({ label, key, render, lo, hi, invert }) => {
        const val = row[key] as number | null;
        const colorCls = (key === "hr" || key === "ip" || key === "bf") ? "text-foreground" : statCell(val, lo, hi, (invert as boolean | undefined));
        return (
          <div
            key={key}
            className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <span className="text-[8px] uppercase tracking-[0.08em] font-semibold whitespace-nowrap" style={{ color: "rgba(255,255,255,0.35)" }}>
              {label}
            </span>
            <span className={`text-sm font-mono font-bold leading-none ${colorCls}`}>
              {render(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Zone frequency grid ───────────────────────────────────────────────────────

type ZoneFreq = { zone: number; pct: number };

function ZoneGrid({ freqs }: { freqs: ZoneFreq[] }) {
  const byZone = Object.fromEntries(freqs.map(z => [z.zone, z.pct]));
  const maxPct = Math.max(...freqs.map(z => z.pct), 1);

  return (
    <div className="grid grid-cols-3 gap-1 w-fit mx-auto">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(zone => {
        const pct = byZone[zone] ?? 0;
        const intensity = pct / maxPct;
        return (
          <div
            key={zone}
            className="w-16 h-14 rounded flex flex-col items-center justify-center gap-0.5"
            style={{
              background: `rgba(96,165,250,${0.06 + intensity * 0.45})`,
              border: `1px solid rgba(96,165,250,${0.12 + intensity * 0.35})`,
            }}
          >
            <span className="text-[8px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>{zone}</span>
            <span className="text-xs font-mono font-bold text-foreground">{pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Pitch outcome cell (table <td>) ─────────────────────────────────────────

function PitchCell({ v, lo, hi, ba, pct, invert }: {
  v: number | null | undefined;
  lo: number;
  hi: number;
  ba?: boolean;
  pct?: boolean;
  invert?: boolean;
}) {
  const colorCls = statCell(v, lo, hi, invert);
  const display = ba ? fmt(v, { ba: true }) : pct ? fmt(v, { pct: true }) : fmt(v);
  return <td className={`text-center py-2 px-1.5 ${colorCls}`}>{display}</td>;
}

// ── Platoon comparison ────────────────────────────────────────────────────────

function PlatoonRow({ label, row, highlight }: { label: string; row: PitcherStatRow; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg ${highlight ? "ring-1 ring-accent/40" : ""}`}
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <span className="text-xs font-bold w-14 flex-shrink-0 text-foreground">{label}</span>
      {[
        { label: "wOBA", val: fmt(row.woba, { ba: true }), cls: statCell(row.woba, 0.295, 0.330) },
        { label: "SLG",  val: fmt(row.slg, { ba: true }),  cls: statCell(row.slg, 0.360, 0.420) },
        { label: "HR",   val: row.hr != null ? String(row.hr) : DASH, cls: "text-foreground" },
        { label: "K%",   val: fmt(row.k_pct, { pct: true }), cls: statCell(row.k_pct, 26, 18, true) },
        { label: "Brl%", val: fmt(row.barrel_pct, { pct: true }), cls: statCell(row.barrel_pct, 5, 9) },
        { label: "HH%",  val: fmt(row.hard_hit_pct, { pct: true }), cls: statCell(row.hard_hit_pct, 32, 40) },
      ].map(({ label: l, val, cls }) => (
        <div key={l} className="flex flex-col items-center gap-0.5 flex-1">
          <span className="text-[8px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>{l}</span>
          <span className={`text-xs font-mono font-bold ${cls}`}>{val}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PitcherStatsPanel({
  pitcher,
  zoneFreqLhb,
  zoneFreqRhb,
  onClose,
}: {
  pitcher: PitcherInfo;
  zoneFreqLhb?: ZoneFreq[];
  zoneFreqRhb?: ZoneFreq[];
  onClose: () => void;
}) {
  const [hand, setHand] = useState<HandTab>("vs_L");
  const profile = pitcher.profile ?? null;
  const rows = profile?.rows ?? null;
  const is2025 = (profile?.data_year ?? 2026) === 2025;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const row = rows?.[hand] ?? null;
  const zoneFreq = hand === "vs_L" ? zoneFreqLhb : zoneFreqRhb;
  const hasZones = zoneFreq && zoneFreq.length > 0 && zoneFreq.some(z => z.pct > 0);

  // Pitcher type tags derived from arsenal — use hand-split data when available
  const arsenal = (hand === "vs_L" ? profile?.arsenal_vs_L : profile?.arsenal_vs_R) ?? profile?.arsenal ?? [];
  const topPitch = arsenal[0];
  const hasSweeper = arsenal.some(e => e.type === "ST" && e.usage_pct >= 10);
  const highK = rows?.season?.k_pct != null && rows.season.k_pct >= 25;
  const groundBall = rows?.season?.fb_pct != null && rows.season.fb_pct <= 28;
  const flyBall = rows?.season?.fb_pct != null && rows.season.fb_pct >= 40;
  const hardToHit = rows?.season?.barrel_pct != null && rows.season.barrel_pct <= 5;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden w-full max-w-3xl"
        style={{
          background: "linear-gradient(180deg, rgba(14,14,20,0.99) 0%, rgba(10,10,15,1) 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "-16px 0 48px rgba(0,0,0,0.7)",
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {pitcher.id ? (
            <img
              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${pitcher.id}/headshot/67/current`}
              alt={pitcher.name}
              className="w-14 h-14 rounded-full object-cover flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.08)" }}
            />
          ) : (
            <div className="w-14 h-14 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground leading-tight">{pitcher.name}</h2>
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
            {/* Pitcher type tags */}
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {highK && <Tag label="High-K" color="green" />}
              {hardToHit && <Tag label="Low Barrel%" color="green" />}
              {hasSweeper && <Tag label="Sweeper" color="blue" />}
              {groundBall && <Tag label="GB-heavy" color="blue" />}
              {flyBall && <Tag label="FB-heavy" color="yellow" />}
              {topPitch && <Tag label={topPitch.name} color="default" />}
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

        {/* ── vs LHB / vs RHB primary toggle ── */}
        <div className="flex items-center px-5 pt-4 pb-0 gap-0 flex-shrink-0">
          {(["vs_L", "vs_R"] as HandTab[]).map((h) => (
            <button
              key={h}
              onClick={() => setHand(h)}
              className="flex-1 py-2.5 text-sm font-bold cursor-pointer transition-all"
              style={hand === h
                ? { borderBottom: "2px solid var(--accent)", color: "var(--accent)" }
                : { borderBottom: "2px solid rgba(255,255,255,0.08)", color: "var(--muted)" }}
            >
              {h === "vs_L" ? "vs LHB" : "vs RHB"}
            </button>
          ))}
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">
          {!profile ? (
            <p className="text-sm text-center py-12" style={{ color: "var(--muted)" }}>No Statcast data available.</p>
          ) : (
            <>
              {/* Split stats strip */}
              {row && (
                <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="text-[9px] uppercase tracking-[0.12em] font-bold mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {hand === "vs_L" ? "vs Left-Handed Batters" : "vs Right-Handed Batters"} — Season
                  </p>
                  <SplitStrip row={row} />
                </div>
              )}

              {/* Arsenal */}
              {arsenal.length > 0 && (
                <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>Pitch Results — {hand === "vs_L" ? "vs LHB" : "vs RHB"}</p>
                    <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.25)" }}>green = batter favorable · red = pitcher favorable</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                          <th className="text-left py-1.5 pr-3 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Type</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>#</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>%</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>BBE</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>BA</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>wOBA</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>SLG</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>ISO</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>HR</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>BB%</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Whiff%</th>
                          <th className="text-center py-1.5 px-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>K%</th>
                          <th className="text-center py-1.5 pl-1.5 font-medium text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Velo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arsenal.map((entry) => (
                          <tr key={entry.type} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold w-5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{entry.type}</span>
                                <span className="text-xs text-foreground whitespace-nowrap">{entry.name}</span>
                              </div>
                            </td>
                            <td className="text-center py-2 px-1.5" style={{ color: "var(--muted)" }}>{entry.count}</td>
                            <td className="text-center py-2 px-1.5 font-semibold text-foreground">{entry.usage_pct.toFixed(1)}%</td>
                            <td className="text-center py-2 px-1.5" style={{ color: "var(--muted)" }}>{entry.bbe ?? DASH}</td>
                            <PitchCell v={entry.ba}   lo={0.225} hi={0.270} ba />
                            <PitchCell v={entry.woba} lo={0.295} hi={0.340} ba />
                            <PitchCell v={entry.slg}  lo={0.360} hi={0.450} ba />
                            <PitchCell v={entry.iso}  lo={0.135} hi={0.200} ba />
                            <td className="text-center py-2 px-1.5 text-foreground">{entry.hr ?? DASH}</td>
                            <PitchCell v={entry.bb_pct}   lo={6.5} hi={10} pct />
                            <PitchCell v={entry.whiff_pct} lo={28} hi={35} pct invert />
                            <PitchCell v={entry.k_pct}    lo={26} hi={33} pct invert />
                            <td className={`text-center py-2 pl-1.5 ${entry.avg_velo != null ? veloColor(entry.avg_velo, entry.type) : "text-muted"}`}>
                              {entry.avg_velo != null ? entry.avg_velo.toFixed(1) : DASH}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Zone frequency */}
              {hasZones && (
                <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="text-[9px] uppercase tracking-[0.12em] font-bold mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Zone Location — {hand === "vs_L" ? "vs LHB" : "vs RHB"}
                  </p>
                  <p className="text-[9px] mb-4" style={{ color: "rgba(255,255,255,0.25)" }}>% of all pitches thrown to each zone</p>
                  <ZoneGrid freqs={zoneFreq!} />
                </div>
              )}

              {/* Platoon splits comparison */}
              {rows?.vs_L && rows?.vs_R && (
                <div className="px-5 py-4">
                  <p className="text-[9px] uppercase tracking-[0.12em] font-bold mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>Platoon Splits</p>
                  <div className="space-y-1.5">
                    <PlatoonRow label="vs LHB" row={rows.vs_L} highlight={hand === "vs_L"} />
                    <PlatoonRow label="vs RHB" row={rows.vs_R} highlight={hand === "vs_R"} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Tag({ label, color }: { label: string; color: "green" | "blue" | "yellow" | "default" }) {
  const styles: Record<string, React.CSSProperties> = {
    green:   { background: "rgba(74,222,128,0.10)",  border: "1px solid rgba(74,222,128,0.25)",  color: "rgba(74,222,128,0.9)" },
    blue:    { background: "rgba(96,165,250,0.10)",  border: "1px solid rgba(96,165,250,0.25)",  color: "rgba(96,165,250,0.9)" },
    yellow:  { background: "rgba(251,191,36,0.10)",  border: "1px solid rgba(251,191,36,0.25)",  color: "rgba(251,191,36,0.9)" },
    default: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)" },
  };
  return (
    <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded" style={styles[color]}>{label}</span>
  );
}
