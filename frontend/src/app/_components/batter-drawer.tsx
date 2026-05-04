"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { PlayerData, LookbackKey, PitchDetailEntry } from "./types";
import { ScoreBar } from "./score-bar";
import { PitchesTab } from "./pitches-tab";
import { BvPTab } from "./bvp-tab";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";
import { BatterProfileRow } from "./batter-profile-row";

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
  great:   { dot: "bg-accent-green",    text: "text-accent-green",  bg: "bg-accent-green/8 border-accent-green/25" },
  decent:  { dot: "bg-accent-yellow",   text: "text-accent-yellow", bg: "bg-accent-yellow/8 border-accent-yellow/20" },
  tough:   { dot: "bg-red-500/60",      text: "text-muted",         bg: "bg-white/[0.025] border-white/8" },
  unknown: { dot: "bg-white/25",        text: "text-muted",         bg: "bg-white/[0.025] border-white/8" },
};

function matchupLabel(pitchDetail: Record<string, PitchDetailEntry>): {
  label: string;
  color: string;
} {
  const entries = Object.entries(pitchDetail).filter(([, d]) => (d.usage_pct ?? 0) >= 12);
  if (entries.length === 0) return { label: "UNKNOWN", color: "text-muted" };

  let totalUsage = 0;
  let weighted = 0;
  for (const [, d] of entries) {
    const usage = (d.usage_pct ?? 0) / 100;
    const barrel = d.barrel_rate ?? 0;
    const ev = d.avg_exit_velo ?? 88;
    const barrelNorm = Math.min(barrel / 25, 1);
    const evNorm = Math.max(0, Math.min((ev - 85) / 20, 1));
    weighted += usage * (0.65 * barrelNorm + 0.35 * evNorm);
    totalUsage += usage;
  }
  const score = totalUsage > 0 ? weighted / totalUsage : 0.5;
  if (score >= 0.45) return { label: "GREAT MATCHUP", color: "text-accent-green" };
  if (score >= 0.25) return { label: "DECENT", color: "text-accent-yellow" };
  return { label: "TOUGH", color: "text-muted" };
}

