import type { PlayerData, ScoreSet, RecentAB } from "./types";

export type UILookback = "L5" | "L10" | "L15" | "L20" | "L25" | "Season";

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
  let hr = 0, fbForHr = 0;
  for (const ab of pool) {
    const ev = Number(ab.ev || 0);
    const la = Number(ab.angle || 0);
    const bs = ab.bat_speed == null ? null : Number(ab.bat_speed);
    evSum += ev;
    if (ev >= 95) hh += 1;
    // Statcast barrel: EV >= 98 AND LA between 26 and 30. Matches the
    // canonical Savant definition used elsewhere in the UI.
    if (ev >= 98 && la >= 26 && la <= 30) brl += 1;
    if (la >= 25 && la <= 50) { fb += 1; if (ab.result === "home_run") { fbForHr += 1; hr += 1; } }
    else if (la >= 10 && la < 25) ld += 1;
    else if (la < 10) gb += 1;
    else pu += 1;
    if (bs != null && bs >= 75 && ev >= 95) blast += 1;
  }
  const pct = (x: number) => Math.round((x / cnt) * 1000) / 10;

  const l10 = p.scores.L10;
  const pitcher_score = l10?.pitcher_score ?? 0.5;
  const env_score     = l10?.env_score     ?? 0.5;
  const barrel_n = norm((brl / cnt), BRL_LO, BRL_HI);
  const fb_n     = norm((fb / cnt),  FB_LO,  FB_HI);
  const ev_n     = norm((evSum / cnt), EV_LO, EV_HI);
  const batter_score = barrel_n * 0.55 + fb_n * 0.25 + ev_n * 0.20;
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
    pull_brl:     p.season_profile?.pull_barrel ?? 0,
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
