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
        "weighted_ld_rate": 0.0,
        "weighted_gb_rate": 0.0,
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
    # When the pitcher has no Statcast history (rookie debut, etc.), pitch_mix
    # is empty — but we still score the batter off their own profile instead
    # of returning zeros. matchup_score stays at its neutral 0.5 default;
    # pitcher_score floors at 0.5 (Step 6); batter_score + env_score do all
    # the work. data_quality flag tells the UI to warn the user.
    pitch_mix = get_pitch_mix(pitcher_df, batter_hand, pitcher_season_df)
    arsenal_unknown = not pitch_mix
    if arsenal_unknown:
        result["data_quality"] = "NO_PITCH_DATA"
        pitch_weights: dict[str, float] = {}
        result["pitch_types_used"] = []
    else:
        pitch_weights = get_pitch_weights(pitch_mix)
        result["pitch_types_used"] = list(pitch_mix.keys())

    # ── Step 3: Get batter's last N total BIP vs pitcher handedness ────────
    # Like PropFinder: take the last 5 (or 10) balls in play total,
    # then weight metrics by pitcher's pitch mix from within that pool.
    effective_n_bip = n_pa or config.MIN_PA_PER_PITCH_TYPE
    low_sample = False
    per_pitch_metrics: dict[str, dict] = {}

    # Get last N BIP vs this pitcher hand, filtered to pitcher's pitch types
    # If pitcher has ST (sweeper) but no SL (slider), add SL to search —
    # PropFinder shows both in arsenal and batters face both interchangeably
    pitcher_pitch_types = set(pitch_mix.keys())
    if "ST" in pitcher_pitch_types and "SL" not in pitcher_pitch_types:
        pitcher_pitch_types.add("SL")
    if "SL" in pitcher_pitch_types and "ST" not in pitcher_pitch_types:
        pitcher_pitch_types.add("ST")
    recent_bip = pd.DataFrame()
    if not batter_df.empty and "p_throws" in batter_df.columns:
        hand_mask = batter_df["p_throws"] == pitcher_hand
        bip_mask = batter_df["launch_speed"].notna()
        event_mask = batter_df["events"].notna() if "events" in batter_df.columns else True
        # If the pitcher arsenal is unknown, don't filter by pitch type — fall
        # back to all BIP vs same-hand pitchers so batter_score still reflects
        # real recent production.
        if pitcher_pitch_types and "pitch_type" in batter_df.columns:
            pitch_mask = batter_df["pitch_type"].isin(pitcher_pitch_types)
        else:
            pitch_mask = True
        recent_bip = batter_df[hand_mask & bip_mask & event_mask & pitch_mask].copy()
        if not recent_bip.empty:
            sort_cols = ["game_date", "at_bat_number"] if "at_bat_number" in recent_bip.columns else ["game_date"]
            recent_bip = recent_bip.sort_values(sort_cols, ascending=False).head(effective_n_bip)

    # Backfill from 2025 season data if not enough BIP in 2026
    # PropFinder does this — goes back to last season when recent data is thin
    if len(recent_bip) < effective_n_bip and season_df is not None and not season_df.empty:
        needed = effective_n_bip - len(recent_bip)
        s_hand = season_df["p_throws"] == pitcher_hand if "p_throws" in season_df.columns else True
        s_bip = season_df["launch_speed"].notna()
        s_event = season_df["events"].notna() if "events" in season_df.columns else True
        if pitcher_pitch_types and "pitch_type" in season_df.columns:
            s_pitch = season_df["pitch_type"].isin(pitcher_pitch_types)
        else:
            s_pitch = True
        season_bip = season_df[s_hand & s_bip & s_event & s_pitch].copy()
        if not season_bip.empty:
            s_sort = ["game_date", "at_bat_number"] if "at_bat_number" in season_bip.columns else ["game_date"]
            season_bip = season_bip.sort_values(s_sort, ascending=False).head(needed)
            recent_bip = pd.concat([recent_bip, season_bip], ignore_index=True)
            # Ensure exactly N BIP after backfill
            recent_bip = recent_bip.head(effective_n_bip)

    if recent_bip.empty:
        result["data_quality"] = "NO_BATTER_DATA"
        low_sample = True
    else:
        if len(recent_bip) < effective_n_bip:
            low_sample = True

        # ── Step 4: Pitch-usage-weighted batter metrics ──────────────────────
        # EV/barrel/FB/HH are weighted by how often the pitcher throws each pitch.
        # Painter's FF at 47% vs LHBs means Soderstrom's FF stats get 47% weight,
        # not an equal share. Pool metrics serve as fallback for pitches with no BIP.
        recent_bip = recent_bip.head(effective_n_bip)
        pool_metrics = calc_batter_metrics_for_pitch(recent_bip)

        # Extra display stats from this lookback's BIP pool
        _n_bip = len(recent_bip)
        result["bip_count"] = _n_bip
        if _n_bip > 0:
            if "estimated_woba_using_speedangle" in recent_bip.columns:
                _xw = recent_bip["estimated_woba_using_speedangle"].dropna()
                result["xwoba"] = round(float(_xw.mean()), 3) if len(_xw) > 0 else 0.0
            else:
                result["xwoba"] = 0.0
            if "launch_angle" in recent_bip.columns:
                _sweet = (recent_bip["launch_angle"] >= 8) & (recent_bip["launch_angle"] <= 32)
                result["sweet_spot"] = round(float(_sweet.sum() / _n_bip * 100), 1)
            else:
                result["sweet_spot"] = 0.0
            if {"hc_x", "hc_y", "stand", "launch_speed_angle"}.issubset(recent_bip.columns):
                _sub = recent_bip.dropna(subset=["hc_x", "hc_y"])
                if len(_sub) > 0:
                    _spray = np.degrees(np.arctan2(_sub["hc_x"].astype(float) - 125.42, 198.27 - _sub["hc_y"].astype(float)))
                    _pulled = ((_sub["stand"] == "R") & (_spray < -15)) | ((_sub["stand"] == "L") & (_spray > 15))
                    _barrel = _sub["launch_speed_angle"] == 6
                    result["pull_brl"] = round(float((_pulled & _barrel).sum() / _n_bip * 100), 1)
                else:
                    result["pull_brl"] = 0.0
            else:
                result["pull_brl"] = 0.0
        else:
            result["xwoba"] = 0.0
            result["sweet_spot"] = 0.0
            result["pull_brl"] = 0.0

        # Per-pitch metrics — need ≥3 BIP to trust; otherwise fall back to pool avg.
        # 1-2 BIP per pitch type is pure noise (2 GBs on FF ≠ "can't hit fastballs").
        for pt in pitch_mix:
            pt_codes = {pt}
            if pt == "ST": pt_codes.add("SL")
            if pt == "SL": pt_codes.add("ST")
            pt_rows = recent_bip[recent_bip["pitch_type"].isin(pt_codes)] if "pitch_type" in recent_bip.columns else pd.DataFrame()
            per_pitch_metrics[pt] = calc_batter_metrics_for_pitch(pt_rows) if len(pt_rows) >= 3 else pool_metrics

        # Default to pool; override with pitch-weighted blend when weights exist
        result["weighted_exit_velo"]     = pool_metrics["avg_exit_velo"]
        result["weighted_barrel_rate"]   = pool_metrics["barrel_rate"]
        result["weighted_fb_rate"]       = pool_metrics["fly_ball_rate"]
        result["weighted_ld_rate"]       = pool_metrics["line_drive_rate"]
        result["weighted_gb_rate"]       = pool_metrics["ground_ball_rate"]
        result["weighted_hard_hit_rate"] = pool_metrics["hard_hit_rate"]

        if pitch_weights:
            w_ev = w_brl = w_fb = w_hh = w_ld = w_gb = total_w = 0.0
            for pt, wt in pitch_weights.items():
                m = per_pitch_metrics.get(pt, pool_metrics)
                w_ev  += wt * m["avg_exit_velo"]
                w_brl += wt * m["barrel_rate"]
                w_fb  += wt * m["fly_ball_rate"]
                w_hh  += wt * m["hard_hit_rate"]
                w_ld  += wt * m.get("line_drive_rate", pool_metrics["line_drive_rate"])
                w_gb  += wt * m.get("ground_ball_rate", pool_metrics["ground_ball_rate"])
                total_w += wt
            if total_w > 0:
                result["weighted_exit_velo"]     = w_ev  / total_w
                result["weighted_barrel_rate"]   = w_brl / total_w
                result["weighted_fb_rate"]       = w_fb  / total_w
                result["weighted_hard_hit_rate"] = w_hh  / total_w
                result["weighted_ld_rate"]       = w_ld  / total_w
                result["weighted_gb_rate"]       = w_gb  / total_w

    # ── Step 5: Normalize and weight batter metrics ──────────────────────────
    # Score from the same metrics the user sees — no hidden numbers
    batter_metric_map = {
        "weighted_exit_velo": "avg_exit_velo",
        "weighted_barrel_rate": "barrel_rate",
        "weighted_fb_rate": "fly_ball_rate",
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

    # If pitcher has thin 2026 data, blend with 2025 season stats.
    # Threshold raised to 50 IP — at 9 IP in April, we should trust
    # 2025 heavily (Castillo: 23 HR in 180 IP in 2025 but 0 HR in 9 IP
    # in 2026 → old code gave 92% weight to the 9 IP, rating him as
    # HR-proof when he's actually very hittable).
    blended_with_2025 = False
    if p_metrics["total_ip"] < 50 and pitcher_season_df is not None and not pitcher_season_df.empty:
        p_2025 = calc_pitcher_metrics(pitcher_season_df, batter_hand)
        if p_2025["total_ip"] > 20:
            # Blend: linear ramp from 0-50 IP. At 9 IP → 82% trust in 2025.
            # At 25 IP → 50/50. At 50 IP → full trust in 2026.
            w_2026 = p_metrics["total_ip"] / 50  # 0 to 1
            w_2025 = 1 - w_2026
            for key in ["fb_rate_allowed", "hr_per_fb_rate", "hr_per_ip", "total_hrs_norm"]:
                p_metrics[key] = p_metrics[key] * w_2026 + p_2025[key] * w_2025
            blended_with_2025 = True

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

    # Floor pitcher score at 0.5 only when we have NO reliable data at all
    # Don't apply if we successfully blended with 2025 season data
    if p_metrics["total_ip"] < 10 and not blended_with_2025:
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
    matchup_swstr = 0.0  # weighted batter whiff% vs pitcher's mix (display only)
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
                    # HR rate: HRs per plate appearance for this pitch type
                    hr_rate = s["hr"] / max(s.get("n_pa", s["count"]), 1) * 100
                    weighted_hr_rate += hr_rate * wt
                    weighted_whiff += s["whiff_pct"] * wt
                    total_weight += wt

            if total_weight > 0:
                weighted_iso /= total_weight
                weighted_slg /= total_weight
                weighted_hr_rate /= total_weight
                weighted_whiff /= total_weight
                matchup_swstr = round(float(weighted_whiff), 1)

                # Normalize each to 0-1
                iso_norm = float(np.clip((weighted_iso - 0.05) / (0.30 - 0.05), 0, 1))
                slg_norm = float(np.clip((weighted_slg - 0.25) / (0.60 - 0.25), 0, 1))
                hr_norm = float(np.clip(weighted_hr_rate / 8.0, 0, 1))  # 8% HR/PA = elite
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
    result["matchup_swstr"] = matchup_swstr

    # ── Step 7c: Composite ───────────────────────────────────────────────────
    composite = (
        config.BATTER_COMPOSITE_WEIGHT * batter_score
        + config.MATCHUP_QUALITY_WEIGHT * matchup_score
        + config.PITCHER_COMPOSITE_WEIGHT * pitcher_score
        + config.ENVIRONMENT_COMPOSITE_WEIGHT * env_score
    )

    # Batter score gatekeeper — weak bats can't ride a vulnerable pitcher into top rankings
    # If batter_score < 0.30, cap composite at 0.40 regardless of pitcher/env
    if batter_score < 0.30:
        composite = min(composite, 0.40)

    result["composite_score"] = composite

    # Count total balls in play for confidence
    total_bip = 0
    if not batter_df.empty:
        hand_mask = batter_df["p_throws"] == pitcher_hand
        bip_mask = batter_df["launch_speed"].notna()
        total_bip = int((hand_mask & bip_mask).sum())
    result["total_bip"] = total_bip

    # Confidence penalty — small samples produce unreliable metrics
    # 15+ BIP = full confidence, scales down linearly
    if total_bip >= 15:
        confidence = 1.0
    elif total_bip >= 10:
        confidence = 0.90
    elif total_bip >= 7:
        confidence = 0.80
    elif total_bip >= 4:
        confidence = 0.65
    elif total_bip >= 1:
        confidence = 0.50
    else:
        confidence = 0.35

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

    # ── Step 8: Collect recent AB detail from the same BIP pool (with 2025 backfill) ──
    recent_abs = []
    _n = n_pa or config.MIN_PA_PER_PITCH_TYPE
    _recent_pool = pd.DataFrame()
    if not batter_df.empty and "p_throws" in batter_df.columns:
        _hand_mask = batter_df["p_throws"] == pitcher_hand
        _bip_mask = batter_df["launch_speed"].notna()
        _event_mask = batter_df["events"].notna() if "events" in batter_df.columns else True
        # If pitcher arsenal is unknown, fall back to all BIP vs same-hand so
        # recent_abs still populates (ML Rankings' reliability multiplier
        # otherwise zeros the batter out).
        if pitcher_pitch_types and "pitch_type" in batter_df.columns:
            _pitch_mask = batter_df["pitch_type"].isin(pitcher_pitch_types)
        else:
            _pitch_mask = True
        _recent_pool = batter_df[_hand_mask & _bip_mask & _event_mask & _pitch_mask].copy()
        if not _recent_pool.empty:
            _sort_cols = ["game_date", "at_bat_number"] if "at_bat_number" in _recent_pool.columns else ["game_date"]
            _recent_pool = _recent_pool.sort_values(_sort_cols, ascending=False).head(_n)
    # Backfill from 2025 for display too
    if len(_recent_pool) < _n and season_df is not None and not season_df.empty:
        _needed = _n - len(_recent_pool)
        _s_hand = season_df["p_throws"] == pitcher_hand if "p_throws" in season_df.columns else True
        _s_bip = season_df["launch_speed"].notna()
        _s_event = season_df["events"].notna() if "events" in season_df.columns else True
        if pitcher_pitch_types and "pitch_type" in season_df.columns:
            _s_pitch = season_df["pitch_type"].isin(pitcher_pitch_types)
        else:
            _s_pitch = True
        _s_pool = season_df[_s_hand & _s_bip & _s_event & _s_pitch].copy()
        if not _s_pool.empty:
            _s_sort = ["game_date", "at_bat_number"] if "at_bat_number" in _s_pool.columns else ["game_date"]
            _s_pool = _s_pool.sort_values(_s_sort, ascending=False).head(_needed)
            _recent_pool = pd.concat([_recent_pool, _s_pool], ignore_index=True)
    if not _recent_pool.empty:
        for _, row in _recent_pool.iterrows():
            recent_abs.append({
                "date": str(row.get("game_date", ""))[:10],
                "pitcher_name": str(row.get("player_name", "")),
                "pitch_arm": pitcher_hand,
                "pitch_type": str(row.get("pitch_name", row.get("pitch_type", ""))),
                "ev": round(float(row.get("launch_speed", 0)), 1),
                "angle": round(float(row.get("launch_angle", 0)), 1),
                "distance": round(float(row.get("hit_distance_sc", 0)), 0)
                    if pd.notna(row.get("hit_distance_sc")) else None,
                "result": str(row.get("events", row.get("description", ""))),
            })
    # Sort by date descending
    recent_abs.sort(key=lambda x: x["date"], reverse=True)
    result["recent_abs"] = recent_abs

    # Per-pitch-type recent ABs — last 10 BIP per pitch type (supports L5 and L10 views)
    # Backfills from 2025 if not enough 2026 data
    pitch_abs: dict[str, list] = {}

    def _get_hand_bip(df):
        if df is None or df.empty or "p_throws" not in df.columns:
            return pd.DataFrame()
        filtered = df[
            (df["p_throws"] == pitcher_hand) &
            (df["launch_speed"].notna()) &
            (df["events"].notna() if "events" in df.columns else True)
        ].copy()
        if not filtered.empty:
            s = ["game_date", "at_bat_number"] if "at_bat_number" in filtered.columns else ["game_date"]
            filtered = filtered.sort_values(s, ascending=False)
        return filtered

    hand_bip_2026 = _get_hand_bip(batter_df)
    hand_bip_2025 = _get_hand_bip(season_df)

    # pitch_detail_metrics[pt] = calc_batter_metrics_for_pitch(all_pt) computed
    # inside the loop below while the DataFrame is still available.
    pitch_detail_metrics: dict[str, dict] = {}

    if not hand_bip_2026.empty or not hand_bip_2025.empty:
        for pt in pitch_mix:
            # Match ST<->SL
            pt_codes = {pt}
            if pt == "ST": pt_codes.add("SL")
            if pt == "SL": pt_codes.add("ST")

            # Get from 2026 first
            pt_rows_26 = hand_bip_2026[hand_bip_2026["pitch_type"].isin(pt_codes)].head(10) if not hand_bip_2026.empty and "pitch_type" in hand_bip_2026.columns else pd.DataFrame()

            # Backfill from 2025 if needed
            pt_rows_25 = pd.DataFrame()
            if len(pt_rows_26) < 10 and not hand_bip_2025.empty and "pitch_type" in hand_bip_2025.columns:
                needed = 10 - len(pt_rows_26)
                pt_rows_25 = hand_bip_2025[hand_bip_2025["pitch_type"].isin(pt_codes)].head(needed)

            all_pt = pd.concat([pt_rows_26, pt_rows_25]) if not pt_rows_25.empty else pt_rows_26
            if not all_pt.empty:
                # Compute display stats from the same rows shown in pitch_abs.
                # This avoids the mismatch where per_pitch_metrics used recent_bip
                # (last-N total BIP) and could return all zeros for a pitch type
                # that wasn't in the last N total BIP.
                pitch_detail_metrics[pt] = calc_batter_metrics_for_pitch(all_pt)

                pt_list = []
                for _, row in all_pt.iterrows():
                    pt_list.append({
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
                pitch_abs[pt] = pt_list
    result["pitch_abs"] = pitch_abs

    # Per-pitch whiff% from all pitches (not just BIP): use batter_df then season_df as fallback
    _whiff_by_type: dict[str, float] = {}
    _swing_descs = {"swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
                    "hit_into_play", "hit_into_play_score", "hit_into_play_no_out"}
    _whiff_descs = {"swinging_strike", "swinging_strike_blocked"}
    for _src_df in [batter_df, season_df]:
        if _src_df is None or _src_df.empty: continue
        if not {"p_throws", "pitch_type", "description"}.issubset(_src_df.columns): continue
        _hdf = _src_df[_src_df["p_throws"] == pitcher_hand]
        if _hdf.empty: continue
        for _pt in pitch_mix:
            if _pt in _whiff_by_type: continue
            _pt_codes = {_pt}
            if _pt == "ST": _pt_codes.add("SL")
            if _pt == "SL": _pt_codes.add("ST")
            _pt_rows = _hdf[_hdf["pitch_type"].isin(_pt_codes)]
            _n_swings = int(_pt_rows["description"].isin(_swing_descs).sum())
            _n_whiffs = int(_pt_rows["description"].isin(_whiff_descs).sum())
            if _n_swings >= 5:  # require min 5 swings — 1-2 whiffs = 100% is noise
                _whiff_by_type[_pt] = round(float(_n_whiffs / _n_swings * 100), 1)

    # Recompute matchup_swstr from _whiff_by_type (reliable: min 5 swings, uses 2026+2025 data)
    # Overrides the season-stats value computed in step 7b which can hit 100% on tiny samples
    if pitch_weights:
        _ww = _wtotal = 0.0
        for _pt, _wt in pitch_weights.items():
            if _pt in _whiff_by_type:
                _ww += _whiff_by_type[_pt] * _wt
                _wtotal += _wt
        if _wtotal > 0:
            result["matchup_swstr"] = round(_ww / _wtotal, 1)

    # Per-pitch aggregate stats — sourced from pitch_detail_metrics which is
    # computed from the same per-type DataFrames used for pitch_abs (not from
    # the last-N total BIP pool, which could miss pitch types entirely).
    pitch_detail = {}
    for pt in pitch_mix:
        m = pitch_detail_metrics.get(pt, {})
        n_pt = len(pitch_abs.get(pt, []))
        pitch_detail[pt] = {
            "usage_pct": round(pitch_mix[pt] * 100, 1),
            "weight": round(pitch_weights.get(pt, 0) * 100, 1),
            "barrel_rate": round(m.get("barrel_rate", 0) * 100, 1),
            "fb_rate": round(m.get("fly_ball_rate", 0) * 100, 1),
            "ld_rate": round(m.get("line_drive_rate", 0) * 100, 1),
            "gb_rate": round(m.get("ground_ball_rate", 0) * 100, 1),
            "hard_hit_rate": round(m.get("hard_hit_rate", 0) * 100, 1),
            "avg_exit_velo": round(m.get("avg_exit_velo", 0), 1),
            "avg_launch_angle": round(m.get("avg_launch_angle", 0), 1),
            "count": n_pt,
            "whiff_pct": _whiff_by_type.get(pt, 0.0),
        }
    result["pitch_detail"] = pitch_detail

    return result
