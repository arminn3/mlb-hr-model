"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { GameData, PlayerData } from "./types";

/* ---------- helpers ---------- */

function getGrade(composite: number): { label: string; color: string } {
  if (composite >= 0.65) return { label: "A+", color: "text-white" };
  if (composite >= 0.55) return { label: "A", color: "text-white" };
  if (composite >= 0.45) return { label: "B", color: "text-white" };
  if (composite >= 0.35) return { label: "C", color: "text-white" };
  if (composite >= 0.25) return { label: "D", color: "text-white" };
  return { label: "F", color: "text-white" };
}

// Figma design tokens — grade cell backgrounds and borders.
const GRADE_BG: Record<string, string> = {
  "A+": "#2a732e",
  A: "#2a732e",
  B: "#037bc7",
  C: "#6242b8",
  D: "#cc581d",
  F: "#931621",
};
const GRADE_BORDER: Record<string, string> = {
  "A+": "#428b47",
  A: "#428b47",
  B: "#426f8b",
  C: "#55428b",
  D: "#8b6242",
  F: "#8b4260",
};

function getForm(player: PlayerData): { label: string; color: string } {
  const l5 = player.scores.L5;
  const l10 = player.scores.L10;
  if (!l5 || !l10) return { label: "N/A", color: "text-muted" };

  const barrelUp = l5.barrel_pct > l10.barrel_pct;
  const evUp = l5.exit_velo > l10.exit_velo;

  if (barrelUp && evUp) return { label: "Hot", color: "text-accent-green" };
  if (!barrelUp && l5.barrel_pct < l10.barrel_pct)
    return { label: "Cold", color: "text-accent-red" };
  if (barrelUp || evUp) return { label: "Good", color: "text-accent-yellow" };
  return { label: "Average", color: "text-muted" };
}

function getPitchRating(barrelRate: number): { label: string; color: string } {
  if (barrelRate > 15) return { label: "Strong", color: "text-accent-green" };
  if (barrelRate > 8) return { label: "Average", color: "text-accent-yellow" };
  return { label: "Weak", color: "text-accent-red" };
}

function parkLabel(pf: number): string {
  if (pf >= 105) return "HR Friendly";
  if (pf >= 95) return "Neutral";
  return "Pitcher Park";
}

function fmt(v: number | undefined | null, decimals = 1): string {
  if (v === undefined || v === null) return "-";
  return v.toFixed(decimals);
}

function pct(v: number | undefined | null, decimals = 1): string {
  if (v === undefined || v === null) return "-";
  return v.toFixed(decimals) + "%";
}

/* ---------- sub-components ---------- */

function GradeBadge({ grade }: { grade: { label: string; color: string } }) {
  const bgMap: Record<string, string> = {
    ELITE: "bg-accent-green/20 text-accent-green border-accent-green/40",
    A: "bg-accent-green/10 text-accent-green border-accent-green/30",
    B: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30",
    C: "bg-accent-red/10 text-accent-red border-accent-red/30",
    D: "bg-card text-muted border-card-border",
  };
  return (
    <span
      className={`text-xs font-bold px-2.5 py-1 rounded border ${bgMap[grade.label] ?? bgMap.D}`}
    >
      {grade.label} GRADE
    </span>
  );
}

