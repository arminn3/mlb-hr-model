"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameData, PlayerData, ModelData } from "./types";
import { scoreFor, computeSeasonScore, type UILookback } from "./score-utils";
import { RatingBadge } from "./rating-badge";
import { ScoreBar } from "./score-bar";
import { teamLogoUrl } from "./game-header";

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
export interface MlWeights {
  batter: number;
  matchup: number;
  pitcher: number;
  environment: number;
}

// Fallback if ml_analysis.json isn't available yet (matches the
// 18-day cumulative analysis as of 2026-04-11).
export const FALLBACK_WEIGHTS: MlWeights = {
  batter: 0.391,
  matchup: 0.092,
  pitcher: 0.435,
  environment: 0.082,
};

// ── Season-anchored + form modifier ─────────────────────────────────────────
// Base = season batter score (true ability). Form delta = how L5/L10 batter
// scores compare to that baseline. Clamped ±0.15 so a hot/cold streak moves
// players without overriding the season profile. Pitcher/env from today.
// Recompute batter score from raw stats on the same scale as season formula
function _formBatterFromScoreSet(s: import("./types").ScoreSet, seasonBatter: number): number {
  const BRL_LO = 0.0, BRL_HI = 0.25;
  const FB_LO  = 0.15, FB_HI  = 0.55;
  const EV_LO  = 92.0, EV_HI  = 102.0;
  const norm = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  if (s.barrel_pct == null || s.fb_pct == null || s.exit_velo == null) return seasonBatter;
  const brl = norm(s.barrel_pct / 100, BRL_LO, BRL_HI);
  const fb  = norm(s.fb_pct    / 100, FB_LO,  FB_HI);
  const ev  = norm(s.exit_velo,        EV_LO,  EV_HI);
  return brl * 0.55 + fb * 0.25 + ev * 0.20;
}

export function combinedScore(player: PlayerData): number {
  const season = computeSeasonScore(player);
  const l5 = scoreFor(player, "L5");
  const l10 = scoreFor(player, "L10");
  if (!l5 && !l10) return 0;

  let baseBatter: number;
  let pitcher: number;
  let env: number;

  if (season) {
    const fb5  = l5  ? _formBatterFromScoreSet(l5,  season.batter) : season.batter;
    const fb10 = l10 ? _formBatterFromScoreSet(l10, season.batter) : season.batter;
    const formBatter = (fb5 + fb10) / 2;
    // 70% season (stable ability), 30% recent form (L5+L10 barrel/FB/EV)
    baseBatter = season.batter * 0.70 + formBatter * 0.30;
    pitcher = season.pitcher;
    env = season.env;
  } else {
    // No season data — fall back to L5/L10 average
    const s = l10 ?? l5!;
    baseBatter = s.batter_score;
    pitcher = s.pitcher_score;
    env = s.env_score;
  }

  return baseBatter * 0.50 + pitcher * 0.35 + env * 0.15;
}

export function combinedFormDelta(player: PlayerData): number | null {
  const season = computeSeasonScore(player);
  if (!season) return null;
  const l5 = scoreFor(player, "L5");
  const l10 = scoreFor(player, "L10");
  if (!l5 && !l10) return null;
  const fb5  = l5  ? _formBatterFromScoreSet(l5,  season.batter) : season.batter;
  const fb10 = l10 ? _formBatterFromScoreSet(l10, season.batter) : season.batter;
  const formBatter = (fb5 + fb10) / 2;
  return formBatter - season.batter;
}

