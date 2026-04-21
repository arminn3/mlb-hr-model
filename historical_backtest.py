#!/usr/bin/env python3
"""
10-season per-park weather-vs-HR backtest.

Pipeline:
  1. Load per-game aggregation (cache/games_2015_2024.parquet from historical_data.py)
  2. Fetch/cache game start times (MLB Stats API → cache/game_times.parquet)
  3. Join each game to nearest-hour ASOS observation (.asos_cache/{station}_{year}.json)
  4. Compute density-delta + wind-out-component features
  5. Subtract league-season mean HR rate → residual
  6. Per-park OLS fit: residual ~ beta_rho * density_term + beta_wind * wind_term
  7. Apply empirical-Bayes (James-Stein) shrinkage toward league-global slopes
  8. Refit global K_RHO, K_WIND on full dataset
  9. Leave-one-season-out cross-validation
 10. Write environment_calibration.json

Reuses physics primitives from weather_backtest.py (PARK_CF_BEARING,
humid_air_density_kg_m3, wind_out_component, WIND_HEIGHT_CORRECTION,
RHO_REFERENCE) so the calibration targets the same formula environment.py
uses at runtime.

Usage:
    python3 historical_backtest.py --all      # full pipeline
    python3 historical_backtest.py --build    # only rebuild joined CSV
    python3 historical_backtest.py --analyze  # only re-run calibration
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import requests

from asos_fetch import STADIUM_TO_ICAO
from weather_backtest import (
    PARK_CF_BEARING,
    RHO_REFERENCE,
    WIND_HEIGHT_CORRECTION,
    humid_air_density_kg_m3,
    wind_out_component,
)

_GAMES_PARQUET = Path("cache/games_2015_2024.parquet")
_GAME_TIMES_PARQUET = Path("cache/game_times.parquet")
_BACKTEST_CSV = Path("cache/historical_backtest.csv")
_CALIB_JSON = Path("environment_calibration.json")
_ASOS_CACHE_DIR = Path(".asos_cache")


# ── Step 2: game start times ────────────────────────────────────────────

def fetch_game_times_for_dates(dates: list[str]) -> dict[int, str]:
    """Hit MLB Stats API once per date for all regular-season games.
       Returns {game_pk: gameDate_iso_utc}."""
    out: dict[int, str] = {}
    session = requests.Session()
    for i, d in enumerate(dates, 1):
        if i % 50 == 0 or i == len(dates):
            print(f"  game-times [{i}/{len(dates)}]  ({len(out)} games so far)")
        url = (
            "https://statsapi.mlb.com/api/v1/schedule"
            f"?sportId=1&date={d}&gameType=R"
        )
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            print(f"  [warn] {d}: {exc}", file=sys.stderr)
            continue
        for day in data.get("dates", []):
            for g in day.get("games", []):
                out[int(g["gamePk"])] = g["gameDate"]
        time.sleep(0.2)
    return out


def load_or_fetch_game_times(games_df: pd.DataFrame) -> pd.DataFrame:
    if _GAME_TIMES_PARQUET.exists():
        print(f"Loaded cached game times from {_GAME_TIMES_PARQUET}")
        return pd.read_parquet(_GAME_TIMES_PARQUET)

    print(f"Fetching game times from MLB Stats API...")
    dates = sorted(games_df["game_date"].unique().tolist())
    mapping = fetch_game_times_for_dates(dates)
    gt = pd.DataFrame(
        [{"game_pk": pk, "game_time_utc": v} for pk, v in mapping.items()]
    )
    _GAME_TIMES_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    gt.to_parquet(_GAME_TIMES_PARQUET)
    print(f"Wrote {len(gt):,} game times → {_GAME_TIMES_PARQUET}")
    return gt


# ── Step 3: weather join ────────────────────────────────────────────────

def load_asos_cache(station: str, year: int) -> list[dict]:
    p = _ASOS_CACHE_DIR / f"{station}_{year}.json"
    if not p.exists():
        return []
    with p.open() as f:
        return json.load(f)


def _parse_utc(s: str) -> Optional[datetime]:
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        return None


def join_weather(games: pd.DataFrame, game_times: pd.DataFrame) -> pd.DataFrame:
    """For each game row, find the nearest-hour ASOS observation and
       attach temp/wind/pressure/humidity columns."""
    merged = games.merge(game_times, on="game_pk", how="left")
    # Default to 19:10 UTC if game time missing (evening EDT game)
    merged["game_time_dt"] = merged["game_time_utc"].apply(
        lambda s: _parse_utc(s) if isinstance(s, str) else None
    )

    # Load every ASOS cache once, keyed by (station, year)
    stations_needed = merged["home_team"].map(STADIUM_TO_ICAO).dropna().unique()
    seasons_needed = merged["season"].unique()
    cache: dict[tuple[str, int], list[tuple[datetime, dict]]] = {}
    for st in stations_needed:
        for yr in seasons_needed:
            obs = load_asos_cache(st, int(yr))
            if not obs:
                continue
            # parse once, sort once
            parsed = []
            for o in obs:
                t = _parse_utc(o["valid_utc"])
                if t is None:
                    continue
                parsed.append((t, o))
            parsed.sort(key=lambda x: x[0])
            cache[(st, int(yr))] = parsed

    def nearest(station: str, year: int, target: datetime) -> Optional[dict]:
        entries = cache.get((station, year))
        if not entries:
            return None
        # binary search for speed
        import bisect
        times = [e[0] for e in entries]
        idx = bisect.bisect_left(times, target)
        candidates = []
        if idx > 0: candidates.append(entries[idx-1])
        if idx < len(entries): candidates.append(entries[idx])
        if not candidates: return None
        best = min(candidates, key=lambda e: abs((e[0]-target).total_seconds()))
        if abs((best[0]-target).total_seconds()) > 90*60:
            return None
        return best[1]

    print("Joining weather to games (this is the slow part)...")
    cols = {
        "temp_f": [], "dewpoint_f": [], "relative_humidity": [],
        "wind_speed_mph": [], "wind_dir_deg": [], "pressure_hpa": [],
        "precip_in": [],
    }
    default_start = datetime(2000, 1, 1, 23, 10)  # 19:10 ET ≈ 23:10 UTC (unused directly)
    for i, row in enumerate(merged.itertuples(index=False)):
        if i % 2000 == 0:
            print(f"  {i:,}/{len(merged):,}")
        station = STADIUM_TO_ICAO.get(row.home_team)
        year = int(row.season)
        if station is None or row.game_time_dt is None:
            for c in cols: cols[c].append(None)
            continue
        obs = nearest(station, year, row.game_time_dt)
        if obs is None:
            for c in cols: cols[c].append(None)
            continue
        for c in cols:
            cols[c].append(obs.get(c))
    for c, vals in cols.items():
        merged[c] = vals
    merged = merged.drop(columns=["game_time_dt"])
    return merged


def add_physics_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add the two primary features:
       density_term = (RHO_REFERENCE / rho) - 1  (fractional density deficit)
       wind_term    = wind_out_component * WIND_HEIGHT_CORRECTION (mph)
       Both are centered around "neutral conditions" = 0.
    """
    density_terms = []
    wind_terms = []
    for row in df.itertuples(index=False):
        rho = humid_air_density_kg_m3(
            row.temp_f if not (row.temp_f is None or pd.isna(row.temp_f)) else None,
            row.pressure_hpa if not (row.pressure_hpa is None or pd.isna(row.pressure_hpa)) else None,
            row.relative_humidity if not (row.relative_humidity is None or pd.isna(row.relative_humidity)) else None,
        )
        dterm = (RHO_REFERENCE / rho - 1.0) if (rho and rho > 0) else 0.0
        density_terms.append(dterm)
        wspd = row.wind_speed_mph if not (row.wind_speed_mph is None or pd.isna(row.wind_speed_mph)) else None
        wdir = row.wind_dir_deg if not (row.wind_dir_deg is None or pd.isna(row.wind_dir_deg)) else None
        w_out = wind_out_component(wspd, wdir, row.home_team)
        wind_terms.append(w_out * WIND_HEIGHT_CORRECTION)
    df["density_term"] = density_terms
    df["wind_term"] = wind_terms
    return df


