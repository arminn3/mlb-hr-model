"""
Raw metric calculations from Statcast pitch-level DataFrames.
"""

import pandas as pd
import numpy as np

import config


def get_pitch_mix(
    pitcher_df: pd.DataFrame, batter_hand: str,
    pitcher_season_df: pd.DataFrame = None,
) -> dict[str, float]:
    """
    Calculate pitch type usage percentages for a pitcher vs a specific batter
    handedness. Blends recent data with 2025 season data early in the season.
    Filters out pitches below PITCH_MIN_USAGE_PCT and re-normalizes.

    Returns dict: pitch_type code -> usage fraction (0.0-1.0), sums to 1.0.
    """
    def _calc_mix(df: pd.DataFrame) -> tuple[dict[str, float], int]:
        """Helper: compute raw mix from a DataFrame. Returns (mix_dict, total_pitches)."""
        if df is None or df.empty:
            return {}, 0
        filtered = df[df["stand"] == batter_hand].copy() if "stand" in df.columns else df.copy()
        if filtered.empty:
            return {}, 0
        filtered = filtered.dropna(subset=["pitch_type"])
        if filtered.empty:
            return {}, 0
        counts = filtered["pitch_type"].value_counts()
        total = counts.sum()
        if total == 0:
            return {}, 0
        return (counts / total).to_dict(), int(total)

    recent_mix, recent_total = _calc_mix(pitcher_df)
    season_mix, season_total = _calc_mix(pitcher_season_df)

    # Blend recent + season based on how many recent pitches we have
    # 200+ recent pitches (~3 starts) = trust recent fully
    # 0 recent pitches = use season entirely
    if recent_total >= 200:
        mix = recent_mix
    elif recent_total == 0:
        mix = season_mix
    elif season_total == 0:
        mix = recent_mix
    else:
        # Blend: more recent pitches = more weight on recent
        recent_weight = min(recent_total / 200, 1.0)
        season_weight = 1.0 - recent_weight

        # Combine all pitch types from both
        all_types = set(recent_mix.keys()) | set(season_mix.keys())
        mix = {}
        for pt in all_types:
            r_val = recent_mix.get(pt, 0) * recent_weight
            s_val = season_mix.get(pt, 0) * season_weight
            mix[pt] = r_val + s_val

    if not mix:
        return {}

    # Filter out pitches below minimum usage threshold
    mix = {pt: pct for pt, pct in mix.items() if pct >= config.PITCH_MIN_USAGE_PCT}

    # Re-normalize so remaining pitches sum to 1.0
    total_remaining = sum(mix.values())
    if total_remaining == 0:
        return {}
    mix = {pt: pct / total_remaining for pt, pct in mix.items()}

    return mix


def get_pitch_weights(pitch_mix: dict[str, float]) -> dict[str, float]:
    """
    Convert pitch usage fractions into scoring weights using tiered multipliers.

    Tiers (checked top-down, first match wins):
      - 45%+ usage → 2.0x (dominant pitch — batter will see it most)
      - 25-44% usage → 1.3x (significant pitch — can't ignore it)
      - 12-24% usage → 1.0x (baseline)
      - <12% → already dropped by get_pitch_mix()

    Normalize so weights sum to 1.0.
    """
    if not pitch_mix:
        return {}

    raw_weights = {}
    for pt, usage in pitch_mix.items():
        multiplier = 1.0
        for threshold, mult in config.PITCH_WEIGHT_TIERS:
            if usage >= threshold:
                multiplier = mult
                break
        raw_weights[pt] = usage * multiplier

    total = sum(raw_weights.values())
    if total == 0:
        return {}

    return {pt: w / total for pt, w in raw_weights.items()}


def filter_pa_by_pitch_type_and_hand(
    batter_df: pd.DataFrame,
    pitch_type: str,
    pitcher_hand: str,
    n_pa: int = None,
) -> pd.DataFrame:
    """
    Get the last N balls in play of a specific pitch type from a specific
    handedness pitcher.

    Key: "last N" means the N most recent pitches of this type that were
    actually put in play (have exit velocity), not just the last N plate
    appearances. This matches how PropFinder counts — balls in play only.
    """
    if n_pa is None:
        n_pa = config.MIN_PA_PER_PITCH_TYPE

    if batter_df.empty:
        return pd.DataFrame()

    # Filter to matching pitcher hand and pitch type
    mask = (
        (batter_df["p_throws"] == pitcher_hand)
        & (batter_df["pitch_type"] == pitch_type)
    )
    filtered = batter_df[mask].copy()

    if filtered.empty:
        return pd.DataFrame()

    # Only keep balls in play (have exit velocity)
    bip = filtered.dropna(subset=["launch_speed"])

    if bip.empty:
        return pd.DataFrame()

    # Sort by date descending
    bip = bip.sort_values(
        ["game_date", "at_bat_number"] if "at_bat_number" in bip.columns else ["game_date"],
        ascending=False,
    )

    # Take the last N balls in play
    return bip.head(n_pa)


