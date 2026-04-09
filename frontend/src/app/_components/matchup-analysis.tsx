"use client";

import { useMemo, useState } from "react";
import type { GameData, PlayerData } from "./types";

/* ---------- helpers ---------- */

function getGrade(composite: number): { label: string; color: string } {
  if (composite >= 0.7) return { label: "ELITE", color: "text-accent-green" };
  if (composite >= 0.55) return { label: "A", color: "text-accent-green" };
  if (composite >= 0.4) return { label: "B", color: "text-accent-yellow" };
  if (composite >= 0.25) return { label: "C", color: "text-accent-red" };
  return { label: "D", color: "text-muted" };
}

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
  return Math.min(1, Math.max(0, raw));
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
    return { label: "N/A", dot: "\u26AA", color: "text-muted" };

  const barrelDiff = l5.barrel_pct - l10.barrel_pct;
  const evDiff = l5.exit_velo - l10.exit_velo;
  const combined = barrelDiff + evDiff;

  if (combined > 3)
    return { label: "Hot", dot: "\uD83D\uDFE2", color: "text-accent-green" };
  if (combined > 1)
    return { label: "Good", dot: "\uD83D\uDD35", color: "text-blue-400" };
  if (combined > -1)
    return { label: "Average", dot: "\uD83D\uDFE1", color: "text-accent-yellow" };
  if (combined > -3)
    return { label: "Slump", dot: "\uD83D\uDFE0", color: "text-orange-400" };
  return { label: "Cold", dot: "\uD83D\uDD34", color: "text-accent-red" };
}

function greenGradientBg(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const alpha = Math.round(clamped * 40);
  return `rgba(34, 197, 94, ${alpha / 100})`;
}

/* ---------- table sub-components ---------- */

