"""
Raw metric calculations from Statcast pitch-level DataFrames.
"""

import pandas as pd
import numpy as np
import requests

import config

# Statcast event sets used by build_pitcher_profile
_OUT_EVENTS = {
    "strikeout", "field_out", "force_out", "grounded_into_double_play",
    "double_play", "triple_play", "fielders_choice", "fielders_choice_out",
    "sac_fly", "sac_bunt", "sac_fly_double_play",
}
_HIT_EVENTS = {"single", "double", "triple", "home_run"}
_BB_EVENTS = {"walk", "intent_walk"}
_SWING_DESCRIPTIONS = {
    "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
    "hit_into_play", "missed_bunt", "foul_bunt",
}
_WHIFF_DESCRIPTIONS = {"swinging_strike", "swinging_strike_blocked", "foul_tip"}

# Friendly pitch-type names for the UI
_PITCH_NAMES = {
    "FF": "Four-Seam", "FT": "Two-Seam", "FC": "Cutter", "SI": "Sinker",
    "SL": "Slider", "ST": "Sweeper", "SV": "Slurve", "CU": "Curveball",
    "KC": "Knuckle-Curve", "CH": "Changeup", "FS": "Splitter", "FO": "Forkball",
    "EP": "Eephus", "KN": "Knuckleball", "SC": "Screwball",
}


# wOBA weights (FanGraphs 2024 — close enough for current-season directional comparison)
_WOBA_WEIGHTS = {
    "walk": 0.696, "intent_walk": 0.696, "hit_by_pitch": 0.728,
    "single": 0.882, "double": 1.244, "triple": 1.569, "home_run": 2.005,
}


def build_pitcher_profile(pitcher_df: pd.DataFrame, pitcher_id: int = None,
                           season: int = 2026) -> dict:
    """Compute pitcher's full 2026 stat table — Season / vsLHB / vsRHB rows
    with all the columns the UI table needs (IP, BF, BAA, wOBA, SLG, ISO,
    WHIP, HR, HR/9, BB%, Whiff%, K%, Meatball%, Barrel%, HH%, FB%, HR/FB%,
    PullAir%). Plus the pitcher's arsenal.

    Returns:
        {
          "rows": {"season": {...}, "vs_L": {...}, "vs_R": {...}},
          "arsenal": [{type, name, usage_pct, avg_velo, avg_spin, whiff_pct, count}, ...],
          "wins": int, "losses": int, "games_started": int,
        }

    Each row has the same shape; missing fields → None and the UI renders "—".
    """
    out: dict = {
        "rows": {
            "season": _empty_row(),
            "vs_L": _empty_row(),
            "vs_R": _empty_row(),
        },
        "arsenal": [],
        "wins": 0,
        "losses": 0,
        "games_started": 0,
    }

    # Pull season W/L from MLB Stats API (Statcast doesn't have these)
    if pitcher_id is not None:
        try:
            url = (f"https://statsapi.mlb.com/api/v1/people/{pitcher_id}/stats"
                   f"?stats=season&group=pitching&season={season}")
            resp = requests.get(url, timeout=8)
            if resp.ok:
                splits = resp.json().get("stats", [{}])[0].get("splits", [])
                if splits:
                    s = splits[0].get("stat", {})
                    out["wins"] = int(s.get("wins", 0) or 0)
                    out["losses"] = int(s.get("losses", 0) or 0)
                    out["games_started"] = int(s.get("gamesStarted", 0) or 0)
        except Exception:
            pass

    if pitcher_df is None or len(pitcher_df) == 0:
        return out

    df = pitcher_df

    # Compute season + per-hand splits from the same df
    out["rows"]["season"] = _compute_row(df)
    if "stand" in df.columns:
        out["rows"]["vs_L"] = _compute_row(df[df["stand"] == "L"])
        out["rows"]["vs_R"] = _compute_row(df[df["stand"] == "R"])

    # Arsenal
    if "pitch_type" in df.columns and len(df) > 0:
        total = len(df)
        arsenal = []
        for pt, group in df.groupby("pitch_type"):
            if pd.isna(pt) or pt == "":
                continue
            n = len(group)
            velo = group["release_speed"].dropna() if "release_speed" in group.columns else pd.Series(dtype=float)
            spin = group["release_spin_rate"].dropna() if "release_spin_rate" in group.columns else pd.Series(dtype=float)
            desc = group["description"] if "description" in group.columns else pd.Series(dtype=object)
            n_swings = int(desc.isin(_SWING_DESCRIPTIONS).sum())
            n_whiffs = int(desc.isin(_WHIFF_DESCRIPTIONS).sum())
            arsenal.append({
                "type": pt,
                "name": _PITCH_NAMES.get(pt, pt),
                "usage_pct": round(n / total * 100, 1),
                "avg_velo": round(float(velo.mean()), 1) if len(velo) > 0 else None,
                "avg_spin": int(round(float(spin.mean()))) if len(spin) > 0 else None,
                "whiff_pct": round(n_whiffs / n_swings * 100, 1) if n_swings > 0 else 0.0,
                "count": n,
            })
        arsenal.sort(key=lambda a: a["usage_pct"], reverse=True)
        out["arsenal"] = arsenal

    return out


