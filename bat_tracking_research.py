#!/usr/bin/env python3
"""
Bat-Tracking Stats — HR Predictiveness Research

Answers four questions from cached 2015-2026 Statcast parquets:
  1. Which metrics best predict HR rate, controlling for league HR-rate drift?
  2. Are they sustainable within a season (1H → 2H predictive)?
  3. Are they stable year-over-year (2024 → 2025)?
  4. Which 2026 hitters are "lucky" (actual HR ≫ xHR) vs "unlucky"?

Metrics evaluated:
  Barrel %, Exit Velo, Hard-Hit %, FB % (already in our model)
  Bat Speed (mph), Fast Swing % (bat_speed ≥ 75) — new, 2024+
  Pull+FB % (derived from hc_x/hc_y) — new, thin coverage (~17%)

Output:
  cache/batter_seasons.parquet  — per-batter-season aggregates (reusable)
  cache/bat_tracking_research.json — full findings
  Console summary
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

# ── Constants (mirror config.py so our numbers match the live model) ─────
BARREL_VALUE = 6
HARD_HIT_THRESHOLD = 95.0        # mph EV
FLY_BALL_LA_MIN = 25             # degrees
FLY_BALL_LA_MAX = 50
FAST_SWING_MPH = 75.0             # Statcast "fast swing" threshold
PULL_HC_X_THRESHOLD = 50.0        # feet off center; sign determined by batter stance
IDEAL_AA_MIN = 5.0                # Statcast "ideal attack angle" range: 5-25°
IDEAL_AA_MAX = 25.0
BARREL_HR_CONVERSION = 0.60       # league: barrels become HRs at ~60% rate (HRp calibration)

MIN_PA = 100                      # batter-season min-PA filter
MIN_PA_LEADERBOARD = 50           # early-season: filter at 50 PAs so leaderboard isn't empty

_ROOT = Path(__file__).resolve().parent
_CACHE = _ROOT / "cache"
_AGG_OUT = _CACHE / "batter_seasons.parquet"      # intermediate, gitignored
_REPORT_OUT = _ROOT / "bat_tracking_research.json"  # deliverable, committed


# ── 1. Per-batter-season aggregator ──────────────────────────────────────
def _is_pulled(hc_x: pd.Series, stand: pd.Series) -> pd.Series:
    """Pulled = hit sent toward the batter's pull side.
       RHB pull = hc_x > +threshold (hit to left field)
       LHB pull = hc_x < -threshold (hit to right field)
       Note: Statcast hc_x origin is home plate; +x = 3B/LF side from overhead view."""
    rhb = (stand == "R") & (hc_x > PULL_HC_X_THRESHOLD)
    lhb = (stand == "L") & (hc_x < -PULL_HC_X_THRESHOLD)
    return rhb | lhb


def aggregate_batter_season(df: pd.DataFrame, season: int) -> pd.DataFrame:
    """Emit one row per batter with ≥MIN_PA plate appearances.
       Input: raw pitch-level Statcast for one season."""
    # PA = row where event fires (terminal pitch)
    pa_rows = df[df["events"].notna()].copy()
    if pa_rows.empty:
        return pd.DataFrame()

    # Batted-ball events (BBE) = PA with launch data
    bbe = pa_rows[pa_rows["launch_speed"].notna()].copy()

    # Per-batter PA + HR
    pa_counts = pa_rows.groupby("batter").size().rename("pa")
    hr_counts = (pa_rows["events"] == "home_run").groupby(pa_rows["batter"]).sum().rename("hr")

    # Per-batter BBE-based metrics
    # Barrel: launch_speed_angle == 6
    # Use fillna(False) + astype(int) to avoid nullable-int conversion issues
    bbe["_barrel"] = (bbe.get("launch_speed_angle", pd.Series(dtype=float)).eq(BARREL_VALUE).fillna(False)).astype(int)
    bbe["_hard_hit"] = (
        (bbe["launch_speed"] >= HARD_HIT_THRESHOLD)
        & (bbe["launch_angle"] > 0)
        & (bbe["launch_angle"] <= 50)
    ).fillna(False).astype(int)
    bbe["_fb"] = (
        (bbe["launch_angle"] >= FLY_BALL_LA_MIN)
        & (bbe["launch_angle"] <= FLY_BALL_LA_MAX)
    ).fillna(False).astype(int)

    # Pull + FB (derived; only rows with hc_x populated)
    bbe["_has_hc"] = bbe.get("hc_x", pd.Series(dtype=float)).notna()
    if "hc_x" in bbe.columns:
        bbe["_pull_fb"] = (
            _is_pulled(bbe["hc_x"], bbe["stand"]).fillna(False)
            & bbe["_fb"].astype(bool)
        ).fillna(False).astype(int)
    else:
        bbe["_pull_fb"] = 0

    # Aggregates
    grp = bbe.groupby("batter")
    barrel_pct = grp["_barrel"].mean().rename("barrel_pct")
    hard_hit_pct = grp["_hard_hit"].mean().rename("hard_hit_pct")
    fb_pct = grp["_fb"].mean().rename("fb_pct")
    exit_velo = grp["launch_speed"].mean().rename("exit_velo")
    avg_launch_angle = grp["launch_angle"].mean().rename("avg_launch_angle")
    n_bbe = grp.size().rename("n_bbe")

    # HRp-parity metrics
    if "hit_distance_sc" in bbe.columns:
        avg_distance = grp["hit_distance_sc"].mean().rename("avg_distance")
    else:
        avg_distance = pd.Series(dtype=float, name="avg_distance")
    if "estimated_slg_using_speedangle" in bbe.columns:
        xslg = grp["estimated_slg_using_speedangle"].mean().rename("xslg")
    else:
        xslg = pd.Series(dtype=float, name="xslg")
    if "estimated_woba_using_speedangle" in bbe.columns:
        xwoba = grp["estimated_woba_using_speedangle"].mean().rename("xwoba")
    else:
        xwoba = pd.Series(dtype=float, name="xwoba")

    # FB Exit Velo — EV on fly balls only
    fb_only = bbe[bbe["_fb"] == 1]
    fb_ev = fb_only.groupby("batter")["launch_speed"].mean().rename("fb_ev") if not fb_only.empty else pd.Series(dtype=float, name="fb_ev")

    # HR/FB — HR count per FB count
    hr_fb = bbe[(bbe["events"] == "home_run") & (bbe["_fb"] == 1)].groupby("batter").size().rename("n_hr_fb")

    # Barrels count (for Bar xHR)
    barrels_count = grp["_barrel"].sum().rename("n_barrels")

    # Pure Pull % — % of BBE pulled (any LA)
    if "hc_x" in bbe.columns:
        pulled_any = _is_pulled(bbe["hc_x"], bbe["stand"]).fillna(False)
        bbe["_pull"] = pulled_any.astype(int)
        pull_bbe_full = bbe[bbe["_has_hc"]]
        if not pull_bbe_full.empty:
            pull_pct = pull_bbe_full.groupby("batter")["_pull"].mean().rename("pull_pct")
        else:
            pull_pct = pd.Series(dtype=float, name="pull_pct")
    else:
        pull_pct = pd.Series(dtype=float, name="pull_pct")

    # Pull+FB: among BBE with hc_x available only
    pull_bbe = bbe[bbe["_has_hc"]]
    if not pull_bbe.empty:
        pull_grp = pull_bbe.groupby("batter")
        pull_fb_pct = pull_grp["_pull_fb"].mean().rename("pull_fb_pct")
        n_bbe_with_hc = pull_grp.size().rename("n_bbe_with_hc")
    else:
        pull_fb_pct = pd.Series(dtype=float, name="pull_fb_pct")
        n_bbe_with_hc = pd.Series(dtype=int, name="n_bbe_with_hc")

    # Bat-tracking (swings with bat_speed populated)
    swings = df[df.get("bat_speed", pd.Series(dtype=float)).notna()].copy()
    if not swings.empty:
        swings["_fast"] = (swings["bat_speed"] >= FAST_SWING_MPH).astype(int)
        sgrp = swings.groupby("batter")
        bat_speed = sgrp["bat_speed"].mean().rename("bat_speed")
        fast_swing_pct = sgrp["_fast"].mean().rename("fast_swing_pct")
        swing_length = sgrp["swing_length"].mean().rename("swing_length") if "swing_length" in swings.columns else None
        n_swings_with_bs = sgrp.size().rename("n_swings_with_bat_speed")
        # Attack angle + Ideal AA %
        if "attack_angle" in swings.columns:
            attack_angle = sgrp["attack_angle"].mean().rename("attack_angle")
            swings["_ideal_aa"] = (
                (swings["attack_angle"] >= IDEAL_AA_MIN)
                & (swings["attack_angle"] <= IDEAL_AA_MAX)
            ).fillna(False).astype(int)
            ideal_aa_pct = sgrp["_ideal_aa"].mean().rename("ideal_aa_pct")
        else:
            attack_angle = pd.Series(dtype=float, name="attack_angle")
            ideal_aa_pct = pd.Series(dtype=float, name="ideal_aa_pct")
    else:
        bat_speed = pd.Series(dtype=float, name="bat_speed")
        fast_swing_pct = pd.Series(dtype=float, name="fast_swing_pct")
        swing_length = None
        n_swings_with_bs = pd.Series(dtype=int, name="n_swings_with_bat_speed")
        attack_angle = pd.Series(dtype=float, name="attack_angle")
        ideal_aa_pct = pd.Series(dtype=float, name="ideal_aa_pct")

    # Name lookup: Statcast's player_name column is the PITCHER; we need
    # the batter's name, which we'll resolve later via MLB Stats API. For
    # now carry batter_id only.

    # Assemble
    parts = [pa_counts, hr_counts, n_bbe, barrel_pct, exit_velo, avg_launch_angle,
             fb_pct, hard_hit_pct,
             bat_speed, fast_swing_pct, pull_fb_pct, pull_pct,
             avg_distance, xslg, xwoba, fb_ev, hr_fb, barrels_count,
             attack_angle, ideal_aa_pct,
             n_bbe_with_hc, n_swings_with_bs]
    if swing_length is not None:
        parts.append(swing_length)
    result = pd.concat(parts, axis=1)
    result["hr_rate"] = result["hr"] / result["pa"]
    # Bar xHR — barrels × league-average barrel→HR conversion (~60%)
    result["bar_xhr"] = result["n_barrels"].fillna(0) * BARREL_HR_CONVERSION
    result["bar_diff"] = result["hr"] - result["bar_xhr"]
    # HR/FB rate
    result["hr_per_fb"] = result["n_hr_fb"].fillna(0) / (result["fb_pct"] * result["n_bbe"]).replace(0, pd.NA)
    result["season"] = season
    result = result.reset_index().rename(columns={"batter": "batter_id"})
    # Force numeric dtypes — defends against mixed-type quirks from Statcast Int64
    num_cols = ["pa", "hr", "n_bbe", "barrel_pct", "exit_velo", "avg_launch_angle",
                "fb_pct", "hard_hit_pct",
                "bat_speed", "fast_swing_pct", "pull_fb_pct", "pull_pct",
                "avg_distance", "xslg", "xwoba", "fb_ev", "n_hr_fb", "n_barrels",
                "attack_angle", "ideal_aa_pct",
                "n_bbe_with_hc", "n_swings_with_bat_speed", "hr_rate",
                "bar_xhr", "bar_diff", "hr_per_fb"]
    for c in num_cols:
        if c in result.columns:
            result[c] = pd.to_numeric(result[c], errors="coerce")

    # Don't filter here — callers apply season-specific PA floors.
    # (2024/2025: ≥100 PA for training; 2026: ≥50 for early-season leaderboard.)
    return result


def _load_year(year: int) -> Optional[pd.DataFrame]:
    """Load a year's Statcast. Prefers the cached parquet; falls back to
       the in-memory bulk cache for the current season (2026) which doesn't
       have a saved parquet yet."""
    path = _CACHE / f"statcast_{year}.parquet"
    if path.exists():
        print(f"  loading {year} from parquet...", flush=True)
        return pd.read_parquet(path)
    # Fallback: current season bulk cache
    try:
        from data_fetchers import load_bulk_statcast
    except Exception:
        return None
    print(f"  loading {year} from bulk cache (data_fetchers.load_bulk_statcast)...", flush=True)
    df = load_bulk_statcast()
    if df is None or df.empty:
        return None
    # Filter to the requested year
    gd = pd.to_datetime(df["game_date"])
    df_y = df[gd.dt.year == year].copy()
    return df_y if not df_y.empty else None


def build_all_seasons(years: list[int]) -> pd.DataFrame:
    """Aggregate every year into one big table. Loads parquets from cache/
       (falls back to bulk cache for the current season)."""
    frames = []
    for y in years:
        df = _load_year(y)
        if df is None or df.empty:
            print(f"  skip {y}: no data available", file=sys.stderr)
            continue
        if "game_type" in df.columns:
            df = df[df["game_type"] == "R"]
        agg = aggregate_batter_season(df, y)
        print(f"    {y}: {len(agg):,} batter-seasons @ ≥{MIN_PA} PA", flush=True)
        frames.append(agg)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


# ── Name resolution (MLB Stats API, batch) ───────────────────────────────
def resolve_names(batter_ids: list[int]) -> dict[int, str]:
    """Batch-lookup MLB player names via /api/v1/people?personIds=..."""
    import requests
    out: dict[int, str] = {}
    if not batter_ids:
        return out
    for i in range(0, len(batter_ids), 100):
        chunk = batter_ids[i:i+100]
        ids_str = ",".join(str(x) for x in chunk)
        url = f"https://statsapi.mlb.com/api/v1/people?personIds={ids_str}"
        try:
            r = requests.get(url, timeout=15)
            data = r.json()
            for p in data.get("people", []):
                out[int(p["id"])] = p.get("fullName", "?")
        except Exception as exc:
            print(f"    name lookup failed for chunk {i}: {exc}", file=sys.stderr)
    return out


# ── 2. Correlations ──────────────────────────────────────────────────────
def pearson_r(x: np.ndarray, y: np.ndarray) -> tuple[float, int]:
    """Pearson r + n used, skipping NaN pairs."""
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    n = len(x)
    if n < 3:
        return float("nan"), n
    sx = x.std(ddof=1); sy = y.std(ddof=1)
    if sx == 0 or sy == 0:
        return 0.0, n
    r = float(np.mean((x - x.mean()) * (y - y.mean())) / (sx * sy))
    r = r * n / (n - 1)  # sample r adjustment
    return r, n


def spearman_rho(x: np.ndarray, y: np.ndarray) -> tuple[float, int]:
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    n = len(x)
    if n < 3:
        return float("nan"), n
    rx = pd.Series(x).rank().values
    ry = pd.Series(y).rank().values
    return pearson_r(rx, ry)[0], n


def fisher_ci(r: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% CI on Pearson r via Fisher z-transform."""
    if n < 4 or not np.isfinite(r) or abs(r) >= 1:
        return (float("nan"), float("nan"))
    z_r = 0.5 * math.log((1 + r) / (1 - r))
    se = 1.0 / math.sqrt(n - 3)
    lo = math.tanh(z_r - z * se)
    hi = math.tanh(z_r + z * se)
    return lo, hi