function TableGradeBadge({ grade }: { grade: { label: string; color: string } }) {
  const styles: Record<string, string> = {
    ELITE: "bg-accent-green/25 text-accent-green border-accent-green/50",
    A: "bg-accent-green/15 text-accent-green border-accent-green/40",
    B: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/40",
    C: "bg-accent-red/15 text-accent-red border-accent-red/40",
    D: "bg-card text-muted border-card-border",
  };
  return (
    <span
      className={`text-xs font-bold px-2.5 py-1 rounded border inline-block min-w-[2.5rem] ${styles[grade.label] ?? styles.D}`}
    >
      {grade.label}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = "center",
}: {
  label: string;
  sortKey: TableSortKey;
  currentSort: TableSortKey;
  currentDir: SortDir;
  onSort: (key: TableSortKey) => void;
  align?: "left" | "center";
}) {
  const active = currentSort === sortKey;
  const arrow = active ? (currentDir === "desc" ? "\u2193" : "\u2191") : "";
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none py-3 px-2 font-semibold text-[11px] uppercase tracking-wider transition-colors whitespace-nowrap ${
        align === "left" ? "text-left" : "text-center"
      } ${active ? "text-accent" : "text-muted hover:text-foreground"}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
          {active ? arrow : "\u2195"}
        </span>
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
  sortKey: TableSortKey;
  sortDir: SortDir;
  onSort: (key: TableSortKey) => void;
}) {
  const headerProps = { currentSort: sortKey, currentDir: sortDir, onSort };
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-card-border bg-card/20">
        <table className="w-full text-sm">
          <thead className="bg-card/40 border-b border-card-border sticky top-0">
            <tr>
              <SortHeader label="Batter" sortKey="name" align="left" {...headerProps} />
              <SortHeader label="Team" sortKey="team" align="left" {...headerProps} />
              <SortHeader label="Grade" sortKey="composite" {...headerProps} />
              <SortHeader label="HR Prob" sortKey="hr_prob" {...headerProps} />
              <SortHeader label="Form" sortKey="form" {...headerProps} />
              <SortHeader label="Pitcher" sortKey="pitcher_name" align="left" {...headerProps} />
              <SortHeader label="P. Team" sortKey="pitcher_team" align="left" {...headerProps} />
              <SortHeader label="Batter Power" sortKey="batter_power" {...headerProps} />
              <SortHeader label="Pitcher Vuln" sortKey="pitcher_vuln" {...headerProps} />
              <SortHeader label="EV" sortKey="exit_velo" {...headerProps} />
              <SortHeader label="Barrel%" sortKey="barrel_pct" {...headerProps} />
              <SortHeader label="Score" sortKey="composite" {...headerProps} />
            </tr>
          </thead>
          <tbody>
            {players.map(({ player, game }, i) => {
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

              return (
                <tr
                  key={`${game.game_pk}-${player.name}`}
                  className={`border-b border-card-border/30 hover:bg-card/50 transition-colors ${
                    i % 2 === 0 ? "bg-transparent" : "bg-card/10"
                  }`}
                >
                  <td className="py-3 px-3 font-semibold text-foreground whitespace-nowrap">
                    {player.name}
                  </td>
                  <td className="py-3 px-2 text-muted font-mono text-xs">
                    {batterTeam}
                  </td>
                  <td className="py-3 px-2 text-center bg-accent/5">
                    <TableGradeBadge grade={grade} />
                  </td>
                  <td className="py-3 px-2 text-center font-mono font-bold text-accent">
                    {calcHrProb(seasonComposite).toFixed(1)}%
                  </td>
                  <td className="py-3 px-2 text-center whitespace-nowrap">
                    <span className={form.color} title={form.label}>
                      {form.dot}{" "}
                      <span className="text-xs font-medium">{form.label}</span>
                    </span>
                  </td>
                  <td className="py-3 px-3 text-foreground whitespace-nowrap">
                    {player.opp_pitcher}
                  </td>
                  <td className="py-3 px-2 text-muted font-mono text-xs">
                    {pitcherTeam}
                  </td>
                  <td
                    className="py-3 px-2 text-center font-mono font-bold text-foreground"
                    style={{
                      backgroundColor: greenGradientBg(batterPower),
                    }}
                  >
                    {batterPower.toFixed(2)}
                  </td>
                  <td
                    className="py-3 px-2 text-center font-mono font-bold text-foreground"
                    style={{
                      backgroundColor: greenGradientBg(scores.pitcher_score),
                    }}
                  >
                    {scores.pitcher_score.toFixed(2)}
                  </td>
                  <td className="py-3 px-2 text-center font-mono text-foreground">
                    {fmt(sp?.ev)}
                  </td>
                  <td className="py-3 px-2 text-center font-mono text-foreground">
                    {pct(sp?.barrel)}
                  </td>
                  <td className="py-3 px-2 text-center font-mono font-bold text-foreground">
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
                  <TableGradeBadge grade={grade} />
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
  const [tableSortBy, setTableSortBy] = useState<TableSortKey>("composite");
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

    return result;
  }, [allPairs, pitcherVulnFilter, batterPowerFilter]);

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

    const isTextSort =
      tableSortBy === "name" ||
      tableSortBy === "team" ||
      tableSortBy === "pitcher_name" ||
      tableSortBy === "pitcher_team";

    const sorted = [...tableFilteredPairs];
    sorted.sort((a, b) => {
      const dir = tableSortDir === "desc" ? -1 : 1;
      if (isTextSort) {
        return textValue(a, tableSortBy).localeCompare(textValue(b, tableSortBy)) * dir;
      }
      return (numericValue(a, tableSortBy) - numericValue(b, tableSortBy)) * dir;
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
    "bg-card/50 border border-card-border text-foreground text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent/40 cursor-pointer";

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
            >
              <option value="all">Batter Power: All</option>
              <option value="elite">Elite (&gt;0.8)</option>
              <option value="strong">Strong (&gt;0.5)</option>
              <option value="average">Average</option>
              <option value="weak">Weak</option>
            </select>

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
          </p>

          <div className="space-y-2">
            {cardSortedPlayers.slice(0, 25).map(({ player, game }, i) => (
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