def calc_batter_metrics_for_pitch(pa_pitches: pd.DataFrame) -> dict[str, float]:
    """
    From pitch-level rows (one pitch type, one handedness), compute batter metrics.

    Returns:
        avg_exit_velo, barrel_rate, fly_ball_rate, hard_hit_rate
    All as raw values (not normalized). Returns 0.0 for all if no balls in play.
    """
    defaults = {
        "avg_exit_velo": 0.0,
        "barrel_rate": 0.0,
        "fly_ball_rate": 0.0,
        "hard_hit_rate": 0.0,
    }

    if pa_pitches.empty:
        return defaults

    # Balls in play = rows where launch_speed is not NaN
    bip = pa_pitches.dropna(subset=["launch_speed"])
    if bip.empty:
        return defaults

    n_bip = len(bip)

    # Average exit velocity
    avg_ev = bip["launch_speed"].mean()

    # Barrel rate: launch_speed_angle == 6 is a barrel
    if "launch_speed_angle" in bip.columns:
        barrels = (bip["launch_speed_angle"] == config.BARREL_VALUE).sum()
    else:
        # Fallback: use barrel column if it exists (some datasets use 0/1)
        barrels = bip.get("barrel", pd.Series(dtype=float)).fillna(0).astype(bool).sum()
    barrel_rate = barrels / n_bip

    # Fly ball rate: launch angle 25-50° (excludes popups which are 50°+)
    if "launch_angle" in bip.columns:
        fly_balls = (
            (bip["launch_angle"] >= config.FLY_BALL_LA_MIN)
            & (bip["launch_angle"] <= config.FLY_BALL_LA_MAX)
        ).sum()
    else:
        fly_balls = 0
    fly_ball_rate = fly_balls / n_bip

    # Hard hit rate: exit velo >= 95 mph AND launch angle > 0° (exclude popups/grounders)
    # A 96 EV popup at 66° or grounder at -10° has zero HR potential
    if "launch_angle" in bip.columns:
        hard_hits = (
            (bip["launch_speed"] >= config.HARD_HIT_THRESHOLD)
            & (bip["launch_angle"] > 0)
            & (bip["launch_angle"] <= 50)
        ).sum()
    else:
        hard_hits = (bip["launch_speed"] >= config.HARD_HIT_THRESHOLD).sum()
    hard_hit_rate = hard_hits / n_bip

    return {
        "avg_exit_velo": float(avg_ev),
        "barrel_rate": float(barrel_rate),
        "fly_ball_rate": float(fly_ball_rate),
        "hard_hit_rate": float(hard_hit_rate),
    }


def calc_pitcher_metrics(
    pitcher_df: pd.DataFrame, batter_hand: str
) -> dict[str, float]:
    """
    Compute pitcher metrics split by batter handedness.

    Returns:
        fb_rate_allowed, hr_per_fb_rate, hr_per_ip, total_hrs, total_ip,
        total_hrs_norm (normalized 0-1 based on IP context)
    """
    defaults = {
        "fb_rate_allowed": 0.0,
        "hr_per_fb_rate": 0.0,
        "hr_per_ip": 0.0,
        "total_hrs": 0,
        "total_ip": 0.0,
        "total_hrs_norm": 0.0,
    }

    if pitcher_df.empty:
        return defaults

    df = pitcher_df[pitcher_df["stand"] == batter_hand].copy()
    if df.empty:
        return defaults

    # Balls in play
    bip = df.dropna(subset=["launch_speed"])

    # Fly balls — use Statcast bb_type classification (matches FanGraphs)
    # Falls back to launch angle range if bb_type not available
    if not bip.empty and "bb_type" in bip.columns:
        fly_mask = bip["bb_type"] == "fly_ball"
        n_fly = fly_mask.sum()
        fb_rate = n_fly / len(bip) if len(bip) > 0 else 0.0
    elif not bip.empty and "launch_angle" in bip.columns:
        fly_mask = (
            (bip["launch_angle"] >= config.FLY_BALL_LA_MIN)
            & (bip["launch_angle"] <= config.FLY_BALL_LA_MAX)
        )
        n_fly = fly_mask.sum()
        fb_rate = n_fly / len(bip) if len(bip) > 0 else 0.0
    else:
        n_fly = 0
        fb_rate = 0.0

    # Home runs
    if "events" in df.columns:
        hr_mask = df["events"] == "home_run"
        total_hrs = int(hr_mask.sum())
    else:
        total_hrs = 0

    # HR / FB rate
    hr_per_fb = total_hrs / n_fly if n_fly > 0 else 0.0

    # Innings pitched estimation from PA-ending events
    # Events column is non-null when a PA ends
    if "events" in df.columns:
        pa_ending = df["events"].dropna()
        # Count outs: anything that's not a hit, walk, HBP, error, etc.
        hit_events = {
            "single", "double", "triple", "home_run",
            "walk", "hit_by_pitch", "intent_walk",
            "catcher_interf",
        }
        outs = sum(1 for e in pa_ending if e not in hit_events)
        total_ip = outs / 3.0
    else:
        total_ip = 0.0

    # HR per 9 innings
    hr_per_ip = (total_hrs / total_ip * 9.0) if total_ip > 0 else 0.0

    # Normalized HR count (HR per IP as a density, then scale)
    total_hrs_norm = min(total_hrs / max(total_ip, 1.0), 1.0)

    return {
        "fb_rate_allowed": float(fb_rate),
        "hr_per_fb_rate": float(hr_per_fb),
        "hr_per_ip": float(hr_per_ip),
        "total_hrs": total_hrs,
        "total_ip": float(total_ip),
        "total_hrs_norm": float(total_hrs_norm),
    }