METRICS = [
    "barrel_pct", "exit_velo", "hard_hit_pct", "fb_pct",
    "avg_launch_angle", "avg_distance",
    "xslg", "xwoba",
    "bat_speed", "fast_swing_pct", "attack_angle", "ideal_aa_pct",
    "pull_fb_pct",
]


def univariate_correlations(df: pd.DataFrame) -> dict:
    """For each metric, correlation with hr_rate_residual (league-season adjusted)."""
    if "hr_rate_residual" not in df.columns:
        leag = df.groupby("season").apply(lambda s: s["hr"].sum() / s["pa"].sum(), include_groups=False)
        df = df.copy()
        df["league_hr_rate"] = df["season"].map(leag)
        df["hr_rate_residual"] = df["hr_rate"] - df["league_hr_rate"]

    out = {}
    for m in METRICS:
        if m not in df.columns:
            out[m] = {"r": None, "rho": None, "n": 0, "ci": None, "reason": "column missing"}
            continue
        x = df[m].to_numpy(dtype=float)
        y = df["hr_rate_residual"].to_numpy(dtype=float)
        r, n = pearson_r(x, y)
        rho, _ = spearman_rho(x, y)
        ci = fisher_ci(r, n)
        out[m] = {
            "r": round(r, 4) if np.isfinite(r) else None,
            "rho": round(rho, 4) if np.isfinite(rho) else None,
            "n": int(n),
            "ci_low": round(ci[0], 4) if np.isfinite(ci[0]) else None,
            "ci_high": round(ci[1], 4) if np.isfinite(ci[1]) else None,
        }
    return out