export function mlComposite(player: PlayerData, lb: UILookback, w: MlWeights): number {
  const s = scoreFor(player, lb);
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
  onTabChange,
}: {
  games: GameData[];
  lookback: UILookback;
  currentDate: string;
  onTabChange?: (tab: "ml" | "combined") => void;
}) {
  const [rankingTab, setRankingTab] = useState<"ml" | "combined">("ml");
  const setTab = (t: "ml" | "combined") => { setRankingTab(t); onTabChange?.(t); };
  const [filter, setFilter] = useState<number>(10);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const downloadPng = async () => {
    if (!cardsRef.current || downloadState === "loading") return;
    setDownloadState("loading");
    try {
      const domtoimage = (await import("dom-to-image-more")).default;
      const dataUrl = await domtoimage.toPng(cardsRef.current, {
        bgcolor: "#1c1c1e",
        scale: 2,
        filter: (node: Element) => {
          // Skip cross-origin images to avoid CORS failures
          if (node.tagName === "IMG") return false;
          return true;
        },
      });
      const link = document.createElement("a");
      const label = filter === 0 ? "all" : `top${filter}`;
      link.download = `hr-rankings-${label}.png`;
      link.href = dataUrl;
      link.click();
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (err) {
      console.error("Download failed:", err);
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 2500);
    }
  };
  const [mlWeights, setMlWeights] = useState<MlWeights>(FALLBACK_WEIGHTS);
  const [weightSource, setWeightSource] = useState<string>("fallback");
  const [yesterday, setYesterday] = useState<{
    date: string;
    mlPicks: YesterdayPick[];
    combinedPicks: YesterdayPick[];
    totalHRs: number;
  } | null>(null);

  // Load yesterday's slate + HR hitters, score with ML weights AND Season+Form.
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
        const mlPicksAll: YesterdayPick[] = [];
        const combinedPicksAll: YesterdayPick[] = [];
        for (const game of slate.games ?? []) {
          for (const player of game.players ?? []) {
            if (seen.has(player.name)) continue;
            seen.add(player.name);
            const mlScore = mlComposite(player, lookback, mlWeights);
            const abs = scoreFor(player, lookback)?.recent_abs?.length ?? 0;
            const reliability = Math.min(1, abs / 10);
            const base = {
              name: player.name,
              matchup: `${game.away_team}@${game.home_team}`,
              oppPitcher: player.opp_pitcher,
              hitHR: hrNames.has(player.name),
              nearHR: !hrNames.has(player.name) && nearNames.has(player.name),
            };
            mlPicksAll.push({ ...base, mlScore: mlScore * reliability });
            combinedPicksAll.push({ ...base, mlScore: combinedScore(player) });
          }
        }
        mlPicksAll.sort((a, b) => b.mlScore - a.mlScore);
        combinedPicksAll.sort((a, b) => b.mlScore - a.mlScore);
        setYesterday({
          date: prevStr,
          mlPicks: mlPicksAll.slice(0, 30),
          combinedPicks: combinedPicksAll.slice(0, 30),
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
      const s = scoreFor(pair.player, lookback);
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

  const sortedCombined = useMemo(() => {
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
    return all.sort((a, b) => combinedScore(b.player) - combinedScore(a.player));
  }, [games]);

  const activeSorted = rankingTab === "combined" ? sortedCombined : sorted;
  const top = filter === 0 ? activeSorted : activeSorted.slice(0, filter);
  if (top.length === 0) return null;

  const wPct = (n: number) => `${Math.round(n * 100)}%`;

  const activePicks = yesterday
    ? (rankingTab === "combined" ? yesterday.combinedPicks : yesterday.mlPicks)
    : [];
  const yesterdayHits = activePicks.filter((p) => p.hitHR).length;
  const yesterdayNears = activePicks.filter((p) => p.nearHR).length;
  const yesterdayTop20Hits = activePicks.slice(0, 20).filter((p) => p.hitHR).length;
  const yesterdayTop10Hits = activePicks.slice(0, 10).filter((p) => p.hitHR).length;

  const yesterdayPanel = yesterday && activePicks.length > 0 ? (
        <div className="border border-card-border rounded-xl bg-card/30 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                {rankingTab === "combined" ? "Yesterday's Season + Form Picks" : "Yesterday's ML Picks"} — {yesterday.date}
              </h3>
              <p className="text-[11px] text-muted mt-0.5">
                {rankingTab === "combined"
                  ? "How Season + Form would have ranked yesterday's slate."
                  : "How these same ML weights would have ranked yesterday's slate."}
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
            {activePicks.map((p, i) => (
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
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] leading-[20px] font-semibold tracking-[-0.005em] text-foreground">
            {rankingTab === "combined" ? "Season + Form" : "ML Rankings"}
          </h2>
          <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-0.5">
            {rankingTab === "combined"
              ? "Season power profile anchored · recent form adjusts ±15%"
              : "Data-driven — reweighted using what the ML learned from past HR outcomes"}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-card/30 border border-card-border rounded-lg p-1 w-fit">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                filter === opt.value
                  ? "bg-accent text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
          <button
            onClick={downloadPng}
            disabled={downloadState === "loading"}
            title="Download as PNG"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all text-[11px] font-semibold border ${
              downloadState === "done"
                ? "bg-accent-green/15 border-accent-green/40 text-accent-green"
                : downloadState === "error"
                ? "bg-red-500/15 border-red-500/40 text-red-400"
                : downloadState === "loading"
                ? "bg-card/50 border-card-border text-muted opacity-60"
                : "bg-card/50 border-card-border text-muted hover:border-accent/40 hover:text-accent"
            }`}
          >
            {downloadState === "loading" ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Generating…
              </>
            ) : downloadState === "done" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Downloaded!
              </>
            ) : downloadState === "error" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Failed
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                PNG
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-4">
        {(["ml", "combined"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-3 py-1.5 text-[12px] font-semibold rounded-[var(--radius-md)] cursor-pointer transition-colors " +
              (rankingTab === t
                ? "bg-accent/15 text-accent border border-accent/40"
                : "bg-transparent text-muted border border-[#2c2c2e] hover:text-foreground hover:border-[#3a3a3e]")
            }
          >
            {t === "ml" ? "ML Model" : "Season + Form"}
          </button>
        ))}
      </div>

      {rankingTab === "ml" && (
        <p className="text-[11px] leading-[16px] text-muted mb-4">
          Current ML weights:{" "}
          <span className="text-foreground font-mono">
            Batter {wPct(mlWeights.batter)} · Pitcher {wPct(mlWeights.pitcher)}
            · Matchup {wPct(mlWeights.matchup)} · Env {wPct(mlWeights.environment)}
          </span>{" "}
          <span className="text-[10px] text-muted/80">({weightSource})</span>
        </p>
      )}
      {rankingTab === "combined" && (
        <p className="text-[11px] leading-[16px] text-muted mb-4">
          <span className="text-foreground font-mono">Batter 50% · Pitcher 35% · Env 15%</span>
          {" · "}batter = 70% season + 30% recent form (L5+L10 barrel/FB/EV) · &lt;20 season BIP falls back to L5/L10
        </p>
      )}

      {/* Ranking cards */}
      <div ref={cardsRef} className="space-y-3">
        {top.map(({ player, game }, i) => {
          const s = scoreFor(player, lookback);
          if (!s) return null;
          const isCombo = rankingTab === "combined";
          const score = isCombo ? combinedScore(player) : mlComposite(player, lookback, mlWeights);
          const delta = isCombo ? combinedFormDelta(player) : null;
          const season = isCombo ? computeSeasonScore(player) : null;
          const isSmallSample = isCombo
            ? (!player.season_profile || (player.season_profile.bip_count ?? 0) < 20)
            : (s.data_quality === "LOW_SAMPLE" || (s.recent_abs?.length ?? 10) <= 2);

          // MLB headshot — match player name in team_pitch_mix batters
          const mixBatters = [
            ...(game.team_pitch_mix?.away?.batters ?? []),
            ...(game.team_pitch_mix?.home?.batters ?? []),
          ];
          const mlbId = mixBatters.find((b) => b.name === player.name)?.id;

          // Key stats
          const ev = s.exit_velo;
          const barrel = s.barrel_pct;
          const fb = s.fb_pct;
          const hh = s.hard_hit_pct;

          // Matchup quality from pitch_detail
          const pitchEntries = Object.entries(player.pitch_detail ?? {}).filter(([, d]) => (d.usage_pct ?? 0) >= 12);
          let matchupLabel = "—";
          let matchupColor = "text-muted";
          if (pitchEntries.length > 0) {
            let totalU = 0, weighted = 0;
            for (const [, d] of pitchEntries) {
              const u = (d.usage_pct ?? 0) / 100;
              const b = d.barrel_rate ?? 0;
              const e = d.avg_exit_velo ?? 88;
              weighted += u * (0.65 * Math.min(b / 25, 1) + 0.35 * Math.max(0, Math.min((e - 85) / 20, 1)));
              totalU += u;
            }
            const mScore = totalU > 0 ? weighted / totalU : 0;
            if (mScore >= 0.45) { matchupLabel = "GREAT"; matchupColor = "text-accent-green"; }
            else if (mScore >= 0.25) { matchupLabel = "DECENT"; matchupColor = "text-accent-yellow"; }
            else { matchupLabel = "TOUGH"; matchupColor = "text-red-400/80"; }
          }

          const scoreColor = score >= 0.65 ? "text-accent-green" : score >= 0.50 ? "text-accent-yellow" : "text-foreground";

          return (
            <div
              key={player.name}
              className="flex items-center gap-4 px-4 py-4 rounded-2xl"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08), 0 4px 12px -4px rgba(0,0,0,0.5)",
              }}
            >
              {/* Rank */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-bold font-mono"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.6)" }}
              >
                {i + 1}
              </div>

              {/* Headshot */}
              {mlbId ? (
                <img
                  src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
                  alt={player.name}
                  className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                  style={{ border: "2px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }}
                  loading="lazy"
                />
              ) : (
                <div className="w-14 h-14 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.10)" }} />
              )}

              {/* Player info — name + matchup only */}
              <div className="w-56 flex-shrink-0 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[17px] font-bold leading-tight ${isSmallSample ? "text-red-400" : "text-foreground"}`}>
                    {player.name}
                  </span>
                  <RatingBadge composite={score} />
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <img src={teamLogoUrl(game.away_team)} alt={game.away_team} className="w-4 h-4 object-contain opacity-80" />
                  <span className="text-[12px] font-semibold text-foreground/80">{game.away_team}</span>
                  <span className="text-[11px] text-muted/50">vs</span>
                  <img src={teamLogoUrl(game.home_team)} alt={game.home_team} className="w-4 h-4 object-contain opacity-80" />
                  <span className="text-[12px] font-semibold text-foreground/80">{game.home_team}</span>
                  <span className="text-[11px] text-muted truncate">· vs {player.opp_pitcher} ({player.pitcher_hand}HP)</span>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px self-stretch flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

              {/* Stats — to the right of player info */}
              <div className="flex-1 min-w-0">
                {/* Stats grid — label above, value below */}
                <div className="flex items-start gap-6">
                  {[
                    { label: "EV", value: String(ev), hi: Number(ev) >= 95 },
                    { label: "Brl%", value: `${barrel}%`, hi: Number(barrel) >= 12 },
                    { label: "HH%", value: `${hh}%`, hi: Number(hh) >= 45 },
                    { label: "FB%", value: `${fb}%`, hi: Number(fb) >= 38 },
                  ].map(({ label, value, hi }) => (
                    <div key={label}>
                      <div className="text-[9px] uppercase tracking-wider text-muted/40 mb-1">{label}</div>
                      <div className={`text-[14px] font-bold font-mono ${hi ? "text-accent-green" : "text-foreground"}`}>{value}</div>
                    </div>
                  ))}
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-muted/40 mb-1">Matchup</div>
                    <div className={`text-[13px] font-bold uppercase tracking-wide ${matchupColor}`}>{matchupLabel}</div>
                  </div>
                  {delta !== null && Math.abs(delta) > 0.01 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-muted/40 mb-1">Form</div>
                      <div className={`text-[13px] font-bold font-mono ${delta > 0 ? "text-accent-green" : "text-red-400"}`}>
                        {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Sub-score bars */}
                <div className="flex items-center gap-6 mt-3">
                  {[
                    { label: "BAT", val: season?.batter ?? s.batter_score },
                    { label: "PIT", val: season?.pitcher ?? s.pitcher_score },
                    { label: "ENV", val: season?.env ?? s.env_score },
                  ].map(({ label, val }) => {
                    const barColor = val >= 0.65 ? "#22c55e" : val >= 0.45 ? "#eab308" : "rgba(255,255,255,0.2)";
                    return (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-wider w-6" style={{ color: barColor }}>{label}</span>
                        <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(val * 100)}%`, background: barColor }} />
                        </div>
                        <span className="text-[10px] font-mono" style={{ color: barColor }}>{val.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Score */}
              <div className="text-right flex-shrink-0 pl-2">
                <div className={`text-3xl font-black font-mono leading-none ${scoreColor}`}>
                  {score.toFixed(2)}
                </div>
                <div className="text-[9px] uppercase tracking-[0.12em] text-muted/40 mt-1">Score</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {yesterdayPanel}
    </>
  );
}
