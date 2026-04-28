"use client";

import { useState } from "react";
import type { PlayerData, LookbackKey, PitchDetailEntry } from "./types";
import { ScoreBar } from "./score-bar";
import { PitchesTab } from "./pitches-tab";
import { BvPTab } from "./bvp-tab";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";
import { BatterProfileRow } from "./batter-profile-row";

function evColor(ev: number): string {
  if (ev >= 95) return "bg-accent-green/80 text-background";
  if (ev >= 90) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}

function angleColor(angle: number): string {
  if (angle >= 25 && angle <= 35) return "bg-accent-green/80 text-background";
  if (angle >= 20 && angle <= 40) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}

function distColor(dist: number | null): string {
  if (!dist) return "text-muted";
  if (dist >= 350) return "bg-accent-green/80 text-background";
  if (dist >= 300) return "bg-accent-green/40 text-foreground";
  return "text-foreground";
}

function statHighlight(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-accent-green font-semibold";
  if (value >= thresholds[0]) return "text-foreground";
  return "text-muted";
}

export function BatterCard({
  player,
  lookback,
  battingOrder,
  mlbId,
}: {
  player: PlayerData;
  lookback: LookbackKey;
  battingOrder: number | null;
  mlbId?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<"profile" | "abs" | "statcast" | "pitches" | "bvp">("profile");
  // Multi-select set of pitch codes — empty Set = "all pitches"
  const [pitchFilter, setPitchFilter] = useState<Set<string>>(new Set());

  const scores = player.scores[lookback] || player.scores.L5;
  const pitchDetail = player.pitch_detail || {};
  const pitchTypes = player.pitch_types || [];

  // Pitch code to full name mapping for filtering
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

  // Build set of pitch names that match the pitcher's arsenal
  const arsenalPitchNames = new Set<string>();
  for (const pt of pitchTypes) {
    arsenalPitchNames.add(pt);
    for (const name of (PITCH_NAMES[pt] || [])) {
      arsenalPitchNames.add(name);
    }
  }

  // Filter recent ABs — combine per-pitch-type buckets when one or more pitches
  // are selected; empty filter = all pitches.
  const pitchAbsData = (scores as unknown as Record<string, unknown>).pitch_abs as Record<string, Array<Record<string, unknown>>> | undefined;
  const limit = lookback === "L10" ? 10 : 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredABs: any[];
  if (pitchFilter.size === 0) {
    // All pitches — combine, dedupe, sort, cap
    if (pitchAbsData && Object.keys(pitchAbsData).length > 0) {
      const allPitchAbs = Object.values(pitchAbsData).flat();
      allPitchAbs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const seen = new Set<string>();
      const deduped = allPitchAbs.filter((ab) => {
        const key = `${ab.date}-${ab.ev}-${ab.angle}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      filteredABs = deduped.slice(0, limit);
    } else {
      filteredABs = (scores.recent_abs || []).slice(0, limit);
    }
  } else {
    // Subset — union of selected pitch buckets, deduped + sorted + capped
    const selected: Array<Record<string, unknown>> = [];
    for (const pt of pitchFilter) {
      selected.push(...(pitchAbsData?.[pt] || []));
    }
    selected.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const seen = new Set<string>();
    filteredABs = selected
      .filter((ab) => {
        const key = `${ab.date}-${ab.ev}-${ab.angle}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  // HR/FB% computed from recent_abs in this lookback — count HRs over fly balls
  // (launch angle 25-50). League avg ~13%; >18% green, <10% muted.
  const recentAbsArr = scores.recent_abs ?? [];
  const flyBalls = recentAbsArr.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrInLookback = recentAbsArr.filter((ab) => ab.result === "home_run").length;
  const hrFbPct = flyBalls.length > 0 ? (hrInLookback / flyBalls.length) * 100 : null;

  // Season-long pull-side barrel rate (from season_profile, not lookback).
  // League avg ~3-4%; >8% green, >4% foreground, <4% muted.
  const pullBrl = player.season_profile?.pull_barrel ?? null;

  return (
    <div
      className="rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] hover:border-white/15"
      style={{
        background: expanded
          ? "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.025) 100%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.018) 100%)",
        border: `1px solid ${expanded ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.10)"}`,
        boxShadow: expanded
          ? "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 6px 18px -6px rgba(0,0,0,0.45)"
          : "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 2px 8px -3px rgba(0,0,0,0.30)",
      }}
    >
      {/* Card face */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 cursor-pointer"
      >
        {/* Top row: identity + score */}
        <div className="flex items-center gap-3">
          {/* Headshot + batting order (order only shown once lineup is posted) */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 w-10">
            {mlbId ? (
              <img
                src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
                alt={player.name}
                className="w-10 h-10 rounded-full object-cover bg-card-border/40"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-card-border/40" />
            )}
            {battingOrder !== null && (
              <span className="text-[11px] font-bold text-accent font-mono leading-none">{battingOrder}</span>
            )}
          </div>

          {/* Name + tags */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground whitespace-nowrap mb-1 leading-tight">
              {player.name}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[10px] text-muted font-mono">{player.batter_hand}HB</span>
              <RatingBadge composite={scores.composite} />
              {scores.recent_abs.length <= 2 && (
                <Tooltip text="Limited MLB data — score may not reflect true ability">
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20 whitespace-nowrap">
                    NEW
                  </span>
                </Tooltip>
              )}
              {scores.data_quality !== "OK" && scores.recent_abs.length > 2 && (
                <Tooltip text={scores.data_quality === "LOW_SAMPLE" ? "Fewer than 5 balls in play — small sample size" : "Pitcher has less than 10 innings — pitcher metrics less reliable"}>
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-accent-yellow/10 text-accent-yellow whitespace-nowrap">
                    {scores.data_quality.replace(/_/g, " ")}
                  </span>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Composite score */}
          <div className="flex-shrink-0 w-28">
            <ScoreBar value={scores.composite} />
          </div>

          {/* Expand icon */}
          <svg
            className={`w-4 h-4 text-muted flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Stat mini-cards — own row, evenly spaced, full width */}
        <div className="grid grid-cols-6 gap-2 mt-3">
          <StatMiniCard label="Barrel%" value={`${scores.barrel_pct}%`}
            cls={statHighlight(scores.barrel_pct, [8, 15])} />
          <StatMiniCard
            label="Pull Brl%"
            value={pullBrl == null ? "—" : `${pullBrl.toFixed(1)}%`}
            cls={pullBrl == null ? "text-muted" : statHighlight(pullBrl, [4, 8])}
          />
          <StatMiniCard label="FB%" value={`${scores.fb_pct}%`}
            cls={statHighlight(scores.fb_pct, [25, 40])} />
          <StatMiniCard
            label="HR/FB%"
            value={hrFbPct == null ? "—" : `${hrFbPct.toFixed(1)}%`}
            cls={hrFbPct == null ? "text-muted" : statHighlight(hrFbPct, [10, 18])}
          />
          <StatMiniCard label="Hard Hit%" value={`${scores.hard_hit_pct}%`}
            cls={statHighlight(scores.hard_hit_pct, [35, 50])} />
          <StatMiniCard label="Exit Velo" value={`${scores.exit_velo}`}
            cls={statHighlight(scores.exit_velo, [88, 93])} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="px-4 pb-4"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          {/* Sub-tabs — segmented control */}
          <div
            className="inline-flex items-center p-[3px] rounded-full mt-3 mb-4 backdrop-blur-md"
            style={{
              background: "rgba(255,255,255,0.035)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {(["profile", "abs", "statcast", "pitches", "bvp"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                  detailTab === tab
                    ? "bg-accent text-black shadow-[0_1px_3px_0_rgba(0,0,0,0.35)]"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab === "profile" ? `Profile · ${lookback}` : tab === "abs" ? `Recent ABs · ${lookback}` : tab === "statcast" ? "Pitch Breakdown" : tab === "pitches" ? "Pitches" : "vs Pitcher"}
              </button>
            ))}
          </div>

          {/* Profile — single row of season-style stats filtered to this matchup */}
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

          {/* Recent ABs */}
          {detailTab === "abs" && (
            <div>
              {/* Pitch type filter — multi-select. Empty Set = "all". */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <button
                  onClick={() => setPitchFilter(new Set())}
                  className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                    pitchFilter.size === 0
                      ? "bg-accent/20 text-accent border border-accent/40"
                      : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"
                  }`}
                >
                  All Pitches
                </button>
                {pitchTypes.map((pt) => {
                  const detail = pitchDetail[pt];
                  const fullName = PITCH_NAMES[pt]?.[0] || pt;
                  const tipText = detail
                    ? `${fullName} — ${detail.usage_pct}% of pitches. Barrel: ${detail.barrel_rate}%, FB: ${detail.fb_rate}%, EV: ${detail.avg_exit_velo}`
                    : fullName;
                  const sel = pitchFilter.has(pt);
                  return (
                    <Tooltip key={pt} text={tipText}>
                      <button
                        onClick={() =>
                          setPitchFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(pt)) next.delete(pt);
                            else next.add(pt);
                            return next;
                          })
                        }
                        className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                          sel
                            ? "bg-accent/20 text-accent border border-accent/40"
                            : "bg-white/[0.04] text-muted border border-white/10 hover:text-foreground hover:border-white/20"
                        }`}
                      >
                        {pt} {detail ? `${detail.usage_pct}%` : ""}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

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
                        <td className="py-1.5 pr-3 text-muted font-mono">{ab.date.slice(5)}</td>
                        <td className="py-1.5 pr-3 text-foreground">{ab.pitcher_name}</td>
                        <td className="py-1.5 px-2 text-center text-muted">{ab.pitch_arm}</td>
                        <td className="py-1.5 pr-3 text-foreground">{ab.pitch_type}</td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${evColor(ab.ev)}`}>{ab.ev}</span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${angleColor(ab.angle)}`}>{ab.angle}</span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`px-1 py-0.5 rounded font-mono ${distColor(ab.distance)}`}>
                            {ab.distance ? ab.distance : "-"}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted capitalize">{(ab.result || "").replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted py-2">No recent AB data for this lookback{pitchFilter.size > 0 ? ` against ${[...pitchFilter].join(", ")}` : ""}.</p>
              )}
            </div>
          </div>
          )}

          {/* Statcast per-pitch breakdown */}
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
                      <th className="text-center py-1.5 px-2">Hard Hit%</th>
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

          {/* Season pitches tab */}
          {detailTab === "pitches" && (
            <PitchesTab player={player} />
          )}

          {/* BvP history tab */}
          {detailTab === "bvp" && (
            <BvPTab player={player} />
          )}
        </div>
      )}
    </div>
  );
}

function StatMiniCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.03)",
      }}
    >
      <span className="text-[9px] uppercase tracking-[0.08em] text-muted/70 leading-none">{label}</span>
      <span className={`font-mono text-sm font-semibold leading-none ${cls}`}>{value}</span>
    </div>
  );
}
