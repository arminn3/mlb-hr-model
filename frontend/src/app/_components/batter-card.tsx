"use client";

import type { PlayerData, LookbackKey } from "./types";
import { ScoreBar } from "./score-bar";
import { RatingBadge } from "./rating-badge";
import { Tooltip } from "./tooltip";

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
  onSelect,
}: {
  player: PlayerData;
  lookback: LookbackKey;
  battingOrder: number | null;
  mlbId?: number;
  onSelect: () => void;
}) {
  const scores = player.scores[lookback] || player.scores.L5;
  const pullBrl = player.season_profile?.pull_barrel ?? null;

  const recentAbsArr = scores.recent_abs ?? [];
  const flyBalls = recentAbsArr.filter((ab) => ab.angle >= 25 && ab.angle <= 50);
  const hrInLookback = recentAbsArr.filter((ab) => ab.result === "home_run").length;
  const hrFbPct = flyBalls.length > 0 ? (hrInLookback / flyBalls.length) * 100 : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] hover:border-white/20 cursor-pointer"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.018) 100%)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 2px 8px -3px rgba(0,0,0,0.30)",
      }}
    >
      <div className="p-4">
        {/* Top row: headshot + name + score */}
        <div className="flex items-center gap-3">
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

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground whitespace-nowrap mb-1 leading-tight">{player.name}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[10px] text-muted font-mono">{player.batter_hand}HB</span>
              <RatingBadge composite={scores.composite} />
              {scores.recent_abs.length <= 2 && (
                <Tooltip text="Limited MLB data — score may not reflect true ability">
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-accent/10 text-accent border border-accent/20 whitespace-nowrap">NEW</span>
                </Tooltip>
              )}
              {scores.data_quality !== "OK" && scores.recent_abs.length > 2 && (
                <Tooltip text={scores.data_quality === "LOW_SAMPLE" ? "Fewer than 5 balls in play — small sample size" : "Pitcher has less than 10 innings — pitcher metrics less reliable"}>
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-accent-yellow/10 text-accent-yellow whitespace-nowrap">{scores.data_quality.replace(/_/g, " ")}</span>
                </Tooltip>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 w-28">
            <ScoreBar value={scores.composite} />
          </div>

          {/* Right arrow indicating clickable */}
          <svg className="w-4 h-4 text-muted/50 flex-shrink-0 -rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Stat mini-cards */}
        <div className="grid grid-cols-6 gap-2 mt-3">
          <StatMiniCard label="Exit Velo"  value={`${scores.exit_velo}`}                                            cls={statHighlight(scores.exit_velo, [88, 93])} />
          <StatMiniCard label="Barrel%"    value={`${scores.barrel_pct}%`}                                          cls={statHighlight(scores.barrel_pct, [8, 15])} />
          <StatMiniCard label="Hard Hit%"  value={`${scores.hard_hit_pct}%`}                                        cls={statHighlight(scores.hard_hit_pct, [35, 50])} />
          <StatMiniCard label="HR/FB%"     value={hrFbPct == null ? "—" : `${hrFbPct.toFixed(1)}%`}               cls={hrFbPct == null ? "text-muted" : statHighlight(hrFbPct, [10, 18])} />
          <StatMiniCard label="FB%"        value={`${scores.fb_pct}%`}                                              cls={statHighlight(scores.fb_pct, [25, 40])} />
          <StatMiniCard label="Pull Brl%"  value={pullBrl == null ? "—" : `${pullBrl.toFixed(1)}%`}               cls={pullBrl == null ? "text-muted" : statHighlight(pullBrl, [4, 8])} />
        </div>
      </div>
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
