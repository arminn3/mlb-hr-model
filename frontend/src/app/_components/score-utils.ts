import type { PlayerData, ScoreSet } from "./types";

export type UILookback = "L5" | "L10" | "Season";

// Normalization ranges — must match config.py NORM_RANGES
const EV_LO = 92.0, EV_HI = 102.0;
const BRL_LO = 0.0, BRL_HI = 0.25;
const FB_LO = 0.15, FB_HI = 0.55;

function norm(v: number, lo: number, hi: number) {
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

export function computeSeasonScore(p: PlayerData): { batter: number; pitcher: number; env: number } | null {
  const sp = p.season_profile;
  if (!sp || sp.bip_count < 20) return null;
  const barrel_n = norm(sp.barrel / 100, BRL_LO, BRL_HI);
  const fb_n     = norm(sp.fb     / 100, FB_LO,  FB_HI);
  const ev_n     = norm(sp.ev,           EV_LO,  EV_HI);
  const batter   = barrel_n * 0.55 + fb_n * 0.25 + ev_n * 0.20;
  const l10      = p.scores.L10;
  return { batter, pitcher: l10?.pitcher_score ?? 0.5, env: l10?.env_score ?? 0.5 };
}

function computeSeasonScoreSet(p: PlayerData): ScoreSet | null {
  const sp = p.season_profile;
  if (!sp || sp.bip_count < 20) return null;

  const barrel_n = norm(sp.barrel / 100, BRL_LO, BRL_HI);
  const fb_n     = norm(sp.fb     / 100, FB_LO,  FB_HI);
  const ev_n     = norm(sp.ev,           EV_LO,  EV_HI);

  const batter_score = barrel_n * 0.55 + fb_n * 0.25 + ev_n * 0.20;

  // Keep today's pitcher/env context from L10 so the composite is still useful for betting
  const l10 = p.scores.L10;
  const pitcher_score = l10?.pitcher_score ?? 0.5;
  const env_score     = l10?.env_score     ?? 0.5;

  // Season mode: batter 50%, pitcher 35%, env 15%
  const composite = batter_score * 0.50 + pitcher_score * 0.35 + env_score * 0.15;

  return {
    composite,
    batter_score,
    pitcher_score,
    env_score,
    exit_velo:     sp.ev,
    barrel_pct:    sp.barrel,
    fb_pct:        sp.fb,
    ld_pct:        sp.ld ?? 0,
    gb_pct:        sp.gb ?? 0,
    hard_hit_pct:  sp.hard_hit,
    data_quality:  "SEASON",
    recent_abs:    sp.season_abs ?? l10?.recent_abs ?? [],
    xwoba:         sp.xwoba,
    sweet_spot:    sp.sweet_spot,
    blast_pct:     sp.blast,
    pull_brl:      sp.pull_barrel,
    swstr:         undefined,
    bip:           sp.bip_count,
  };
}

export function scoreFor(p: PlayerData, lb: UILookback): ScoreSet | null {
  if (lb === "Season") return computeSeasonScoreSet(p);
  return p.scores[lb] ?? null;
}
