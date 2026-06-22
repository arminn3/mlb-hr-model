"use client";

import { useState, useEffect, useMemo } from "react";
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
}) {
  const [detailTab, setDetailTab] = useState<"abs" | "statcast" | "pitches" | "bvp" | "profile">("abs");
  const [activeLookback, setActiveLookback] = useState<UILookback>(lookback);

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
  const limit = activeLookback === "L5" ? 5 : activeLookback === "Season" ? 25 : 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredABs: any[];
  if (pitchFilter.size === 0) {
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

  if (pitchFilter.size > 0) {
    let totalCount = 0, wBarrel = 0, wFb = 0, wLd = 0, wGb = 0, wHard = 0, wEv = 0;
    for (const pt of pitchFilter) {
      const d = pitchDetail[pt]; if (!d) continue;
      const c = d.count ?? 0; totalCount += c;
      wBarrel += (d.barrel_rate ?? 0) * c; wFb += (d.fb_rate ?? 0) * c;
      wLd += (d.ld_rate ?? 0) * c; wGb += (d.gb_rate ?? 0) * c;
      wHard += (d.hard_hit_rate ?? 0) * c; wEv += (d.avg_exit_velo ?? 0) * c;
    }
    if (totalCount > 0) {
      displayBarrel = Math.round((wBarrel / totalCount) * 10) / 10;
      displayFb = Math.round((wFb / totalCount) * 10) / 10;
      displayLd = Math.round((wLd / totalCount) * 10) / 10;
      displayGb = Math.round((wGb / totalCount) * 10) / 10;
      displayHardHit = Math.round((wHard / totalCount) * 10) / 10;
      displayEv = Math.round((wEv / totalCount) * 10) / 10;
    } else { displayBarrel = 0; displayFb = 0; displayLd = 0; displayGb = 0; displayHardHit = 0; displayEv = 0; }
    const filterAbs = recentAbsArr.filter((ab) => {
      const pt = ab.pitch_type ?? "";
      if (pitchFilter.has(pt)) return true;
      for (const code of pitchFilter) if ((PITCH_NAMES[code] || []).includes(pt)) return true;
      return false;
    });
    const fFb = filterAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
    const fHr = filterAbs.filter((ab) => ab.result === "home_run").length;
    displayHrFb = fFb.length > 0 ? (fHr / fFb.length) * 100 : null;
  }

  const pitchDetailEntries = Object.entries(pitchDetail).sort((a, b) => (b[1].usage_pct ?? 0) - (a[1].usage_pct ?? 0));
  const matchup = matchupLabel(pitchDetail);
  const playerTags = buildTags(player, parkFactor);

  const statCards = [
    { label: "Exit Velo",  value: `${displayEv}`,                                           cls: statHighlight(displayEv, [88, 93]) },
    { label: "Barrel%",    value: `${displayBarrel}%`,                                       cls: statHighlight(displayBarrel, [8, 15]) },
    { label: "Hard Hit%",  value: `${displayHardHit}%`,                                      cls: statHighlight(displayHardHit, [35, 50]) },
    { label: "HR/FB%",     value: displayHrFb == null ? "—" : `${displayHrFb.toFixed(1)}%`, cls: displayHrFb == null ? "text-muted" : statHighlight(displayHrFb, [10, 18]) },
    { label: "GB%",        value: displayGb === null ? "—" : `${displayGb}%`,               cls: "text-muted" },
    { label: "LD%",        value: displayLd === null ? "—" : `${displayLd}%`,               cls: "text-muted" },
    { label: "FB%",        value: `${displayFb}%`,                                           cls: statHighlight(displayFb, [25, 40]) },
    { label: "Pull Brl%",  value: pullBrl == null ? "—" : `${pullBrl.toFixed(1)}%`,          cls: pullBrl == null ? "text-muted" : statHighlight(pullBrl, [4, 8]) },
    { label: "Season FB%", value: player.season_profile?.fb != null ? `${player.season_profile.fb}%` : "—", cls: player.season_profile?.fb != null ? statHighlight(player.season_profile.fb, [25, 40]) : "text-muted" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-1 py-2 space-y-5">
      {/* Back row */}
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
        <div className="flex items-center p-1 rounded-xl gap-0.5 ml-auto" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
          {(["L5", "L10", "Season"] as UILookback[]).map((lb) => (
            <button key={lb} onClick={() => setActiveLookback(lb)}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-all ${activeLookback === lb ? "bg-accent text-white shadow-[0_1px_4px_0_rgba(0,0,0,0.4)]" : "text-muted hover:text-foreground"}`}>
              {lb}
            </button>
          ))}
        </div>
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
              <RatingBadge composite={scores.composite} />
              {scores.recent_abs.length <= 2 && (
                <Tooltip text="Limited MLB data — score may not reflect true ability">
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20">NEW</span>
                </Tooltip>
              )}
              {scores.data_quality !== "OK" && scores.recent_abs.length > 2 && (
                <Tooltip text={scores.data_quality === "LOW_SAMPLE" ? "Fewer than 5 balls in play" : "Pitcher has less than 10 innings"}>
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-accent-yellow/10 text-accent-yellow">{scores.data_quality.replace(/_/g, " ")}</span>
                </Tooltip>
              )}
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

        {/* HR Signal */}
        <HRSignalCard player={player} />

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

        {/* Stat cards — sit directly above the pitch filter so the user can
            see the numbers and the chip controls together. Both windows
            (L5/L10/Season) AND selected pitches drive these values. */}
        <div className="grid grid-cols-3 gap-2">
          {statCards.map(({ label, value, cls }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.14), inset 0 -1px 0 0 rgba(0,0,0,0.35), 0 4px 10px -2px rgba(0,0,0,0.55)",
              }}>
              <span className="text-[10px] uppercase tracking-[0.08em] text-muted/60 leading-none">{label}</span>
              <span className={`font-mono text-base font-semibold leading-none ${cls}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* Pitch filter chips — strictly the opposing pitcher's vs-hand arsenal.
            Every pitch the pitcher actually throws to this hand appears (no
            usage threshold). Default selection is ≥12% (auto-set). Clicking
            "All Pitches" toggles between selecting everything and clearing
            so the user can isolate single pitches. */}
        {chipList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                // Toggle: if everything is already selected, clear so the user
                // can hand-pick chips. Otherwise select the whole arsenal.
                if (pitchFilter.size === chipList.length) setPitchFilter(new Set());
                else setPitchFilter(new Set(chipList.map((c) => c.type)));
              }}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${pitchFilter.size === chipList.length ? "bg-accent/20 text-accent border border-accent/40" : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"}`}>
              All Pitches
            </button>
            {chipList.map(({ type: pt, usage }) => {
              const detail = pitchDetail[pt];
              const name = PITCH_NAMES[pt]?.[0] || pt;
              const tipText = detail
                ? `${name} — ${usage}% of pitches. Barrel: ${detail.barrel_rate}%, FB: ${detail.fb_rate}%, EV: ${detail.avg_exit_velo}`
                : `${name} — ${usage}% of pitches`;
              const sel = pitchFilter.has(pt);
              return (
                <Tooltip key={pt} text={tipText}>
                  <button onClick={() => setPitchFilter((prev) => { const next = new Set(prev); if (next.has(pt)) next.delete(pt); else next.add(pt); return next; })}
                    className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${sel ? "bg-accent/20 text-accent border border-accent/40" : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"}`}>
                    {pt} {usage}%
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        {/* Tabs */}
        <div>
          <div className="inline-flex items-center p-1 rounded-2xl mb-4 gap-0.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {(["abs", "statcast", "pitches", "bvp", "profile"] as const).map((tab) => (
              <button key={tab} onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-lg cursor-pointer transition-all ${detailTab === tab ? "bg-accent text-white shadow-[0_1px_4px_0_rgba(0,0,0,0.4)]" : "text-muted hover:text-foreground"}`}>
                {tab === "profile" ? `Profile · ${activeLookback}` : tab === "abs" ? `ABs · ${activeLookback}` : tab === "statcast" ? "Pitches" : tab === "pitches" ? "Arsenal" : "vs Pitcher"}
              </button>
            ))}
          </div>

          {detailTab === "profile" && (
            <BatterProfileRow recentAbs={scores.recent_abs ?? []} pitcherName={player.opp_pitcher} pitcherHand={player.pitcher_hand} batterHand={player.batter_hand} pitchTypes={pitchTypes} lookback={activeLookback} />
          )}

          {detailTab === "abs" && (
            <div className="overflow-x-auto">
              {filteredABs.length > 0 ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-foreground/65 border-b border-card-border">
                      <th className="text-left py-2.5 pl-3 pr-3 font-semibold">Date</th>
                      <th className="text-left py-2.5 pr-3 font-semibold">Pitcher</th>
                      <th className="text-center py-2.5 px-2 font-semibold">Arm</th>
                      <th className="text-left py-2.5 pr-3 font-semibold">Pitch</th>
                      <th className="text-center py-2.5 px-2 font-semibold">EV</th>
                      <th className="text-center py-2.5 px-2 font-semibold">Angle</th>
                      <th className="text-center py-2.5 px-2 font-semibold">Dist</th>
                      <th className="text-left py-2.5 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredABs.map((ab, i) => {
                      const isHR = ab.result === "home_run";
                      // Statcast barrel: EV>=98 AND launch angle 26-30 (the canonical
                      // "barrel" zone). Excludes HRs since they already get their own row tint.
                      const ev = Number(ab.ev);
                      const la = Number(ab.angle);
                      const isBarrel = !isHR && ev >= 98 && la >= 26 && la <= 30;
                      const rowBg = isHR
                        ? "rgba(74,222,128,0.12)"          // light green — HR
                        : isBarrel
                        ? "rgba(96,165,250,0.12)"          // light blue — barrel
                        : "transparent";
                      return (
                      <tr key={i} className="border-b border-card-border/30 last:border-0" style={{ background: rowBg }}>
                        <td className="py-3 pl-3 pr-3 text-foreground/75 font-mono">{String(ab.date).slice(5)}</td>
                        <td className="py-3 pr-3 text-foreground">{String(ab.pitcher_name ?? "")}</td>
                        <td className="py-3 px-2 text-center text-foreground/70 font-mono">{String(ab.pitch_arm ?? "")}</td>
                        <td className="py-3 pr-3 text-foreground">{String(ab.pitch_type ?? "")}</td>
                        <td className="py-3 px-2 text-center">
                          <span className="px-1.5 py-0.5 rounded font-mono font-semibold" style={{ color: evGradient(Number(ab.ev)) }}>{String(ab.ev)}</span>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded font-mono ${angleColor(Number(ab.angle))}`}>{String(ab.angle)}</span>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded font-mono ${distColor(ab.distance != null ? Number(ab.distance) : null)}`}>
                            {ab.distance ? String(ab.distance) : "-"}
                          </span>
                        </td>
                        <td className="py-3 text-foreground/80 capitalize">{String(ab.result ?? "").replace(/_/g, " ")}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted py-2">No recent AB data{pitchFilter.size > 0 ? ` against ${[...pitchFilter].join(", ")}` : ""}.</p>
              )}
            </div>
          )}

          {detailTab === "statcast" && (
            <div className="overflow-x-auto">
              {Object.keys(pitchDetail).length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                      <th className="text-left py-1.5 pr-3">Pitch</th>
                      <th className="text-center py-1.5 px-2">Usage%</th>
                      <th className="text-center py-1.5 px-2">Weight%</th>
                      <th className="text-center py-1.5 px-2">Barrel%</th>
                      <th className="text-center py-1.5 px-2">FB%</th>
                      <th className="text-center py-1.5 px-2">HH%</th>
                      <th className="text-center py-1.5 px-2">Avg EV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pitchDetail).map(([pt, d]: [string, PitchDetailEntry]) => (
                      <tr key={pt} className="border-b border-card-border/30 last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-foreground">{pt}</td>
                        <td className="py-1.5 px-2 text-center font-mono text-muted">{d.usage_pct}%</td>
                        <td className="py-1.5 px-2 text-center font-mono text-accent">{d.weight}%</td>
                        <td className="py-1.5 px-2 text-center font-mono">{d.barrel_rate}%</td>
                        <td className="py-1.5 px-2 text-center font-mono">{d.fb_rate}%</td>
                        <td className="py-1.5 px-2 text-center font-mono">{d.hard_hit_rate}%</td>
                        <td className="py-1.5 px-2 text-center font-mono">{d.avg_exit_velo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted py-2">No pitch breakdown data.</p>
              )}
            </div>
          )}

          {detailTab === "pitches" && <PitchesTab player={player} />}
          {detailTab === "bvp" && <BvPTab player={player} />}
        </div>

        {/* Zone Overlap */}
        {player.batter_zones && (
          <ZoneGrid batter_zones={player.batter_zones} pitcher_zone_freq={player.pitcher_zone_freq ?? []} />
        )}
      </div>
  );
}
