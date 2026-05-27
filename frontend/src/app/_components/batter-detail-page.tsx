"use client";

import { useState, useEffect } from "react";
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

const PITCH_NAMES: Record<string, string[]> = {
  FF: ["4-Seam Fastball", "Four-Seam"],
  SI: ["Sinker"],
  FC: ["Cutter"],
  SL: ["Slider", "Sweeper"],
  CU: ["Curveball", "Curve"],
  CH: ["Changeup"],
  FS: ["Split-Finger", "Splitter"],
  KC: ["Knuckle Curve"],
  KN: ["Knuckleball"],
  ST: ["Sweeper"],
  SV: ["Slurve"],
};

function evColor(ev: number) {
  if (ev >= 95) return "bg-accent-green/80 text-background";
  if (ev >= 90) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}
function angleColor(angle: number) {
  if (angle >= 25 && angle <= 35) return "bg-accent-green/80 text-background";
  if (angle >= 20 && angle <= 40) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}
function distColor(dist: number | null) {
  if (!dist) return "text-muted";
  if (dist >= 350) return "bg-accent-green/80 text-background";
  if (dist >= 300) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}
function statHighlight(value: number, thresholds: [number, number]) {
  if (value >= thresholds[1]) return "text-accent-green font-semibold";
  if (value >= thresholds[0]) return "text-foreground";
  return "text-muted";
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

  // Find pitcher's top-5 most-used zones
  const sorted = [...pitcher_zone_freq].sort((a, b) => b.pct - a.pct);
  const top5Zones = new Set(sorted.slice(0, 5).map((z) => z.zone));

  // Overlap: batter's hot HR zone AND pitcher frequently attacks it (top 5 zones)
  const isBatterHot = (zn: number) => { const z = bzMap[zn]; return !!(z && z.bip >= 2 && z.hr_rate >= 4); };
  const isPitcherFrequent = (zn: number) => top5Zones.has(zn);
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
              const isTop5 = top5Zones.has(zn);

              // Blue intensity proportional to frequency vs max zone
              const t = Math.min(pct / maxPct, 1);
              const alpha = 0.07 + t * 0.73;
              const cellSty: React.CSSProperties = isOverlap
                ? { background: "rgba(250,204,21,0.22)", border: "1.5px solid rgba(250,204,21,0.65)" }
                : isTop5
                ? { background: `rgba(59,130,246,${alpha})`, border: `1px solid rgba(59,130,246,${Math.min(alpha + 0.2, 0.95)})` }
                : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" };
              const textColor = isOverlap ? "text-yellow-300" : isTop5 ? "text-white" : "text-foreground/50";

              return (
                <div key={zn} title={pf ? `Zone ${zn}: ${pct.toFixed(1)}% of pitches (${pf.count} pitches)` : "No data"}
                  className="rounded flex flex-col items-center justify-center gap-0.5"
                  style={{ width: 52, height: 40, ...cellSty }}>
                  {pct > 0 ? (
                    <>
                      <span className={`text-[11px] font-mono font-bold leading-none ${textColor}`}>{pct.toFixed(1)}%</span>
                      {isTop5 && <span className="text-[7px] leading-none" style={{ color: "rgba(148,163,184,0.5)" }}>top 5</span>}
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
    <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Zone Overlap</span>
        <span className={`text-xs font-bold ${overallLabel.color}`}>
          {overlapCount} zone{overlapCount !== 1 ? "s" : ""} overlap · {overallLabel.text}
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
}: {
  player: PlayerData;
  lookback: UILookback;
  mlbId?: number;
  battingOrder: number | null;
  teamAbbr?: string;
  onBack: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: (name: string) => void;
}) {
  const [detailTab, setDetailTab] = useState<"abs" | "statcast" | "pitches" | "bvp" | "profile">("abs");
  const [pitchFilter, setPitchFilter] = useState<Set<string>>(new Set());
  const [activeLookback, setActiveLookback] = useState<UILookback>(lookback);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, []);

  const scores = scoreFor(player, activeLookback) ?? scoreFor(player, "L5")!;
  const pitchDetail = player.pitch_detail || {};
  const pitchTypes = player.pitch_types || [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pitchAbsData = (scores as any).pitch_abs as Record<string, Array<Record<string, unknown>>> | undefined;
  const limit = activeLookback === "L10" ? 10 : 5;
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
    const selected: Array<Record<string, unknown>> = [];
    for (const pt of pitchFilter) selected.push(...(pitchAbsData?.[pt] || []));
    selected.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const seen = new Set<string>();
    filteredABs = selected.filter((ab) => { const k = `${ab.date}-${ab.ev}-${ab.angle}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }

  const recentAbsArr = scores.recent_abs ?? [];
  const flyBalls = recentAbsArr.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrInLookback = recentAbsArr.filter((ab) => ab.result === "home_run").length;
  const hrFbPct = flyBalls.length > 0 ? (hrInLookback / flyBalls.length) * 100 : null;
  const pullBrl = player.season_profile?.pull_barrel ?? null;

  let displayBarrel = scores.barrel_pct, displayFb = scores.fb_pct;
  let displayLd = scores.ld_pct ?? 0, displayGb = scores.gb_pct ?? 0;
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

  const statCards = [
    { label: "Exit Velo",  value: `${displayEv}`,                                           cls: statHighlight(displayEv, [88, 93]) },
    { label: "Barrel%",    value: `${displayBarrel}%`,                                       cls: statHighlight(displayBarrel, [8, 15]) },
    { label: "Hard Hit%",  value: `${displayHardHit}%`,                                      cls: statHighlight(displayHardHit, [35, 50]) },
    { label: "HR/FB%",     value: displayHrFb == null ? "—" : `${displayHrFb.toFixed(1)}%`, cls: displayHrFb == null ? "text-muted" : statHighlight(displayHrFb, [10, 18]) },
    { label: "GB%",        value: `${displayGb}%`,                                           cls: "text-muted" },
    { label: "LD%",        value: `${displayLd}%`,                                           cls: "text-muted" },
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
        <div className="flex items-center p-[3px] rounded-full ml-auto" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
          {(["L5", "L10", "Season"] as UILookback[]).map((lb) => (
            <button key={lb} onClick={() => setActiveLookback(lb)}
              className={`px-3 py-1 text-[11px] font-bold rounded-full cursor-pointer transition-all ${activeLookback === lb ? "bg-accent text-black shadow-[0_1px_3px_0_rgba(0,0,0,0.35)]" : "text-muted hover:text-foreground"}`}>
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
            <div className="text-sm text-muted mb-2">
              <span className="font-mono">{player.batter_hand}HB</span>
              <span className="mx-2 opacity-40">·</span>
              <span>vs {player.opp_pitcher} ({player.pitcher_hand}HP)</span>
              {player.pitcher_data_year === 2025 && (
                <span className="ml-2 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-400/15 text-amber-400/90 border border-amber-400/20">2025 data</span>
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
          </div>
        </div>

        {/* Score bar */}
        <ScoreBar value={scores.composite} />

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-2">
          {statCards.map(({ label, value, cls }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span className="text-[9px] uppercase tracking-[0.08em] text-muted/70 leading-none">{label}</span>
              <span className={`font-mono text-base font-semibold leading-none ${cls}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* HR Signal */}
        <HRSignalCard player={player} />

        {/* Pitch Matchup */}
        {pitchDetailEntries.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Pitch Matchup</span>
              <span className={`text-xs font-bold ${matchup.color}`}>{matchup.label}</span>
            </div>
            <div className="space-y-1.5">
              {pitchDetailEntries.map(([pt, d]) => {
                const score = pitchScore(d); const c = SCORE_COLORS[score];
                return (
                  <div key={pt} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${c.bg}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                    <span className="text-xs font-mono font-semibold text-foreground w-7 flex-shrink-0">{pt}</span>
                    <span className="text-[11px] text-muted flex-1 min-w-0 truncate">{PITCH_NAMES[pt]?.[0] || pt}</span>
                    <span className="text-[10px] text-muted/60 font-mono flex-shrink-0">{d.usage_pct}%</span>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-1">
                      {d.barrel_rate != null && <span className={`text-[11px] font-mono font-semibold ${c.text}`}>{d.barrel_rate}% brl</span>}
                      {d.avg_exit_velo != null && <span className="text-[11px] font-mono text-muted">{d.avg_exit_velo} EV</span>}
                      {d.barrel_rate == null && d.avg_exit_velo == null && <span className="text-[11px] text-muted/50">no data</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-pitch EV / LA breakdown */}
        {pitchDetailEntries.length > 0 && pitchAbsData && (
          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">EV &amp; LA vs Arsenal</span>
              <span className="text-[9px] text-muted/40 ml-2 font-mono">recent · 2026</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <th className="px-4 py-1.5 text-[9px] uppercase tracking-wider text-muted/50 font-semibold text-left w-24">Pitch</th>
                    <th className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted/50 font-semibold text-center">Avg EV</th>
                    <th className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted/50 font-semibold text-center">Avg LA</th>
                    <th className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted/40 font-semibold text-center">EV '26</th>
                    <th className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted/40 font-semibold text-center">LA '26</th>
                    <th className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted/40 font-semibold text-center">n</th>
                  </tr>
                </thead>
                <tbody>
                  {pitchDetailEntries.map(([pt, d]) => {
                    const abs = pitchAbsData[pt] ?? [];
                    const season26 = abs.filter((ab) => String(ab.date ?? "").startsWith("2026"));
                    const s26Ev = season26.length > 0
                      ? season26.reduce((s, ab) => s + (Number(ab.ev) || 0), 0) / season26.length
                      : null;
                    const s26La = season26.length > 0
                      ? season26.reduce((s, ab) => s + (Number(ab.angle) || 0), 0) / season26.length
                      : null;
                    const evColor = (ev: number | null | undefined) => {
                      if (ev == null) return "text-muted/40";
                      if (ev >= 95) return "text-accent-green font-semibold";
                      if (ev >= 90) return "text-foreground";
                      return "text-muted";
                    };
                    const laColor = (la: number | null | undefined) => {
                      if (la == null) return "text-muted/40";
                      if (la >= 20 && la <= 35) return "text-accent-green font-semibold";
                      if (la >= 10 && la <= 45) return "text-foreground";
                      return "text-muted";
                    };
                    return (
                      <tr key={pt} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono font-semibold text-foreground">{pt}</span>
                          <span className="text-[10px] text-muted/50 ml-1.5">{PITCH_NAMES[pt]?.[0] || ""}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-mono ${evColor(d.avg_exit_velo)}`}>
                            {d.avg_exit_velo > 0 ? d.avg_exit_velo : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-mono ${laColor(d.avg_launch_angle)}`}>
                            {d.avg_launch_angle != null ? `${d.avg_launch_angle}°` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-mono ${evColor(s26Ev)}`}>
                            {s26Ev != null ? s26Ev.toFixed(1) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-mono ${laColor(s26La)}`}>
                            {s26La != null ? `${s26La.toFixed(1)}°` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-[10px] font-mono text-muted/50">{abs.length}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pitch filter chips */}
        {pitchTypes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setPitchFilter(new Set())}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${pitchFilter.size === 0 ? "bg-accent/20 text-accent border border-accent/40" : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"}`}>
              All Pitches
            </button>
            {pitchTypes.map((pt) => {
              const detail = pitchDetail[pt];
              const tipText = detail ? `${PITCH_NAMES[pt]?.[0] || pt} — ${detail.usage_pct}% of pitches. Barrel: ${detail.barrel_rate}%, FB: ${detail.fb_rate}%, EV: ${detail.avg_exit_velo}` : (PITCH_NAMES[pt]?.[0] || pt);
              const sel = pitchFilter.has(pt);
              return (
                <Tooltip key={pt} text={tipText}>
                  <button onClick={() => setPitchFilter((prev) => { const next = new Set(prev); if (next.has(pt)) next.delete(pt); else next.add(pt); return next; })}
                    className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${sel ? "bg-accent/20 text-accent border border-accent/40" : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"}`}>
                    {pt}{detail ? ` ${detail.usage_pct}%` : ""}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        {/* Tabs */}
        <div>
          <div className="inline-flex items-center p-[3px] rounded-full mb-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {(["abs", "statcast", "pitches", "bvp", "profile"] as const).map((tab) => (
              <button key={tab} onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-all ${detailTab === tab ? "bg-accent text-black shadow-[0_1px_3px_0_rgba(0,0,0,0.35)]" : "text-muted hover:text-foreground"}`}>
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
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                      <th className="text-left py-1.5 pr-3">Date</th>
                      <th className="text-left py-1.5 pr-3">Pitcher</th>
                      <th className="text-center py-1.5 px-2">Arm</th>
                      <th className="text-left py-1.5 pr-3">Pitch</th>
                      <th className="text-center py-1.5 px-2">EV</th>
                      <th className="text-center py-1.5 px-2">Angle</th>
                      <th className="text-center py-1.5 px-2">Dist</th>
                      <th className="text-left py-1.5">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredABs.map((ab, i) => (
                      <tr key={i} className="border-b border-card-border/30 last:border-0">
                        <td className="py-1.5 pr-3 text-muted font-mono">{String(ab.date).slice(5)}</td>
                        <td className="py-1.5 pr-3 text-foreground">{String(ab.pitcher_name ?? "")}</td>
                        <td className="py-1.5 px-2 text-center text-muted">{String(ab.pitch_arm ?? "")}</td>
                        <td className="py-1.5 pr-3 text-foreground">{String(ab.pitch_type ?? "")}</td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${evColor(Number(ab.ev))}`}>{String(ab.ev)}</span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${angleColor(Number(ab.angle))}`}>{String(ab.angle)}</span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${distColor(ab.distance != null ? Number(ab.distance) : null)}`}>
                            {ab.distance ? String(ab.distance) : "-"}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted capitalize">{String(ab.result ?? "").replace(/_/g, " ")}</td>
                      </tr>
                    ))}
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
