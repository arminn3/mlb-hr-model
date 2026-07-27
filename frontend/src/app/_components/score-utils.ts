import type { PlayerData, ScoreSet, RecentAB } from "./types";

export type UILookback = "L5" | "L10" | "L15" | "L20" | "L25" | "Season";

// Normalization ranges — must match config.py NORM_RANGES
const EV_LO = 92.0, EV_HI = 102.0;
const BRL_LO = 0.0, BRL_HI = 0.25;
// Fly-ball rate is the QUALITY-GATED hard-fly rate (flies >= 90 EV only).
const FB_LO = 0.04, FB_HI = 0.24;
const HH_LO = 0.30, HH_HI = 0.60;
// Min EV (mph) for a fly ball to count toward the scoring fly-ball rate —
// must match config.HARD_FLY_EV_MIN.
const HARD_FLY_EV_MIN = 90;

function norm(v: number, lo: number, hi: number) {
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

// Batter score from raw rates — must match config.BATTER_WEIGHTS + NORM_RANGES.
// barrel 0.45 · hard-hit 0.25 · hard-fly 0.15 · avg EV 0.15.
function batterScore(barrelFrac: number, hardHitFrac: number, hardFlyFrac: number, ev: number) {
  return (
    norm(barrelFrac, BRL_LO, BRL_HI) * 0.45 +
    norm(hardHitFrac, HH_LO, HH_HI) * 0.25 +
    norm(hardFlyFrac, FB_LO, FB_HI) * 0.15 +
    norm(ev, EV_LO, EV_HI) * 0.15
  );
}

/** Hard-fly rate (flies LA 25-50 hit >= 90 EV, per BBE) over an AB pool.
 *  Mirrors metrics.calc_batter_metrics_for_pitch's gated fly_ball_rate. */
function hardFlyFrac(abs: RecentAB[]): number {
  if (abs.length === 0) return 0;
  let n = 0;
  for (const ab of abs) {
    const ev = Number(ab.ev || 0), la = Number(ab.angle || 0);
    if (la >= 25 && la <= 50 && ev >= HARD_FLY_EV_MIN) n += 1;
  }
  return n / abs.length;
}

/** Season-long same-hand hard-fly rate from season_abs (best available gated
 *  fly-ball signal — the season aggregate `sp.fb` is raw/ungated). */
function seasonHardFlyFrac(p: PlayerData): number {
  const sp = p.season_profile;
  const abs = (sp?.season_abs ?? []).filter((ab) => !p.pitcher_hand || ab.pitch_arm === p.pitcher_hand);
  return abs.length ? hardFlyFrac(abs) : (sp ? sp.fb / 100 : 0);
}

export function computeSeasonScore(p: PlayerData): { batter: number; pitcher: number; env: number } | null {
  const sp = p.season_profile;
  if (!sp || sp.bip_count < 20) return null;
  const batter = batterScore(sp.barrel / 100, sp.hard_hit / 100, seasonHardFlyFrac(p), sp.ev);
  const l10    = p.scores.L10;
  return { batter, pitcher: l10?.pitcher_score ?? 0.5, env: l10?.env_score ?? 0.5 };
}

function computeSeasonScoreSet(p: PlayerData): ScoreSet | null {
  const sp = p.season_profile;
  if (!sp || sp.bip_count < 20) return null;

  const batter_score = batterScore(sp.barrel / 100, sp.hard_hit / 100, seasonHardFlyFrac(p), sp.ev);

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
    // Gated hard-fly% (>= 90 EV) so the displayed FB% equals the score input.
    fb_pct:        Math.round(seasonHardFlyFrac(p) * 1000) / 10,
    ld_pct:        sp.ld ?? 0,
    gb_pct:        sp.gb ?? 0,
    hard_hit_pct:  sp.hard_hit,
    data_quality:  "SEASON",
    recent_abs:    sp.season_abs ?? l10?.recent_abs ?? [],
    xwoba:         sp.xwoba,
    sweet_spot:    sp.sweet_spot,
    avg_la:        sp.avg_la,
    blast_pct:     sp.blast,
    pull_brl:      sp.pull_barrel,
    swstr:         undefined,
    bip:           sp.bip_count,
  };
}

/** Synthesize a raw-pool ScoreSet from season_abs for L15/L20/L25.
 *  Those windows aren't pre-computed by main.py (LOOKBACK_WINDOWS is L5/L10
 *  only per the scoring-lookback memory rule). Purely display-side — doesn't
 *  touch ranking composites.
 *
 *  Stats are computed from the most-recent-N slice (matches the label "L15"
 *  = "last 15 BBE"). recent_abs is returned as the FULL season_abs (up to
 *  25) so the AB table can apply the user's pitch filter first and then cap
 *  at N — otherwise pre-slicing makes the table show fewer than N entries
 *  whenever the pitch filter is on. */
