"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { PlayerData, PitchDetailEntry, ZoneEntry } from "./types";
import { HRSignalCard } from "./hr-signal-card";
import { scoreFor, type UILookback } from "./score-utils";
import { ScoreBar } from "./score-bar";
import { PitchesTab } from "./pitches-tab";
import { BvPTab } from "./bvp-tab";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";
import { BatterProfileRow } from "./batter-profile-row";
import { teamLogoUrl } from "./game-header";
import { buildTags, PlayerTagPills } from "./player-tags";

const PITCH_NAMES: Record<string, string[]> = {
  FF: ["4-Seam Fastball", "Four-Seam"],
  SI: ["Sinker"],
  FC: ["Cutter"],
  SL: ["Slider", "Sweeper"],
  CU: ["Curveball", "Curve"],
  CH: ["Changeup"],
  FS: ["Split-Finger", "Splitter"],
  FO: ["Forkball"],
  KC: ["Knuckle Curve"],
  KN: ["Knuckleball"],
  ST: ["Sweeper"],
  SV: ["Slurve"],
  SC: ["Screwball"],
  EP: ["Eephus"],
};

function evColor(_ev: number) {
  return "";
}
function angleColor(angle: number) {
  if (angle >= 25 && angle <= 35) return "bg-accent-green/80 text-background";
  if (angle >= 20 && angle <= 40) return "bg-accent-green/40 text-foreground";
  return "text-red-400";
}
function distColor(dist: number | null) {
  if (!dist) return "text-red-400/60";
  if (dist >= 350) return "bg-accent-green/80 text-background";
  if (dist >= 300) return "bg-accent-green/40 text-foreground";
  return "text-red-400";
}
function evGradient(ev: number | null | undefined): string {
  if (ev == null || ev === 0) return "rgba(148,163,184,0.35)";
  if (ev >= 105) return "rgba(0,240,100,1)";
  if (ev >= 98)  return "rgba(34,197,94,1)";
  if (ev >= 95)  return "rgba(74,222,128,1)";
  if (ev >= 93)  return "rgba(134,239,172,0.9)";
  if (ev >= 90)  return "rgba(187,247,208,0.55)";
  if (ev >= 88)  return "rgba(252,165,165,0.55)";
  if (ev >= 85)  return "rgba(248,113,113,0.80)";
  return "rgba(239,68,68,1)";
}

function statHighlight(value: number, thresholds: [number, number]) {
  if (value >= thresholds[1]) return "text-accent-green font-semibold";
  if (value >= thresholds[0]) return "text-foreground";
  return "text-red-400";
}

function pitchScore(d: PitchDetailEntry): "great" | "decent" | "tough" | "unknown" {
  if (d.barrel_rate == null && d.avg_exit_velo == null) return "unknown";
  const barrel = d.barrel_rate ?? 0;
  const ev = d.avg_exit_velo ?? 88;
  if (barrel >= 20 || (barrel >= 12 && ev >= 95)) return "great";
  if (barrel >= 8 || ev >= 90) return "decent";
  return "tough";
}

const SCORE_COLORS = {
  great:   { dot: "bg-accent-green",  text: "text-accent-green",  bg: "bg-accent-green/8 border-accent-green/25" },
  decent:  { dot: "bg-accent-yellow", text: "text-accent-yellow", bg: "bg-accent-yellow/8 border-accent-yellow/20" },
  tough:   { dot: "bg-red-500/60",    text: "text-muted",         bg: "bg-white/[0.025] border-white/8" },
  unknown: { dot: "bg-white/25",      text: "text-muted",         bg: "bg-white/[0.025] border-white/8" },
};

function matchupLabel(pitchDetail: Record<string, PitchDetailEntry>): { label: string; color: string } {
  const entries = Object.entries(pitchDetail).filter(([, d]) => (d.usage_pct ?? 0) >= 12);
  if (!entries.length) return { label: "UNKNOWN", color: "text-muted" };
  let totalUsage = 0, weighted = 0;
  for (const [, d] of entries) {
    const u = (d.usage_pct ?? 0) / 100;
    const b = d.barrel_rate ?? 0;
    const e = d.avg_exit_velo ?? 88;
    weighted += u * (0.65 * Math.min(b / 25, 1) + 0.35 * Math.max(0, Math.min((e - 85) / 20, 1)));
    totalUsage += u;
  }
  const score = totalUsage > 0 ? weighted / totalUsage : 0.5;
  if (score >= 0.45) return { label: "GREAT MATCHUP", color: "text-accent-green" };
  if (score >= 0.25) return { label: "DECENT", color: "text-accent-yellow" };
  return { label: "TOUGH", color: "text-muted" };
}

const ZONE_ROWS = [
  { label: "Upper", zones: [1, 2, 3] },
  { label: "Middle", zones: [4, 5, 6] },
  { label: "Lower", zones: [7, 8, 9] },
];
const ZONE_COL_LABELS = ["Outside", "Mid", "Inside"];

