"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameData, PlayerData, ModelData } from "./types";
import { scoreFor, computeSeasonScore, applyHhFloor, type UILookback } from "./score-utils";
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

// Pure season score with a 10 BIP floor — used for consensus ranking.
// Kept at module level so both the sortedSeason memo and the yesterday
// useEffect can call it without dependency issues.
function _seasonScoreConsensus(player: PlayerData): number | null {
  const sp = player.season_profile;
  if (!sp || sp.bip_count < 10) return null;
  const n = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const batter = n(sp.barrel / 100, 0.0, 0.25) * 0.55
               + n(sp.fb     / 100, 0.15, 0.55) * 0.25
               + n(sp.ev,           92,   102)   * 0.20;
  const l10 = player.scores.L10;
  return batter * 0.50 + (l10?.pitcher_score ?? 0.5) * 0.35 + (l10?.env_score ?? 0.5) * 0.15;
}

// "Test" — same formula as the season consensus, but the batter side reads
// 3-year aggregated stats (2024+2025+current) instead of just the current
// season. Pitcher + env still come from today's L10 matchup. Higher BIP
// floor since the sample pool spans 3 seasons.
export function testScoreConsensus(player: PlayerData): number | null {
  const tp = player.three_year_profile;
  if (!tp || tp.bip_count < 50) return null;
  const n = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const batter = n(tp.barrel / 100, 0.0, 0.25) * 0.55
               + n(tp.fb     / 100, 0.15, 0.55) * 0.25
               + n(tp.ev,           92,   102)   * 0.20;
  const l10 = player.scores.L10;
  return batter * 0.50 + (l10?.pitcher_score ?? 0.5) * 0.35 + (l10?.env_score ?? 0.5) * 0.15;
}

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

// Balanced Edge — geometric mean of 5 factors. Weakness in any single factor
// (cold form, soft pitcher matchup, flat park, bad mix vs arsenal) actively
// drags the score down. Nothing can carry.
export function combinedScore(player: PlayerData): number {
  const l10 = scoreFor(player, "L10");
  const l5  = scoreFor(player, "L5");
  if (!l10 && !l5) return 0;
  const s = l10 ?? l5!;

  const norm = (v: number, lo: number, hi: number) =>
    Math.max(0.05, Math.min(1, (v - lo) / (hi - lo)));

  const fL10 = norm((l10 ?? s).batter_score, 0.2, 0.8);
  const fL5  = norm((l5  ?? l10!).batter_score, 0.2, 0.8);
  const fPit = norm(s.pitcher_score, 0.2, 0.8);
  const fEnv = norm(s.env_score, 0.2, 0.8);

  // Weighted barrel + hard-hit across pitcher's pitch types
  const pd = player.pitch_detail ?? {};
  let wbBrl = 0, wbHh = 0, wt = 0;
  for (const dd of Object.values(pd)) {
    const u = dd.usage_pct ?? 0;
    wt += u;
    wbBrl += (dd.barrel_rate ?? 0) * u;
    wbHh  += (dd.hard_hit_rate ?? 0) * u;
  }
  if (wt > 0) { wbBrl /= wt; wbHh /= wt; }
  const fMix = (norm(wbBrl, 5, 35) + norm(wbHh, 20, 60)) / 2;

  return Math.pow(fL10 * fL5 * fPit * fEnv * fMix, 1 / 5);
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
  const raw =
    w.batter * s.batter_score +
    w.matchup * s.batter_score + // matchup proxy — same direction as batter
    w.pitcher * s.pitcher_score +
    w.environment * s.env_score;
  // Hard-hit floor — a bat below ~40% hard-hit in the window can't be a top
  // play no matter how bombable the pitcher is (matches model.py). This is the
  // real L5/L10 sort key, so the cap has to live here too.
  return applyHhFloor(raw, (s.hard_hit_pct ?? 0) / 100);
}