function computeSliceScoreSet(p: PlayerData, n: 15 | 20 | 25): ScoreSet | null {
  const fullSeasonAbs: RecentAB[] = p.season_profile?.season_abs ?? [];
  // season_abs now carries BOTH hands (same-hand block first, then an
  // opposite-hand block for the Pitch Arm filter). The default matchup view —
  // and the stats that feed this composite — must be the opposing-hand pool
  // only, so filter to it before slicing. The full both-hand list is still
  // returned as recent_abs so the AB table's arm filter can pull either hand.
  const oppHand = p.pitcher_hand;
  const sameHandAbs = oppHand
    ? fullSeasonAbs.filter((ab) => ab.pitch_arm === oppHand)
    : fullSeasonAbs;
  const pool: RecentAB[] = sameHandAbs.slice(0, n);
  if (pool.length === 0) return null;

  const cnt = pool.length;
  // Pool-level rates over the N most recent BBE — match the convention used
  // for L5/L10 display (raw counts / total BBE, no pitch-mix weighting).
  let evSum = 0, brl = 0, hh = 0, fb = 0, ld = 0, gb = 0, pu = 0, blast = 0;
  let hr = 0, fbForHr = 0, pullBrl = 0;
  for (const ab of pool) {
    const ev = Number(ab.ev || 0);
    const la = Number(ab.angle || 0);
    const bs = ab.bat_speed == null ? null : Number(ab.bat_speed);
    evSum += ev;
    if (ev >= 95) hh += 1;
    // Barrel: prefer Statcast's precomputed launch_speed_angle == 6 (same
    // definition the backend uses for L5/L10 + season, so barrel% is consistent
    // across every window). Fall back to the EV>=98 & LA 26-30 heuristic only
    // for legacy slates that predate the `lsa` field.
    const isBarrel = ab.lsa != null ? ab.lsa === 6 : (ev >= 98 && la >= 26 && la <= 30);
    if (isBarrel) brl += 1;
    // Pull-barrel: barrel hit to the pull side. season_abs carries `direction`
    // so this is window-specific (L5/L10 get it from the backend; here we make
    // L15/L20/L25 consistent instead of falling back to the season value).
    if (isBarrel && ab.direction === "pull") pullBrl += 1;
    // Fly-ball rate is QUALITY-GATED: only flies hit >= 90 EV count (soft flies
    // aren't homer-worthy). Matches metrics.calc_batter_metrics_for_pitch.
    if (la >= 25 && la <= 50 && ev >= HARD_FLY_EV_MIN) { fb += 1; if (ab.result === "home_run") { fbForHr += 1; hr += 1; } }
    else if (la >= 10 && la < 25) ld += 1;
    else if (la < 10) gb += 1;
    else pu += 1;
    if (bs != null && bs >= 75 && ev >= 95) blast += 1;
  }
  const pct = (x: number) => Math.round((x / cnt) * 1000) / 10;

  const l10 = p.scores.L10;
  const pitcher_score = l10?.pitcher_score ?? 0.5;
  const env_score     = l10?.env_score     ?? 0.5;
  const batter_score = batterScore(brl / cnt, hh / cnt, fb / cnt, evSum / cnt);
  const composite = batter_score * 0.50 + pitcher_score * 0.35 + env_score * 0.15;

  return {
    composite,
    batter_score,
    pitcher_score,
    env_score,
    exit_velo:    Math.round((evSum / cnt) * 10) / 10,
    barrel_pct:   pct(brl),
    fb_pct:       pct(fb),
    ld_pct:       pct(ld),
    gb_pct:       pct(gb),
    hard_hit_pct: pct(hh),
    data_quality: "OK",
    // Full season_abs so the AB table can pitch-filter then slice — pool
    // (15/20/25 pre-filter) drives the stats above.
    recent_abs:   fullSeasonAbs,
    blast_pct:    pct(blast),
    pull_brl:     pct(pullBrl),
    xwoba:        p.season_profile?.xwoba,
    sweet_spot:   p.season_profile?.sweet_spot,
    avg_la:       p.season_profile?.avg_la,
    swstr:        undefined,
    bip:          cnt,
  };
  // HR/FB% lives outside ScoreSet (the batter detail page derives it from
  // recent_abs). Silencing unused-var by void-ing for now — we may surface it
  // later if the AB-table consumers want a pre-computed pct.
  void fbForHr;
}

export function scoreFor(p: PlayerData, lb: UILookback): ScoreSet | null {
  if (lb === "Season") return computeSeasonScoreSet(p);
  if (lb === "L15" || lb === "L20" || lb === "L25") {
    return computeSliceScoreSet(p, lb === "L15" ? 15 : lb === "L20" ? 20 : 25);
  }
  return p.scores[lb] ?? null;
}
