"use client";

import { useState } from "react";
import { ScoreBar } from "./score-bar";
import { StatPill } from "./stat-pill";

interface RecentAB {
  date: string;
  pitcher_name: string;
  pitch_arm: string;
  pitch_type: string;
  ev: number;
  angle: number;
  distance: number | null;
  result: string;
}

interface PitchDetail {
  usage_pct: number;
  weight: number;
  barrel_rate: number;
  fb_rate: number;
  hard_hit_rate: number;
  avg_exit_velo: number;
}

interface Player {
  Player: string;
  "Opp Pitcher": string;
  "P Hand": string;
  "B Hand": string;
  "Pitch Types": string;
  "Wt Exit Velo": number;
  "Wt Barrel%": number;
  "Wt FB%": number;
  "Wt Hard Hit%": number;
  "P FB%": number;
  "P HR/FB%": number;
  "P HR/9": number;
  "Batter Score": number;
  "Pitcher Score": number;
  Composite: number;
  "Over Odds": number | string;
  "Over Book"?: string;
  "Under Odds"?: number | string;
  "Data Quality": string;
  "Recent ABs"?: RecentAB[];
  "Pitch Detail"?: Record<string, PitchDetail>;
  "Env Score"?: number;
  Environment?: {
    park_factor: number;
    temperature_f: number | null;
    wind_speed_mph: number | null;
    wind_direction: number | null;
    wind_score: number;
    humidity: number | null;
    is_dome: boolean;
    park_norm: number;
    temp_norm: number;
    wind_norm: number;
    humid_norm: number;
    env_score: number;
  };
}

