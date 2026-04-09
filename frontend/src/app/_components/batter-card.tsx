"use client";

import { useState } from "react";
import type { PlayerData, LookbackKey, PitchDetailEntry } from "./types";
import { ScoreBar } from "./score-bar";
import { PitchesTab } from "./pitches-tab";
import { BvPTab } from "./bvp-tab";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";
import {
  TABLE_BG,
  cellClass,
  cellStyle,
  headerCellClass,
  headerCellStyle,
  tableClass,
  tableWrapperClass,
  tableWrapperStyle,
} from "./table-styles";

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
    <div className="border border-card-border rounded-lg bg-card/40 hover:bg-card/60 transition-colors">
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
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-semibold text-foreground">{player.name}</span>
              <span className="text-[10px] text-muted font-mono">{player.batter_hand}HB</span>
              <RatingBadge composite={scores.composite} />
              {scores.recent_abs.length <= 2 && (
                <Tooltip text="Limited MLB data — score may not reflect true ability">
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20">
                    NEW
                  </span>
                </Tooltip>
              )}
              {scores.data_quality !== "OK" && scores.recent_abs.length > 2 && (
                <Tooltip text={scores.data_quality === "LOW_SAMPLE" ? "Fewer than 5 balls in play — small sample size" : "Pitcher has less than 10 innings — pitcher metrics less reliable"}>
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-accent-yellow/10 text-accent-yellow">
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
        <div className="px-4 pb-4 border-t border-card-border">
          {/* Sub-tabs */}
          <div className="flex items-center gap-1 mt-3 mb-3 bg-background/50 rounded-lg p-1 w-fit">
            {(["abs", "statcast", "pitches", "bvp"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
                  detailTab === tab
                    ? "bg-accent/15 text-accent font-medium"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab === "abs" ? `Recent ABs (${lookback})` : tab === "statcast" ? "Pitch Breakdown" : tab === "pitches" ? "Pitches" : "vs Pitcher"}
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
                  className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-colors ${
                    pitchFilter === "all"
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-background/50 text-muted border border-card-border hover:text-foreground"
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
                        className={`px-2.5 py-1 text-[10px] font-mono rounded-full cursor-pointer transition-colors ${
                          pitchFilter === pt
                            ? "bg-accent/15 text-accent border border-accent/30"
                            : "bg-background/50 text-muted border border-card-border hover:text-foreground"
                        }`}
                      >
                        {pt} {detail ? `${detail.usage_pct}%` : ""}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

              <div className={tableWrapperClass} style={tableWrapperStyle}>
              {filteredABs.length > 0 ? (
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={headerCellClass} style={headerCellStyle}>Date</th>
                      <th className={headerCellClass} style={headerCellStyle}>Pitcher</th>
                      <th className={headerCellClass} style={headerCellStyle}>Arm</th>
                      <th className={headerCellClass} style={headerCellStyle}>Pitch</th>
                      <th className={headerCellClass} style={headerCellStyle}>EV</th>
                      <th className={headerCellClass} style={headerCellStyle}>Angle</th>
                      <th className={headerCellClass} style={headerCellStyle}>Dist</th>
                      <th className={headerCellClass} style={headerCellStyle}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredABs.map((ab, i) => (
                      <tr key={i} style={{ backgroundColor: TABLE_BG }}>
                        <td className={cellClass} style={cellStyle}>{ab.date.slice(5)}</td>
                        <td className={cellClass} style={cellStyle}>{ab.pitcher_name}</td>
                        <td className={cellClass} style={cellStyle}>{ab.pitch_arm}</td>
                        <td className={cellClass} style={cellStyle}>{ab.pitch_type}</td>
                        <td className={cellClass} style={cellStyle}>{ab.ev}</td>
                        <td className={cellClass} style={cellStyle}>{ab.angle}</td>
                        <td className={cellClass} style={cellStyle}>{ab.distance ? ab.distance : "-"}</td>
                        <td className={cellClass} style={cellStyle}>{(ab.result || "").replace(/_/g, " ")}</td>
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
            <div className={tableWrapperClass} style={tableWrapperStyle}>
              {Object.keys(pitchDetail).length > 0 ? (
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={headerCellClass} style={headerCellStyle}>Pitch</th>
                      <th className={headerCellClass} style={headerCellStyle}>Usage%</th>
                      <th className={headerCellClass} style={headerCellStyle}>Weight%</th>
                      <th className={headerCellClass} style={headerCellStyle}>Barrel%</th>
                      <th className={headerCellClass} style={headerCellStyle}>FB%</th>
                      <th className={headerCellClass} style={headerCellStyle}>Hard Hit%</th>
                      <th className={headerCellClass} style={headerCellStyle}>Avg EV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pitchDetail).map(([pt, d]: [string, PitchDetailEntry]) => (
                      <tr key={pt} style={{ backgroundColor: TABLE_BG }}>
                        <td className={cellClass} style={cellStyle}>{pt}</td>
                        <td className={cellClass} style={cellStyle}>{d.usage_pct}%</td>
                        <td className={cellClass} style={cellStyle}>{d.weight}%</td>
                        <td className={cellClass} style={cellStyle}>{d.barrel_rate}%</td>
                        <td className={cellClass} style={cellStyle}>{d.fb_rate}%</td>
                        <td className={cellClass} style={cellStyle}>{d.hard_hit_rate}%</td>
                        <td className={cellClass} style={cellStyle}>{d.avg_exit_velo}</td>
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