def _empty_row() -> dict:
    return {
        "ip": None, "bf": 0, "baa": None, "woba": None, "slg": None, "iso": None,
        "whip": None, "hr": 0, "hr_per_9": None,
        "bb_pct": None, "whiff_pct": None, "k_pct": None, "meatball_pct": None,
        "barrel_pct": None, "hard_hit_pct": None, "fb_pct": None,
        "hr_fb_pct": None, "pullair_pct": None,
    }


def _compute_row(df: pd.DataFrame) -> dict:
    """Compute one row of the pitcher stat table from a Statcast pitch-level df.
    df may be the full season or a hand-filtered subset.
    """
    row = _empty_row()
    if df is None or len(df) == 0:
        return row

    has_events = "events" in df.columns
    evt = df["events"].dropna() if has_events else pd.Series(dtype=object)
    n_pa = len(evt)
    if n_pa == 0:
        return row

    # Outs → IP
    n_outs = int(evt.isin(_OUT_EVENTS).sum())
    # strikeout shows up in _OUT_EVENTS too — count once
    ip = n_outs / 3.0

    # PA / BF (excluding catcher's interference, ignored for our purposes)
    bf = int(n_pa)

    # Counts
    n_k = int((evt == "strikeout").sum())
    n_bb = int(evt.isin(_BB_EVENTS).sum())
    n_hbp = int((evt == "hit_by_pitch").sum())
    n_sf = int((evt == "sac_fly").sum())
    n_singles = int((evt == "single").sum())
    n_doubles = int((evt == "double").sum())
    n_triples = int((evt == "triple").sum())
    n_hr = int((evt == "home_run").sum())
    n_hits = n_singles + n_doubles + n_triples + n_hr
    n_ab = max(n_pa - n_bb - n_hbp - n_sf, 0)

    # BAA / SLG / ISO
    baa = round(n_hits / n_ab, 3) if n_ab > 0 else None
    total_bases = n_singles + 2 * n_doubles + 3 * n_triples + 4 * n_hr
    slg = round(total_bases / n_ab, 3) if n_ab > 0 else None
    iso = round(slg - baa, 3) if (slg is not None and baa is not None) else None

    # wOBA against
    woba_num = (
        _WOBA_WEIGHTS["walk"] * n_bb
        + _WOBA_WEIGHTS["hit_by_pitch"] * n_hbp
        + _WOBA_WEIGHTS["single"] * n_singles
        + _WOBA_WEIGHTS["double"] * n_doubles
        + _WOBA_WEIGHTS["triple"] * n_triples
        + _WOBA_WEIGHTS["home_run"] * n_hr
    )
    woba_denom = n_ab + n_bb + n_hbp + n_sf
    woba = round(woba_num / woba_denom, 3) if woba_denom > 0 else None

    # WHIP — (BB + H) / IP
    whip = round((n_bb + n_hits) / ip, 2) if ip > 0 else None

    # HR/9
    hr_per_9 = round(n_hr * 9 / ip, 2) if ip > 0 else None

    # BB% / K% — % of plate appearances
    bb_pct = round(n_bb / n_pa * 100, 1)
    k_pct = round(n_k / n_pa * 100, 1)

    # Strike-zone metrics — over all pitches in df, not just PAs
    desc = df["description"] if "description" in df.columns else pd.Series(dtype=object)
    n_swings = int(desc.isin(_SWING_DESCRIPTIONS).sum())
    n_whiffs = int(desc.isin(_WHIFF_DESCRIPTIONS).sum())
    whiff_pct = round(n_whiffs / n_swings * 100, 1) if n_swings > 0 else None

    # Meatball% — pitches in Heart of zone (or zone 5 fallback)
    if "attack_zone" in df.columns:
        n_heart = int((df["attack_zone"] == "Heart").sum())
        meatball_pct = round(n_heart / len(df) * 100, 1)
    elif "zone" in df.columns:
        n_mid = int((df["zone"] == 5).sum())
        meatball_pct = round(n_mid / len(df) * 100, 1)
    else:
        meatball_pct = None

    # Statcast contact-quality metrics (over BIP)
    bip = df[df["bb_type"].notna()] if "bb_type" in df.columns else df.iloc[0:0]
    n_bip = len(bip)
    if n_bip > 0:
        n_fb_bip = int((bip["bb_type"] == "fly_ball").sum())
        ev = bip["launch_speed"].dropna() if "launch_speed" in bip.columns else pd.Series(dtype=float)
        n_hard = int((ev >= 95).sum()) if len(ev) > 0 else 0
        if "launch_speed_angle" in bip.columns:
            n_barrels = int((bip["launch_speed_angle"] == 6).sum())
        else:
            la = bip["launch_angle"] if "launch_angle" in bip.columns else None
            if la is not None and len(ev) > 0:
                barrel_mask = (bip["launch_speed"] >= 98) & (la.between(26, 30))
                n_barrels = int(barrel_mask.sum())
            else:
                n_barrels = 0
        barrel_pct = round(n_barrels / n_bip * 100, 1)
        hard_hit_pct = round(n_hard / n_bip * 100, 1)
        fb_pct = round(n_fb_bip / n_bip * 100, 1)
        hr_fb_pct = round(n_hr / n_fb_bip * 100, 1) if n_fb_bip > 0 else 0.0
        # PullAir%: pulled fly balls + line drives (LA >= 10) over BIP.
        # Statcast spray-angle proxy via hc_x/hc_y. Use the standard formula:
        #   spray_angle_deg = atan2((hc_x - 125.42), (198.27 - hc_y)) * 180/pi
        # Pulled = abs(spray) > 15 AND sign matches batter handedness:
        #   RHB pulled → spray < -15 (LF side); LHB pulled → spray > 15 (RF side).
        if {"hc_x", "hc_y", "stand", "launch_angle"}.issubset(bip.columns):
            try:
                hc_x = bip["hc_x"].astype(float)
                hc_y = bip["hc_y"].astype(float)
                spray = np.degrees(np.arctan2(hc_x - 125.42, 198.27 - hc_y))
                stand = bip["stand"]
                la = bip["launch_angle"].astype(float)
                pulled_mask = (
                    ((stand == "R") & (spray < -15)) | ((stand == "L") & (spray > 15))
                )
                air_mask = la >= 10
                n_pullair = int((pulled_mask & air_mask).sum())
                pullair_pct = round(n_pullair / n_bip * 100, 1)
            except Exception:
                pullair_pct = None
        else:
            pullair_pct = None
    else:
        barrel_pct = hard_hit_pct = fb_pct = hr_fb_pct = pullair_pct = None

    row.update({
        "ip": round(ip, 1),
        "bf": bf,
        "baa": baa,
        "woba": woba,
        "slg": slg,
        "iso": iso,
        "whip": whip,
        "hr": n_hr,
        "hr_per_9": hr_per_9,
        "bb_pct": bb_pct,
        "whiff_pct": whiff_pct,
        "k_pct": k_pct,
        "meatball_pct": meatball_pct,
        "barrel_pct": barrel_pct,
        "hard_hit_pct": hard_hit_pct,
        "fb_pct": fb_pct,
        "hr_fb_pct": hr_fb_pct,
        "pullair_pct": pullair_pct,
    })
    return row