export function MLRankings({
  games,
  lookback,
  currentDate,
  onTabChange,
  lineupOverride,
}: {
  games: GameData[];
  lookback: UILookback;
  currentDate: string;
  onTabChange?: (tab: "ml" | "combined" | "consensus" | "test") => void;
  lineupOverride?: { starters: string[]; postedTeams?: string[] } | null;
}) {
  const [rankingTab, setRankingTab] = useState<"ml" | "combined" | "consensus" | "test">("ml");
  const setTab = (t: "ml" | "combined" | "consensus" | "test") => {
    setRankingTab(t);
    onTabChange?.(t);
  };
  const [filter, setFilter] = useState<number>(10);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [downloadError, setDownloadError] = useState<string>("");

  const downloadPng = () => {
    if (downloadState === "loading") return;
    setDownloadState("loading");
    try {
      const DPR = 2;
      const W = 900;
      const PAD = 28;
      const ROW_H = 64;
      const HEADER_H = 72;
      const FOOTER_H = 44;
      const rows = filter === 0 ? activeSorted : activeSorted.slice(0, filter);
      const H = HEADER_H + rows.length * (ROW_H + 8) + FOOTER_H + PAD;

      const canvas = document.createElement("canvas");
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(DPR, DPR);

      // Background
      ctx.fillStyle = "#111113";
      ctx.fillRect(0, 0, W, H);

      // Header
      ctx.fillStyle = "#e4e4e7";
      ctx.font = "bold 22px Inter, system-ui, sans-serif";
      ctx.fillText(
        rankingTab === "combined" ? "Balanced Edge Rankings"
          : rankingTab === "test" ? "Test (3-yr) Rankings"
          : "ML HR Rankings",
        PAD, 34
      );
      ctx.fillStyle = "#71717a";
      ctx.font = "13px Inter, system-ui, sans-serif";
      ctx.fillText(`${rows.length} players · Beeb Sheets`, PAD, 56);

      // Column headers
      const COL = { rank: PAD, name: PAD + 36, ev: 420, brl: 490, hh: 558, fb: 624, matchup: 690, score: W - PAD };
      ctx.fillStyle = "#52525b";
      ctx.font = "bold 9px Inter, system-ui, sans-serif";
      ["EV", "BRL%", "HH%", "FB%", "MATCHUP", "SCORE"].forEach((lbl, i) => {
        const x = [COL.ev, COL.brl, COL.hh, COL.fb, COL.matchup, COL.score][i];
        const tw = ctx.measureText(lbl).width;
        ctx.fillText(lbl, i === 5 ? x - tw : x, HEADER_H - 10);
      });

      rows.forEach(({ player, game }, i) => {
        const s = scoreFor(player, lookback);
        if (!s) return;
        const score =
          rankingTab === "combined" ? combinedScore(player)
          : rankingTab === "test"   ? (testScoreConsensus(player) ?? 0)
          : mlComposite(player, lookback, mlWeights);
        const y = HEADER_H + i * (ROW_H + 8);

        // Card bg
        const rr = 10;
        ctx.beginPath();
        ctx.roundRect(PAD - 8, y, W - (PAD - 8) * 2, ROW_H, rr);
        ctx.fillStyle = "#1c1c1e";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();

        const cy = y + ROW_H / 2;

        // Rank
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "bold 13px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), COL.rank + 6, cy + 5);
        ctx.textAlign = "left";

        // Name — red for small-sample players, same rule as the on-screen
        // cards so the exported PNG never presents a fluke as trustworthy.
        const isSmallSample =
          rankingTab === "combined"
            ? (!player.season_profile || (player.season_profile.bip_count ?? 0) < 20)
            : rankingTab === "test"
              ? (!player.three_year_profile || (player.three_year_profile.bip_count ?? 0) < 50)
              : (s.data_quality === "LOW_SAMPLE" || s.data_quality === "NO_BATTER_DATA");
        ctx.fillStyle = isSmallSample ? "#f87171" : "#e4e4e7";
        ctx.font = "bold 15px Inter, system-ui, sans-serif";
        ctx.fillText(player.name, COL.name, cy - 6);
        if (isSmallSample) {
          const nameW = ctx.measureText(player.name).width;
          const bbe = rankingTab === "test"
            ? (player.three_year_profile?.bip_count ?? 0)
            : (player.season_profile?.bip_count ?? 0);
          ctx.font = "bold 10px Inter, system-ui, sans-serif";
          ctx.fillStyle = "#f87171";
          ctx.fillText(`${bbe} BBE`, COL.name + nameW + 8, cy - 6);
        }

        // Matchup line
        ctx.fillStyle = "#71717a";
        ctx.font = "11px Inter, system-ui, sans-serif";
        ctx.fillText(`${game.away_team} vs ${game.home_team} · ${player.opp_pitcher} (${player.pitcher_hand}HP)`, COL.name, cy + 10);

        // Stats
        const ev = s.exit_velo ?? 0;
        const barrel = s.barrel_pct ?? 0;
        const hh = s.hard_hit_pct ?? 0;
        const fb = s.fb_pct ?? 0;

        const drawStat = (val: string, x: number, hi: boolean) => {
          ctx.fillStyle = hi ? "#4ade80" : "#e4e4e7";
          ctx.font = "bold 14px Inter, system-ui, sans-serif";
          ctx.fillText(val, x, cy + 5);
        };

        drawStat(String(ev), COL.ev, ev >= 95);
        drawStat(`${barrel}%`, COL.brl, barrel >= 12);
        drawStat(`${hh}%`, COL.hh, hh >= 45);
        drawStat(`${fb}%`, COL.fb, fb >= 38);

        // Matchup label
        const matchupLabel = (() => {
          const score_s = scoreFor(player, lookback);
          if (!score_s) return "";
          const pit = score_s.pitcher_score ?? 0.5;
          return pit >= 0.65 ? "GREAT" : pit >= 0.5 ? "DECENT" : "TOUGH";
        })();
        const matchupColor = matchupLabel === "GREAT" ? "#4ade80" : matchupLabel === "DECENT" ? "#fbbf24" : "#f87171";
        ctx.fillStyle = matchupColor;
        ctx.font = "bold 11px Inter, system-ui, sans-serif";
        ctx.fillText(matchupLabel, COL.matchup, cy + 5);

        // Score
        const scoreColor = score >= 0.65 ? "#4ade80" : score >= 0.5 ? "#fbbf24" : "#e4e4e7";
        ctx.fillStyle = scoreColor;
        ctx.font = "bold 22px Inter, system-ui, sans-serif";
        const scoreTxt = score.toFixed(2);
        const scoreW = ctx.measureText(scoreTxt).width;
        ctx.fillText(scoreTxt, COL.score - scoreW, cy + 8);
      });

      // Footer watermark
      const fy = H - 14;
      ctx.fillStyle = "#3f3f46";
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      const wm = "Beeb Sheets";
      const wmW = ctx.measureText(wm).width;
      ctx.fillText(wm, W / 2 - wmW / 2, fy);

      const dataUrl = canvas.toDataURL("image/png");
      const label = filter === 0 ? "all" : `top${filter}`;
      // Safari mobile blocks programmatic clicks — open in new tab as fallback
      const link = document.createElement("a");
      link.download = `beeb-rankings-${label}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(msg);
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 4000);
    }
  };

  // Consensus uses a different table layout (L5/L10/Season rank chips + avg),
  // so it gets its own canvas renderer. Small-sample names render red with a
  // BBE tag, same rule as the score-card export and the on-screen tables.
  const downloadConsensusPng = () => {
    if (downloadState === "loading") return;
    setDownloadState("loading");
    try {
      const DPR = 2, W = 900, PAD = 28, ROW_H = 64, HEADER_H = 72, FOOTER_H = 44;
      const rows = consensusRows;
      const H = HEADER_H + rows.length * (ROW_H + 8) + FOOTER_H + PAD;
      const canvas = document.createElement("canvas");
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(DPR, DPR);
      ctx.fillStyle = "#111113";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "#e4e4e7";
      ctx.font = "bold 22px Inter, system-ui, sans-serif";
      ctx.fillText("Consensus Rankings", PAD, 34);
      ctx.fillStyle = "#71717a";
      ctx.font = "13px Inter, system-ui, sans-serif";
      ctx.fillText(`${rows.length} players · avg of L5 / L10 / Season rank · Beeb Sheets`, PAD, 56);

      const COL = { rank: PAD, name: PAD + 36, l5: 590, l10: 660, season: 740, avg: W - PAD };
      ctx.fillStyle = "#52525b";
      ctx.font = "bold 9px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("L5", COL.l5, HEADER_H - 10);
      ctx.fillText("L10", COL.l10, HEADER_H - 10);
      ctx.fillText("SEASON", COL.season, HEADER_H - 10);
      ctx.textAlign = "right";
      ctx.fillText("AVG RK", COL.avg, HEADER_H - 10);
      ctx.textAlign = "left";

      const chip = (rank: number, x: number, cy: number) => {
        ctx.fillStyle = rank <= 10 ? "#22c55e" : rank <= 20 ? "#eab308" : "#a1a1aa";
        ctx.font = "bold 14px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`#${rank}`, x, cy + 5);
        ctx.textAlign = "left";
      };

      rows.forEach((row, i) => {
        const { player, game } = row;
        const y = HEADER_H + i * (ROW_H + 8);
        ctx.beginPath();
        ctx.roundRect(PAD - 8, y, W - (PAD - 8) * 2, ROW_H, 10);
        ctx.fillStyle = "#1c1c1e";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const cy = y + ROW_H / 2;

        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "bold 13px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), COL.rank + 6, cy + 5);
        ctx.textAlign = "left";

        const seasonBip = player.season_profile?.bip_count ?? 0;
        const low = seasonBip < 20;
        ctx.fillStyle = low ? "#f87171" : "#e4e4e7";
        ctx.font = "bold 15px Inter, system-ui, sans-serif";
        ctx.fillText(player.name, COL.name, cy - 6);
        if (low) {
          const nameW = ctx.measureText(player.name).width;
          ctx.font = "bold 10px Inter, system-ui, sans-serif";
          ctx.fillStyle = "#f87171";
          ctx.fillText(`${seasonBip} BBE`, COL.name + nameW + 8, cy - 6);
        }

        ctx.fillStyle = "#71717a";
        ctx.font = "11px Inter, system-ui, sans-serif";
        ctx.fillText(`${game.away_team} vs ${game.home_team} · ${player.opp_pitcher} (${player.pitcher_hand}HP)`, COL.name, cy + 10);

        chip(row.l5Rank, COL.l5, cy);
        chip(row.l10Rank, COL.l10, cy);
        chip(row.seasonRank, COL.season, cy);

        ctx.fillStyle = "#a1a1aa";
        ctx.font = "bold 15px Inter, system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(row.avgRank.toFixed(1), COL.avg, cy + 5);
        ctx.textAlign = "left";
      });

      const fy = H - 14;
      ctx.fillStyle = "#3f3f46";
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      const wm = "Beeb Sheets";
      const wmW = ctx.measureText(wm).width;
      ctx.fillText(wm, W / 2 - wmW / 2, fy);

      const link = document.createElement("a");
      link.download = "beeb-consensus.png";
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(msg);
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 4000);
    }
  };

  const [mlWeights, setMlWeights] = useState<MlWeights>(FALLBACK_WEIGHTS);
  const [weightSource, setWeightSource] = useState<string>("fallback");
  const [yesterday, setYesterday] = useState<{
    date: string;
    mlPicks: YesterdayPick[];
    combinedPicks: YesterdayPick[];
    consensusPicks: YesterdayPick[];
    testPicks: YesterdayPick[];
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
      .then(([slate, cum]: [ModelData | null, Array<{ date: string; players_who_batted?: string[]; hr_hitters: Array<{ name: string }>; near_hr_hitters?: Array<{ name: string }>; near_hr_events?: Array<{ batter: string }> }>]) => {
        if (!slate) return;
        const dayReport = cum.find((x) => x.date === prevStr);
        const hrNames = new Set<string>(
          (dayReport?.hr_hitters ?? []).map((h) => h.name)
        );
        const nearNames = new Set<string>([
          ...(dayReport?.near_hr_hitters ?? []).map((h) => h.name),
          ...(dayReport?.near_hr_events ?? []).map((h) => h.batter),
        ]);
        // Only count players who actually batted yesterday. Excludes bench /
        // scratched / players in postponed games. Falls back to "include all"
        // if the report is missing the field (older results before this change).
        const playedSet: Set<string> | null = dayReport?.players_who_batted
          ? new Set(dayReport.players_who_batted)
          : null;
        const seen = new Set<string>();
        const allPlayers: { player: PlayerData; game: GameData }[] = [];
        const mlPicksAll: YesterdayPick[] = [];
        const combinedPicksAll: YesterdayPick[] = [];
        for (const game of slate.games ?? []) {
          for (const player of game.players ?? []) {
            if (playedSet && !playedSet.has(player.name)) continue;
            if (seen.has(player.name)) continue;
            seen.add(player.name);
            allPlayers.push({ player, game });
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

        // Consensus: players in top 30 of L5, L10, and Season on yesterday's slate
        const TOP_N = 30;
        const yL5 = [...allPlayers].sort((a, b) => {
          const ra = Math.min(1, (scoreFor(a.player, "L5")?.recent_abs?.length ?? 0) / 10);
          const rb = Math.min(1, (scoreFor(b.player, "L5")?.recent_abs?.length ?? 0) / 10);
          return mlComposite(b.player, "L5", mlWeights) * rb - mlComposite(a.player, "L5", mlWeights) * ra;
        });
        const yL10 = [...allPlayers].sort((a, b) => {
          const ra = Math.min(1, (scoreFor(a.player, "L10")?.recent_abs?.length ?? 0) / 10);
          const rb = Math.min(1, (scoreFor(b.player, "L10")?.recent_abs?.length ?? 0) / 10);
          return mlComposite(b.player, "L10", mlWeights) * rb - mlComposite(a.player, "L10", mlWeights) * ra;
        });
        const ySeason = [...allPlayers]
          .filter(r => _seasonScoreConsensus(r.player) !== null)
          .sort((a, b) => (_seasonScoreConsensus(b.player) ?? 0) - (_seasonScoreConsensus(a.player) ?? 0));
        const l5Ranks = new Map(yL5.slice(0, TOP_N).map((r, i) => [r.player.name, i + 1]));
        const l10Ranks = new Map(yL10.slice(0, TOP_N).map((r, i) => [r.player.name, i + 1]));
        const seasonRanks = new Map(ySeason.slice(0, TOP_N).map((r, i) => [r.player.name, i + 1]));
        const consensusPicksAll: YesterdayPick[] = allPlayers
          .filter(r => l5Ranks.has(r.player.name) && l10Ranks.has(r.player.name) && seasonRanks.has(r.player.name))
          .map(r => ({
            name: r.player.name,
            matchup: `${r.game.away_team}@${r.game.home_team}`,
            oppPitcher: r.player.opp_pitcher,
            hitHR: hrNames.has(r.player.name),
            nearHR: !hrNames.has(r.player.name) && nearNames.has(r.player.name),
            mlScore: (l5Ranks.get(r.player.name)! + l10Ranks.get(r.player.name)! + seasonRanks.get(r.player.name)!) / 3,
          }))
          .sort((a, b) => a.mlScore - b.mlScore);

        // Test rankings — same shape as season consensus but reads
        // three_year_profile. Will be empty for any historical slate that
        // pre-dates the compute_three_year_batter.py wiring.
        const testPicksAll: YesterdayPick[] = allPlayers
          .filter(r => testScoreConsensus(r.player) !== null)
          .map(r => ({
            name: r.player.name,
            matchup: `${r.game.away_team}@${r.game.home_team}`,
            oppPitcher: r.player.opp_pitcher,
            hitHR: hrNames.has(r.player.name),
            nearHR: !hrNames.has(r.player.name) && nearNames.has(r.player.name),
            mlScore: testScoreConsensus(r.player) ?? 0,
          }))
          .sort((a, b) => b.mlScore - a.mlScore);

        setYesterday({
          date: prevStr,
          mlPicks: mlPicksAll.slice(0, 30),
          combinedPicks: combinedPicksAll.slice(0, 30),
          consensusPicks: consensusPicksAll,
          testPicks: testPicksAll.slice(0, 30),
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

  // Default pool = every player whose game is being played. The "Refresh Lineups"
  // override is team-aware: for teams that have posted a lineup, only their 9
  // starters survive; for teams that haven't posted yet, all candidates remain.
  // This way we never hide someone based on a non-decision.
  const confirmedStarters = useMemo(() => {
    // Two sources of truth, in priority order:
    //   1. Manual lineup override (user clicked "Refresh Lineups") — wins for
    //      teams the user explicitly fetched. Lets them force a refresh when
    //      the cron is behind.
    //   2. Slate's team_pitch_mix.lineup_status — populated by patch_lineups.py
    //      every 15 min. When status === "posted", only batters with order 1-9
    //      are in tonight's lineup. Otherwise we don't know yet, include all
    //      candidates from that team.
    const overrideStarters = new Set(lineupOverride?.starters ?? []);
    const overridePostedTeams = new Set(lineupOverride?.postedTeams ?? []);

    const result = new Set<string>();
    for (const game of games) {
      const tpm = game.team_pitch_mix;
      for (const side of ["away", "home"] as const) {
        const team = side === "away" ? game.away_team : game.home_team;
        const sideData = tpm?.[side];
        const overrideHasThisTeam = overridePostedTeams.has(team);
        const slatePosted = sideData?.lineup_status === "posted";

        if (overrideHasThisTeam) {
          // Manual override is the truth for this team.
          for (const p of game.players) {
            if (p.batter_side === side && overrideStarters.has(p.name)) {
              result.add(p.name);
            }
          }
        } else if (slatePosted && sideData) {
          // Slate's posted lineup wins — only the 9 starters survive.
          for (const b of sideData.batters) {
            if (b.order != null && b.order >= 1 && b.order <= 9) {
              result.add(b.name);
            }
          }
        } else {
          // Lineup not yet posted for this team — keep all candidates.
          for (const p of game.players) {
            if (p.batter_side === side) result.add(p.name);
          }
        }
      }
    }
    return result;
  }, [games, lineupOverride]);

  const sorted = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!confirmedStarters.has(player.name)) continue;
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
        if (!confirmedStarters.has(player.name)) continue;
        if (!seen.has(player.name)) {
          seen.add(player.name);
          all.push({ player, game });
        }
      }
    }
    return all.sort((a, b) => combinedScore(b.player) - combinedScore(a.player));
  }, [games, confirmedStarters]);

  // Fixed L5/L10 sorted lists for consensus (independent of current lookback toggle)
  const sortedL5 = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!confirmedStarters.has(player.name)) continue;
        if (!seen.has(player.name)) { seen.add(player.name); all.push({ player, game }); }
      }
    }
    return all.sort((a, b) => {
      const sa = scoreFor(a.player, "L5");
      const sb = scoreFor(b.player, "L5");
      const rA = Math.min(1, (sa?.recent_abs?.length ?? 0) / 10);
      const rB = Math.min(1, (sb?.recent_abs?.length ?? 0) / 10);
      return mlComposite(b.player, "L5", mlWeights) * rB - mlComposite(a.player, "L5", mlWeights) * rA;
    });
  }, [games, mlWeights, confirmedStarters]);

  const sortedL10 = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!confirmedStarters.has(player.name)) continue;
        if (!seen.has(player.name)) { seen.add(player.name); all.push({ player, game }); }
      }
    }
    return all.sort((a, b) => {
      const sa = scoreFor(a.player, "L10");
      const sb = scoreFor(b.player, "L10");
      const rA = Math.min(1, (sa?.recent_abs?.length ?? 0) / 10);
      const rB = Math.min(1, (sb?.recent_abs?.length ?? 0) / 10);
      return mlComposite(b.player, "L10", mlWeights) * rB - mlComposite(a.player, "L10", mlWeights) * rA;
    });
  }, [games, mlWeights, confirmedStarters]);

  const sortedSeason = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!confirmedStarters.has(player.name)) continue;
        if (!seen.has(player.name)) { seen.add(player.name); all.push({ player, game }); }
      }
    }
    return all
      .filter(r => _seasonScoreConsensus(r.player) !== null)
      .sort((a, b) => (_seasonScoreConsensus(b.player) ?? 0) - (_seasonScoreConsensus(a.player) ?? 0));
  }, [games, confirmedStarters]);

  const sortedTest = useMemo(() => {
    const seen = new Set<string>();
    const all: { player: PlayerData; game: GameData }[] = [];
    for (const game of games) {
      for (const player of game.players) {
        if (!confirmedStarters.has(player.name)) continue;
        if (!seen.has(player.name)) { seen.add(player.name); all.push({ player, game }); }
      }
    }
    return all
      .filter(r => testScoreConsensus(r.player) !== null)
      .sort((a, b) => (testScoreConsensus(b.player) ?? 0) - (testScoreConsensus(a.player) ?? 0));
  }, [games, confirmedStarters]);

  const consensusRows = useMemo(() => {
    const TOP_N = 30;
    const l5Top = sortedL5.slice(0, TOP_N);
    const l10Top = sortedL10.slice(0, TOP_N);
    const seasonTop = sortedSeason.slice(0, TOP_N);
    const l5Ranks = new Map(l5Top.map((r, i) => [r.player.name, i + 1]));
    const l10Ranks = new Map(l10Top.map((r, i) => [r.player.name, i + 1]));
    const seasonRanks = new Map(seasonTop.map((r, i) => [r.player.name, i + 1]));
    return sortedL5
      .filter(r => l5Ranks.has(r.player.name) && l10Ranks.has(r.player.name) && seasonRanks.has(r.player.name))
      .map(r => ({
        player: r.player,
        game: r.game,
        l5Rank: l5Ranks.get(r.player.name)!,
        l10Rank: l10Ranks.get(r.player.name)!,
        seasonRank: seasonRanks.get(r.player.name)!,
        avgRank: (l5Ranks.get(r.player.name)! + l10Ranks.get(r.player.name)! + seasonRanks.get(r.player.name)!) / 3,
      }))
      .sort((a, b) => a.avgRank - b.avgRank);
  }, [sortedL5, sortedL10, sortedSeason]);

  const activeSorted =
    rankingTab === "combined" ? sortedCombined
    : rankingTab === "test"   ? sortedTest
    : sorted;
  // Pre-filter to only players that have a renderable score, so rank numbers
  // are always sequential (no gaps from silently-skipped null renders).
  const hasScore = (player: PlayerData) =>
    rankingTab === "combined"
      ? !!(scoreFor(player, "L10") ?? scoreFor(player, "L5"))
      : rankingTab === "test"
        ? testScoreConsensus(player) !== null
        : !!scoreFor(player, lookback);
  const scoreable = activeSorted.filter(({ player }) => hasScore(player));
  const top = filter === 0 ? scoreable : scoreable.slice(0, filter);
  // Don't blank the whole page when the current sub-tab has no data — the
  // user can still switch tabs. Only kill the render when there's literally
  // nothing in any pool (no games loaded yet).
  const hasAnyData = sorted.length > 0 || sortedCombined.length > 0 || sortedTest.length > 0;
  if (!hasAnyData) return null;

  const wPct = (n: number) => `${Math.round(n * 100)}%`;

  const activePicks = yesterday
    ? (rankingTab === "combined" ? yesterday.combinedPicks
      : rankingTab === "test"     ? yesterday.testPicks
      : yesterday.mlPicks)
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
                {rankingTab === "combined" ? "Yesterday's Balanced Edge Picks"
                  : rankingTab === "test" ? "Yesterday's Test Picks"
                  : "Yesterday's ML Picks"} — {yesterday.date}
              </h3>
              <p className="text-[11px] text-muted mt-0.5">
                {rankingTab === "combined"
                  ? "How Balanced Edge would have ranked yesterday's slate."
                  : rankingTab === "test"
                    ? "How the 3-year batter profile (2024+2025+2026) would have ranked yesterday's slate."
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

  const consensusPicks = yesterday?.consensusPicks ?? [];
  const consensusHits = consensusPicks.filter(p => p.hitHR).length;
  const consensusNears = consensusPicks.filter(p => p.nearHR).length;
  const consensusPanel = yesterday && consensusPicks.length > 0 ? (
    <div className="border border-card-border rounded-xl bg-card/30 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Yesterday&apos;s Consensus Picks — {yesterday.date}
          </h3>
          <p className="text-[11px] text-muted mt-0.5">
            Players in the top 30 on all three lists yesterday. Sorted by avg rank.
            Leaguewide: {yesterday.totalHRs} HRs hit.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="text-right">
            <div className="text-[10px] text-muted uppercase">HR</div>
            <div className="font-mono font-bold text-accent-green">{consensusHits}/{consensusPicks.length}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted uppercase">Near HR</div>
            <div className="font-mono font-bold text-accent-yellow">{consensusNears}</div>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 md:columns-2 md:gap-x-1.5">
        {consensusPicks.map((p, i) => (
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
            <span className="font-mono font-bold text-muted w-5 text-center shrink-0">{i + 1}</span>
            <span className={`w-4 text-center shrink-0 ${p.hitHR ? "text-accent-green" : p.nearHR ? "text-accent-yellow" : "text-muted/30"}`}>
              {p.hitHR ? "✓" : p.nearHR ? "◐" : "·"}
            </span>
            <span className="flex-1 min-w-0 truncate text-foreground font-medium">{p.name}</span>
            <span className="text-[10px] text-muted shrink-0">{p.matchup}</span>
            <span className="font-mono text-muted shrink-0 w-16 text-right">avg #{p.mlScore.toFixed(1)}</span>
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
            {rankingTab === "combined" ? "Balanced Edge"
              : rankingTab === "consensus" ? "Consensus"
              : rankingTab === "test" ? "Test (3-yr profile)"
              : "ML Rankings"}
          </h2>
          <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted mt-0.5">
            {rankingTab === "combined"
              ? "Season power profile anchored · recent form adjusts ±15%"
              : rankingTab === "consensus"
              ? "Players in the top 30 on every list — L5, L10, and Season"
              : rankingTab === "test"
              ? "Career power profile (2024+2025+2026) × today's pitcher & park"
              : "Data-driven — reweighted using what the ML learned from past HR outcomes"}
          </p>
        </div>
        <div className="flex items-center gap-2">
        {rankingTab !== "consensus" && (
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
        )}
          {<button
            onClick={rankingTab === "consensus" ? downloadConsensusPng : downloadPng}
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
                {downloadError ? downloadError.slice(0, 40) : "Failed"}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                PNG
              </>
            )}
          </button>}
        </div>
      </div>

      {/* Tab toggle */}
      {/* Balanced Edge ("combined") and Test tabs hidden per user request —
          keep only ML Model + Consensus. All their logic remains intact; to
          restore, add "combined" / "test" back to the array below. */}
      <div className="flex items-center gap-1 mb-4">
        {(["ml", "consensus"] as const).map((t) => (
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
            {t === "ml" ? "ML Model" : "Consensus"}
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
          <span className="text-foreground font-mono">Geometric mean</span>
          {" · "}L10 form × L5 form × pitcher vs-hand × park+weather × weighted barrel/HH vs pitcher's pitch mix · weakness in any one factor drags the rank down
        </p>
      )}
      {rankingTab === "test" && (
        <p className="text-[11px] leading-[16px] text-muted mb-4">
          <span className="text-foreground font-mono">3-year batter profile</span>
          {" · "}barrel 55% · FB 25% · EV 20%
          {" · "}rolled with pitcher (35%) + park/weather (15%) from today&apos;s L10 matchup
          {" · "}50-BIP floor across 2024 + 2025 + 2026 (vs opposing hand)
        </p>
      )}

      {/* Consensus table */}
      {rankingTab === "consensus" && (
        consensusRows.length === 0 ? (
          <p className="text-[13px] text-muted text-center py-8">No players appear in the top 30 on all three lists today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 pr-3 w-6">#</th>
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 pr-4">Player</th>
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 pr-3 text-center w-14">L5</th>
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 pr-3 text-center w-14">L10</th>
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 pr-3 text-center w-16">Season</th>
                  <th className="text-[10px] uppercase tracking-wider text-muted/50 font-semibold pb-2 text-center w-16">Avg Rk</th>
                </tr>
              </thead>
              <tbody>
                {consensusRows.map((row, i) => {
                  const mixBatters = [
                    ...(row.game.team_pitch_mix?.away?.batters ?? []),
                    ...(row.game.team_pitch_mix?.home?.batters ?? []),
                  ];
                  const mlbId = mixBatters.find((b) => b.name === row.player.name)?.id;
                  // Low season sample — the Consensus's Season leg lets players
                  // in at ≥10 BBE, but every other ranking requires ≥20. Rather
                  // than drop these, keep them and flag the name red (same
                  // convention as the batter tables) so a small-sample #1 like
                  // a 15-BBE hot streak reads as untrustworthy, not gospel.
                  const seasonBip = row.player.season_profile?.bip_count ?? 0;
                  const lowSample = seasonBip < 20;
                  const rankChip = (rank: number) => {
                    const color = rank <= 10 ? "#22c55e" : rank <= 20 ? "#eab308" : "#71717a";
                    return (
                      <span
                        className="inline-flex items-center justify-center w-8 h-6 rounded font-mono font-bold text-[12px]"
                        style={{ color, background: color + "18" }}
                      >
                        #{rank}
                      </span>
                    );
                  };
                  return (
                    <tr
                      key={row.player.name}
                      className="border-t"
                      style={{ borderColor: "rgba(255,255,255,0.05)" }}
                    >
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-muted/50">{i + 1}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          {mlbId ? (
                            <img
                              src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${mlbId}/headshot/67/current`}
                              alt={row.player.name}
                              className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                              style={{ border: "1px solid rgba(255,255,255,0.10)" }}
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)" }} />
                          )}
                          <div>
                            <div className={`font-semibold text-[13px] leading-tight flex items-center gap-1.5 ${lowSample ? "text-red-400" : "text-foreground"}`}>
                              {row.player.name}
                              {lowSample && (
                                <span className="px-1 py-0 text-[8px] font-bold rounded bg-accent-red/10 text-red-400 border border-accent-red/20">
                                  {seasonBip} BBE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted leading-tight">
                              {row.game.away_team} vs {row.game.home_team} · {row.player.opp_pitcher} ({row.player.pitcher_hand}HP)
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-center">{rankChip(row.l5Rank)}</td>
                      <td className="py-2.5 pr-3 text-center">{rankChip(row.l10Rank)}</td>
                      <td className="py-2.5 pr-3 text-center">{rankChip(row.seasonRank)}</td>
                      <td className="py-2.5 text-center font-mono text-[12px] text-muted">{row.avgRank.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Empty state — current sub-tab has no scoreable players (e.g. Test
       *  before backend has injected three_year_profile, or any tab when
       *  three_year_profile is missing from a cached client JSON). */}
      {rankingTab !== "consensus" && top.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[13px] text-muted">
            {rankingTab === "test"
              ? "No 3-year profile data loaded."
              : "No scoreable players for this view yet."}
          </p>
          {rankingTab === "test" && (() => {
            let totalPlayers = 0;
            let withTp = 0;
            const seen = new Set<string>();
            for (const game of games) {
              for (const player of game.players) {
                if (seen.has(player.name)) continue;
                seen.add(player.name);
                totalPlayers++;
                if (player.three_year_profile) withTp++;
              }
            }
            return (
              <p className="text-[11px] text-muted/60 mt-2 font-mono">
                debug: {totalPlayers} players in state, {withTp} have three_year_profile
                {" · "}confirmedStarters: {confirmedStarters.size}
                {withTp === 0 && " · client JSON is stale — restart the dev server or hard-refresh again"}
              </p>
            );
          })()}
        </div>
      )}

      {/* Ranking cards */}
      {rankingTab !== "consensus" && top.length > 0 && <div ref={cardsRef} className="space-y-3">
        {top.map(({ player, game }, i) => {
          const isCombo = rankingTab === "combined";
          const isTest  = rankingTab === "test";
          // For combined/test, fall back between L10/L5 so a player with only
          // one lookback isn't silently skipped (causing rank gaps).
          const s = (isCombo || isTest)
            ? (scoreFor(player, "L10") ?? scoreFor(player, "L5"))
            : scoreFor(player, lookback);
          if (!s) return null;
          const score =
            isCombo ? combinedScore(player)
            : isTest ? (testScoreConsensus(player) ?? 0)
            : mlComposite(player, lookback, mlWeights);
          const delta = isCombo ? combinedFormDelta(player) : null;
          const season = isCombo ? computeSeasonScore(player) : null;
          const isSmallSample = isCombo
            ? (!player.season_profile || (player.season_profile.bip_count ?? 0) < 20)
            : isTest
              ? (!player.three_year_profile || (player.three_year_profile.bip_count ?? 0) < 50)
              : (s.data_quality === "LOW_SAMPLE" || s.data_quality === "NO_BATTER_DATA");

          // MLB headshot — match player name in team_pitch_mix batters
          const mixBatters = [
            ...(game.team_pitch_mix?.away?.batters ?? []),
            ...(game.team_pitch_mix?.home?.batters ?? []),
          ];
          const mlbId = mixBatters.find((b) => b.name === player.name)?.id;

          // Key stats — Test tab MUST display 3-yr profile values (the same
          // numbers that drive testScoreConsensus). Display = Score rule.
          const tp = player.three_year_profile;
          const ev = isTest && tp ? tp.ev : s.exit_velo;
          const barrel = isTest && tp ? tp.barrel : s.barrel_pct;
          const fb = isTest && tp ? tp.fb : s.fb_pct;
          const hh = isTest && tp ? (tp.hard_hit ?? null) : s.hard_hit_pct;
          const blast = isTest && tp ? (tp.blast ?? null) : s.blast_pct;
          const pullBrl = isTest && tp ? (tp.pull_barrel ?? null) : s.pull_brl;

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
              className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-4 rounded-2xl"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08), 0 4px 12px -4px rgba(0,0,0,0.5)",
              }}
            >
              {/* Top row on mobile: rank + headshot + name + score */}
              <div className="flex items-center gap-3 md:contents">
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
                    className="w-12 h-12 md:w-14 md:h-14 rounded-full object-cover flex-shrink-0"
                    style={{ border: "2px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }}
                    loading="lazy"
                  />
                ) : (
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.10)" }} />
                )}

                {/* Player info — name + matchup */}
                <div className="flex-1 min-w-0 md:w-56 md:flex-shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[16px] font-bold leading-tight ${isSmallSample ? "text-red-400" : "text-foreground"}`}>
                      {player.name}
                    </span>
                    <RatingBadge composite={score} />
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    <img src={teamLogoUrl(game.away_team)} alt={game.away_team} className="w-3.5 h-3.5 object-contain opacity-80" />
                    <span className="text-[11px] font-semibold text-foreground/80">{game.away_team}</span>
                    <span className="text-[10px] text-muted/50">vs</span>
                    <img src={teamLogoUrl(game.home_team)} alt={game.home_team} className="w-3.5 h-3.5 object-contain opacity-80" />
                    <span className="text-[11px] font-semibold text-foreground/80">{game.home_team}</span>
                    <span className="text-[10px] text-muted truncate">· {player.opp_pitcher} ({player.pitcher_hand}HP)</span>
                  </div>
                </div>

                {/* Score — visible on mobile in top row */}
                <div className="text-right flex-shrink-0 md:hidden">
                  <div className={`text-2xl font-black font-mono leading-none ${scoreColor}`}>{score.toFixed(2)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-muted/40 mt-0.5">Score</div>
                </div>
              </div>

              {/* Divider — desktop only */}
              <div className="hidden md:block w-px self-stretch flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

              {/* Stats */}
              <div className="flex-1 min-w-0">
                {/* Stat chips + matchup pill */}
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { label: "EV", value: String(ev), hi: Number(ev) >= 95 },
                    { label: "Brl%", value: `${barrel}%`, hi: Number(barrel) >= 12 },
                    { label: "Blast%", value: blast == null ? "—" : `${blast}%`, hi: Number(blast) >= 15 },
                    { label: "PullBrl%", value: pullBrl == null || pullBrl === 0 ? "—" : `${pullBrl}%`, hi: Number(pullBrl) >= 6 },
                    { label: "HH%", value: `${hh}%`, hi: Number(hh) >= 45 },
                    { label: "FB%", value: `${fb}%`, hi: Number(fb) >= 38 },
                  ].map(({ label, value, hi }) => (
                    <div key={label} className="flex flex-col items-center px-2 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", minWidth: 36 }}>
                      <span className="text-[9px] uppercase tracking-wider text-muted/50">{label}</span>
                      <span className={`text-[12px] font-bold font-mono leading-tight ${hi ? "text-accent-green" : "text-foreground"}`}>{value}</span>
                    </div>
                  ))}
                  {matchupLabel !== "—" && (
                    <span
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide ${matchupColor}`}
                      style={{ background: matchupLabel === "GREAT" ? "rgba(34,197,94,0.10)" : matchupLabel === "DECENT" ? "rgba(234,179,8,0.10)" : "rgba(248,113,113,0.10)" }}
                    >
                      {matchupLabel}
                    </span>
                  )}
                  {delta !== null && Math.abs(delta) > 0.01 && (
                    <span className={`px-2 py-1 rounded-lg text-[11px] font-bold font-mono ${delta > 0 ? "text-accent-green" : "text-red-400"}`}
                      style={{ background: delta > 0 ? "rgba(34,197,94,0.10)" : "rgba(248,113,113,0.10)" }}>
                      {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)} form
                    </span>
                  )}
                </div>

                {/* BAT/PIT/ENV bars — wrap on mobile so they don't overflow */}
                <div className="flex items-center gap-2 md:gap-4 mt-2 flex-wrap">
                  {[
                    { label: "BAT", val: season?.batter ?? s.batter_score },
                    { label: "PIT", val: season?.pitcher ?? s.pitcher_score },
                    { label: "ENV", val: season?.env ?? s.env_score },
                  ].map(({ label, val }) => {
                    const barColor = val >= 0.65 ? "#22c55e" : val >= 0.45 ? "#eab308" : "rgba(255,255,255,0.2)";
                    return (
                      <div key={label} className="flex items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider w-6 shrink-0" style={{ color: barColor }}>{label}</span>
                        <div className="w-10 md:w-20 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.round(val * 100)}%`, background: barColor }} />
                        </div>
                        <span className="text-[10px] font-mono shrink-0" style={{ color: barColor }}>{val.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Score — desktop only */}
              <div className="hidden md:block text-right flex-shrink-0 pl-2">
                <div className={`text-3xl font-black font-mono leading-none ${scoreColor}`}>{score.toFixed(2)}</div>
                <div className="text-[9px] uppercase tracking-[0.12em] text-muted/40 mt-1">Score</div>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
    {rankingTab === "consensus" ? consensusPanel : yesterdayPanel}
    </>
  );
}
