"use client";

import { useState } from "react";
import type { PlayerData, LookbackKey, PitchDetailEntry } from "./types";
import { ScoreBar } from "./score-bar";
import { PitchesTab } from "./pitches-tab";
import { BvPTab } from "./bvp-tab";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";

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
  rank,
}: {
  player: PlayerData;
  lookback: LookbackKey;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<"abs" | "statcast" | "pitches" | "bvp">("abs");
  const [pitchFilter, setPitchFilter] = useState<string>("all");

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

  // Filter recent ABs — use per-pitch-type last 5 BIP when a pitch filter is selected
  const pitchAbsData = (scores as unknown as Record<string, unknown>).pitch_abs as Record<string, Array<Record<string, unknown>>> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredABs: any[];
  if (pitchFilter === "all") {
    // Combine all per-pitch-type ABs, deduplicate, sort, cap at L5=5 / L10=10
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
      const limit = lookback === "L10" ? 10 : 5;
      filteredABs = deduped.slice(0, limit);
    } else {
      filteredABs = (scores.recent_abs || []).slice(0, lookback === "L10" ? 10 : 5);
    }
  } else {
    const limit = lookback === "L10" ? 10 : 5;
    filteredABs = (pitchAbsData?.[pitchFilter] || []).slice(0, limit);
  }

  return (
    <div
      className="rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] hover:border-white/10"
      style={{
        background: expanded
          ? "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.008) 100%)",
        border: `1px solid ${expanded ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)"}`,
        boxShadow: expanded
          ? "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 4px 16px -4px rgba(0,0,0,0.35)"
          : "inset 0 1px 0 0 rgba(255,255,255,0.025)",
      }}
    >
      {/* Card face */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 cursor-pointer"
      >
        <div className="flex items-start gap-3">
          {/* Rank + Badge */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 w-8">
            <span className="text-sm font-bold text-accent font-mono">{rank}</span>
          </div>

          {/* Player info + metrics */}
          <div className="flex-1 min-w-0">
            {/* Row 1: name (on its own line so it never wraps mid-word) */}
            <div className="font-semibold text-foreground whitespace-nowrap mb-1">
              {player.name}
            </div>
            {/* Row 2: tags — can wrap to a second line if there are many */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
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

            {/* Stat pills row */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <MetricPill label="Barrel%" value={`${scores.barrel_pct}%`}
                cls={statHighlight(scores.barrel_pct, [8, 15])} />
              <MetricPill label="FB%" value={`${scores.fb_pct}%`}
                cls={statHighlight(scores.fb_pct, [25, 40])} />
              <MetricPill label="Hard Hit%" value={`${scores.hard_hit_pct}%`}
                cls={statHighlight(scores.hard_hit_pct, [35, 50])} />
              <MetricPill label="Exit Velo" value={`${scores.exit_velo}`}
                cls={statHighlight(scores.exit_velo, [88, 93])} />
            </div>
          </div>

          {/* Composite score */}
          <div className="flex-shrink-0 w-28">
            <ScoreBar value={scores.composite} />
          </div>

          {/* Expand icon */}
          <svg
            className={`w-4 h-4 text-muted flex-shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
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
            {(["abs", "statcast", "pitches", "bvp"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                  detailTab === tab
                    ? "bg-accent text-black shadow-[0_1px_3px_0_rgba(0,0,0,0.35)]"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab === "abs" ? `Recent ABs · ${lookback}` : tab === "statcast" ? "Pitch Breakdown" : tab === "pitches" ? "Pitches" : "vs Pitcher"}
              </button>
            ))}
          </div>

          {/* Recent ABs */}
          {detailTab === "abs" && (
            <div>
              {/* Pitch type filter */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <button
                  onClick={() => setPitchFilter("all")}
                  className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                    pitchFilter === "all"
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
                  return (
                    <Tooltip key={pt} text={tipText}>
                      <button
                        onClick={() => setPitchFilter(pt === pitchFilter ? "all" : pt)}
                        className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-all duration-[var(--duration-fast)] ${
                          pitchFilter === pt
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
                <p className="text-xs text-muted py-2">No recent AB data for this lookback{pitchFilter !== "all" ? ` against ${pitchFilter}` : ""}.</p>
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

function MetricPill({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted uppercase">{label}</span>
      <span className={`font-mono text-xs ${cls}`}>{value}</span>
    </div>
  );
}
