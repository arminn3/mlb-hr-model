"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameData, LookbackKey, PlayerData, ModelData } from "./types";
import { RatingBadge } from "./rating-badge";
import { ScoreBar } from "./score-bar";

interface YesterdayPick {
  name: string;
  matchup: string;
  oppPitcher: string;
  mlScore: number;
  hitHR: boolean;
  nearHR: boolean;
}

const FILTER_OPTIONS = [
  { label: "Top 10", value: 10 },
  { label: "Top 20", value: 20 },
  { label: "Top 30", value: 30 },
  { label: "All", value: 0 },
] as const;

// ML category weights loaded from results/ml_analysis.json.
// These represent what the ML learned from past HR outcomes —
// separate from the manual composite weights used by HR Rankings.
interface MlWeights {
  batter: number;
  matchup: number;
  pitcher: number;
  environment: number;
}

// Fallback if ml_analysis.json isn't available yet (matches the
// 18-day cumulative analysis as of 2026-04-11).
const FALLBACK_WEIGHTS: MlWeights = {
  batter: 0.391,
  matchup: 0.092,
  pitcher: 0.435,
  environment: 0.082,
};

function mlComposite(player: PlayerData, lb: LookbackKey, w: MlWeights): number {
  const s = player.scores[lb];
  if (!s) return 0;
  // Use backend's batter/pitcher/env scores but reweight them with
  // ML-learned category weights. matchup_score isn't stored
  // separately in the JSON, so we split batter contribution lightly.
  return (
    w.batter * s.batter_score +
    w.matchup * s.batter_score + // matchup proxy — same direction as batter
    w.pitcher * s.pitcher_score +
    w.environment * s.env_score
  );
}