# ── Step 5: residual ────────────────────────────────────────────────────

def add_residual(df: pd.DataFrame) -> pd.DataFrame:
    season_means = df.groupby("season")["hr_rate"].mean().to_dict()
    df["hr_rate_league"] = df["season"].map(season_means)
    df["hr_rate_residual"] = df["hr_rate"] - df["hr_rate_league"]
    return df


# ── Steps 6-7: per-park calibration + shrinkage ─────────────────────────

def fit_ols(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    """Return (slope, intercept, standard_error_of_slope). x is 1-D."""
    n = len(x)
    if n < 2:
        return 0.0, 0.0, float("inf")
    x_mean = x.mean()
    y_mean = y.mean()
    ss_xx = ((x - x_mean) ** 2).sum()
    if ss_xx == 0:
        return 0.0, y_mean, float("inf")
    slope = ((x - x_mean) * (y - y_mean)).sum() / ss_xx
    intercept = y_mean - slope * x_mean
    resid = y - (slope * x + intercept)
    dof = max(1, n - 2)
    mse = (resid ** 2).sum() / dof
    se_slope = math.sqrt(mse / ss_xx)
    return slope, intercept, se_slope


def fit_park_coefficients(df: pd.DataFrame) -> dict:
    """Per-park OLS fit of hr_rate_residual on wind_term (controlling for
       density_term via residualization against the global density slope).

       Returns {park: {beta_wind, se_wind, n, beta_density_global, ...}}.
    """
    # Fit global density slope first (pooled). This gives us a baseline
    # effect-of-weather that doesn't vary by park (density is a physics
    # law, not a park trait).
    valid = df.dropna(subset=["density_term", "wind_term"]).copy()
    # Drop domes (no wind effect by design — is_dome in slate; here we
    # approximate by dropping TB & TOR plus any rows with wind_term==0
    # AND density_term==0).
    valid = valid[~valid["home_team"].isin(["TB", "TOR"])].copy()

    x_full = np.column_stack([valid["density_term"].values,
                              valid["wind_term"].values])
    y_full = valid["hr_rate_residual"].values
    # Multi-feature OLS via numpy.linalg.lstsq
    A = np.column_stack([x_full, np.ones(len(x_full))])
    global_coef, _, _, _ = np.linalg.lstsq(A, y_full, rcond=None)
    beta_density_global, beta_wind_global, intercept_global = global_coef
    print(f"\nGlobal pooled fit (all parks combined):")
    print(f"  beta_density = {beta_density_global:.5f} (HR_rate per unit density-deficit)")
    print(f"  beta_wind    = {beta_wind_global:.5f} (HR_rate per mph tailwind × height)")
    print(f"  intercept    = {intercept_global:.5f}")
    print(f"  n = {len(valid):,} games")

    # Per-park fits
    park_fits: dict[str, dict] = {}
    for park, group in valid.groupby("home_team"):
        n = len(group)
        if n < 30:
            # too thin — fall back to global slope
            park_fits[park] = {
                "n": n,
                "beta_wind_raw": float(beta_wind_global),
                "se_wind": float("inf"),
                "ci_low": None, "ci_high": None, "p_val": None,
                "shrunk": float(beta_wind_global),
                "sens_raw": 1.0, "sens_shrunk": 1.0,
                "note": "too few games — used global",
            }
            continue
        # Residualize y and wind_term against density_term so wind coef is
        # marginal effect holding density constant.
        x_d = group["density_term"].values
        y = group["hr_rate_residual"].values
        w = group["wind_term"].values
        # Project out density from y and w separately
        b_d_y, _, _ = fit_ols(x_d, y)
        y_adj = y - b_d_y * x_d
        b_d_w, _, _ = fit_ols(x_d, w)
        w_adj = w - b_d_w * x_d
        slope, _, se = fit_ols(w_adj, y_adj)
        # 95% CI and p-value (rough, 2σ)
        ci_low, ci_high = slope - 2*se, slope + 2*se
        z = abs(slope / se) if se > 0 else 0.0
        p_val = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
        park_fits[park] = {
            "n": int(n),
            "beta_wind_raw": float(slope),
            "se_wind": float(se),
            "ci_low": float(ci_low),
            "ci_high": float(ci_high),
            "p_val": float(p_val),
        }

    # James-Stein / empirical-Bayes shrinkage toward beta_wind_global
    raw_slopes = np.array([v["beta_wind_raw"] for v in park_fits.values()
                           if not math.isinf(v["se_wind"])])
    between_var = raw_slopes.var(ddof=1) if len(raw_slopes) > 2 else 0.0
    # Average sampling variance
    avg_within_var = np.mean([v["se_wind"]**2 for v in park_fits.values()
                              if not math.isinf(v["se_wind"])])
    tau_sq = max(between_var - avg_within_var, 1e-10)
    print(f"\nShrinkage:")
    print(f"  between-park variance: {between_var:.6f}")
    print(f"  avg within-park var:   {avg_within_var:.6f}")
    print(f"  tau²:                  {tau_sq:.6f}")

    # Shrinkage weight per park: tau²/(tau² + se²)
    for park, v in park_fits.items():
        if math.isinf(v["se_wind"]):
            v["shrunk"] = float(beta_wind_global)
        else:
            w = tau_sq / (tau_sq + v["se_wind"]**2)
            v["shrunk"] = float(w * v["beta_wind_raw"] + (1 - w) * beta_wind_global)
        # Convert to sensitivity multiplier (dimensionless)
        v["sens_raw"] = float(v["beta_wind_raw"] / beta_wind_global) if beta_wind_global != 0 else 1.0
        v["sens_shrunk"] = float(v["shrunk"] / beta_wind_global) if beta_wind_global != 0 else 1.0

    # Confidence gate + physical floor. Parks where the wind coefficient
    # didn't clear p<0.10 get reverted to the global average (1.0×) — their
    # regression slope was too noisy to trust over the prior. Significant
    # parks keep their shrunk multiplier, floored at 0.3 to prevent
    # physically nonsensical negative wind effects (wind blowing TOWARD
    # center field can't make HRs less likely).
    P_THRESHOLD = 0.10
    SENS_FLOOR = 0.3
    for park, v in park_fits.items():
        p = v.get("p_val")
        if p is None or p > P_THRESHOLD:
            v["sens_ship"] = 1.0
            v["ship_reason"] = "p>{:.2f}: fell back to league mean".format(P_THRESHOLD)
        elif v["sens_shrunk"] < SENS_FLOOR:
            v["sens_ship"] = SENS_FLOOR
            v["ship_reason"] = f"shrunk below floor ({v['sens_shrunk']:.2f}), clamped to {SENS_FLOOR}"
        else:
            v["sens_ship"] = round(v["sens_shrunk"], 3)
            v["ship_reason"] = "shrunk estimate (p<{:.2f})".format(P_THRESHOLD)

    out = {
        "meta": {
            "n_games": int(len(valid)),
            "seasons": sorted(map(int, valid["season"].unique().tolist())),
            "beta_density_global": float(beta_density_global),
            "beta_wind_global": float(beta_wind_global),
            "intercept_global": float(intercept_global),
            "tau_sq": float(tau_sq),
        },
        "parks": park_fits,
    }
    return out


# ── Step 8: global K_RHO, K_WIND in environment.py form ─────────────────

def derive_global_k(calib: dict, baseline_rate: float) -> tuple[float, float]:
    """Convert raw OLS slopes (absolute HR rate per feature) into the
       semantics environment.py uses (percent HR-rate *relative* boost).

       env.py formulas:
         density_pct = ((RHO_REFERENCE/rho)^K_RHO - 1) * 100
         wind_pct    = K_WIND * wind_out_component * WIND_HEIGHT_CORRECTION

       where density_pct/wind_pct are relative % boosts added together
       into combined_hr_pct.

       Unit chain for K_WIND:
         beta_wind: HR_rate (fraction) per mph-of-height-corrected wind
         → relative boost per mph = beta_wind / baseline_rate
         → percent boost per mph  = beta_wind / baseline_rate * 100

       Unit chain for K_RHO: linear regime of (rho_ref/rho)^K_RHO ≈ 1 + K·ε
       where ε = fractional density deficit. So slope of density_pct wrt ε
       equals K_RHO · 100 (percent). Our beta_density is slope of abs HR
       rate wrt ε, so:
         K_RHO = beta_density / baseline_rate
    """
    meta = calib["meta"]
    K_WIND = meta["beta_wind_global"] / baseline_rate * 100.0
    K_RHO = meta["beta_density_global"] / baseline_rate
    return float(K_RHO), float(K_WIND)


# ── Step 9: cross-validation ────────────────────────────────────────────

def leave_one_season_cv(df: pd.DataFrame) -> dict:
    """Fit on 9 seasons, predict residual on 10th. Return per-season
       correlation and RMSE."""
    seasons = sorted(df["season"].unique().tolist())
    results = []
    df_v = df.dropna(subset=["density_term", "wind_term", "hr_rate_residual"]).copy()
    df_v = df_v[~df_v["home_team"].isin(["TB", "TOR"])]
    for yr in seasons:
        train = df_v[df_v["season"] != yr]
        test = df_v[df_v["season"] == yr]
        if len(train) < 100 or len(test) < 30:
            continue
        A = np.column_stack([train["density_term"].values,
                             train["wind_term"].values,
                             np.ones(len(train))])
        coef, _, _, _ = np.linalg.lstsq(A, train["hr_rate_residual"].values, rcond=None)
        b_d, b_w, b_0 = coef
        preds = (b_d * test["density_term"].values
                 + b_w * test["wind_term"].values + b_0)
        actual = test["hr_rate_residual"].values
        # Pearson correlation
        if len(preds) > 1 and np.std(preds) > 0:
            r = float(np.corrcoef(preds, actual)[0, 1])
        else:
            r = 0.0
        rmse = float(np.sqrt(((preds - actual) ** 2).mean()))
        results.append({"season": int(yr), "n_test": int(len(test)),
                        "pearson_r": r, "rmse": rmse,
                        "beta_density": float(b_d), "beta_wind": float(b_w)})
    return {"per_season": results}


# ── Orchestration ───────────────────────────────────────────────────────

def build() -> pd.DataFrame:
    if not _GAMES_PARQUET.exists():
        # Fall back to partial files
        parts = sorted(Path("cache").glob("games_*.parquet"))
        if not parts:
            print(f"ERROR: {_GAMES_PARQUET} missing and no partial files.",
                  file=sys.stderr)
            sys.exit(1)
        dfs = [pd.read_parquet(p) for p in parts]
        games = pd.concat(dfs, ignore_index=True)
        print(f"Loaded {len(games):,} games from {len(parts)} partial files")
    else:
        games = pd.read_parquet(_GAMES_PARQUET)
        print(f"Loaded {len(games):,} games from {_GAMES_PARQUET}")

    game_times = load_or_fetch_game_times(games)
    joined = join_weather(games, game_times)
    joined = add_physics_features(joined)
    joined = add_residual(joined)

    _BACKTEST_CSV.parent.mkdir(parents=True, exist_ok=True)
    joined.to_csv(_BACKTEST_CSV, index=False)
    print(f"Wrote {len(joined):,} joined rows → {_BACKTEST_CSV}")
    return joined


def analyze(df: Optional[pd.DataFrame] = None) -> dict:
    if df is None:
        if not _BACKTEST_CSV.exists():
            print(f"ERROR: {_BACKTEST_CSV} missing. Run --build first.",
                  file=sys.stderr)
            sys.exit(1)
        df = pd.read_csv(_BACKTEST_CSV)

    calib = fit_park_coefficients(df)
    cv = leave_one_season_cv(df)
    # Baseline league HR rate used for unit conversions
    baseline_rate = float(df["hr_rate"].mean())
    K_RHO, K_WIND = derive_global_k(calib, baseline_rate)

    output = {
        "meta": {
            **calib["meta"],
            "K_RHO": K_RHO,
            "K_WIND": K_WIND,
            "baseline_hr_rate": baseline_rate,
            "cross_validation": cv,
        },
        "parks": calib["parks"],
        # Ready-to-paste dict for environment.py (confidence-gated + floored)
        "PARK_WIND_SENSITIVITY_SHRUNK": {
            p: round(v["sens_ship"], 3) for p, v in calib["parks"].items()
        },
    }
    with _CALIB_JSON.open("w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nWrote calibration → {_CALIB_JSON}")

    # Print summary
    print("\n══ Global coefficients ══")
    print(f"  K_RHO  = {K_RHO:.3f}")
    print(f"  K_WIND = {K_WIND:.3f}")
    print("\n══ Per-park wind sensitivity ══")
    print(f"  {'Park':4} {'n':>5} {'raw':>7} {'shrunk':>7} {'SHIP':>6} {'p_val':>7}  note")
    for p in sorted(calib["parks"], key=lambda x: -calib["parks"][x]["sens_ship"]):
        v = calib["parks"][p]
        pv = f"{v['p_val']:.3f}" if v['p_val'] is not None else "  -  "
        note = v.get("ship_reason", "")
        print(f"  {p:4} {v['n']:>5} {v['sens_raw']:>7.3f} "
              f"{v['sens_shrunk']:>7.3f} {v['sens_ship']:>6.2f} {pv:>7}  {note}")

    print("\n══ Cross-validation ══")
    for r in cv["per_season"]:
        print(f"  {r['season']}: r = {r['pearson_r']:+.4f}, "
              f"rmse = {r['rmse']:.5f}, "
              f"β_wind = {r['beta_wind']:.5f}, "
              f"n_test = {r['n_test']}")
    return output


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="Rebuild joined CSV")
    ap.add_argument("--analyze", action="store_true", help="Only run analysis")
    ap.add_argument("--all", action="store_true", help="Build + analyze")
    args = ap.parse_args()

    if not (args.build or args.analyze or args.all):
        args.all = True

    df = None
    if args.build or args.all:
        df = build()
    if args.analyze or args.all:
        analyze(df)
    return 0


if __name__ == "__main__":
    sys.exit(main())