function formatOdds(odds: number | string): string {
  if (typeof odds === "string") return odds || "-";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function qualityBadge(quality: string) {
  if (quality === "OK") {
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-green/15 text-accent-green">
        OK
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-yellow/15 text-accent-yellow">
      {quality.replace(/_/g, " ")}
    </span>
  );
}

// Color code EV and angle values like PropFinder
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

export function PlayerRow({
  player,
  rank,
}: {
  player: Player;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<"abs" | "metrics" | "statcast">("abs");

  const recentABs = player["Recent ABs"] || [];
  const pitchDetail = player["Pitch Detail"] || {};

  return (
    <div className="border border-card-border rounded-xl bg-card/50 hover:bg-card/80 transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 cursor-pointer"
      >
        <div className="flex items-center gap-4">
          {/* Rank */}
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
            <span className="text-sm font-bold text-accent">{rank}</span>
          </div>

          {/* Player info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground truncate">
                {player.Player}
              </span>
              <span className="text-xs text-muted">
                ({player["B Hand"]}HB)
              </span>
              {qualityBadge(player["Data Quality"])}
            </div>
            <div className="text-xs text-muted mt-0.5">
              vs {player["Opp Pitcher"]}{" "}
              <span className="text-accent/70">({player["P Hand"]}HP)</span>
              <span className="mx-1.5 text-card-border">|</span>
              {player["Pitch Types"]}
            </div>
          </div>

          {/* Key stats (wider screens) */}
          <div className="hidden md:flex items-center gap-3">
            <StatPill label="Barrel%" value={player["Wt Barrel%"]} unit="%" />
            <StatPill label="FB%" value={player["Wt FB%"]} unit="%" />
            <StatPill label="Hard Hit" value={player["Wt Hard Hit%"]} unit="%" />
          </div>

          {/* Composite score */}
          <div className="flex-shrink-0 w-32">
            <ScoreBar value={player.Composite} />
          </div>

          {/* Expand arrow */}
          <svg
            className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-card-border">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 mt-2 mb-3 bg-background/50 rounded-lg p-1 w-fit">
            {(["abs", "metrics", "statcast"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
                  detailTab === tab
                    ? "bg-accent/15 text-accent font-medium"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab === "abs"
                  ? "Recent ABs"
                  : tab === "metrics"
                    ? "Metrics"
                    : "Statcast"}
              </button>
            ))}
          </div>

          {/* Recent ABs tab — PropFinder-style table */}
          {detailTab === "abs" && (
            <div>
              {recentABs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
                        <th className="text-left py-1.5 pr-3">Date</th>
                        <th className="text-left py-1.5 pr-3">Pitcher</th>
                        <th className="text-center py-1.5 px-2">Arm</th>
                        <th className="text-left py-1.5 pr-3">Type</th>
                        <th className="text-center py-1.5 px-2">EV</th>
                        <th className="text-center py-1.5 px-2">Angle</th>
                        <th className="text-center py-1.5 px-2">Distance</th>
                        <th className="text-left py-1.5">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentABs.map((ab, i) => (
                        <tr
                          key={i}
                          className="border-b border-card-border/50 last:border-0"
                        >
                          <td className="py-1.5 pr-3 text-muted font-mono">
                            {ab.date.slice(5)}
                          </td>
                          <td className="py-1.5 pr-3 text-foreground">
                            {ab.pitcher_name}
                          </td>
                          <td className="py-1.5 px-2 text-center text-muted">
                            {ab.pitch_arm}
                          </td>
                          <td className="py-1.5 pr-3 text-foreground">
                            {ab.pitch_type}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${evColor(ab.ev)}`}
                            >
                              {ab.ev.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${angleColor(ab.angle)}`}
                            >
                              {ab.angle.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${distColor(ab.distance)}`}
                            >
                              {ab.distance ? ab.distance.toFixed(0) : "-"}
                            </span>
                          </td>
                          <td className="py-1.5 text-muted capitalize">
                            {ab.result.replace(/_/g, " ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted py-2">
                  No recent at-bat data available for this matchup.
                </p>
              )}
            </div>
          )}

          {/* Metrics tab */}
          {detailTab === "metrics" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                  Batter Metrics (Weighted)
                </h4>
                <div className="space-y-1.5">
                  <MetricLine label="Exit Velo" value={`${player["Wt Exit Velo"]} mph`} />
                  <MetricLine label="Barrel%" value={`${player["Wt Barrel%"]}%`} />
                  <MetricLine label="Fly Ball%" value={`${player["Wt FB%"]}%`} />
                  <MetricLine label="Hard Hit%" value={`${player["Wt Hard Hit%"]}%`} />
                </div>
              </div>
              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                  Pitcher Splits (vs {player["B Hand"]}HB)
                </h4>
                <div className="space-y-1.5">
                  <MetricLine label="FB% Allowed" value={`${player["P FB%"]}%`} />
                  <MetricLine label="HR/FB%" value={`${player["P HR/FB%"]}%`} />
                  <MetricLine label="HR/9" value={`${player["P HR/9"]}`} />
                </div>
              </div>
              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                  Sub-Scores
                </h4>
                <div className="space-y-1.5">
                  <MetricLine label="Batter Score" value={player["Batter Score"].toFixed(3)} />
                  <MetricLine label="Pitcher Score" value={player["Pitcher Score"].toFixed(3)} />
                  <MetricLine label="Composite" value={player.Composite.toFixed(3)} highlight />
                </div>
              </div>
              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                  Matchup
                </h4>
                <div className="space-y-1.5">
                  <MetricLine label="Pitcher Hand" value={player["P Hand"] === "R" ? "Right" : "Left"} />
                  <MetricLine label="Batter Hand" value={player["B Hand"] === "R" ? "Right" : "Left"} />
                  <MetricLine label="Pitches Faced" value={player["Pitch Types"]} />
                  <MetricLine label="Over Odds" value={formatOdds(player["Over Odds"])} />
                </div>
              </div>
            </div>
          )}

          {/* Statcast tab — per-pitch-type breakdown */}
          {detailTab === "statcast" && (
            <div>
              {Object.keys(pitchDetail).length > 0 ? (
                <div className="overflow-x-auto">
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
                      {Object.entries(pitchDetail).map(([pt, detail]) => (
                        <tr
                          key={pt}
                          className="border-b border-card-border/50 last:border-0"
                        >
                          <td className="py-1.5 pr-3 font-medium text-foreground">
                            {pt}
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono text-muted">
                            {detail.usage_pct}%
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono text-accent">
                            {detail.weight}%
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${
                                detail.barrel_rate >= 15
                                  ? "bg-accent-green/80 text-background"
                                  : detail.barrel_rate >= 8
                                    ? "bg-accent-green/40 text-foreground"
                                    : "text-foreground"
                              }`}
                            >
                              {detail.barrel_rate}%
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${
                                detail.fb_rate >= 40
                                  ? "bg-accent-green/80 text-background"
                                  : detail.fb_rate >= 25
                                    ? "bg-accent-green/40 text-foreground"
                                    : "text-foreground"
                              }`}
                            >
                              {detail.fb_rate}%
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${
                                detail.hard_hit_rate >= 50
                                  ? "bg-accent-green/80 text-background"
                                  : detail.hard_hit_rate >= 35
                                    ? "bg-accent-green/40 text-foreground"
                                    : "text-foreground"
                              }`}
                            >
                              {detail.hard_hit_rate}%
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono ${evColor(detail.avg_exit_velo)}`}
                            >
                              {detail.avg_exit_velo}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted py-2">
                  No per-pitch Statcast data available.
                </p>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function MetricLine({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span
        className={
          highlight
            ? "font-mono font-bold text-accent"
            : "font-mono text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