function zoneBackground(rate: number, bip: number, r: number, g: number, b: number): React.CSSProperties {
  if (bip < 2) return { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" };
  const t = Math.min(rate / 12, 1);
  const alpha = 0.07 + t * 0.73;
  return {
    background: `rgba(${r},${g},${b},${alpha})`,
    border: `1px solid rgba(${r},${g},${b},${Math.min(alpha + 0.2, 0.95)})`,
  };
}

function ZoneGrid({
  batter_zones,
  pitcher_zone_freq,
}: {
  batter_zones: ZoneEntry[];
  pitcher_zone_freq: { zone: number; count: number; pct: number }[];
}) {
  const bzMap = Object.fromEntries(batter_zones.map((z) => [z.zone, z]));
  const pfMap = Object.fromEntries(pitcher_zone_freq.map((z) => [z.zone, z]));

  // Pitcher "attacks" a zone if they throw there ≥8% of pitches (~above-average for a 9-zone grid)
  const activeZones = new Set(pitcher_zone_freq.filter((z) => z.pct >= 8).map((z) => z.zone));

  // Overlap: batter's hot HR zone (≥2 BIP, ≥4% HR rate) AND pitcher attacks it
  const isBatterHot = (zn: number) => { const z = bzMap[zn]; return !!(z && z.bip >= 2 && z.hr_rate >= 4); };
  const isPitcherFrequent = (zn: number) => activeZones.has(zn);
  const overlapZones = new Set(ZONE_ROWS.flatMap((r) => r.zones).filter((zn) => isBatterHot(zn) && isPitcherFrequent(zn)));
  const overlapCount = overlapZones.size;
  const overallLabel = overlapCount >= 3
    ? { text: "GREAT", color: "text-accent-green" }
    : overlapCount >= 1
    ? { text: "DECENT", color: "text-accent-yellow" }
    : { text: "POOR OVERLAP", color: "text-muted" };

  const maxPct = Math.max(...pitcher_zone_freq.map((z) => z.pct), 1);

  function BatterHeatGrid() {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-1" style={{ paddingLeft: 44 }}>
          {ZONE_COL_LABELS.map((l) => (
            <div key={l} className="text-center text-[8px] text-muted/40 uppercase tracking-wider" style={{ width: 52 }}>{l}</div>
          ))}
        </div>
        {ZONE_ROWS.map(({ label, zones }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="text-right pr-1.5 text-[8px] text-muted/40 uppercase tracking-wider flex-shrink-0" style={{ width: 40 }}>{label}</div>
            {zones.map((zn) => {
              const z = bzMap[zn];
              const isOverlap = overlapZones.has(zn);
              const rate = z?.hr_rate ?? 0;
              const bip = z?.bip ?? 0;
              const hasData = bip >= 2;

              const cellSty: React.CSSProperties = isOverlap
                ? { background: "rgba(250,204,21,0.22)", border: "1.5px solid rgba(250,204,21,0.65)" }
                : zoneBackground(rate, bip, 239, 68, 68);
              const textColor = isOverlap ? "text-yellow-300" : rate >= 7 ? "text-white" : "text-foreground/80";

              return (
                <div key={zn} title={z ? `${z.bip} BIP · ${z.hrs} HR · ${z.hr_rate.toFixed(1)}% HR rate` : "No data"}
                  className="rounded flex flex-col items-center justify-center gap-0.5"
                  style={{ width: 52, height: 40, ...cellSty }}>
                  {hasData ? (
                    <>
                      <span className={`text-[11px] font-mono font-bold leading-none ${textColor}`}>{(rate / 100).toFixed(2)}</span>
                      <span className="text-[8px] text-muted/35 leading-none">{bip}bip</span>
                    </>
                  ) : <span className="text-[10px] text-muted/20">—</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function PitcherFreqGrid() {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-1" style={{ paddingLeft: 44 }}>
          {ZONE_COL_LABELS.map((l) => (
            <div key={l} className="text-center text-[8px] text-muted/40 uppercase tracking-wider" style={{ width: 52 }}>{l}</div>
          ))}
        </div>
        {ZONE_ROWS.map(({ label, zones }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="text-right pr-1.5 text-[8px] text-muted/40 uppercase tracking-wider flex-shrink-0" style={{ width: 40 }}>{label}</div>
            {zones.map((zn) => {
              const pf = pfMap[zn];
              const pct = pf?.pct ?? 0;
              const isOverlap = overlapZones.has(zn);
              const isActive = activeZones.has(zn);

              // Blue intensity proportional to frequency vs max zone
              const t = Math.min(pct / maxPct, 1);
              const alpha = 0.07 + t * 0.73;
              const cellSty: React.CSSProperties = isOverlap
                ? { background: "rgba(250,204,21,0.22)", border: "1.5px solid rgba(250,204,21,0.65)" }
                : isActive
                ? { background: `rgba(59,130,246,${alpha})`, border: `1px solid rgba(59,130,246,${Math.min(alpha + 0.2, 0.95)})` }
                : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" };
              const textColor = isOverlap ? "text-yellow-300" : isActive ? "text-white" : "text-foreground/50";

              return (
                <div key={zn} title={pf ? `Zone ${zn}: ${pct.toFixed(1)}% of pitches (${pf.count} pitches)` : "No data"}
                  className="rounded flex flex-col items-center justify-center gap-0.5"
                  style={{ width: 52, height: 40, ...cellSty }}>
                  {pct > 0 ? (
                    <>
                      <span className={`text-[11px] font-mono font-bold leading-none ${textColor}`}>{pct.toFixed(1)}%</span>
                    </>
                  ) : <span className="text-[10px] text-muted/20">—</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5)" }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/55">Zone Overlap</span>
        <span className={`text-xs font-bold ${overallLabel.color}`}>
          {overlapCount}/9 zones · {overallLabel.text}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-6 justify-center overflow-x-auto">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.06em] font-semibold" style={{ color: "rgba(239,68,68,0.7)" }}>Batter HR Rate</span>
          <BatterHeatGrid />
        </div>
        <div className="self-center text-muted/20 text-sm font-light">vs</div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.06em] font-semibold" style={{ color: "rgba(96,165,250,0.7)" }}>Pitcher Location Freq</span>
          <PitcherFreqGrid />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 justify-center">
        <span className="text-[8px] text-muted/30 uppercase tracking-wider">Gold = batter hot zone + pitcher throws there · Blue = pitcher top-5 zones</span>
      </div>
    </div>
  );
}

// ── Filter helpers ───────────────────────────────────────────────────────────

function FilterDropdown({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted/60 mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-card/50 border border-card-border rounded-lg text-foreground focus:outline-none focus:border-accent/50 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function PitchMultiSelect({
  chipList, selected, onToggle, onClearAll, onSelectAll, onSelectArsenal, pitchNames,
}: {
  chipList: Array<{ type: string; usage: number }>;
  selected: Set<string>;
  onToggle: (pt: string) => void;
  onClearAll: () => void;
  onSelectAll: () => void;
  /** Selects every pitch in the opposing pitcher's vs-hand arsenal with
   *  ≥12% usage — the same set the dropdown opens with by default. */
  onSelectArsenal: () => void;
  pitchNames: Record<string, string[]>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const summary = selected.size === 0
    ? "All pitches"
    : selected.size <= 2
      ? [...selected].map((pt) => pitchNames[pt]?.[0] ?? pt).join(", ")
      : `${selected.size} selected`;
  return (
    <div ref={ref} className="relative">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted/60 mb-1.5">Pitch Type</div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-sm bg-card/50 border border-card-border rounded-lg text-foreground hover:border-accent/50 cursor-pointer text-left flex items-center justify-between"
      >
        <span className="truncate">{summary}</span>
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-muted ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && chipList.length > 0 && (
        <div className="absolute z-50 mt-1 w-64 max-h-72 overflow-y-auto bg-card border border-card-border rounded-lg shadow-lg p-2">
          <div className="flex items-center justify-between gap-3 px-2 py-1 mb-1 border-b border-card-border/50">
            <button onClick={onSelectAll} className="text-[10px] uppercase tracking-wider text-muted hover:text-foreground cursor-pointer">All</button>
            <button onClick={onSelectArsenal} className="text-[10px] uppercase tracking-wider text-accent hover:text-accent/80 cursor-pointer font-semibold">Arsenal (12%+)</button>
            <button onClick={onClearAll} className="text-[10px] uppercase tracking-wider text-accent-red/80 hover:text-accent-red cursor-pointer">Clear</button>
          </div>
          {chipList.map((c) => {
            const on = selected.has(c.type);
            const name = pitchNames[c.type]?.[0] ?? c.type;
            return (
              <button
                key={c.type}
                onClick={() => onToggle(c.type)}
                className={`w-full flex items-center justify-between px-2 py-1.5 text-[12px] rounded cursor-pointer ${on ? "bg-accent/15 text-accent" : "text-foreground hover:bg-white/5"}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded border ${on ? "bg-accent border-accent" : "border-muted/40"} flex items-center justify-center`}>
                    {on && <svg className="w-2.5 h-2.5 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <span>{name}</span>
                </span>
                <span className="text-[10px] font-mono text-muted/60">{c.usage}%</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── BatterDetailPage ─────────────────────────────────────────────────────────

export function BatterDetailPage({
  player,
  lookback,
  mlbId,
  battingOrder,
  teamAbbr,
  onBack,
  isFavorited,
  onToggleFavorite,
  parkFactor,
  opposingArsenal,
  gamePlayers,
  onSwitchPlayer,
}: {
  player: PlayerData;
  lookback: UILookback;
  mlbId?: number;
  battingOrder: number | null;
  teamAbbr?: string;
  onBack: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: (name: string) => void;
  parkFactor?: number;
  /** Full arsenal the opposing pitcher throws vs this batter's hand. Sourced
   *  from `pitcher.profile.arsenal_vs_L | arsenal_vs_R`. When present, this is
   *  the authoritative pitch-chip source — overrides `player.pitch_types`
   *  which is pre-stripped at backend's 12% min usage. */
  opposingArsenal?: import("./types").PitcherArsenalEntry[] | null;
  /** Other batters in the same game, used by the Switch Hitter dropdown so
   *  the user can navigate between players without losing filter selections. */
  gamePlayers?: Array<{ name: string; battingOrder: number | null; hand: string; isSelf: boolean }>;
  onSwitchPlayer?: (name: string) => void;
}) {
  // Season is no longer a valid option on this page — the BBE log is what
  // drives the view, and Season's season_profile isn't a true ordered log.
  // If the global lookback is "Season", land on L10 instead.
  const [activeLookback, setActiveLookback] = useState<UILookback>(lookback === "Season" ? "L10" : lookback);
  // New filter dropdowns. Pitch Arm defaults to the opposing pitcher's
  // hand — the matchup-relevant pool. Picking the other hand currently
  // returns no rows because the backend's recent_abs / season_abs are
  // pre-filtered to the same hand as the opposing pitcher (see model.py
  // line ~493 and main.py line ~611). Extending the slate to carry
  // both-hand pools is a separate task flagged below.
  const _initialArm: "L" | "R" | "Both" =
    player.pitcher_hand === "L" ? "L"
    : player.pitcher_hand === "R" ? "R"
    : "Both";
  const [armFilter, setArmFilter] = useState<"L" | "R" | "Both">(_initialArm);
  const [dnFilter,  setDnFilter]  = useState<"D" | "N" | "Both">("Both");
  const [haFilter,  setHaFilter]  = useState<"H" | "A" | "Both">("Both");

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, []);

  const scores = scoreFor(player, activeLookback) ?? scoreFor(player, "L5")!;
  const pitchDetail = player.pitch_detail || {};
  const pitchTypes = player.pitch_types || [];

  // Authoritative chip list: prefer the opposing pitcher's vs-hand arsenal
  // (every pitch the pitcher actually throws to this batter's hand, even
  // sub-12% rarities). Falls back to the stripped player.pitch_types only
  // when the pitcher profile isn't loaded.
  const chipList = useMemo<{ type: string; usage: number }[]>(() => {
    const fromArsenal = (opposingArsenal ?? [])
      .filter((e) => (e.usage_pct ?? 0) > 0)
      .map((e) => ({ type: e.type, usage: e.usage_pct }));
    if (fromArsenal.length > 0) return fromArsenal.sort((a, b) => b.usage - a.usage);
    // Fallback: use the stripped pitch_types list.
    return pitchTypes
      .map((pt) => ({ type: pt, usage: pitchDetail[pt]?.usage_pct ?? 0 }))
      .sort((a, b) => b.usage - a.usage);
  }, [opposingArsenal, pitchTypes, pitchDetail]);

  // Default-select pitches >= 12% usage. Re-defaults whenever the chip list
  // changes (different batter / different game / lookback updates).
  const defaultSelected = useMemo(
    () => new Set(chipList.filter((c) => c.usage >= 12).map((c) => c.type)),
    [chipList]
  );
  const [pitchFilter, setPitchFilter] = useState<Set<string>>(defaultSelected);
  // When the chip list changes (new batter opened), reset to the new default.
  useEffect(() => { setPitchFilter(defaultSelected); }, [defaultSelected]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pitchAbsData = (scores as any).pitch_abs as Record<string, Array<Record<string, unknown>>> | undefined;
  // Match the slice size of computeSliceScoreSet for L15/L20/L25 so the AB
  // table renders the same N rows the stat cards summarized.
  const limit =
    activeLookback === "L5"    ? 5
  : activeLookback === "L10"   ? 10
  : activeLookback === "L15"   ? 15
  : activeLookback === "L20"   ? 20
  : activeLookback === "L25"   ? 25
  : activeLookback === "Season" ? 25
  : 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredABs: any[];
  // For L15/L20/L25 and Season, the AB table shows the last N BBE outright —
  // pitch filter narrows the stat cards above but does NOT shrink the log.
  // Otherwise picking L25 with the default ≥12% pitch chips selected drops
  // the table well below 25, which is the bug the user just flagged.
  const isWideWindow = activeLookback === "L15" || activeLookback === "L20"
                    || activeLookback === "L25" || activeLookback === "Season";
  if (isWideWindow) {
    filteredABs = (scores.recent_abs || []).slice(0, limit);
  } else if (pitchFilter.size === 0) {
    if (pitchAbsData && Object.keys(pitchAbsData).length > 0) {
      const all = Object.values(pitchAbsData).flat();
      all.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const seen = new Set<string>();
      filteredABs = all.filter((ab) => { const k = `${ab.date}-${ab.ev}-${ab.angle}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
    } else {
      filteredABs = (scores.recent_abs || []).slice(0, limit);
    }
  } else {
    // Primary: pitch_abs is a code-keyed lookup populated for L5/L10 lookbacks.
    const selected: Array<Record<string, unknown>> = [];
    for (const pt of pitchFilter) selected.push(...(pitchAbsData?.[pt] || []));
    // Fallback: Season mode (and any case where pitch_abs wasn't emitted) —
    // filter scores.recent_abs by matching the AB's pitch_type against the
    // selected codes OR their friendly names (Statcast logs sometimes store
    // 'FF' and sometimes 'Four-Seam Fastball', so we accept both).
    if (selected.length === 0) {
      const matches = (scores.recent_abs || []).filter((ab) => {
        const pt = ab.pitch_type ?? "";
        if (pitchFilter.has(pt)) return true;
        for (const code of pitchFilter) {
          if (code === pt) return true;
          if ((PITCH_NAMES[code] || []).includes(pt)) return true;
        }
        return false;
      });
      selected.push(...(matches as unknown as Array<Record<string, unknown>>));
    }
    selected.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const seen = new Set<string>();
    filteredABs = selected.filter((ab) => { const k = `${ab.date}-${ab.ev}-${ab.angle}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }

  // Apply the new PropFinder-style filters (Arm/Day-Night/Home-Away) on top
  // of the pitch-type filter. Each is a no-op when set to "Both".
  filteredABs = filteredABs.filter((ab) => {
    if (armFilter !== "Both" && String(ab.pitch_arm ?? "") !== armFilter) return false;
    if (dnFilter  !== "Both" && String(ab.day_night ?? "") !== dnFilter)  return false;
    if (haFilter  !== "Both" && String(ab.home_away ?? "") !== haFilter)  return false;
    return true;
  });

  const recentAbsArr = scores.recent_abs ?? [];
  const flyBalls = recentAbsArr.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrInLookback = recentAbsArr.filter((ab) => ab.result === "home_run").length;
  const hrFbPct = flyBalls.length > 0 ? (hrInLookback / flyBalls.length) * 100 : null;
  const pullBrl = player.season_profile?.pull_barrel ?? null;

  const isSeasonMode = scores.data_quality === "SEASON";
  const bip = scores.bip ?? 0;

  let displayBarrel = scores.barrel_pct, displayFb = scores.fb_pct;
  let displayLd: number | null = (bip < 3 && scores.ld_pct === 0) ? null : (scores.ld_pct ?? null);
  let displayGb: number | null = (bip < 3 && scores.gb_pct === 0) ? null : (scores.gb_pct ?? null);
  let displayHardHit = scores.hard_hit_pct, displayEv = scores.exit_velo;
  let displayHrFb: number | null = hrFbPct;
  // PU% (pop-ups) — Statcast doesn't surface this directly, but the four
  // launch-angle buckets (GB/LD/FB/PU) sum to 100% of BIP. Derive PU% by
  // subtracting the three we do have. Falls back to null if any input is
  // unknown so we don't render a misleading number.
  const _puFromBuckets = (gb: number | null, ld: number | null, fb: number | null): number | null =>
    (gb == null || ld == null || fb == null) ? null
      : Math.max(0, Math.round((100 - gb - ld - fb) * 10) / 10);
  let displayPu: number | null = _puFromBuckets(displayGb, displayLd, displayFb);
  // Blast% — must be `let` so the pitch-filter recompute can override with
  // a raw count over the filtered pool (otherwise it locks to the season /
  // L10 value regardless of which pitch chip is on).
  let displayBlast: number | null = scores.blast_pct ?? player.season_profile?.blast ?? null;

  // Pitch-filter aware stat recompute. Computes raw counts over the same
  // pool the AB table below shows (filteredABs) — so the cards and the log
  // can never disagree. No pitch-mix weighting at any layer.
  //
  // Note: for L5/L10 the AB table source is `pitchAbsData[pitch]` (the
  // per-pitch BBE log baked into the slate), which can hold more entries
  // than scores.recent_abs's 10-row arsenal pool. That's why "Cutter only"
  // can show a populated table while scores.recent_abs has zero cutters.
  // Using filteredABs as the stat pool keeps them in sync.
  if (pitchFilter.size > 0 && filteredABs.length > 0) {
    const n = filteredABs.length;
    const pct = (count: number) => Math.round((count / n) * 1000) / 10;
    let gb = 0, ld = 0, fb = 0, pu = 0, brl = 0, hh = 0, blast = 0;
    let evSum = 0;
    let fbCt = 0, hrCt = 0;
    for (const ab of filteredABs) {
      const ev = Number(ab.ev || 0);
      const la = Number(ab.angle || 0);
      const bs = ab.bat_speed == null ? null : Number(ab.bat_speed);
      evSum += ev;
      if (ev >= 95) hh += 1;
      if (ev >= 98 && la >= 26 && la <= 30) brl += 1;
      if (la >= 25 && la <= 50) { fb += 1; fbCt += 1; if (ab.result === "home_run") hrCt += 1; }
      else if (la >= 10 && la < 25) ld += 1;
      else if (la < 10) gb += 1;
      else pu += 1;
      if (bs != null && bs >= 75 && ev >= 95) blast += 1;
    }
    displayBarrel  = pct(brl);
    displayFb      = pct(fb);
    displayLd      = pct(ld);
    displayGb      = pct(gb);
    displayHardHit = pct(hh);
    displayEv      = Math.round((evSum / n) * 10) / 10;
    displayPu      = pct(pu);
    displayHrFb    = fbCt > 0 ? Math.round((hrCt / fbCt) * 1000) / 10 : null;
    // Blast% = bat_speed >= 75 AND launch_speed >= 95, raw count over
    // filtered pool. Will show null on slates pre-dating the bat_speed
    // backend field — every ab.bat_speed null → blast count stays 0 but
    // the % is meaningful only when the field exists.
    const haveBatSpeed = filteredABs.some((ab) => ab.bat_speed != null);
    displayBlast = haveBatSpeed ? pct(blast) : null;
  } else if (pitchFilter.size > 0) {
    displayBarrel = 0; displayFb = 0; displayLd = 0;
    displayGb = 0; displayHardHit = 0; displayEv = 0;
    displayPu = null; displayHrFb = null; displayBlast = null;
  }
  void recentAbsArr;

  const pitchDetailEntries = Object.entries(pitchDetail).sort((a, b) => (b[1].usage_pct ?? 0) - (a[1].usage_pct ?? 0));
  const matchup = matchupLabel(pitchDetail);
  const playerTags = buildTags(player, parkFactor);

  // displayBlast is declared up with the other display lets (above the
  // pitch-filter recompute block) so the recompute branch can override it.
  const displayPullBrl = player.season_profile?.pull_barrel ?? null;
  const statCards = [
    { label: "Avg EV",     value: `${displayEv}`,                                             cls: statHighlight(displayEv, [88, 93]) },
    { label: "Barrel%",    value: `${displayBarrel}%`,                                        cls: statHighlight(displayBarrel, [8, 15]) },
    { label: "GB%",        value: displayGb === null ? "—" : `${displayGb}%`,                cls: "text-foreground" },
    { label: "FB%",        value: `${displayFb}%`,                                            cls: statHighlight(displayFb, [25, 40]) },
    { label: "LD%",        value: displayLd === null ? "—" : `${displayLd}%`,                cls: "text-foreground" },
    { label: "PU%",        value: displayPu === null ? "—" : `${displayPu}%`,                cls: "text-foreground" },
    { label: "HR/FB%",     value: displayHrFb == null ? "—" : `${displayHrFb.toFixed(1)}%`,  cls: displayHrFb == null ? "text-foreground" : statHighlight(displayHrFb, [10, 18]) },
    { label: "Hard Hit%",  value: `${displayHardHit}%`,                                       cls: statHighlight(displayHardHit, [35, 50]) },
    { label: "Blast%",     value: displayBlast == null ? "—" : `${displayBlast}%`,           cls: displayBlast == null ? "text-foreground" : statHighlight(displayBlast, [10, 20]) },
    { label: "Pull Brl%",  value: displayPullBrl == null ? "—" : `${displayPullBrl}%`,       cls: displayPullBrl == null ? "text-foreground" : statHighlight(displayPullBrl, [3, 8]) },
  ];

  return (
    <div className="max-w-5xl mx-auto px-1 py-2 space-y-5">
      {/* Back row — lookback toggle moved into the filter dropdown row below
          so it's part of the unified Events/Arm/D-N/H-A/Pitch filter group. */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={15} />
          <span>Back to game</span>
        </button>
        {teamAbbr && (
          <>
            <span className="text-muted/30 text-xs">·</span>
            <img src={teamLogoUrl(teamAbbr)} alt={teamAbbr} className="w-5 h-5 object-contain opacity-60" />
          </>
        )}
      </div>

        {/* Player header */}
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0">
            {mlbId ? (
              <img
                src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
                alt={player.name}
                className="w-20 h-20 rounded-full object-cover"
                style={{ border: "2px solid rgba(255,255,255,0.12)" }}
              />
            ) : (
              <div className="w-20 h-20 rounded-full" style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.10)" }} />
            )}
            {battingOrder !== null && (
              <span className="absolute -bottom-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold text-black" style={{ background: "var(--accent)" }}>
                {battingOrder}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-foreground leading-tight">{player.name}</h1>
              {onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(player.name)}
                  className="cursor-pointer transition-transform hover:scale-110 active:scale-95 flex-shrink-0"
                  aria-label={isFavorited ? "Remove from picks" : "Add to picks"}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isFavorited ? "var(--accent-yellow)" : "none"} stroke={isFavorited ? "var(--accent-yellow)" : "rgba(255,255,255,0.3)"} strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>
              )}
            </div>
            {/* Handedness matchup badge — prominent */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-0 rounded-lg overflow-hidden text-[11px] font-bold font-mono" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                <span className="px-2.5 py-1" style={{ background: "rgba(96,165,250,0.18)", color: "rgba(147,197,253,1)" }}>
                  {player.batter_hand === "L" ? "LHB" : player.batter_hand === "R" ? "RHB" : "SHB"}
                </span>
                <span className="px-1.5 py-1 text-[10px] font-normal" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>vs</span>
                <span className="px-2.5 py-1" style={{ background: player.pitcher_hand === "L" ? "rgba(251,191,36,0.18)" : "rgba(248,113,113,0.18)", color: player.pitcher_hand === "L" ? "rgba(253,224,132,1)" : "rgba(252,165,165,1)" }}>
                  {player.pitcher_hand}HP
                </span>
              </div>
              <span className="text-sm text-muted truncate">vs {player.opp_pitcher}</span>
              {player.pitcher_data_year === 2025 && (
                <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-400/15 text-amber-400/90 border border-amber-400/20">2025 data</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Badges read from the L10 score directly — decoupled from
                  activeLookback so swapping Events doesn't toggle NEW /
                  LOW_SAMPLE chips, which was causing the visible page
                  shift the user kept calling out. */}
              {(() => {
                const lockedScores = player.scores.L10 ?? scores;
                return (
                  <>
                    <RatingBadge composite={lockedScores.composite} />
                    {lockedScores.recent_abs.length <= 2 && (
                      <Tooltip text="Limited MLB data — score may not reflect true ability">
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20">NEW</span>
                      </Tooltip>
                    )}
                    {lockedScores.data_quality !== "OK" && lockedScores.recent_abs.length > 2 && (
                      <Tooltip text={lockedScores.data_quality === "LOW_SAMPLE" ? "Fewer than 5 balls in play" : "Pitcher has less than 10 innings"}>
                        <span className="px-1.5 py-0.5 text-[9px] rounded bg-accent-yellow/10 text-accent-yellow">{lockedScores.data_quality.replace(/_/g, " ")}</span>
                      </Tooltip>
                    )}
                  </>
                );
              })()}
            </div>
            {playerTags.length > 0 && (
              <div className="mt-2">
                <PlayerTagPills tags={playerTags} />
              </div>
            )}
          </div>
        </div>

        {/* Score bar */}
        <ScoreBar value={scores.composite} />

        {/* HR Signal — collapsed by default to save vertical space; users
            who want the breakdown can click open. */}
        <details className="rounded-xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <summary className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted cursor-pointer flex items-center justify-between">
            <span>Power Signals</span>
            <span className="text-[10px] text-muted/50 normal-case tracking-normal">click to expand</span>
          </summary>
          <div className="px-1 pb-2">
            <HRSignalCard player={player} />
          </div>
        </details>

        {/* Pitch Matchup */}
        {pitchDetailEntries.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/55">Pitch Matchup</span>
                <div className="flex items-center gap-0 rounded overflow-hidden text-[10px] font-bold font-mono" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>
                  <span className="px-1.5 py-0.5" style={{ background: "rgba(96,165,250,0.15)", color: "rgba(147,197,253,0.9)" }}>
                    {player.batter_hand === "L" ? "LHB" : player.batter_hand === "R" ? "RHB" : "SHB"}
                  </span>
                  <span className="px-1 py-0.5 text-[9px] font-normal" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>vs</span>
                  <span className="px-1.5 py-0.5" style={{ background: player.pitcher_hand === "L" ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.15)", color: player.pitcher_hand === "L" ? "rgba(253,224,132,0.9)" : "rgba(252,165,165,0.9)" }}>
                    {player.pitcher_hand}HP
                  </span>
                </div>
              </div>
              <span className={`text-xs font-bold ${matchup.color}`}>{matchup.label}</span>
            </div>
            <div className="space-y-1.5">
              {pitchDetailEntries.map(([pt, d]) => {
                const score = pitchScore(d); const c = SCORE_COLORS[score];
                return (
                  <div key={pt} className={`flex items-center px-3 py-2.5 rounded-lg border ${c.bg}`} style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 -1px 0 0 rgba(0,0,0,0.25), 0 2px 6px -2px rgba(0,0,0,0.4)" }}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                    <span className="text-xs font-mono font-bold text-foreground ml-2.5 w-7 flex-shrink-0">{pt}</span>
                    <span className="text-[11px] text-muted flex-1 min-w-0 truncate ml-1">{PITCH_NAMES[pt]?.[0] || pt}</span>
                    <div className="flex items-stretch flex-shrink-0 ml-2" style={{ gap: 0 }}>
                      <div className="flex flex-col items-center justify-center px-3" style={{ borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
                        <span className="text-[8px] uppercase tracking-wider text-muted/45 leading-none mb-0.5">Usage</span>
                        <span className="text-[13px] font-mono text-muted/75 leading-none">{d.usage_pct ?? "—"}%</span>
                      </div>
                      <div className="flex flex-col items-center justify-center px-3" style={{ borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
                        <span className="text-[8px] uppercase tracking-wider text-muted/45 leading-none mb-0.5">Brl%</span>
                        <span className={`text-[13px] font-mono font-bold leading-none ${c.text}`}>{d.barrel_rate != null ? `${d.barrel_rate}%` : "—"}</span>
                      </div>
                      <div className="flex flex-col items-center justify-center px-3" style={{ borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
                        <span className="text-[8px] uppercase tracking-wider text-muted/45 leading-none mb-0.5">Avg EV</span>
                        <span className="text-[13px] font-mono font-bold leading-none" style={{ color: evGradient(d.avg_exit_velo) }}>{d.avg_exit_velo != null ? d.avg_exit_velo : "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-pitch EV / LA breakdown */}
        {pitchDetailEntries.length > 0 && pitchAbsData && (
          <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.10), inset 0 -1px 0 0 rgba(0,0,0,0.3), 0 4px 10px -2px rgba(0,0,0,0.5)" }}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
              <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-foreground/55">EV &amp; LA vs Arsenal</span>
              <div className="flex items-center gap-0 rounded overflow-hidden text-[10px] font-bold font-mono" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>
                <span className="px-1.5 py-0.5" style={{ background: "rgba(96,165,250,0.15)", color: "rgba(147,197,253,0.9)" }}>
                  {player.batter_hand === "L" ? "LHB" : player.batter_hand === "R" ? "RHB" : "SHB"}
                </span>
                <span className="px-1 py-0.5 text-[9px] font-normal" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>vs</span>
                <span className="px-1.5 py-0.5" style={{ background: player.pitcher_hand === "L" ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.15)", color: player.pitcher_hand === "L" ? "rgba(253,224,132,0.9)" : "rgba(252,165,165,0.9)" }}>
                  {player.pitcher_hand}HP
                </span>
              </div>
              <span className="text-[9px] text-muted/50">recent BIPs</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <th className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold text-left">Pitch</th>
                    <th className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold text-right">Avg EV</th>
                    <th className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold text-right">Avg LA</th>
                    <th className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold text-right">Brl%</th>
                    <th className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold text-right">BIPs</th>
                  </tr>
                </thead>
                <tbody>
                  {pitchDetailEntries.map(([pt, d], idx) => {
                    const abs = pitchAbsData[pt] ?? [];
                    const evPill = (ev: number | null | undefined): { bg: string; cls: string } => {
                      if (ev == null || ev === 0) return { bg: "transparent", cls: "text-muted/40" };
                      return { bg: "transparent", cls: "font-bold" };
                    };
                    const laPill = (la: number | null | undefined): { bg: string; cls: string } => {
                      if (la == null) return { bg: "transparent", cls: "text-muted/40" };
                      if (la >= 20 && la <= 35) return { bg: "rgba(34,197,94,0.20)", cls: "text-accent-green font-bold" };
                      if (la >= 10 && la <= 45) return { bg: "rgba(34,197,94,0.08)", cls: "text-foreground font-semibold" };
                      return { bg: "rgba(239,68,68,0.12)", cls: "text-red-400 font-bold" };
                    };
                    const brlPct = d.barrel_rate != null ? d.barrel_rate : null;
                    const brlPill: { bg: string; cls: string } = brlPct == null
                      ? { bg: "transparent", cls: "text-muted/40" }
                      : brlPct >= 15
                      ? { bg: "rgba(34,197,94,0.20)", cls: "text-accent-green font-bold" }
                      : brlPct >= 8
                      ? { bg: "rgba(34,197,94,0.08)", cls: "text-foreground font-semibold" }
                      : { bg: "rgba(239,68,68,0.10)", cls: "text-red-400 font-bold" };
                    const pitchName = PITCH_NAMES[pt] ? `${PITCH_NAMES[pt][0]}${PITCH_NAMES[pt][1] ? ` ${PITCH_NAMES[pt][1]}` : ""}` : pt;
                    const { bg: evBg, cls: evCls } = evPill(d.avg_exit_velo);
                    const { bg: laBg, cls: laCls } = laPill(d.avg_launch_angle);
                    return (
                      <tr key={pt} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: idx % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                        <td className="px-4 py-2.5">
                          <span className="text-[11px] font-mono font-bold text-foreground">{pt}</span>
                          <span className="text-[10px] text-muted/60 ml-2">{pitchName}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-[12px] font-mono px-2 py-0.5 rounded ${evCls}`} style={{ background: evBg, color: d.avg_exit_velo > 0 ? evGradient(d.avg_exit_velo) : undefined }}>
                            {d.avg_exit_velo > 0 ? d.avg_exit_velo : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-[12px] font-mono px-2 py-0.5 rounded ${laCls}`} style={{ background: laBg }}>
                            {d.avg_launch_angle != null ? `${d.avg_launch_angle}°` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-[12px] font-mono px-2 py-0.5 rounded ${brlPill.cls}`} style={{ background: brlPill.bg }}>
                            {brlPct != null ? `${brlPct.toFixed(0)}%` : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-[11px] font-mono text-muted/60">{abs.length > 0 ? abs.length : d.count ?? "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Switch Hitter dropdown — preserves filter selections while jumping
            to another batter in the same game. Hidden when no callback supplied
            (e.g. unit tests, embedded views). */}
        {gamePlayers && onSwitchPlayer && gamePlayers.length > 1 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted/60 mb-1.5">
              Switch Hitter <span className="text-muted/40 normal-case tracking-normal">· keeps your filters</span>
            </div>
            <select
              value={player.name}
              onChange={(e) => { if (e.target.value !== player.name) onSwitchPlayer(e.target.value); }}
              className="w-full max-w-xs px-3 py-2 text-sm bg-card/50 border border-card-border rounded-lg text-foreground focus:outline-none focus:border-accent/50 cursor-pointer"
            >
              {gamePlayers.map((gp) => (
                <option key={gp.name} value={gp.name}>
                  {gp.battingOrder != null ? `${gp.battingOrder}. ` : ""}{gp.name} ({gp.hand})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Filter dropdown row — Events / Pitch Arm / Day-Night / Home-Away /
            Pitch Type. Was sticky-pinned but the top:0 anchored it to the
            window, not the dashboard chrome — so it punched up over the page
            header / sidebar. Reverted to inline. AB table below scrolls
            internally instead so toggling Events doesn't reflow the page. */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <FilterDropdown
            label="Events"
            value={activeLookback}
            onChange={(v) => setActiveLookback(v as UILookback)}
            options={[
              { value: "L5",  label: "L5" },
              { value: "L10", label: "L10" },
              { value: "L15", label: "L15" },
              { value: "L20", label: "L20" },
              { value: "L25", label: "L25" },
            ]}
          />
          <FilterDropdown
            label="Pitch Arm"
            value={armFilter}
            onChange={(v) => setArmFilter(v as "L" | "R" | "Both")}
            options={[
              { value: "Both", label: "Both" },
              { value: "L", label: "LHP" },
              { value: "R", label: "RHP" },
            ]}
          />
          <FilterDropdown
            label="Day / Night"
            value={dnFilter}
            onChange={(v) => setDnFilter(v as "D" | "N" | "Both")}
            options={[
              { value: "Both", label: "Both" },
              { value: "D", label: "Day" },
              { value: "N", label: "Night" },
            ]}
          />
          <FilterDropdown
            label="Home / Away"
            value={haFilter}
            onChange={(v) => setHaFilter(v as "H" | "A" | "Both")}
            options={[
              { value: "Both", label: "Both" },
              { value: "H", label: "Home" },
              { value: "A", label: "Away" },
            ]}
          />
          <PitchMultiSelect
            chipList={chipList}
            selected={pitchFilter}
            onToggle={(pt) => setPitchFilter((prev) => { const next = new Set(prev); if (next.has(pt)) next.delete(pt); else next.add(pt); return next; })}
            onClearAll={() => setPitchFilter(new Set())}
            onSelectAll={() => setPitchFilter(new Set(chipList.map((c) => c.type)))}
            onSelectArsenal={() => setPitchFilter(new Set(chipList.filter((c) => c.usage >= 12).map((c) => c.type)))}
            pitchNames={PITCH_NAMES}
          />
        </div>

        {/* 10 stat cards — GB FB LD PU HRFB HH AvgEV Brl Blast PullBrl */}
        <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
          {statCards.map(({ label, value, cls }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.14), inset 0 -1px 0 0 rgba(0,0,0,0.35), 0 4px 10px -2px rgba(0,0,0,0.55)",
              }}>
              <span className="text-[9px] uppercase tracking-[0.08em] text-muted/60 leading-none text-center">{label}</span>
              <span className={`font-mono text-[14px] font-semibold leading-none ${cls}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* AB log — fixed height with internal scroll. User explicitly chose
            "no page shift on Events change" over "no empty space at L5".
            Browser scroll position is preserved between L5 and L25 because
            the table container size doesn't change. */}
        <div>
          <div className="overflow-auto rounded-xl"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
              height: 560,
              overflowAnchor: "none",
            }}>
            {filteredABs.length > 0 ? (
              <table className="w-full text-[13px]">
                <thead style={{ background: "rgba(20,20,22,0.95)" }}>
                  <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                    <th className="text-left  py-2 pl-3 pr-2 font-semibold">Date</th>
                    <th className="text-left  py-2 px-2 font-semibold">Pitcher</th>
                    <th className="text-center py-2 px-2 font-semibold">Arm</th>
                    <th className="text-center py-2 px-2 font-semibold">D/N</th>
                    <th className="text-left  py-2 px-2 font-semibold">Pitch Type</th>
                    <th className="text-center py-2 px-2 font-semibold">EV</th>
                    <th className="text-center py-2 px-2 font-semibold">LA</th>
                    <th className="text-center py-2 px-2 font-semibold">Dist</th>
                    <th className="text-center py-2 px-2 font-semibold">Brl</th>
                    <th className="text-center py-2 px-2 font-semibold">Blast</th>
                    <th className="text-center py-2 px-2 font-semibold">Dir</th>
                    <th className="text-left  py-2 px-2 font-semibold">Event</th>
                    <th className="text-left  py-2 px-2 pr-3 font-semibold">BB Type</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredABs.map((ab, i) => {
                    const ev = Number(ab.ev);
                    const la = Number(ab.angle);
                    const isHR = ab.result === "home_run";
                    const isBarrel = ev >= 98 && la >= 26 && la <= 30;
                    const bs = ab.bat_speed == null ? null : Number(ab.bat_speed);
                    const isBlast = bs != null && bs >= 75 && ev >= 95;
                    const bbType: string =
                      la == null || Number.isNaN(la) ? "—"
                      : la < 10 ? "Ground Ball"
                      : la < 25 ? "Line Drive"
                      : la <= 50 ? "Fly Ball"
                      : "Pop Up";
                    const dirRaw = String(ab.direction ?? "");
                    const dir = dirRaw === "pull" ? "pull" : dirRaw === "center" ? "center" : dirRaw === "oppo" ? "oppo" : "—";
                    const dirCls = dir === "pull" ? "text-accent-yellow" : dir === "oppo" ? "text-accent-green" : dir === "center" ? "text-foreground/70" : "text-muted/40";
                    const rowBg = isHR ? "rgba(74,222,128,0.12)" : isBarrel ? "rgba(96,165,250,0.08)" : "transparent";
                    return (
                      <tr key={i} className="border-b border-card-border/30 last:border-0" style={{ background: rowBg }}>
                        <td className="py-2.5 pl-3 pr-2 text-foreground/75 font-mono text-[12px]">{String(ab.date)}</td>
                        <td className="py-2.5 px-2 text-foreground text-[12px]">{String(ab.pitcher_name ?? "")}</td>
                        <td className="py-2.5 px-2 text-center text-foreground/70 font-mono">{String(ab.pitch_arm ?? "—")}</td>
                        <td className="py-2.5 px-2 text-center text-muted/50 font-mono">{String(ab.day_night ?? "—")}</td>
                        <td className="py-2.5 px-2 text-foreground/85 text-[12px]">{String(ab.pitch_type ?? "—")}</td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="font-mono font-semibold" style={{ color: evGradient(ev) }}>{String(ab.ev)}</span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${angleColor(la)}`}>{String(ab.angle)}</span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${distColor(ab.distance != null ? Number(ab.distance) : null)}`}>
                            {ab.distance ? String(ab.distance) : "—"}
                          </span>
                        </td>
                        <td className={`py-2.5 px-2 text-center font-mono ${isBarrel ? "text-accent-green font-bold" : "text-muted/40"}`}>
                          {isBarrel ? 1 : 0}
                        </td>
                        <td className={`py-2.5 px-2 text-center font-mono ${isBlast ? "text-accent-green font-bold" : "text-muted/40"}`}>
                          {bs == null ? "—" : isBlast ? 1 : 0}
                        </td>
                        <td className={`py-2.5 px-2 text-center font-mono ${dirCls}`}>{dir}</td>
                        <td className={`py-2.5 px-2 text-[12px] capitalize ${isHR ? "text-accent-green font-bold" : "text-foreground/80"}`}>
                          {String(ab.result ?? "").replace(/_/g, " ")}
                        </td>
                        <td className="py-2.5 px-2 pr-3 text-foreground/65 text-[12px]">{bbType}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted px-4 py-8 text-center">No ABs match these filters.</p>
            )}
          </div>
        </div>

        {/* Profile (per-pitch detail) and BvP collapsed below the AB table —
            still accessible, just no longer the lead. Wrap in <details> so
            users who don't need them aren't paying for the screen real estate. */}
        <details className="rounded-xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <summary className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted cursor-pointer">More — Pitch Profile · Arsenal · vs Pitcher</summary>
          <div className="px-4 pb-4 pt-1 space-y-4">
            <BatterProfileRow recentAbs={scores.recent_abs ?? []} pitcherName={player.opp_pitcher} pitcherHand={player.pitcher_hand} batterHand={player.batter_hand} pitchTypes={pitchTypes} lookback={activeLookback} />
            <PitchesTab player={player} />
            <BvPTab player={player} />
          </div>
        </details>

        {/* Zone Overlap */}
        {player.batter_zones && (
          <ZoneGrid batter_zones={player.batter_zones} pitcher_zone_freq={player.pitcher_zone_freq ?? []} />
        )}
      </div>
  );
}
