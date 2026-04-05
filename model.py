"""
Composite scoring engine: combines pitch-weighted batter metrics with
pitcher vulnerability metrics into a single HR prop score.
"""

import pandas as pd
import numpy as np

import config
from metrics import (
    get_pitch_mix,
    get_pitch_weights,
    filter_pa_by_pitch_type_and_hand,
    calc_batter_metrics_for_pitch,
    calc_pitcher_metrics,
)


def normalize_metric(value: float, metric_name: str) -> float:
    """Normalize a raw metric to [0, 1] using fixed empirical ranges."""
    if metric_name not in config.NORM_RANGES:
        return 0.0
    lo, hi = config.NORM_RANGES[metric_name]
    if hi == lo:
        return 0.0
    return float(np.clip((value - lo) / (hi - lo), 0.0, 1.0))


def calc_season_baseline(season_df: pd.DataFrame, pitcher_hand: str) -> dict:
    """
    Calculate a batter's baseline power profile from full-season data.
    Filtered to same-hand pitchers for consistency with the matchup model.
    Returns avg_exit_velo, barrel_rate, fly_ball_rate, hard_hit_rate.
    """
    defaults = {
        "avg_exit_velo": 0.0,
        "barrel_rate": 0.0,
        "fly_ball_rate": 0.0,
        "hard_hit_rate": 0.0,
        "has_data": False,
    }
    if season_df is None or season_df.empty:
        return defaults

    df = season_df[season_df["p_throws"] == pitcher_hand] if "p_throws" in season_df.columns else season_df
    bip = df.dropna(subset=["launch_speed"])
    if len(bip) < 10:
        return defaults

    n = len(bip)
    avg_ev = float(bip["launch_speed"].mean())

    if "launch_speed_angle" in bip.columns:
        barrels = (bip["launch_speed_angle"] == config.BARREL_VALUE).sum()
    else:
        barrels = 0
    barrel_rate = barrels / n

    if "launch_angle" in bip.columns:
        fly_balls = ((bip["launch_angle"] >= config.FLY_BALL_LA_MIN) & (bip["launch_angle"] <= config.FLY_BALL_LA_MAX)).sum()
    else:
        fly_balls = 0
    fb_rate = fly_balls / n

    hard_hits = (bip["launch_speed"] >= config.HARD_HIT_THRESHOLD).sum()
    hh_rate = hard_hits / n

    return {
        "avg_exit_velo": avg_ev,
        "barrel_rate": barrel_rate,
        "fly_ball_rate": fb_rate,
        "hard_hit_rate": hh_rate,
        "has_data": True,
    }


def score_batter_multi_lookback(
    batter_df: pd.DataFrame,
    pitcher_df: pd.DataFrame,
    pitcher_hand: str,
    batter_hand: str,
    env_data: dict = None,
    season_df: pd.DataFrame = None,
    pitcher_season_df: pd.DataFrame = None,
) -> dict:
    """Run scoring at each lookback window. Returns dict keyed by 'L5', 'L10'."""
    results = {}
    for n_pa in config.LOOKBACK_WINDOWS:
        results[f"L{n_pa}"] = score_batter_vs_pitcher(
            batter_df, pitcher_df, pitcher_hand, batter_hand, env_data, n_pa=n_pa,
            season_df=season_df, pitcher_season_df=pitcher_season_df,
        )
    return results


