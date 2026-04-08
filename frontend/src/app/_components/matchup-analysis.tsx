"use client";

import { useMemo, useState } from "react";
import type { GameData, LookbackKey, PlayerData } from "./types";

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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function MatchupCard({
  player,
  game,
  lookback,
  defaultExpanded,
}: {
  player: PlayerData;
  game: GameData;
  lookback: LookbackKey;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const scores = player.scores[lookback];
  if (!scores) return null;

  const grade = getGrade(scores.composite);
  const form = getForm(player);
  const env = game.environment;

  const pitchEntries = Object.entries(player.pitch_detail || {}).sort(
    (a, b) => b[1].usage_pct - a[1].usage_pct,
  );

  return (
    <div className="bg-card/50 border border-card-border rounded-xl overflow-hidden">
      {/* Header — always visible, clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-card/80 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded ${grade.color} bg-card border border-card-border`}
          >
            {grade.label}
          </span>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-foreground truncate block">
              {player.name}{" "}
              <span className="text-muted font-normal text-xs">
                ({player.batter_hand})
              </span>{" "}
              <span className="text-muted font-normal text-xs">vs</span>{" "}
              {player.opp_pitcher}{" "}
              <span className="text-muted font-normal text-xs">
                ({player.pitcher_hand})
              </span>
            </span>
            <span className="text-[11px] text-muted block mt-0.5">
              {game.away_team} @ {game.home_team}
              {game.game_time ? ` \u00b7 ${game.game_time}` : ""}
              {player.platoon ? " \u00b7 Platoon \u2713" : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="font-mono text-xs text-foreground hidden sm:block">
            {scores.composite.toFixed(3)}
          </span>
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
      </button>

      {expanded && (
        <div className="border-t border-card-border">
          {/* Score bar */}
          <div className="grid grid-cols-3 divide-x divide-card-border text-center py-2.5 bg-background/40">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted block">
                Power
              </span>
              <span className="font-mono text-sm text-foreground font-semibold">
                {scores.batter_score.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted block">
                Vulnerability
              </span>
              <span className="font-mono text-sm text-foreground font-semibold">
                {scores.pitcher_score.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted block">
                Context
              </span>
              <span className="font-mono text-sm text-foreground font-semibold">
                {scores.env_score.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Batter / Pitcher split */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-card-border">
            {/* Batter metrics */}
            <div className="p-4 space-y-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Batter Metrics
              </h4>
              <StatRow label="Barrel %" value={pct(scores.barrel_pct)} />
              <StatRow label="Exit Velo" value={fmt(scores.exit_velo) + " mph"} />
              <StatRow label="FB %" value={pct(scores.fb_pct)} />
              <StatRow label="Hard Hit %" value={pct(scores.hard_hit_pct)} />
              <div className="flex justify-between text-xs pt-1">
                <span className="text-muted">Form</span>
                <span className={`font-semibold ${form.color}`}>
                  {form.label}
                </span>
              </div>
              {scores.data_quality && scores.data_quality !== "OK" && (
                <div className="text-[10px] text-accent-yellow mt-1">
                  {scores.data_quality.replace(/_/g, " ")}
                </div>
              )}
            </div>

            {/* Pitcher metrics */}
            <div className="p-4 space-y-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Pitcher Metrics
              </h4>
              <StatRow
                label="HR/FB"
                value={pct(player.pitcher_stats?.hr_fb_rate)}
              />
              <StatRow
                label="HR/9"
                value={fmt(player.pitcher_stats?.hr_per_9, 2)}
              />
              <StatRow
                label="FB Rate"
                value={pct(player.pitcher_stats?.fb_rate)}
              />
              <StatRow
                label="Avg Velo"
                value={
                  player.pitcher_stats?.avg_velo
                    ? fmt(player.pitcher_stats.avg_velo) + " mph"
                    : "-"
                }
              />
              <StatRow
                label="IP"
                value={fmt(player.pitcher_stats?.ip, 1)}
              />
              <StatRow
                label="Total HRs"
                value={
                  player.pitcher_stats?.total_hrs !== undefined
                    ? String(player.pitcher_stats.total_hrs)
                    : "-"
                }
              />
            </div>
          </div>

          {/* BvP career */}
          {player.bvp_stats?.career && player.bvp_stats.career.abs > 0 && (
            <div className="border-t border-card-border p-4">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Head-to-Head (Career)
              </h4>
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
                    <span className="text-muted block text-[10px]">{s.l}</span>
                    <span className="font-mono text-foreground">{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Game context */}
          <div className="border-t border-card-border p-4">
            <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
              Game Context
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted block">Ballpark</span>
                <span className="font-mono text-foreground">
                  {env.park_factor}{" "}
                  <span className="text-muted text-[10px]">
                    ({parkLabel(env.park_factor)})
                  </span>
                </span>
              </div>
              <div>
                <span className="text-muted block">Temperature</span>
                <span className="font-mono text-foreground">
                  {env.temperature_f !== null
                    ? `${Math.round(env.temperature_f)}\u00b0F`
                    : "-"}
                </span>
              </div>
              <div>
                <span className="text-muted block">Wind</span>
                <span className="font-mono text-foreground">
                  {env.wind_speed_mph !== null
                    ? `${fmt(env.wind_speed_mph)} mph`
                    : "-"}
                  {env.wind_score !== undefined && (
                    <span
                      className={`ml-1 text-[10px] ${env.wind_score > 0 ? "text-accent-green" : env.wind_score < -3 ? "text-accent-red" : "text-muted"}`}
                    >
                      ({env.wind_score > 0 ? "+" : ""}
                      {fmt(env.wind_score)})
                    </span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted block">Dome / Roof</span>
                <span className="font-mono text-foreground">
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

          {/* Pitch analysis */}
          {pitchEntries.length > 0 && (
            <div className="border-t border-card-border p-4">
              <h4 className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Pitch-Type Analysis
              </h4>
              <div className="space-y-1.5">
                {pitchEntries.map(([code, detail]) => {
                  const rating = getPitchRating(detail.barrel_rate);
                  return (
                    <div
                      key={code}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="font-mono text-foreground w-8 text-right flex-shrink-0">
                        {code}
                      </span>
                      <span className="text-muted w-12 text-right flex-shrink-0">
                        {pct(detail.usage_pct)}
                      </span>
                      {/* mini bar */}
                      <div className="flex-1 h-1.5 bg-card rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent/40 rounded-full"
                          style={{
                            width: `${Math.min(detail.usage_pct, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-muted w-20 text-right flex-shrink-0 hidden sm:block">
                        Brl {pct(detail.barrel_rate)}
                      </span>
                      <span className="text-muted w-16 text-right flex-shrink-0 hidden sm:block">
                        EV {fmt(detail.avg_exit_velo)}
                      </span>
                      <span
                        className={`w-14 text-right font-semibold flex-shrink-0 ${rating.color}`}
                      >
                        {rating.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- main export ---------- */

export function MatchupAnalysis({
  games,
  lookback,
}: {
  games: GameData[];
  lookback: LookbackKey;
}) {
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"composite" | "batter" | "pitcher">(
    "composite",
  );
  const [expandAll, setExpandAll] = useState(false);

  const filteredGames = useMemo(() => {
    if (selectedGamePk === null) return games;
    return games.filter((g) => g.game_pk === selectedGamePk);
  }, [games, selectedGamePk]);

  const sortedPlayers = useMemo(() => {
    const pairs: { player: PlayerData; game: GameData }[] = [];
    for (const game of filteredGames) {
      for (const player of game.players) {
        pairs.push({ player, game });
      }
    }
    pairs.sort((a, b) => {
      const sa = a.player.scores[lookback];
      const sb = b.player.scores[lookback];
      if (!sa || !sb) return 0;
      if (sortBy === "batter") return sb.batter_score - sa.batter_score;
      if (sortBy === "pitcher") return sb.pitcher_score - sa.pitcher_score;
      return sb.composite - sa.composite;
    });
    return pairs;
  }, [filteredGames, lookback, sortBy]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Game selector */}
        <select
          value={selectedGamePk ?? ""}
          onChange={(e) =>
            setSelectedGamePk(e.target.value ? Number(e.target.value) : null)
          }
          className="bg-card/50 border border-card-border text-foreground text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent/40 cursor-pointer"
        >
          <option value="">All Games ({games.length})</option>
          {games.map((g) => (
            <option key={g.game_pk} value={g.game_pk}>
              {g.away_team} @ {g.home_team}
              {g.game_time ? ` \u2014 ${g.game_time}` : ""}
            </option>
          ))}
        </select>

        {/* Sort chips */}
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

        {/* Expand / Collapse */}
        <button
          onClick={() => setExpandAll(!expandAll)}
          className="ml-auto px-3 py-1.5 text-xs rounded-full bg-card/50 text-muted border border-card-border hover:text-foreground cursor-pointer transition-colors"
        >
          {expandAll ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Player count */}
      <p className="text-xs text-muted">
        {sortedPlayers.length} matchups
        {selectedGamePk !== null && (
          <>
            {" "}
            in{" "}
            {(() => {
              const g = games.find((g) => g.game_pk === selectedGamePk);
              return g ? `${g.away_team} @ ${g.home_team}` : "";
            })()}
          </>
        )}
      </p>

      {/* Cards */}
      <div className="space-y-2">
        {sortedPlayers.map(({ player, game }, i) => (
          <MatchupCard
            key={`${game.game_pk}-${player.name}`}
            player={player}
            game={game}
            lookback={lookback}
            defaultExpanded={expandAll || (i < 5 && selectedGamePk !== null)}
          />
        ))}
      </div>

      {sortedPlayers.length === 0 && (
        <p className="text-center text-muted py-12">
          No matchup data available.
        </p>
      )}
    </div>
  );
}