def calc_pitch_type_stats(
    df: pd.DataFrame, split_col: str, split_val: str
) -> dict[str, dict]:
    """
    Full-season pitch-type aggregation (PropFinder-style).

    Args:
        df: Statcast DataFrame (pitcher or batter)
        split_col: column to filter on — 'stand' for pitcher splits, 'p_throws' for batter splits
        split_val: 'L' or 'R'

    Returns per pitch type: type_name, count, usage_pct, ba, slg, iso, woba, hr, k_pct, whiff_pct
    """
    if df.empty:
        return {}

    filtered = df[df[split_col] == split_val] if split_col in df.columns else df
    if filtered.empty:
        return {}

    filtered = filtered.dropna(subset=["pitch_type"])
    total_pitches = len(filtered)
    if total_pitches == 0:
        return {}

    _NON_AB_EVENTS = {"walk", "hit_by_pitch", "intent_walk", "catcher_interf",
                       "sac_fly", "sac_bunt", "sac_fly_double_play", "sac_bunt_double_play"}
    _HIT_EVENTS = {"single", "double", "triple", "home_run"}
    _BASES = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
    _SWING_DESCRIPTIONS = {"swinging_strike", "swinging_strike_blocked",
                            "foul", "foul_tip", "hit_into_play",
                            "hit_into_play_no_out", "hit_into_play_score",
                            "foul_bunt", "missed_bunt"}

    result = {}

    for pt, pt_df in filtered.groupby("pitch_type"):
        count = len(pt_df)
        usage_pct = (count / total_pitches) * 100

        # Get human-readable name
        type_name = pt
        if "pitch_name" in pt_df.columns:
            names = pt_df["pitch_name"].dropna()
            if not names.empty:
                type_name = names.mode().iloc[0]

        # PA-ending rows only (events is not null)
        pa_df = pt_df[pt_df["events"].notna()]
        n_pa = len(pa_df)

        # At-bats (exclude walks, HBP, sac, etc.)
        ab_mask = ~pa_df["events"].isin(_NON_AB_EVENTS)
        n_ab = ab_mask.sum()

        # Hits and total bases
        hits = pa_df["events"].isin(_HIT_EVENTS).sum()
        total_bases = sum(_BASES.get(e, 0) for e in pa_df["events"])

        ba = hits / n_ab if n_ab > 0 else 0.0
        slg = total_bases / n_ab if n_ab > 0 else 0.0
        iso = slg - ba

        # wOBA (use Statcast columns directly)
        woba_val = pt_df["woba_value"].sum() if "woba_value" in pt_df.columns else 0
        woba_den = pt_df["woba_denom"].sum() if "woba_denom" in pt_df.columns else 0
        woba = woba_val / woba_den if woba_den > 0 else 0.0

        # HRs
        hrs = (pa_df["events"] == "home_run").sum()

        # K%
        strikeouts = (pa_df["events"] == "strikeout").sum()
        k_pct = (strikeouts / n_pa * 100) if n_pa > 0 else 0.0

        # Whiff%
        if "description" in pt_df.columns:
            swinging_strikes = pt_df["description"].isin(
                {"swinging_strike", "swinging_strike_blocked"}
            ).sum()
            swings = pt_df["description"].isin(_SWING_DESCRIPTIONS).sum()
            whiff_pct = (swinging_strikes / swings * 100) if swings > 0 else 0.0
        else:
            whiff_pct = 0.0

        result[str(pt)] = {
            "type_name": str(type_name),
            "count": int(count),
            "usage_pct": round(float(usage_pct), 1),
            "ba": round(float(ba), 3),
            "slg": round(float(slg), 3),
            "iso": round(float(iso), 3),
            "woba": round(float(woba), 3),
            "hr": int(hrs),
            "k_pct": round(float(k_pct), 1),
            "whiff_pct": round(float(whiff_pct), 1),
        }

    return result