def _to_float(value, default=None):
    if value is None or value == "" or value == "-.--":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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


# ── Head-to-head BvP raw PA history ─────────────────────────────────────
# Used by the "Team vs Pitch Mix" tab: emit raw per-PA rows so the frontend
# can aggregate any (Season × Range × Type × PitchType) slice dynamically.

# FanGraphs 2024 wOBA linear weights. Hard-coded constant.
_WOBA_WEIGHTS = {
    "walk": 0.69,
    "hit_by_pitch": 0.72,
    "single": 0.88,
    "double": 1.25,
    "triple": 1.58,
    "home_run": 2.03,
}
_BASES = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
_HIT_EVENTS = {"single", "double", "triple", "home_run"}
_NON_AB_EVENTS = {"walk", "hit_by_pitch", "sac_fly", "sac_bunt", "intent_walk",
                  "catcher_interf", "sac_fly_double_play"}
_K_EVENTS = {"strikeout", "strikeout_double_play"}


def build_batter_pa_history(
    batter_df: pd.DataFrame,
    max_rows: int = 300,
) -> list[dict]:
    """Emit per-PA history for a batter across ALL pitchers faced.

    Each row tags the pitcher's hand (p_throws) so the frontend can
    filter to vs All / vs RHP / vs LHP. Powers the "Team vs Pitch Mix"
    tab's Season/Range/Type/PitcherHand/SelectedPitchTypes filter matrix.

    Rows are sorted newest first and capped at `max_rows` (default 300)
    per call — enough to satisfy L25 Games × ~4 PAs/game with headroom
    while keeping slate JSON size bounded.

    Fields:
        date, season, pitcher_hand ("R"|"L"), pitch_type (str | None),
        pitches_seen, is_bbe, ev, la, is_barrel, is_hard_hit,
        result, bases, woba_value.
    """
    if batter_df is None or batter_df.empty:
        return []
    df = batter_df.copy()

    # Count pitches-seen per PA (game_pk + at_bat_number uniquely identifies a PA)
    if "at_bat_number" in df.columns and "game_pk" in df.columns:
        pitches_per_pa = (
            df.groupby(["game_pk", "at_bat_number"]).size().to_dict()
        )
    else:
        pitches_per_pa = {}

    # Keep only terminating pitches of each PA (events non-null)
    ev_rows = df[df["events"].notna()].copy()
    if ev_rows.empty:
        return []

    # Sort newest first. Tiebreak by at_bat_number (descending) so same-day
    # PAs are in true reverse-chronological order — critical for L{N} PA
    # filters to return the actual most-recent N PAs rather than a random
    # subset of the most-recent day's PAs.
    sort_keys = []
    ascending = []
    if "game_date" in ev_rows.columns:
        sort_keys.append("game_date"); ascending.append(False)
    if "at_bat_number" in ev_rows.columns:
        sort_keys.append("at_bat_number"); ascending.append(False)
    if sort_keys:
        ev_rows = ev_rows.sort_values(by=sort_keys, ascending=ascending)

    # Cap to most recent N PAs to keep slate JSON size bounded
    if len(ev_rows) > max_rows:
        ev_rows = ev_rows.head(max_rows)

    out: list[dict] = []
    for row in ev_rows.itertuples(index=False):
        result = getattr(row, "events", None)
        if result is None:
            continue
        result = str(result)

        date_val = getattr(row, "game_date", None)
        if isinstance(date_val, pd.Timestamp):
            date_str = date_val.strftime("%Y-%m-%d")
        elif date_val is None:
            continue
        else:
            date_str = str(date_val)[:10]
        try:
            season = int(date_str[:4])
        except (ValueError, TypeError):
            continue

        ls = getattr(row, "launch_speed", None)
        la = getattr(row, "launch_angle", None)
        ls_val = float(ls) if ls is not None and not pd.isna(ls) else None
        la_val = float(la) if la is not None and not pd.isna(la) else None
        is_bbe = ls_val is not None

        # Barrel: launch_speed_angle == 6 (Statcast definition)
        lsa = getattr(row, "launch_speed_angle", None)
        is_barrel = False
        if lsa is not None and not pd.isna(lsa):
            try:
                is_barrel = int(lsa) == int(getattr(config, "BARREL_VALUE", 6))
            except (ValueError, TypeError):
                is_barrel = False

        is_hard_hit = bool(ls_val is not None and ls_val >= config.HARD_HIT_THRESHOLD)

        # PA-level counts
        pk = getattr(row, "game_pk", None)
        abn = getattr(row, "at_bat_number", None)
        pitches_seen = int(pitches_per_pa.get((pk, abn), 1)) if pk is not None and abn is not None else 1

        pitch_type = getattr(row, "pitch_type", None)
        if pitch_type is None or pd.isna(pitch_type):
            pitch_type_str = None
        else:
            pitch_type_str = str(pitch_type)

        # Pitcher hand (for vs All/RHP/LHP filter)
        p_throws = getattr(row, "p_throws", None)
        if p_throws is None or pd.isna(p_throws):
            pitcher_hand = None
        else:
            pitcher_hand = str(p_throws).upper()[:1]
            if pitcher_hand not in ("R", "L"):
                pitcher_hand = None

        bases = _BASES.get(result, 0)
        woba_value = _WOBA_WEIGHTS.get(result, 0.0)

        bat_speed = getattr(row, "bat_speed", None)
        bat_speed_val = (
            round(float(bat_speed), 1)
            if bat_speed is not None and not pd.isna(bat_speed) else None
        )

        out.append({
            "date": date_str,
            "season": season,
            "pitcher_hand": pitcher_hand,
            "pitch_type": pitch_type_str,
            "pitches_seen": pitches_seen,
            "is_bbe": is_bbe,
            "ev": round(ls_val, 1) if ls_val is not None else None,
            "la": round(la_val, 1) if la_val is not None else None,
            "bat_speed": bat_speed_val,
            "is_barrel": bool(is_barrel),
            "is_hard_hit": is_hard_hit,
            "result": result,
            "bases": bases,
            "woba_value": round(float(woba_value), 2),
        })

    return out