export function MLRankings({
  games,
  lookback,
  currentDate,
}: {
  games: GameData[];
  lookback: LookbackKey;
  currentDate: string;
}) {
  const [filter, setFilter] = useState<number>(10);
  const [mlWeights, setMlWeights] = useState<MlWeights>(FALLBACK_WEIGHTS);
  const [weightSource, setWeightSource] = useState<string>("fallback");
  const [yesterday, setYesterday] = useState<{
    date: string;
    picks: YesterdayPick[];
    totalHRs: number;
  } | null>(null);

  // Load yesterday's slate + HR hitters, score with current ML weights.
  useEffect(() => {
    if (!currentDate) return;
    const [y, m, d] = currentDate.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    const prevStr = prev.toISOString().slice(0, 10);

    Promise.all([
      fetch(`/data/${prevStr}.json`).then((r) => (r.ok ? r.json() : null)),
      fetch("/data/results/cumulative.json").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([slate, cum]: [ModelData | null, Array<{ date: string; hr_hitters: Array<{ name: string }>; near_hr_hitters?: Array<{ name: string }>; near_hr_events?: Array<{ batter: string }> }>]) => {
        if (!slate) return;
        const dayReport = cum.find((x) => x.date === prevStr);
        const hrNames = new Set<string>(
          (dayReport?.hr_hitters ?? []).map((h) => h.name)
        );
        const nearNames = new Set<string>([
          ...(dayReport?.near_hr_hitters ?? []).map((h) => h.name),
          ...(dayReport?.near_hr_events ?? []).map((h) => h.batter),
        ]);
        const seen = new Set<string>();
        const allPicks: YesterdayPick[] = [];
        for (const game of slate.games ?? []) {
          for (const player of game.players ?? []) {
            if (seen.has(player.name)) continue;
            seen.add(player.name);
            const score = mlComposite(player, lookback, mlWeights);
            const abs = player.scores[lookback]?.recent_abs?.length ?? 0;
            const reliability = Math.min(1, abs / 10);
            allPicks.push({
              name: player.name,
              matchup: `${game.away_team}@${game.home_team}`,
              oppPitcher: player.opp_pitcher,
              mlScore: score * reliability,
              hitHR: hrNames.has(player.name),
              nearHR: !hrNames.has(player.name) && nearNames.has(player.name),
            });
          }
        }
        allPicks.sort((a, b) => b.mlScore - a.mlScore);
        setYesterday({
          date: prevStr,
          picks: allPicks.slice(0, 30),
          totalHRs: hrNames.size,
        });
      })
      .catch(() => setYesterday(null));
  }, [currentDate, lookback, mlWeights]);

  // Prefer the 3-year Matchup v2 weights (125k samples, stable) over the
  // 2026-only ml_analysis.json (~5k samples, noisy). Fall back to the
  // smaller file if v2 isn't deployed yet. When 2026 accumulates enough
  // samples (~20k+), we'll blend them in via a future training pipeline.
  useEffect(() => {
    fetch("/data/results/matchup_v2_weights.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d?.category_weights) {
          setMlWeights({
            batter: d.category_weights.batter ?? FALLBACK_WEIGHTS.batter,
            // matchup_v2 has no "matchup" key — default to 0, lets
            // batter/pitcher/env split the full 100%.
            matchup: d.category_weights.matchup ?? 0,
            pitcher: d.category_weights.pitcher ?? FALLBACK_WEIGHTS.pitcher,
            environment:
              d.category_weights.environment ?? FALLBACK_WEIGHTS.environment,
          });
          setWeightSource(`3yr (${d.n_samples?.toLocaleString?.() ?? "125k"} samples)`);
          return true;
        }
        return false;
      })
      .then((ok) => {
        if (ok) return;
        // Fallback: 2026-only trained weights.
        return fetch("/data/results/ml_analysis.json")
          .then((res) => (res.ok ? res.json() : null))
          .then((d) => {
            if (d?.category_weights) {
              setMlWeights({
                batter: d.category_weights.batter ?? FALLBACK_WEIGHTS.batter,
                matchup: d.category_weights.matchup ?? FALLBACK_WEIGHTS.matchup,
                pitcher: d.category_weights.pitcher ?? FALLBACK_WEIGHTS.pitcher,
                environment:
                  d.category_weights.environment ?? FALLBACK_WEIGHTS.environment,
              });
              setWeightSource(`2026 only (${d.trained_on?.toLocaleString?.() ?? "?"} samples)`);
            }
          });
      })
      .catch(() => {
        // keep fallback
      });
  }, []);

  const sorted = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!seen.has(player.name)) {
          seen.add(player.name);
          all.push({ player, game });
        }
      }
    }
    // Same confidence-weighted ranking as HR Rankings so tiny-sample
    // players can't fake their way to the top.
    const adjustedScore = (pair: typeof all[number]) => {
      const s = pair.player.scores[lookback];
      if (!s) return 0;
      const abs = s.recent_abs?.length ?? 0;
      const reliability = Math.min(1, abs / 10);
      return mlComposite(pair.player, lookback, mlWeights) * reliability;
    };
    return all.sort((a, b) => {
      const diff = adjustedScore(b) - adjustedScore(a);
      if (diff !== 0) return diff;
      return a.player.name.localeCompare(b.player.name);
    });
  }, [games, lookback, mlWeights]);

  const top = filter === 0 ? sorted : sorted.slice(0, filter);
  if (top.length === 0) return null;

  const wPct = (n: number) => `${Math.round(n * 100)}%`;

  const yesterdayHits = yesterday
    ? yesterday.picks.filter((p) => p.hitHR).length
    : 0;
  const yesterdayNears = yesterday
    ? yesterday.picks.filter((p) => p.nearHR).length
    : 0;
  const yesterdayTop20Hits = yesterday
    ? yesterday.picks.slice(0, 20).filter((p) => p.hitHR).length
    : 0;
  const yesterdayTop10Hits = yesterday
    ? yesterday.picks.slice(0, 10).filter((p) => p.hitHR).length
    : 0;

  const yesterdayPanel = yesterday && yesterday.picks.length > 0 ? (
        <div className="border border-card-border rounded-xl bg-card/30 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                Yesterday&apos;s ML Picks — {yesterday.date}
              </h3>
              <p className="text-[11px] text-muted mt-0.5">
                How these same ML weights would have ranked yesterday&apos;s slate.
                {" "}Leaguewide: {yesterday.totalHRs} HRs hit.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="text-right">
                <div className="text-[10px] text-muted uppercase">Top 10</div>
                <div className="font-mono font-bold text-accent-green">
                  {yesterdayTop10Hits}/10
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted uppercase">Top 20</div>
                <div className="font-mono font-bold text-accent-green">
                  {yesterdayTop20Hits}/20
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted uppercase">Top 30</div>
                <div className="font-mono font-bold text-accent-green">
                  {yesterdayHits}/30
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted uppercase">Near HR</div>
                <div className="font-mono font-bold text-accent-yellow">
                  {yesterdayNears}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-1.5 md:columns-2 md:gap-x-1.5">
            {yesterday.picks.map((p, i) => (
              <div
                key={p.name}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs break-inside-avoid ${
                  p.hitHR
                    ? "bg-accent-green/10 border border-accent-green/30"
                    : p.nearHR
                    ? "bg-accent-yellow/10 border border-accent-yellow/30"
                    : "bg-background/30 border border-transparent"
                }`}
              >
                <span className="font-mono font-bold text-muted w-5 text-center shrink-0">
                  {i + 1}
                </span>
                <span
                  className={`w-4 text-center shrink-0 ${
                    p.hitHR
                      ? "text-accent-green"
                      : p.nearHR
                      ? "text-accent-yellow"
                      : "text-muted/30"
                  }`}
                  title={p.nearHR ? "Near HR" : p.hitHR ? "HR" : ""}
                >
                  {p.hitHR ? "\u2713" : p.nearHR ? "\u25d0" : "\u00b7"}
                </span>
                <span className="flex-1 min-w-0 truncate text-foreground font-medium">
                  {p.name}
                </span>
                <span className="text-[10px] text-muted shrink-0">
                  {p.matchup}
                </span>
                <span className="font-mono text-foreground shrink-0 w-12 text-right">
                  {p.mlScore.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null;

  return (
    <>
    <div
      className="rounded-[12px] p-6 mb-6"
      style={{ background: "#1c1c1e", border: "1px solid #2c2c2e" }}
    >
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="text-[15px] leading-[20px] font-semibold tracking-[-0.005em] text-foreground">
            ML Rankings
          </h2>
          <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-0.5">
            Data-driven — reweighted using what the ML learned from past HR outcomes
          </p>
        </div>
        <div
          className="inline-flex items-center rounded-full p-0.5"
          style={{ background: "#141416", border: "1px solid #2c2c2e" }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1 text-[11px] font-medium rounded-full cursor-pointer transition-colors ${
                filter === opt.value
                  ? "bg-accent text-background font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-[16px] text-muted mb-4">
        Current ML weights:{" "}
        <span className="text-foreground font-mono">
          Batter {wPct(mlWeights.batter)} · Pitcher {wPct(mlWeights.pitcher)}
          · Matchup {wPct(mlWeights.matchup)} · Env {wPct(mlWeights.environment)}
        </span>{" "}
        <span className="text-[10px] text-muted/80">({weightSource})</span>
      </p>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2">
        {top.map(({ player, game }, i) => {
          const s = player.scores[lookback];
          if (!s) return null;
          const mlScore = mlComposite(player, lookback, mlWeights);
          return (
            <div
              key={player.name}
              className="flex items-center gap-3 bg-background/30 rounded-lg px-3 py-2.5"
            >
              <span className="text-sm font-bold text-accent font-mono w-7 text-center shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {player.name}
                  </span>
                  <RatingBadge composite={mlScore} />
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px]">
                  <span className="text-foreground font-mono">
                    bat {s.batter_score.toFixed(2)}
                  </span>
                  <span className="font-mono text-foreground">
                    pit {s.pitcher_score.toFixed(2)}
                  </span>
                  <span className="font-mono text-muted">
                    env {s.env_score.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono text-sm font-bold text-foreground">
                  {mlScore.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
              <th className="text-center py-2 w-8">#</th>
              <th className="text-left py-2 pr-3">Player</th>
              <th className="text-left py-2 pr-3">Matchup</th>
              <th className="text-center py-2 px-2">Hand</th>
              <th className="text-center py-2 px-2">Batter</th>
              <th className="text-center py-2 px-2">Pitcher</th>
              <th className="text-center py-2 px-2">Env</th>
              <th className="text-center py-2 px-2">Rating</th>
              <th className="text-center py-2 w-28">ML Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map(({ player, game }, i) => {
              const s = player.scores[lookback];
              if (!s) return null;
              const mlScore = mlComposite(player, lookback, mlWeights);
              return (
                <tr
                  key={player.name}
                  className="border-b border-card-border/30 last:border-0 hover:bg-card/40"
                >
                  <td className="text-center py-2 font-bold text-accent font-mono">
                    {i + 1}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-foreground">
                      {player.name}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {game.away_team}@{game.home_team} vs {player.opp_pitcher}
                  </td>
                  <td className="text-center py-2 font-mono text-muted">
                    {player.batter_hand}v{player.pitcher_hand}
                  </td>
                  <td className="text-center py-2 font-mono">
                    {s.batter_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2 font-mono">
                    {s.pitcher_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2 font-mono text-muted">
                    {s.env_score.toFixed(2)}
                  </td>
                  <td className="text-center py-2">
                    <RatingBadge composite={mlScore} />
                  </td>
                  <td className="py-2">
                    <ScoreBar value={mlScore} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    {yesterdayPanel}
    </>
  );
}