# ── 3. Multivariate xHR model ───────────────────────────────────────────
def fit_xhr_model(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    """Linear regression: hr_rate_residual ~ standardized metrics.
       Returns coefficients + holdout Pearson r."""
    cols = [m for m in METRICS if m in train.columns]
    # Drop rows with any NaN in the chosen columns
    train_clean = train.dropna(subset=cols + ["hr_rate_residual"])
    test_clean = test.dropna(subset=cols + ["hr_rate_residual"])

    if len(train_clean) < 50 or len(test_clean) < 20:
        return {"error": f"insufficient data train={len(train_clean)} test={len(test_clean)}"}

    # Force numeric (parquet round-trip can leave mixed/object dtypes on some cols)
    for c in cols:
        train_clean[c] = pd.to_numeric(train_clean[c], errors="coerce")
        test_clean[c] = pd.to_numeric(test_clean[c], errors="coerce")
    train_clean = train_clean.dropna(subset=cols + ["hr_rate_residual"])
    test_clean = test_clean.dropna(subset=cols + ["hr_rate_residual"])
    if len(train_clean) < 50 or len(test_clean) < 20:
        return {"error": f"insufficient data after numeric coerce: train={len(train_clean)} test={len(test_clean)}"}

    # Standardize features using TRAIN mean/std
    means = train_clean[cols].mean()
    stds = train_clean[cols].std(ddof=1).replace(0, 1.0)
    X_train = ((train_clean[cols] - means) / stds).to_numpy(dtype=float)
    y_train = train_clean["hr_rate_residual"].to_numpy(dtype=float)
    X_test = ((test_clean[cols] - means) / stds).to_numpy(dtype=float)
    y_test = test_clean["hr_rate_residual"].to_numpy(dtype=float)

    # OLS via lstsq with intercept
    X_train_b = np.column_stack([X_train, np.ones(len(X_train))])
    coef, *_ = np.linalg.lstsq(X_train_b, y_train, rcond=None)
    betas, intercept = coef[:-1], coef[-1]

    # Predict on test
    preds = X_test @ betas + intercept
    holdout_r, n = pearson_r(preds, y_test)
    holdout_rmse = float(np.sqrt(np.mean((preds - y_test) ** 2)))

    # Variance Inflation Factor — how collinear is each feature?
    vifs = {}
    for i, c in enumerate(cols):
        other_idx = [j for j in range(len(cols)) if j != i]
        if not other_idx:
            vifs[c] = 1.0
            continue
        X_others = np.column_stack([X_train[:, other_idx], np.ones(len(X_train))])
        y_i = X_train[:, i]
        beta_others, *_ = np.linalg.lstsq(X_others, y_i, rcond=None)
        resid = y_i - X_others @ beta_others
        r2 = 1.0 - (np.var(resid) / max(np.var(y_i), 1e-12))
        vifs[c] = round(1.0 / max(1 - r2, 1e-6), 2)

    return {
        "features": cols,
        "standardized_coefficients": {c: round(float(b), 5) for c, b in zip(cols, betas)},
        "vif": vifs,
        "n_train": len(train_clean),
        "n_test": len(test_clean),
        "holdout_pearson_r": round(holdout_r, 4) if np.isfinite(holdout_r) else None,
        "holdout_rmse": round(holdout_rmse, 5),
        "train_mean": {c: round(float(means[c]), 4) for c in cols},
        "train_std": {c: round(float(stds[c]), 4) for c in cols},
        "intercept": round(float(intercept), 5),
    }


# ── 4. Within-season sustainability (1H → 2H) ────────────────────────────
def within_season_sustainability(year_df_raw: pd.DataFrame, season: int) -> dict:
    """Split the season by median game_date, aggregate each half, correlate."""
    if year_df_raw.empty:
        return {"error": "empty"}
    dates = pd.to_datetime(year_df_raw["game_date"])
    mid = dates.median()
    first = year_df_raw[dates <= mid]
    second = year_df_raw[dates > mid]
    agg1 = aggregate_batter_season(first, season)
    agg2 = aggregate_batter_season(second, season)
    if agg1.empty or agg2.empty:
        return {"error": "empty halves"}
    joined = agg1.merge(agg2[["batter_id", "hr_rate"]].rename(columns={"hr_rate": "hr_rate_h2"}),
                        on="batter_id")
    out = {}
    for m in METRICS:
        if m not in joined.columns:
            continue
        x = joined[m].to_numpy(dtype=float)
        y = joined["hr_rate_h2"].to_numpy(dtype=float)
        r, n = pearson_r(x, y)
        out[m] = {"r_1h_to_2h_hr": round(r, 4) if np.isfinite(r) else None, "n": int(n)}
    return out


# ── 5. Year-to-year stability ────────────────────────────────────────────
def year_to_year_stability(df: pd.DataFrame, year_a: int, year_b: int) -> dict:
    a = df[df["season"] == year_a].copy()
    b = df[df["season"] == year_b].copy()
    joined = a.merge(b, on="batter_id", suffixes=(f"_{year_a}", f"_{year_b}"))
    out: dict = {"n_batters_both_years": int(len(joined))}
    for m in METRICS:
        col_a = f"{m}_{year_a}"
        col_b = f"{m}_{year_b}"
        if col_a not in joined.columns or col_b not in joined.columns:
            continue
        x = joined[col_a].to_numpy(dtype=float)
        y = joined[col_b].to_numpy(dtype=float)
        r_stat, n_stat = pearson_r(x, y)
        # Cross-year: year_a metric → year_b hr_rate
        hr_b = joined[f"hr_rate_{year_b}"].to_numpy(dtype=float)
        r_cross, _ = pearson_r(x, hr_b)
        out[m] = {
            "stat_persistence": round(r_stat, 4) if np.isfinite(r_stat) else None,
            "predicts_next_year_hr": round(r_cross, 4) if np.isfinite(r_cross) else None,
            "n": int(n_stat),
        }
    return out


# ── 6. 2026 Lucky/Unlucky leaderboard ────────────────────────────────────
def lucky_unlucky(model: dict, seasons_df: pd.DataFrame, year_2026_df: pd.DataFrame,
                  name_lookup: dict[int, str]) -> dict:
    """Apply trained model to 2026 batters, rank by actual-HR minus xHR."""
    if "error" in model:
        return {"error": model["error"]}

    cols = model["features"]
    means = pd.Series(model["train_mean"])
    stds = pd.Series(model["train_std"]).replace(0, 1.0)
    betas = pd.Series(model["standardized_coefficients"])
    intercept = model["intercept"]

    df = year_2026_df.dropna(subset=cols).copy()
    df = df[df["pa"] >= MIN_PA_LEADERBOARD].copy()
    if df.empty:
        return {"error": "no 2026 batters meet min-PA threshold"}

    # Apply 2026 season's league hr_rate baseline (so residual units match training)
    league_2026 = df["hr"].sum() / df["pa"].sum()
    X = ((df[cols] - means) / stds).to_numpy()
    pred_residual = X @ betas.values + intercept
    df["predicted_hr_rate"] = pred_residual + league_2026
    df["xhr_count"] = df["predicted_hr_rate"] * df["pa"]
    df["luck_residual"] = df["hr"] - df["xhr_count"]
    df["name"] = df["batter_id"].map(name_lookup).fillna("?")

    display_cols = (
        ["name", "batter_id", "pa", "hr", "xhr_count", "luck_residual",
         "hr_rate", "predicted_hr_rate", "bar_xhr", "bar_diff",
         "n_barrels", "avg_distance", "avg_launch_angle", "xslg", "xwoba", "fb_ev",
         "pull_pct", "attack_angle", "ideal_aa_pct", "hr_per_fb"]
        + cols
    )
    # dedup while preserving order (many cols appear in both hand-picked list and `cols`)
    seen: set[str] = set()
    display_cols = [c for c in display_cols if c in df.columns and not (c in seen or seen.add(c))]

    lucky = df.sort_values("luck_residual", ascending=False).head(20)[display_cols]
    unlucky = df.sort_values("luck_residual", ascending=True).head(20)[display_cols]
    # Full list so the frontend can filter to today's slate (Breakouts /
    # Regression tables are slate-scoped, not a global leaderboard).
    all_sorted = df.sort_values("luck_residual", ascending=True)[display_cols]

    def _rowdict(row) -> dict:
        d = {}
        for c in display_cols:
            v = row[c]
            if isinstance(v, float):
                if np.isnan(v):
                    d[c] = None
                else:
                    d[c] = round(v, 4)
            elif pd.api.types.is_integer_dtype(type(v)) or isinstance(v, (int, np.integer)):
                d[c] = int(v)
            else:
                d[c] = str(v)
        return d

    return {
        "league_hr_rate_2026": round(float(league_2026), 4),
        "min_pa": MIN_PA_LEADERBOARD,
        "n_batters_evaluated": int(len(df)),
        "lucky_top_20": [_rowdict(r) for _, r in lucky.iterrows()],
        "unlucky_top_20": [_rowdict(r) for _, r in unlucky.iterrows()],
        "all_batters_sorted": [_rowdict(r) for _, r in all_sorted.iterrows()],
    }


# ── Orchestration ───────────────────────────────────────────────────────
def _console_summary(report: dict) -> None:
    print("\n" + "═" * 70)
    print("  BAT-TRACKING STATS — HR PREDICTIVENESS RESEARCH")
    print("═" * 70)
    ds = report.get("dataset", {})
    print(f"  Sample: {ds.get('n_batter_seasons', 0):,} batter-seasons across {ds.get('seasons', [])}")
    print(f"  League HR/PA per season: {ds.get('league_hr_rate_by_season', {})}")
    print()

    print("  ── Univariate correlations (metric → HR-rate residual) ──")
    uni = report.get("univariate", {})
    print(f"  {'metric':18} {'pearson r':>10} {'spearman ρ':>12} {'n':>6}   {'95% CI':>20}")
    print(f"  {'─'*18} {'─'*10} {'─'*12} {'─'*6}   {'─'*20}")
    for m, v in uni.items():
        r = v.get("r"); rho = v.get("rho"); n = v.get("n", 0)
        ci_lo = v.get("ci_low"); ci_hi = v.get("ci_high")
        r_str = f"{r:+.4f}" if r is not None else "   -   "
        rho_str = f"{rho:+.4f}" if rho is not None else "   -   "
        ci_str = f"[{ci_lo:+.2f},{ci_hi:+.2f}]" if ci_lo is not None else ""
        print(f"  {m:18} {r_str:>10} {rho_str:>12} {n:>6}   {ci_str:>20}")

    print("\n  ── Multivariate xHR model (train: 2024, test: 2025) ──")
    mv = report.get("multivariate", {})
    if "error" in mv:
        print(f"  {mv['error']}")
    else:
        print(f"  holdout Pearson r: {mv.get('holdout_pearson_r')}   rmse: {mv.get('holdout_rmse')}")
        print(f"  train n={mv.get('n_train')}   test n={mv.get('n_test')}")
        print(f"  {'metric':18} {'std coef':>10}   {'VIF':>6}")
        for c in mv.get("features", []):
            b = mv["standardized_coefficients"].get(c)
            vif = mv["vif"].get(c)
            print(f"  {c:18} {b:>+10.5f}   {vif:>6.2f}")

    print("\n  ── Within-season sustainability (1H metric → 2H HR rate) ──")
    sust = report.get("sustainability", {})
    for season, tbl in sust.items():
        if "error" in tbl:
            print(f"  {season}: {tbl['error']}")
            continue
        print(f"  {season}:")
        for m, v in tbl.items():
            r = v.get("r_1h_to_2h_hr")
            n = v.get("n")
            print(f"    {m:18} {r if r is not None else '-':>7}   n={n}")

    print("\n  ── Year-to-year stability (2024 → 2025) ──")
    yty = report.get("year_to_year", {})
    if "n_batters_both_years" in yty:
        print(f"  n batters in both years @ ≥{MIN_PA} PA: {yty['n_batters_both_years']}")
        print(f"  {'metric':18} {'persistence':>12} {'next-yr HR r':>14}")
        for m, v in yty.items():
            if not isinstance(v, dict):
                continue
            sp = v.get("stat_persistence"); pr = v.get("predicts_next_year_hr")
            sp_s = f"{sp:+.4f}" if sp is not None else "  -  "
            pr_s = f"{pr:+.4f}" if pr is not None else "  -  "
            print(f"  {m:18} {sp_s:>12} {pr_s:>14}")

    print("\n  ── 2026 LUCKY (actual HR >> xHR) ──")
    lu = report.get("lucky_unlucky_2026", {})
    if "error" in lu:
        print(f"  {lu['error']}")
    else:
        print(f"  baseline: n={lu.get('n_batters_evaluated')} @ ≥{lu.get('min_pa')} PA")
        print(f"  {'name':25} {'pa':>4} {'hr':>3} {'xhr':>5} {'luck':>6} {'barrel%':>7} {'bat_spd':>7} {'pull_fb%':>8}")
        for row in lu.get("lucky_top_20", []):
            name = row.get("name", "?")[:25]
            print(f"  {name:25} {row.get('pa',0):>4} {row.get('hr',0):>3} "
                  f"{row.get('xhr_count',0):>5.1f} {row.get('luck_residual',0):>+6.1f} "
                  f"{(row.get('barrel_pct') or 0)*100:>7.1f} "
                  f"{row.get('bat_speed') or 0:>7.1f} "
                  f"{(row.get('pull_fb_pct') or 0)*100:>8.1f}")

        print("\n  ── 2026 UNLUCKY (actual HR << xHR) ──")
        print(f"  {'name':25} {'pa':>4} {'hr':>3} {'xhr':>5} {'luck':>6} {'barrel%':>7} {'bat_spd':>7} {'pull_fb%':>8}")
        for row in lu.get("unlucky_top_20", []):
            name = row.get("name", "?")[:25]
            print(f"  {name:25} {row.get('pa',0):>4} {row.get('hr',0):>3} "
                  f"{row.get('xhr_count',0):>5.1f} {row.get('luck_residual',0):>+6.1f} "
                  f"{(row.get('barrel_pct') or 0)*100:>7.1f} "
                  f"{row.get('bat_speed') or 0:>7.1f} "
                  f"{(row.get('pull_fb_pct') or 0)*100:>8.1f}")

    print("\n  Full report written to:", _REPORT_OUT)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-names", action="store_true",
                    help="Skip MLB Stats API name lookups (use batter IDs only)")
    args = ap.parse_args()

    _CACHE.mkdir(parents=True, exist_ok=True)

    # ── Aggregate ────────────────────────────────────────────────────────
    years = [2024, 2025, 2026]
    print(f"Aggregating batter-seasons for {years}...")
    all_seasons = build_all_seasons(years)
    if all_seasons.empty:
        print("No data aggregated — cache/statcast_*.parquet missing?", file=sys.stderr)
        return 1
    all_seasons.to_parquet(_AGG_OUT, index=False)
    print(f"Wrote {_AGG_OUT} ({len(all_seasons):,} batter-seasons)")

    # ── Calibration set (2024+2025) ─────────────────────────────────────
    calib = all_seasons[
        (all_seasons["season"].isin([2024, 2025])) & (all_seasons["pa"] >= MIN_PA)
    ].copy()
    print(f"Calibration set: {len(calib):,} batter-seasons @ ≥{MIN_PA} PA")
    # Add residual vs league hr/PA (season-level)
    league_hr = calib.groupby("season").apply(
        lambda s: s["hr"].sum() / s["pa"].sum(), include_groups=False,
    )
    calib["league_hr_rate"] = calib["season"].map(league_hr)
    calib["hr_rate_residual"] = calib["hr_rate"] - calib["league_hr_rate"]

    # ── Univariate ───────────────────────────────────────────────────────
    print("\nComputing univariate correlations...")
    univariate = univariate_correlations(calib)

    # ── Multivariate (train 2024, test 2025) ────────────────────────────
    print("Fitting xHR model (train 2024, test 2025)...")
    train = calib[calib["season"] == 2024]
    test = calib[calib["season"] == 2025]
    mv = fit_xhr_model(train, test)

    # ── Sustainability (within-season 1H→2H for 2024 and 2025) ──────────
    print("Computing within-season sustainability...")
    sust = {}
    for y in [2024, 2025]:
        path = _CACHE / f"statcast_{y}.parquet"
        if not path.exists():
            continue
        print(f"  loading {y} for 1H/2H split...", flush=True)
        df = pd.read_parquet(path)
        if "game_type" in df.columns:
            df = df[df["game_type"] == "R"]
        sust[str(y)] = within_season_sustainability(df, y)

    # ── Year-to-year (2024 → 2025) ──────────────────────────────────────
    print("Computing year-to-year stability...")
    yty = year_to_year_stability(all_seasons, 2024, 2025)

    # ── 2026 Lucky/Unlucky ──────────────────────────────────────────────
    lu_block: dict = {}
    if 2026 in all_seasons["season"].unique():
        df_2026 = all_seasons[all_seasons["season"] == 2026].copy()
        # Name lookup for TOP candidates only (speeds it up)
        print(f"Resolving names for {len(df_2026)} 2026 batters...")
        if args.skip_names:
            names: dict[int, str] = {}
        else:
            names = resolve_names(df_2026["batter_id"].astype(int).tolist())
        lu_block = lucky_unlucky(mv, calib, df_2026, names)

    # ── Assemble report ─────────────────────────────────────────────────
    ds_hr_rates = {
        str(s): round(float(league_hr.get(s, 0.0)), 4)
        for s in league_hr.index
    }
    report = {
        "dataset": {
            "seasons": years,
            "n_batter_seasons": int(len(all_seasons)),
            "n_by_season": {str(s): int((all_seasons["season"] == s).sum()) for s in years},
            "min_pa_filter": MIN_PA,
            "league_hr_rate_by_season": ds_hr_rates,
        },
        "univariate": univariate,
        "multivariate": mv,
        "sustainability": sust,
        "year_to_year": yty,
        "lucky_unlucky_2026": lu_block,
    }

    def _default(o):
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.ndarray,)): return o.tolist()
        return str(o)

    with _REPORT_OUT.open("w") as f:
        json.dump(report, f, indent=2, default=_default)

    _console_summary(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