def score_batter_vs_pitcher(
    batter_df: pd.DataFrame,
    pitcher_df: pd.DataFrame,
    pitcher_hand: str,
    batter_hand: str,
    env_data: dict = None,
    n_pa: int = None,
    season_df: pd.DataFrame = None,
    pitcher_season_df: pd.DataFrame = None,
) -> dict:
    """
    Score a batter-pitcher matchup for HR potential.

    Steps:
      1. Get pitcher's pitch mix vs this batter's handedness
      2. Weight the pitches (elevated weight for dominant pitches)
      3. For each pitch type, get batter's recent metrics (last 5 PA, filtered
         by pitcher handedness)
      4. Weighted-average the per-pitch metrics into a single batter profile
      5. Normalize and weight batter metrics -> batter_score
      6. Compute pitcher vulnerability metrics -> pitcher_score
      7. Blend into composite score

    Returns dict with all intermediate metrics, scores, and data quality flag.
    """
    result = {
        "batter_score": 0.0,
        "pitcher_score": 0.0,
        "composite_score": 0.0,
        "weighted_exit_velo": 0.0,
        "weighted_barrel_rate": 0.0,
        "weighted_fb_rate": 0.0,
        "weighted_hard_hit_rate": 0.0,
        "pitcher_fb_rate": 0.0,
        "pitcher_hr_fb_rate": 0.0,
        "pitcher_hr_per_9": 0.0,
        "pitcher_total_hrs": 0,
        "pitcher_ip": 0.0,
        "pitch_types_used": [],
        "data_quality": "OK",
    }

    # ── Step 1-2: Pitch mix and weights ──────────────────────────────────────
    pitch_mix = get_pitch_mix(pitcher_df, batter_hand, pitcher_season_df)
    if not pitch_mix:
        result["data_quality"] = "NO_PITCH_DATA"
        return result

    pitch_weights = get_pitch_weights(pitch_mix)
    result["pitch_types_used"] = list(pitch_mix.keys())

    # ── Step 3: Per-pitch-type batter metrics ────────────────────────────────
    per_pitch_metrics: dict[str, dict] = {}
    low_sample = False
    effective_n_pa = n_pa or config.MIN_PA_PER_PITCH_TYPE

    for pt in pitch_mix:
        pa_data = filter_pa_by_pitch_type_and_hand(
            batter_df, pt, pitcher_hand, effective_n_pa
        )

        if pa_data.empty:
            low_sample = True
            per_pitch_metrics[pt] = {
                "avg_exit_velo": 0.0,
                "barrel_rate": 0.0,
                "fly_ball_rate": 0.0,
                "hard_hit_rate": 0.0,
            }
            continue

        # Check if we got enough PAs
        if "at_bat_number" in pa_data.columns and "game_pk" in pa_data.columns:
            n_pa_actual = pa_data[["game_pk", "at_bat_number"]].drop_duplicates().shape[0]
            if n_pa_actual < effective_n_pa:
                low_sample = True

        per_pitch_metrics[pt] = calc_batter_metrics_for_pitch(pa_data)

    # ── Step 4: Weighted average across pitch types ──────────────────────────
    # Exclude pitch types with zero data from the weighting, re-normalize
    active_pts = {
        pt for pt, m in per_pitch_metrics.items()
        if any(v > 0 for v in m.values())
    }
    if not active_pts:
        result["data_quality"] = "NO_BATTER_DATA"
        # Still compute pitcher score below
    else:
        # Re-normalize weights to only include active pitch types
        active_weights = {pt: pitch_weights.get(pt, 0) for pt in active_pts}
        w_total = sum(active_weights.values())
        if w_total > 0:
            active_weights = {pt: w / w_total for pt, w in active_weights.items()}

        # Map from calc names -> result dict names
        calc_to_result = {
            "avg_exit_velo": "weighted_exit_velo",
            "barrel_rate": "weighted_barrel_rate",
            "fly_ball_rate": "weighted_fb_rate",
            "hard_hit_rate": "weighted_hard_hit_rate",
        }
        for calc_key, result_key in calc_to_result.items():
            weighted_val = sum(
                per_pitch_metrics[pt][calc_key] * active_weights[pt]
                for pt in active_pts
            )
            result[result_key] = weighted_val

    # ── Step 4b: Blend recent metrics with 2025 season baseline ────────────
    # Early in the season, recent data is noisy. Use 2025 as a stabilizer.
    # Weight shifts from 70% season / 30% recent (early) to 30% season / 70% recent (mid-season)
    baseline = calc_season_baseline(season_df, pitcher_hand)
    if baseline["has_data"]:
        # Count total BIP in recent data to determine blend weight
        recent_bip = 0
        if not batter_df.empty:
            hand_mask = batter_df["p_throws"] == pitcher_hand if "p_throws" in batter_df.columns else True
            bip_mask = batter_df["launch_speed"].notna()
            recent_bip = int((hand_mask & bip_mask).sum()) if not isinstance(hand_mask, bool) else int(bip_mask.sum())

        # More recent BIP = trust recent data more
        # 0 BIP = 50% season, 15+ BIP = 100% recent (no 2025)
        season_weight = max(0.0, 0.50 - (recent_bip / 30))
        recent_weight = 1.0 - season_weight

        blend_map = {
            "weighted_exit_velo": "avg_exit_velo",
            "weighted_barrel_rate": "barrel_rate",
            "weighted_fb_rate": "fly_ball_rate",
            "weighted_hard_hit_rate": "hard_hit_rate",
        }
        for result_key, baseline_key in blend_map.items():
            recent_val = result[result_key]
            season_val = baseline[baseline_key]
            result[result_key] = recent_val * recent_weight + season_val * season_weight

    # ── Step 5: Normalize and weight batter metrics ──────────────────────────
    batter_metric_map = {
        "weighted_exit_velo": "avg_exit_velo",
        "weighted_barrel_rate": "barrel_rate",
        "weighted_fb_rate": "fly_ball_rate",
        "weighted_hard_hit_rate": "hard_hit_rate",
    }
    batter_score = 0.0
    for result_key, config_key in batter_metric_map.items():
        raw = result[result_key]
        normed = normalize_metric(raw, config_key)
        batter_score += normed * config.BATTER_WEIGHTS[config_key]
    result["batter_score"] = batter_score

    # ── Step 6: Pitcher vulnerability metrics ────────────────────────────────
    # Use 2026 data, but fall back to 2025 season data if pitcher has < 10 IP
    p_metrics = calc_pitcher_metrics(pitcher_df, batter_hand)

    # If pitcher has thin 2026 data, blend with 2025 season stats
    if p_metrics["total_ip"] < 10 and pitcher_season_df is not None and not pitcher_season_df.empty:
        p_2025 = calc_pitcher_metrics(pitcher_season_df, batter_hand)
        if p_2025["total_ip"] > 20:
            # Blend: weight by IP ratio. More 2026 IP = more trust in 2026
            w_2026 = p_metrics["total_ip"] / 10  # 0 to 1
            w_2025 = 1 - w_2026
            for key in ["fb_rate_allowed", "hr_per_fb_rate", "hr_per_ip", "total_hrs_norm"]:
                p_metrics[key] = p_metrics[key] * w_2026 + p_2025[key] * w_2025

    result["pitcher_fb_rate"] = p_metrics["fb_rate_allowed"]
    result["pitcher_hr_fb_rate"] = p_metrics["hr_per_fb_rate"]
    result["pitcher_hr_per_9"] = p_metrics["hr_per_ip"]
    result["pitcher_total_hrs"] = p_metrics["total_hrs"]
    result["pitcher_ip"] = p_metrics["total_ip"]

    pitcher_score = 0.0
    pitcher_metric_map = {
        "fb_rate_allowed": p_metrics["fb_rate_allowed"],
        "hr_per_fb_rate": p_metrics["hr_per_fb_rate"],
        "hr_per_ip": p_metrics["hr_per_ip"],
        "total_hrs_norm": p_metrics["total_hrs_norm"],
    }
    for metric_key, weight in config.PITCHER_WEIGHTS.items():
        raw = pitcher_metric_map[metric_key]
        normed = normalize_metric(raw, metric_key)
        pitcher_score += normed * weight

    # Floor pitcher score at 0.5 (league average) when data is too thin
    # to make a reliable assessment — prevents unknown pitchers from
    # dragging hot batters to the bottom of the rankings
    if p_metrics["total_ip"] < 10:
        pitcher_score = max(pitcher_score, 0.5)

    result["pitcher_score"] = pitcher_score

    # ── Step 7: Environment factor ──────────────────────────────────────────
    env_score = 0.5  # neutral default
    if env_data:
        env_score = env_data.get("env_score", 0.5)
        result["environment"] = env_data
    result["env_score"] = env_score

    # ── Step 7b: Matchup quality from season data ─────────────────────────
    # How does this batter's ISO/SLG/HR look against the specific pitch types
    # this pitcher throws? Weighted by pitch mix.
    matchup_score = 0.5  # neutral default
    if season_df is not None and not season_df.empty and pitch_mix:
        from metrics import calc_pitch_type_stats
        season_vs_hand = season_df[season_df["p_throws"] == pitcher_hand] if "p_throws" in season_df.columns else season_df
        if not season_vs_hand.empty:
            season_stats = calc_pitch_type_stats(season_vs_hand, "p_throws", pitcher_hand)

            # For each pitch type in the pitcher's mix, get the batter's ISO/SLG/HR
            weighted_iso = 0.0
            weighted_slg = 0.0
            weighted_hr_rate = 0.0
            weighted_whiff = 0.0
            total_weight = 0.0

            for pt, wt in pitch_weights.items():
                if pt in season_stats:
                    s = season_stats[pt]
                    weighted_iso += s["iso"] * wt
                    weighted_slg += s["slg"] * wt
                    # HR rate: HRs per at-bat for this pitch type
                    hr_rate = s["hr"] / max(s["count"], 1) * 100
                    weighted_hr_rate += hr_rate * wt
                    weighted_whiff += s["whiff_pct"] * wt
                    total_weight += wt

            if total_weight > 0:
                weighted_iso /= total_weight
                weighted_slg /= total_weight
                weighted_hr_rate /= total_weight
                weighted_whiff /= total_weight

                # Normalize each to 0-1
                iso_norm = float(np.clip((weighted_iso - 0.05) / (0.30 - 0.05), 0, 1))
                slg_norm = float(np.clip((weighted_slg - 0.25) / (0.60 - 0.25), 0, 1))
                hr_norm = float(np.clip(weighted_hr_rate / 3.0, 0, 1))  # 3% HR rate = elite
                # Whiff is inverted — lower whiff = better matchup
                whiff_norm = float(np.clip(1.0 - (weighted_whiff / 40.0), 0, 1))

                # Matchup quality: ISO-heavy since we care about power
                matchup_score = (
                    0.40 * iso_norm
                    + 0.25 * slg_norm
                    + 0.20 * hr_norm
                    + 0.15 * whiff_norm
                )

    result["matchup_score"] = matchup_score

    # ── Step 7c: Composite ───────────────────────────────────────────────────
    result["composite_score"] = (
        config.BATTER_COMPOSITE_WEIGHT * batter_score
        + config.MATCHUP_QUALITY_WEIGHT * matchup_score
        + config.PITCHER_COMPOSITE_WEIGHT * pitcher_score
        + config.ENVIRONMENT_COMPOSITE_WEIGHT * env_score
    )

    # Count total balls in play for confidence
    total_bip = 0
    if not batter_df.empty:
        hand_mask = batter_df["p_throws"] == pitcher_hand
        bip_mask = batter_df["launch_speed"].notna()
        total_bip = int((hand_mask & bip_mask).sum())
    result["total_bip"] = total_bip

    # Softer confidence penalty — season blend already handles noise
    if total_bip >= 10:
        confidence = 1.0
    elif total_bip >= 5:
        confidence = 0.95
    elif total_bip >= 1:
        confidence = 0.85
    else:
        confidence = 0.50

    result["confidence"] = confidence
    result["composite_score"] *= confidence

    # Data quality flag
    if result["data_quality"] == "NO_BATTER_DATA" or result["data_quality"] == "NO_PITCH_DATA":
        result["data_quality"] = "NO_DATA"
    elif total_bip < 5:
        result["data_quality"] = "LOW_SAMPLE"
    elif low_sample:
        result["data_quality"] = "LOW_SAMPLE"
    if p_metrics["total_ip"] < 10:
        result["data_quality"] = "LOW_PITCHER_IP"

    # ── Step 8: Collect per-pitch-type recent AB detail ──────────────────────
    # PropFinder-style: individual at-bat rows for each pitch type
    recent_abs = []
    for pt in pitch_mix:
        pa_data = filter_pa_by_pitch_type_and_hand(
            batter_df, pt, pitcher_hand, effective_n_pa
        )
        if pa_data.empty:
            continue
        bip = pa_data.dropna(subset=["launch_speed"])
        for _, row in bip.iterrows():
            recent_abs.append({
                "date": str(row.get("game_date", ""))[:10],
                "pitcher_name": str(row.get("player_name", "")),
                "pitch_arm": pitcher_hand,
                "pitch_type": str(row.get("pitch_name", pt)),
                "ev": round(float(row.get("launch_speed", 0)), 1),
                "angle": round(float(row.get("launch_angle", 0)), 1),
                "distance": round(float(row.get("hit_distance_sc", 0)), 0)
                    if pd.notna(row.get("hit_distance_sc")) else None,
                "result": str(row.get("events", row.get("description", ""))),
            })
    # Sort by date descending
    recent_abs.sort(key=lambda x: x["date"], reverse=True)
    result["recent_abs"] = recent_abs

    # Per-pitch aggregate stats (like PropFinder's Statcast tab)
    pitch_detail = {}
    for pt in pitch_mix:
        m = per_pitch_metrics.get(pt, {})
        pitch_detail[pt] = {
            "usage_pct": round(pitch_mix[pt] * 100, 1),
            "weight": round(pitch_weights.get(pt, 0) * 100, 1),
            "barrel_rate": round(m.get("barrel_rate", 0) * 100, 1),
            "fb_rate": round(m.get("fly_ball_rate", 0) * 100, 1),
            "hard_hit_rate": round(m.get("hard_hit_rate", 0) * 100, 1),
            "avg_exit_velo": round(m.get("avg_exit_velo", 0), 1),
        }
    result["pitch_detail"] = pitch_detail

    return result