function SectionHeader({
  emoji,
  title,
  subtitle,
  borderColor,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  borderColor: string;
}) {
  return (
    <div className={`border-l-4 ${borderColor} pl-3 mb-3`}>
      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
        {emoji} {title}
      </h4>
      {subtitle && (
        <p className="text-[10px] text-muted mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function BulletStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs py-0.5">
      <span className="text-muted mr-1.5">&bull;</span>
      <span className="text-muted">{label}:</span>{" "}
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function calcBatterPower(player: PlayerData): number {
  const sp = player.season_profile;
  if (!sp) return 0;
  const evNorm = Math.max(0, Math.min(1, (sp.ev - 85) / 15));
  const raw = (sp.barrel / 25) * 0.5 + evNorm * 0.3 + (sp.fb / 50) * 0.2;
  // Confidence scaling — small samples get discounted toward 0.
  // 50 BIP = full credit, 25 BIP = half credit, 6 BIP = 12% credit.
  // Prevents career-AAA guys with 1 lucky barrel from 6 BIP (~16% rate)
  // from ranking next to Judge (300+ BIP, real 30% rate).
  const reliability = Math.min(1, (sp.bip_count ?? 0) / 50);
  return Math.min(1, Math.max(0, raw * reliability));
}

// Season-long composite — uses season_profile for batter, season-based
// pitcher_score and env_score (those are the same across L5/L10 in the
// backend). Deliberately does NOT read batter_score or composite from
// scores.L5 since those are L5-dependent.
function calcSeasonComposite(player: PlayerData): number {
  const batterPower = calcBatterPower(player);
  const scores = player.scores.L5; // only for pitcher_score + env_score, both season-based
  const pitcherVuln = scores?.pitcher_score ?? 0.5;
  const envScore = scores?.env_score ?? 0.5;
  // Weights: batter 60% (season_profile), pitcher 35% (season), env 5%
  return 0.6 * batterPower + 0.35 * pitcherVuln + 0.05 * envScore;
}

// Rough HR probability display — composite * 25 lands elite guys
// (~0.80 composite) at ~20%, matching the 16-22% range user referenced
// for ideal/elite plays. Placeholder until a calibrated model is wired.
function calcHrProb(seasonComposite: number): number {
  return seasonComposite * 25;
}

function MatchupCard({
  player,
  game,
  defaultExpanded,
}: {
  player: PlayerData;
  game: GameData;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const scores = player.scores.L5;
  if (!scores) return null;

  const sp = player.season_profile;
  const seasonComposite = calcSeasonComposite(player);
  const grade = getGrade(seasonComposite);
  const form = getForm(player);
  const env = game.environment;
  const hrProb = calcHrProb(seasonComposite).toFixed(1);

  const pitchEntries = Object.entries(player.pitch_detail || {}).sort(
    (a, b) => b[1].usage_pct - a[1].usage_pct,
  );

  const compositeColor =
    seasonComposite >= 0.55
      ? "text-accent-green"
      : seasonComposite >= 0.4
        ? "text-accent-yellow"
        : seasonComposite >= 0.25
          ? "text-accent-red"
          : "text-muted";

  return (
    <div className="bg-card/50 border border-card-border rounded-xl overflow-hidden">
      {/* ===== Header — always visible, clickable ===== */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 hover:bg-card/80 transition-colors cursor-pointer"
      >
        {/* Top row: matchup title + score/grade */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-base font-bold text-foreground block truncate">
              {"\u{1F525}"} {player.name} vs {player.opp_pitcher}
            </span>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {player.platoon ? (
                <span className="text-[10px] bg-accent-green/15 text-accent-green border border-accent-green/30 px-2 py-0.5 rounded-full font-medium">
                  Platoon Advantage
                </span>
              ) : null}
              <span className="text-[11px] text-muted">
                {player.batter_hand} vs {player.pitcher_hand}
              </span>
              {game.game_time && (
                <span className="text-[11px] text-muted">
                  {"\u00b7"} {game.game_time}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`font-mono text-xl font-bold ${compositeColor}`}>
              {hrProb}%
            </span>
            <GradeBadge grade={grade} />
            <svg
              className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        {/* Team pills */}
        <div className="flex items-center gap-2 mt-3">
          <span className="bg-accent-red/20 text-foreground text-xs font-bold px-4 py-1.5 rounded-full border border-accent-red/30">
            {game.away_team}
          </span>
          <span className="text-muted text-xs font-medium">@</span>
          <span className="bg-accent-yellow/20 text-foreground text-xs font-bold px-4 py-1.5 rounded-full border border-accent-yellow/30">
            {game.home_team}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-card-border">
          {/* ===== Score boxes — 3 across ===== */}
          <div className="grid grid-cols-3 gap-3 px-5 py-4">
            {[
              {
                value: calcBatterPower(player).toFixed(2),
                label: "POWER SCORE",
                color: "text-accent-green",
              },
              {
                value: scores.pitcher_score.toFixed(2),
                label: "VULNERABILITY",
                color: "text-accent-yellow",
              },
              {
                value: scores.env_score.toFixed(2),
                label: "CONTEXT",
                color: "text-accent",
              },
            ].map((box) => (
              <div
                key={box.label}
                className="border border-card-border rounded-lg bg-background/40 text-center py-3 px-2"
              >
                <span
                  className={`font-mono text-lg font-bold block ${box.color}`}
                >
                  {box.value}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted block mt-1">
                  {box.label}
                </span>
              </div>
            ))}
          </div>

          {/* ===== Batter / Pitcher two-column ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-0">
            {/* Batter metrics */}
            <div className="px-5 py-4 border-t border-card-border md:border-r">
              <SectionHeader
                emoji={"\u{1F3CF}"}
                title="BATTER METRICS"
                subtitle="Power & Contact Analysis"
                borderColor="border-accent-green"
              />
              <div className="space-y-0.5">
                <BulletStat label="Barrel" value={pct(sp?.barrel)} />
                <BulletStat
                  label="Exit Velo"
                  value={sp?.ev ? fmt(sp.ev) + " mph" : "-"}
                />
                <BulletStat label="FB%" value={pct(sp?.fb)} />
                <BulletStat
                  label="Hard Hit"
                  value={pct(sp?.hard_hit)}
                />
                <BulletStat label="ISO" value={sp?.iso !== undefined ? sp.iso.toFixed(3) : "-"} />
                <BulletStat label="HRs" value={sp?.hrs !== undefined ? String(sp.hrs) : "-"} />
                <BulletStat label="BIP" value={sp?.bip_count !== undefined ? String(sp.bip_count) : "-"} />
              </div>
              <div className="mt-2 pt-2 border-t border-card-border/50 text-xs">
                <span className="text-muted">&bull; Form:</span>{" "}
                <span className={`font-semibold ${form.color}`}>
                  {form.label === "Hot"
                    ? "\u{1F525} Hot"
                    : form.label === "Cold"
                      ? "\u{1F9CA} Cold"
                      : form.label === "Good"
                        ? "\u{2705} Good"
                        : "\u{2796} Average"}
                </span>
              </div>
              {scores.data_quality && scores.data_quality !== "OK" && (
                <div className="text-[10px] text-accent-yellow mt-2">
                  {scores.data_quality.replace(/_/g, " ")}
                </div>
              )}
            </div>

            {/* Pitcher metrics */}
            <div className="px-5 py-4 border-t border-card-border">
              <SectionHeader
                emoji={"\u26BE"}
                title="PITCHER METRICS"
                subtitle="Vulnerability Assessment"
                borderColor="border-accent-red"
              />
              <div className="space-y-0.5">
                <BulletStat
                  label="HR/FB"
                  value={pct(player.pitcher_stats?.hr_fb_rate)}
                />
                <BulletStat
                  label="HR/9"
                  value={fmt(player.pitcher_stats?.hr_per_9, 2)}
                />
                <BulletStat
                  label="FB Rate"
                  value={pct(player.pitcher_stats?.fb_rate)}
                />
                <BulletStat
                  label="Avg Velo"
                  value={
                    player.pitcher_stats?.avg_velo
                      ? fmt(player.pitcher_stats.avg_velo) + " mph"
                      : "-"
                  }
                />
                <BulletStat
                  label="IP"
                  value={fmt(player.pitcher_stats?.ip, 1)}
                />
                <BulletStat
                  label="Total HRs"
                  value={
                    player.pitcher_stats?.total_hrs !== undefined
                      ? String(player.pitcher_stats.total_hrs)
                      : "-"
                  }
                />
              </div>
            </div>
          </div>

          {/* ===== BvP career ===== */}
          {player.bvp_stats?.career && player.bvp_stats.career.abs > 0 && (
            <div className="border-t border-card-border px-5 py-4">
              <SectionHeader
                emoji={"\u{1F4CA}"}
                title="HEAD-TO-HEAD (CAREER)"
                borderColor="border-accent"
              />
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 text-center text-xs">
                {[
                  { l: "AB", v: String(player.bvp_stats.career.abs) },
                  { l: "H", v: String(player.bvp_stats.career.hits) },
                  { l: "HR", v: String(player.bvp_stats.career.hrs) },
                  { l: "BA", v: player.bvp_stats.career.ba.toFixed(3) },
                  { l: "SLG", v: player.bvp_stats.career.slg.toFixed(3) },
                  { l: "ISO", v: player.bvp_stats.career.iso.toFixed(3) },
                  {
                    l: "K%",
                    v: pct(player.bvp_stats.career.k_pct * 100, 1),
                  },
                  {
                    l: "OPS",
                    v:
                      typeof player.bvp_stats.career.ops === "number"
                        ? player.bvp_stats.career.ops.toFixed(3)
                        : String(player.bvp_stats.career.ops ?? "-"),
                  },
                ].map((s) => (
                  <div key={s.l}>
                    <span className="text-muted block text-[10px] uppercase">
                      {s.l}
                    </span>
                    <span className="font-mono text-foreground font-semibold">
                      {s.v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== Bottom two-column: Context + Pitch Analysis ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            {/* Context & Conditions */}
            <div className="px-5 py-4 border-t border-card-border md:border-r">
              <SectionHeader
                emoji={"\u{1F30D}"}
                title="CONTEXT & CONDITIONS"
                borderColor="border-accent"
              />
              <div className="space-y-2">
                <div className="border border-card-border rounded-lg p-3 bg-background/30">
                  <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">
                    Ballpark
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    PF {env.park_factor}
                  </span>
                  <span className="text-[10px] text-muted ml-1.5">
                    ({parkLabel(env.park_factor)})
                  </span>
                </div>
                <div className="border border-card-border rounded-lg p-3 bg-background/30">
                  <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">
                    Weather
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    {env.temperature_f !== null
                      ? `${Math.round(env.temperature_f)}\u00b0F`
                      : "-"}
                  </span>
                  {env.wind_speed_mph !== null && (
                    <span className="font-mono text-sm text-foreground ml-2">
                      Wind {fmt(env.wind_speed_mph)} mph
                      {env.wind_score !== undefined && (
                        <span
                          className={`ml-1 text-[10px] ${env.wind_score > 0 ? "text-accent-green" : env.wind_score < -3 ? "text-accent-red" : "text-muted"}`}
                        >
                          ({env.wind_score > 0 ? "+" : ""}
                          {fmt(env.wind_score)})
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="border border-card-border rounded-lg p-3 bg-background/30">
                  <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">
                    Handedness
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    {player.batter_hand} vs {player.pitcher_hand}
                  </span>
                  {player.platoon ? (
                    <span className="text-[10px] text-accent-green ml-2">
                      Platoon {"\u2713"}
                    </span>
                  ) : null}
                </div>
                <div className="border border-card-border rounded-lg p-3 bg-background/30">
                  <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">
                    Venue
                  </span>
                  <span className="font-mono text-sm text-foreground">
                    {env.is_dome
                      ? "Dome"
                      : env.is_retractable
                        ? env.roof_closed
                          ? "Roof Closed"
                          : "Roof Open"
                        : "Open Air"}
                  </span>
                </div>
              </div>
            </div>

            {/* Pitch Analysis */}
            <div className="px-5 py-4 border-t border-card-border">
              <SectionHeader
                emoji={"\u26BE"}
                title="PITCH ANALYSIS & PERFORMANCE"
                borderColor="border-accent-red"
              />
              {pitchEntries.length > 0 ? (
                <div className="space-y-2">
                  {pitchEntries.map(([code, detail]) => {
                    const rating = getPitchRating(detail.barrel_rate);
                    const borderClr =
                      rating.label === "Strong"
                        ? "border-accent-green"
                        : rating.label === "Average"
                          ? "border-accent-yellow"
                          : "border-accent-red";
                    const badgeBg =
                      rating.label === "Strong"
                        ? "bg-accent-green/15 text-accent-green"
                        : rating.label === "Average"
                          ? "bg-accent-yellow/15 text-accent-yellow"
                          : "bg-accent-red/15 text-accent-red";
                    return (
                      <div
                        key={code}
                        className={`border-l-4 ${borderClr} border border-card-border rounded-lg p-3 bg-background/30`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-foreground">
                            {code} ({pct(detail.usage_pct)})
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${badgeBg}`}
                          >
                            {rating.label}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-muted">
                          Barrel: {pct(detail.barrel_rate)} | EV:{" "}
                          {fmt(detail.avg_exit_velo)}mph | Hard:{" "}
                          {pct(detail.hard_hit_rate)}
                        </div>
                        {detail.count !== undefined && (
                          <div className="text-[10px] text-muted/60 mt-1">
                            {detail.count >= 100
                              ? "large"
                              : detail.count >= 30
                                ? "medium"
                                : "small"}{" "}
                            sample ({detail.count} BBE)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted">No pitch data available.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- table helpers ---------- */

type TableSortKey =
  | "name"
  | "team"
  | "grade"
  | "composite"
  | "hr_prob"
  | "form"
  | "pitcher_name"
  | "pitcher_team"
  | "batter_power"
  | "pitcher_vuln"
  | "exit_velo"
  | "barrel_pct";
type SortDir = "asc" | "desc";
type PitcherVulnFilter = "all" | "high" | "medium" | "low";
type BatterPowerFilter = "all" | "elite" | "strong" | "average" | "weak";

// Columns that default to descending (numeric — highest first)
const DESC_DEFAULT_KEYS = new Set<TableSortKey>([
  "grade",
  "composite",
  "hr_prob",
  "batter_power",
  "pitcher_vuln",
  "exit_velo",
  "barrel_pct",
  "form",
]);

function getFormDetailed(player: PlayerData): {
  label: string;
  dot: string;
  color: string;
} {
  const l5 = player.scores.L5;
  const l10 = player.scores.L10;
  if (!l5 || !l10)
    return { label: "N/A", dot: "\u26AA", color: "text-white" };

  const barrelDiff = l5.barrel_pct - l10.barrel_pct;
  const evDiff = l5.exit_velo - l10.exit_velo;
  const combined = barrelDiff + evDiff;

  // Figma labels: Elite / Ideal / Good / Average / Cold
  if (combined > 4)
    return { label: "Elite", dot: "\uD83D\uDD25", color: "text-white" }; // 🔥
  if (combined > 2)
    return { label: "Ideal", dot: "\uD83D\uDD35", color: "text-white" }; // 🔵
  if (combined > 0)
    return { label: "Good", dot: "\uD83D\uDFE2", color: "text-white" }; // 🟢
  if (combined > -2)
    return { label: "Average", dot: "\uD83D\uDFE1", color: "text-white" }; // 🟡
  return { label: "Cold", dot: "\uD83D\uDD34", color: "text-white" }; // 🔴
}

function greenGradientBg(value: number): string {
  // Figma green #2a732e — only kicks in above 0.5 so weak/average
  // values stay neutral. 0.5 → transparent, 1.0 → solid green.
  // Below 0.5 = no tint at all (was lighting up 20%-power guys
  // with faint green which looked wrong).
  if (value < 0.5) return "transparent";
  const alpha = (value - 0.5) / 0.5; // 0.5..1.0 → 0..1
  return `rgba(42, 115, 46, ${alpha})`;
}

/* ---------- table sub-components ---------- */

function probToAmericanOdds(probPct: number): string {
  // prob is expressed as a percentage (e.g. 17.5)
  if (probPct <= 0 || probPct >= 100) return "";
  const p = probPct / 100;
  const american = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  const rounded = Math.round(american);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: TableSortKey;
  currentSort: TableSortKey | null;
  currentDir: SortDir;
  onSort: (key: TableSortKey) => void;
  align?: "left" | "center";
}) {
  const active = currentSort === sortKey;
  const arrow = active ? (currentDir === "desc" ? "\u2193" : "\u2191") : "";
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] transition-colors whitespace-nowrap border-b border-r border-[#32333b] ${
        align === "left" ? "text-left" : "text-center"
      } ${active ? "text-white" : "text-[#a0a1a4] hover:text-white"}`}
      style={{ backgroundColor: "#1a1c24" }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-xs">{arrow}</span>}
      </span>
    </th>
  );
}

function MatchupTableView({
  players,
  sortKey,
  sortDir,
  onSort,
}: {
  players: { player: PlayerData; game: GameData }[];
  sortKey: TableSortKey | null;
  sortDir: SortDir;
  onSort: (key: TableSortKey) => void;
}) {
  const headerProps = { currentSort: sortKey, currentDir: sortDir, onSort };
  // Figma design tokens
  const bgRow = "#0d1116";
  const borderColor = "#32333b";
  const cellBase =
    "p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-white whitespace-nowrap border-b border-r";
  return (
    <>
      {/* Desktop table — Figma node 1:88 styling applied to full 12-column data set */}
      <div
        className="hidden md:block overflow-x-auto rounded-[12px] border"
        style={{ borderColor, backgroundColor: bgRow, fontFamily: "Inter, system-ui, sans-serif" }}
      >
        <table className="border-collapse w-max min-w-full">
          <thead>
            <tr>
              <SortHeader label="Batter" sortKey="name" align="left" {...headerProps} />
              <SortHeader label="Team" sortKey="team" align="left" {...headerProps} />
              <SortHeader label="Grade" sortKey="grade" align="left" {...headerProps} />
              <SortHeader label="HR Probability" sortKey="hr_prob" align="left" {...headerProps} />
              <SortHeader label="Recent Form" sortKey="form" align="left" {...headerProps} />
              <SortHeader label="Pitcher" sortKey="pitcher_name" align="left" {...headerProps} />
              <SortHeader label="Team" sortKey="pitcher_team" align="left" {...headerProps} />
              <SortHeader label="Batter Power" sortKey="batter_power" align="left" {...headerProps} />
              <SortHeader label="Pitcher Vulnerability" sortKey="pitcher_vuln" align="left" {...headerProps} />
              <SortHeader label="EV" sortKey="exit_velo" align="left" {...headerProps} />
              <SortHeader label="Barrel%" sortKey="barrel_pct" align="left" {...headerProps} />
              <SortHeader label="Score" sortKey="composite" align="left" {...headerProps} />
            </tr>
          </thead>
          <tbody>
            {players.map(({ player, game }) => {
              const scores = player.scores.L5;
              if (!scores) return null;
              const sp = player.season_profile;
              const seasonComposite = calcSeasonComposite(player);
              const grade = getGrade(seasonComposite);
              const form = getFormDetailed(player);
              const batterTeam =
                player.batter_side === "home"
                  ? game.home_team
                  : game.away_team;
              const pitcherTeam =
                player.batter_side === "home"
                  ? game.away_team
                  : game.home_team;
              const batterPower = calcBatterPower(player);
              const hrProbPct = calcHrProb(seasonComposite);
              const americanOdds = probToAmericanOdds(hrProbPct);

              return (
                <tr
                  key={`${game.game_pk}-${player.name}`}
                  style={{ backgroundColor: bgRow }}
                >
                  <td className={cellBase} style={{ borderColor }}>
                    {player.name}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {batterTeam}
                  </td>
                  <td
                    className="p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-white text-left whitespace-nowrap border-b border-r"
                    style={{
                      backgroundColor: GRADE_BG[grade.label],
                      // subtle dark overlay line — visible but not harsh
                      // (replaces the bright #428b47 that was too loud)
                      borderBottomColor: "rgba(0, 0, 0, 0.25)",
                      borderRightColor: borderColor,
                    }}
                  >
                    {grade.label}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {hrProbPct.toFixed(1)}%
                    {americanOdds && (
                      <span className="text-[#a0a1a4] ml-1">({americanOdds})</span>
                    )}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {form.dot} {form.label}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {player.opp_pitcher}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {pitcherTeam}
                  </td>
                  <td
                    className="p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-white whitespace-nowrap border-b border-r"
                    style={{
                      borderColor,
                      backgroundColor: greenGradientBg(batterPower),
                    }}
                  >
                    {batterPower.toFixed(2)}
                  </td>
                  <td
                    className="p-3 font-medium text-sm tracking-[-0.28px] leading-[1.2] text-white whitespace-nowrap border-b border-r"
                    style={{
                      borderColor,
                      backgroundColor: greenGradientBg(scores.pitcher_score),
                    }}
                  >
                    {scores.pitcher_score.toFixed(2)}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {fmt(sp?.ev)}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {pct(sp?.barrel)}
                  </td>
                  <td className={cellBase} style={{ borderColor }}>
                    {(seasonComposite * 100).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards fallback */}
      <div className="md:hidden space-y-2">
        {players.map(({ player, game }) => {
          const scores = player.scores.L5;
          if (!scores) return null;
          const sp = player.season_profile;
          const seasonComposite = calcSeasonComposite(player);
          const grade = getGrade(seasonComposite);
          const form = getFormDetailed(player);
          const batterTeam =
            player.batter_side === "home" ? game.home_team : game.away_team;
          const batterPower = calcBatterPower(player);

          return (
            <div
              key={`${game.game_pk}-${player.name}-mob`}
              className="bg-card/50 border border-card-border rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-foreground block truncate">
                    {player.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {batterTeam} vs {player.opp_pitcher}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-sm font-bold text-foreground">
                    {calcHrProb(seasonComposite).toFixed(1)}%
                  </span>
                  <span
                    className="text-sm font-medium text-white px-2 py-0.5 rounded border"
                    style={{
                      backgroundColor: GRADE_BG[grade.label],
                      borderColor: GRADE_BORDER[grade.label],
                    }}
                  >
                    {grade.label}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                <div>
                  <span className="text-muted block uppercase">Power</span>
                  <span
                    className="font-mono font-semibold text-foreground block rounded px-1"
                    style={{
                      backgroundColor: greenGradientBg(batterPower),
                    }}
                  >
                    {batterPower.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted block uppercase">Vuln</span>
                  <span
                    className="font-mono font-semibold text-foreground block rounded px-1"
                    style={{
                      backgroundColor: greenGradientBg(scores.pitcher_score),
                    }}
                  >
                    {scores.pitcher_score.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted block uppercase">Form</span>
                  <span className={`${form.color} block`}>
                    {form.dot} {form.label}
                  </span>
                </div>
                <div>
                  <span className="text-muted block uppercase">Barrel</span>
                  <span className="font-mono text-foreground block">
                    {pct(sp?.barrel)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- main export ---------- */

export function MatchupAnalysis({
  games,
}: {
  games: GameData[];
}) {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"composite" | "batter" | "pitcher">(
    "composite",
  );
  // null = default order (composite desc) with no active sort indicator.
  // As soon as the user clicks a column, this becomes a real key and
  // the arrow indicator appears.
  const [tableSortBy, setTableSortBy] = useState<TableSortKey | null>(null);
  const [tableSortDir, setTableSortDir] = useState<SortDir>("desc");

  const handleTableSort = (key: TableSortKey) => {
    if (tableSortBy === key) {
      setTableSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setTableSortBy(key);
      setTableSortDir(DESC_DEFAULT_KEYS.has(key) ? "desc" : "asc");
    }
  };
  const [pitcherVulnFilter, setPitcherVulnFilter] =
    useState<PitcherVulnFilter>("all");
  const [batterPowerFilter, setBatterPowerFilter] =
    useState<BatterPowerFilter>("all");
  const [tableSearch, setTableSearch] = useState("");
  const [expandAll, setExpandAll] = useState(false);

  const filteredGames = useMemo(() => {
    if (selectedGamePk === null) return games;
    return games.filter((g) => g.game_pk === selectedGamePk);
  }, [games, selectedGamePk]);

  const allPairs = useMemo(() => {
    const pairs: { player: PlayerData; game: GameData }[] = [];
    for (const game of filteredGames) {
      for (const player of game.players) {
        pairs.push({ player, game });
      }
    }
    return pairs;
  }, [filteredGames]);

  const tableFilteredPairs = useMemo(() => {
    let result = allPairs;

    if (pitcherVulnFilter !== "all") {
      result = result.filter(({ player }) => {
        const s = player.scores.L5;
        if (!s) return false;
        const v = s.pitcher_score;
        if (pitcherVulnFilter === "high") return v > 0.6;
        if (pitcherVulnFilter === "medium") return v >= 0.3 && v <= 0.6;
        return v < 0.3;
      });
    }

    if (batterPowerFilter !== "all") {
      result = result.filter(({ player }) => {
        const v = calcBatterPower(player);
        if (batterPowerFilter === "elite") return v > 0.8;
        if (batterPowerFilter === "strong") return v > 0.5 && v <= 0.8;
        if (batterPowerFilter === "average") return v > 0.3 && v <= 0.5;
        return v <= 0.3;
      });
    }

    if (tableSearch.trim() !== "") {
      const q = tableSearch.trim().toLowerCase();
      result = result.filter(({ player }) =>
        player.name.toLowerCase().includes(q) ||
        (player.opp_pitcher ?? "").toLowerCase().includes(q),
      );
    }

    return result;
  }, [allPairs, pitcherVulnFilter, batterPowerFilter, tableSearch]);

  const tableSortedPlayers = useMemo(() => {
    const teamOf = (pair: { player: PlayerData; game: GameData }) =>
      pair.player.batter_side === "home"
        ? pair.game.home_team
        : pair.game.away_team;
    const pitcherTeamOf = (pair: { player: PlayerData; game: GameData }) =>
      pair.player.batter_side === "home"
        ? pair.game.away_team
        : pair.game.home_team;
    const formScoreOf = (player: PlayerData): number => {
      const l5 = player.scores.L5;
      const l10 = player.scores.L10;
      if (!l5 || !l10) return -999;
      return l5.barrel_pct - l10.barrel_pct + (l5.exit_velo - l10.exit_velo);
    };

    const numericValue = (
      pair: { player: PlayerData; game: GameData },
      key: TableSortKey,
    ): number => {
      const { player } = pair;
      const sp = player.season_profile;
      const scores = player.scores.L5;
      switch (key) {
        case "grade":
        case "composite":
        case "hr_prob":
          return calcSeasonComposite(player);
        case "batter_power":
          return calcBatterPower(player);
        case "pitcher_vuln":
          return scores?.pitcher_score ?? 0;
        case "exit_velo":
          return sp?.ev ?? 0;
        case "barrel_pct":
          return sp?.barrel ?? 0;
        case "form":
          return formScoreOf(player);
        default:
          return 0;
      }
    };

    const textValue = (
      pair: { player: PlayerData; game: GameData },
      key: TableSortKey,
    ): string => {
      switch (key) {
        case "name":
          return pair.player.name;
        case "team":
          return teamOf(pair);
        case "pitcher_name":
          return pair.player.opp_pitcher ?? "";
        case "pitcher_team":
          return pitcherTeamOf(pair);
        default:
          return "";
      }
    };

    // null key → default order: grade (composite) descending
    const effectiveKey: TableSortKey = tableSortBy ?? "grade";
    const effectiveDir: SortDir = tableSortBy === null ? "desc" : tableSortDir;

    const isTextSort =
      effectiveKey === "name" ||
      effectiveKey === "team" ||
      effectiveKey === "pitcher_name" ||
      effectiveKey === "pitcher_team";

    const sorted = [...tableFilteredPairs];
    sorted.sort((a, b) => {
      const dir = effectiveDir === "desc" ? -1 : 1;
      if (isTextSort) {
        return textValue(a, effectiveKey).localeCompare(textValue(b, effectiveKey)) * dir;
      }
      return (numericValue(a, effectiveKey) - numericValue(b, effectiveKey)) * dir;
    });
    return sorted;
  }, [tableFilteredPairs, tableSortBy, tableSortDir]);

  const cardSortedPlayers = useMemo(() => {
    const sorted = [...allPairs];
    sorted.sort((a, b) => {
      const sa = a.player.scores.L5;
      const sb = b.player.scores.L5;
      if (!sa || !sb) return 0;
      if (sortBy === "batter") return calcBatterPower(b.player) - calcBatterPower(a.player);
      if (sortBy === "pitcher") return sb.pitcher_score - sa.pitcher_score;
      return calcSeasonComposite(b.player) - calcSeasonComposite(a.player);
    });
    return sorted;
  }, [allPairs, sortBy]);

  const selectClasses =
    "bg-card/50 border border-card-border text-foreground text-xs rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-accent/40 cursor-pointer appearance-none bg-no-repeat bg-[right_0.6rem_center] bg-[length:0.75em_0.75em]";
  const selectBgStyle: CSSProperties = {
    backgroundImage:
      'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'%239ca3af\'%3E%3Cpath fill-rule=\'evenodd\' d=\'M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z\' clip-rule=\'evenodd\'/%3E%3C/svg%3E")',
  };

  return (
    <div className="space-y-4">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 bg-card/30 border border-card-border rounded-lg p-1 w-fit">
        {(["table", "cards"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
              viewMode === mode
                ? "bg-accent text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {mode === "table" ? "Table" : "Cards"}
          </button>
        ))}
      </div>

      {/* Season-long disclosure */}
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-xs text-foreground">
        <span className="font-semibold text-accent">Season-long view.</span>{" "}
        Grade, HR Probability, Batter Power, EV, and Barrel% all use full
        2025+2026 season data — not L5 or L10. The{" "}
        <span className="font-semibold">Recent Form</span> column is the only
        place recent (L5 vs L10) performance shows up, and it has zero
        influence on the grade or probability.
      </div>

      {viewMode === "table" ? (
        <>
          {/* Table filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedGamePk ?? ""}
              onChange={(e) =>
                setSelectedGamePk(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className={selectClasses}
              style={selectBgStyle}
            >
              <option value="">All Games ({games.length})</option>
              {games.map((g) => (
                <option key={g.game_pk} value={g.game_pk}>
                  {g.away_team} @ {g.home_team}
                  {g.game_time ? ` \u2014 ${g.game_time}` : ""}
                </option>
              ))}
            </select>

            <select
              value={pitcherVulnFilter}
              onChange={(e) =>
                setPitcherVulnFilter(e.target.value as PitcherVulnFilter)
              }
              className={selectClasses}
              style={selectBgStyle}
            >
              <option value="all">Pitcher Vuln: All</option>
              <option value="high">High (&gt;0.6)</option>
              <option value="medium">Medium (0.3-0.6)</option>
              <option value="low">Low (&lt;0.3)</option>
            </select>

            <select
              value={batterPowerFilter}
              onChange={(e) =>
                setBatterPowerFilter(e.target.value as BatterPowerFilter)
              }
              className={selectClasses}
              style={selectBgStyle}
            >
              <option value="all">Batter Power: All</option>
              <option value="elite">Elite (&gt;0.8)</option>
              <option value="strong">Strong (&gt;0.5)</option>
              <option value="average">Average</option>
              <option value="weak">Weak</option>
            </select>

            <div className="relative w-56">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                />
              </svg>
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search batter or pitcher…"
                className="w-full bg-card/50 border border-card-border text-foreground placeholder:text-muted text-xs rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-accent/40"
              />
            </div>

            <span className="text-xs text-muted ml-auto hidden md:inline">
              Click any column header to sort
            </span>
          </div>

          <p className="text-xs text-muted">
            {tableSortedPlayers.length} matchups
            {selectedGamePk !== null && (
              <>
                {" "}
                in{" "}
                {(() => {
                  const g = games.find((gm) => gm.game_pk === selectedGamePk);
                  return g ? `${g.away_team} @ ${g.home_team}` : "";
                })()}
              </>
            )}
          </p>

          <MatchupTableView
            players={tableSortedPlayers}
            sortKey={tableSortBy}
            sortDir={tableSortDir}
            onSort={handleTableSort}
          />

          {tableSortedPlayers.length === 0 && (
            <p className="text-center text-muted py-12">
              No matchup data available.
            </p>
          )}
        </>
      ) : (
        <>
          {/* Cards controls */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedGamePk ?? ""}
              onChange={(e) =>
                setSelectedGamePk(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className={selectClasses}
              style={selectBgStyle}
            >
              <option value="">All Games ({games.length})</option>
              {games.map((g) => (
                <option key={g.game_pk} value={g.game_pk}>
                  {g.away_team} @ {g.home_team}
                  {g.game_time ? ` \u2014 ${g.game_time}` : ""}
                </option>
              ))}
            </select>

            {(
              [
                ["composite", "Score"],
                ["batter", "Power"],
                ["pitcher", "Vulnerability"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-colors ${
                  sortBy === key
                    ? "bg-accent text-background font-bold"
                    : "bg-card/50 text-muted border border-card-border hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}

            <button
              onClick={() => setExpandAll(!expandAll)}
              className="ml-auto px-3 py-1.5 text-xs rounded-full bg-card/50 text-muted border border-card-border hover:text-foreground cursor-pointer transition-colors"
            >
              {expandAll ? "Collapse All" : "Expand All"}
            </button>
          </div>

          <p className="text-xs text-muted">
            Showing top {Math.min(30, cardSortedPlayers.length)} of{" "}
            {cardSortedPlayers.length} matchups
            {selectedGamePk !== null && (
              <>
                {" "}
                in{" "}
                {(() => {
                  const g = games.find((gm) => gm.game_pk === selectedGamePk);
                  return g ? `${g.away_team} @ ${g.home_team}` : "";
                })()}
              </>
            )}
            . Use the Table view to see every matchup.
          </p>

          <div className="space-y-2">
            {cardSortedPlayers.slice(0, 30).map(({ player, game }, i) => (
              <MatchupCard
                key={`${game.game_pk}-${player.name}`}
                player={player}
                game={game}
                defaultExpanded={
                  expandAll || (i < 5 && selectedGamePk !== null)
                }
              />
            ))}
          </div>

          {cardSortedPlayers.length === 0 && (
            <p className="text-center text-muted py-12">
              No matchup data available.
            </p>
          )}
        </>
      )}
    </div>
  );
}