export function BatterDrawer({
  player,
  lookback,
  mlbId,
  battingOrder,
  onClose,
}: {
  player: PlayerData;
  lookback: LookbackKey;
  mlbId?: number;
  battingOrder: number | null;
  onClose: () => void;
}) {
  const [detailTab, setDetailTab] = useState<"abs" | "statcast" | "pitches" | "bvp" | "profile">("abs");
  const [pitchFilter, setPitchFilter] = useState<Set<string>>(new Set());

  const scores = player.scores[lookback] || player.scores.L5;
  const pitchDetail = player.pitch_detail || {};
  const pitchTypes = player.pitch_types || [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Filter recent ABs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pitchAbsData = (scores as any).pitch_abs as Record<string, Array<Record<string, unknown>>> | undefined;
  const limit = lookback === "L10" ? 10 : 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredABs: any[];
  if (pitchFilter.size === 0) {
    if (pitchAbsData && Object.keys(pitchAbsData).length > 0) {
      const all = Object.values(pitchAbsData).flat();
      all.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const seen = new Set<string>();
      filteredABs = all.filter((ab) => {
        const key = `${ab.date}-${ab.ev}-${ab.angle}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, limit);
    } else {
      filteredABs = (scores.recent_abs || []).slice(0, limit);
    }
  } else {
    const selected: Array<Record<string, unknown>> = [];
    for (const pt of pitchFilter) selected.push(...(pitchAbsData?.[pt] || []));
    selected.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const seen = new Set<string>();
    filteredABs = selected.filter((ab) => {
      const key = `${ab.date}-${ab.ev}-${ab.angle}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }

  const recentAbsArr = scores.recent_abs ?? [];
  const flyBalls = recentAbsArr.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrInLookback = recentAbsArr.filter((ab) => ab.result === "home_run").length;
  const hrFbPct = flyBalls.length > 0 ? (hrInLookback / flyBalls.length) * 100 : null;
  const pullBrl = player.season_profile?.pull_barrel ?? null;

  let displayBarrel = scores.barrel_pct;
  let displayFb = scores.fb_pct;
  let displayHardHit = scores.hard_hit_pct;
  let displayEv = scores.exit_velo;
  let displayHrFb: number | null = hrFbPct;
  if (pitchFilter.size > 0) {
    let totalCount = 0;
    let wBarrel = 0, wFb = 0, wHard = 0, wEv = 0;
    for (const pt of pitchFilter) {
      const d = pitchDetail[pt];
      if (!d) continue;
      const c = d.count ?? 0;
      totalCount += c;
      wBarrel += (d.barrel_rate ?? 0) * c;
      wFb += (d.fb_rate ?? 0) * c;
      wHard += (d.hard_hit_rate ?? 0) * c;
      wEv += (d.avg_exit_velo ?? 0) * c;
    }
    if (totalCount > 0) {
      displayBarrel = Math.round((wBarrel / totalCount) * 10) / 10;
      displayFb = Math.round((wFb / totalCount) * 10) / 10;
      displayHardHit = Math.round((wHard / totalCount) * 10) / 10;
      displayEv = Math.round((wEv / totalCount) * 10) / 10;
    } else {
      displayBarrel = 0; displayFb = 0; displayHardHit = 0; displayEv = 0;
    }
    const filterAbs = recentAbsArr.filter((ab) => {
      const pt = ab.pitch_type ?? "";
      if (pitchFilter.has(pt)) return true;
      for (const code of pitchFilter) {
        if ((PITCH_NAMES[code] || []).includes(pt)) return true;
      }
      return false;
    });
    const fFb = filterAbs.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
    const fHr = filterAbs.filter((ab) => ab.result === "home_run").length;
    displayHrFb = fFb.length > 0 ? (fHr / fFb.length) * 100 : null;
  }

  const pitchDetailEntries = Object.entries(pitchDetail).sort((a, b) => (b[1].usage_pct ?? 0) - (a[1].usage_pct ?? 0));
  const matchup = matchupLabel(pitchDetail);

  const statCards = [
    { label: "Exit Velo",  value: `${displayEv}`,                                              cls: statHighlight(displayEv, [88, 93]) },
    { label: "Barrel%",    value: `${displayBarrel}%`,                                          cls: statHighlight(displayBarrel, [8, 15]) },
    { label: "Hard Hit%",  value: `${displayHardHit}%`,                                         cls: statHighlight(displayHardHit, [35, 50]) },
    { label: "HR/FB%",     value: displayHrFb == null ? "—" : `${displayHrFb.toFixed(1)}%`,    cls: displayHrFb == null ? "text-muted" : statHighlight(displayHrFb, [10, 18]) },
    { label: "FB%",        value: `${displayFb}%`,                                              cls: statHighlight(displayFb, [25, 40]) },
    { label: "Pull Brl%",  value: pullBrl == null ? "—" : `${pullBrl.toFixed(1)}%`,             cls: pullBrl == null ? "text-muted" : statHighlight(pullBrl, [4, 8]) },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: "min(680px, 100vw)",
          background: "linear-gradient(180deg, rgba(16,16,20,0.99) 0%, rgba(10,10,14,1) 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "-32px 0 80px -12px rgba(0,0,0,0.75)",
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex-shrink-0 relative">
            {mlbId ? (
              <img
                src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
                alt={player.name}
                className="w-14 h-14 rounded-full object-cover"
                style={{ border: "2px solid rgba(255,255,255,0.12)" }}
              />
            ) : (
              <div className="w-14 h-14 rounded-full" style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.10)" }} />
            )}
            {battingOrder !== null && (
              <span
                className="absolute -bottom-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-black"
                style={{ background: "var(--accent)" }}
              >
                {battingOrder}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg text-foreground leading-tight mb-1">{player.name}</div>
            <div className="text-xs text-muted mb-2">
              <span className="font-mono">{player.batter_hand}HB</span>
              <span className="mx-2 opacity-40">·</span>
              <span>vs {player.opp_pitcher} ({player.pitcher_hand}HP)</span>
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

          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 rounded-lg text-muted hover:text-foreground hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-5">

          {/* Score bar */}
          <ScoreBar value={scores.composite} />

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2">
            {statCards.map(({ label, value, cls }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center gap-1.5 px-3 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <span className="text-[9px] uppercase tracking-[0.08em] text-muted/70 leading-none">{label}</span>
                <span className={`font-mono text-base font-semibold leading-none ${cls}`}>{value}</span>
              </div>
            ))}
          </div>

          {/* Pitch Matchup */}
          {pitchDetailEntries.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Pitch Matchup</span>
                <span className={`text-xs font-bold ${matchup.color}`}>{matchup.label}</span>
              </div>
              <div className="space-y-1.5">
                {pitchDetailEntries.map(([pt, d]) => {
                  const score = pitchScore(d);
                  const c = SCORE_COLORS[score];
                  return (
                    <div key={pt} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${c.bg}`}>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                      <span className="text-xs font-mono font-semibold text-foreground w-7 flex-shrink-0">{pt}</span>
                      <span className="text-[11px] text-muted flex-1 min-w-0 truncate">{PITCH_NAMES[pt]?.[0] || pt}</span>
                      <span className="text-[10px] text-muted/60 font-mono flex-shrink-0">{d.usage_pct}%</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
                        {d.barrel_rate != null ? (
                          <span className={`text-[11px] font-mono font-semibold ${c.text}`}>{d.barrel_rate}% brl</span>
                        ) : null}
                        {d.avg_exit_velo != null ? (
                          <span className="text-[11px] font-mono text-muted">{d.avg_exit_velo} EV</span>
                        ) : null}
                        {d.barrel_rate == null && d.avg_exit_velo == null && (
                          <span className="text-[11px] text-muted/50">no data</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pitch filter chips */}
          {pitchTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setPitchFilter(new Set())}
                className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${
                  pitchFilter.size === 0
                    ? "bg-accent/20 text-accent border border-accent/40"
                    : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"
                }`}
              >
                All Pitches
              </button>
              {pitchTypes.map((pt) => {
                const detail = pitchDetail[pt];
                const tipText = detail
                  ? `${PITCH_NAMES[pt]?.[0] || pt} — ${detail.usage_pct}% of pitches. Barrel: ${detail.barrel_rate}%, FB: ${detail.fb_rate}%, EV: ${detail.avg_exit_velo}`
                  : (PITCH_NAMES[pt]?.[0] || pt);
                const sel = pitchFilter.has(pt);
                return (
                  <Tooltip key={pt} text={tipText}>
                    <button
                      onClick={() =>
                        setPitchFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(pt)) next.delete(pt); else next.add(pt);
                          return next;
                        })
                      }
                      className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all ${
                        sel
                          ? "bg-accent/20 text-accent border border-accent/40"
                          : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"
                      }`}
                    >
                      {pt}{detail ? ` ${detail.usage_pct}%` : ""}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {/* Tabs */}
          <div>
            <div
              className="inline-flex items-center p-[3px] rounded-full mb-4"
              style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {(["abs", "statcast", "pitches", "bvp", "profile"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-all ${
                    detailTab === tab
                      ? "bg-accent text-black shadow-[0_1px_3px_0_rgba(0,0,0,0.35)]"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab === "profile" ? `Profile · ${lookback}` : tab === "abs" ? `ABs · ${lookback}` : tab === "statcast" ? "Pitches" : tab === "pitches" ? "Arsenal" : "vs Pitcher"}
                </button>
              ))}
            </div>

            {detailTab === "profile" && (
              <BatterProfileRow
                recentAbs={scores.recent_abs ?? []}
                pitcherName={player.opp_pitcher}
                pitcherHand={player.pitcher_hand}
                batterHand={player.batter_hand}
                pitchTypes={pitchTypes}
                lookback={lookback}
              />
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
        </div>
      </div>
    </>
  );
}
