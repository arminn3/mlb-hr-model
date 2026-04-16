#!/usr/bin/env python3
"""
Backtest: train separate HR-prediction models on 2023, 2024, 2025 data.
Compare coefficients to decide if weights are stable across years.

Output: results/backtest_weights.json with three coefficient sets + AUCs.
Does NOT touch production ml_weights.json or model config.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from pybaseball import statcast

warnings.filterwarnings("ignore")
pd.options.mode.chained_assignment = None


def fetch_season(year: int) -> pd.DataFrame:
    """Fetch full regular-season Statcast for a year.

    pybaseball chunks internally; this still takes ~5-10 min per year.
    Cached to disk so re-runs are instant.
    """
    cache = Path(f"cache/statcast_{year}.parquet")
    cache.parent.mkdir(exist_ok=True)
    if cache.exists():
        print(f"  [{year}] loading cached: {cache}")
        return pd.read_parquet(cache)
    print(f"  [{year}] fetching statcast {year}-03-15 to {year}-10-05...")
    df = statcast(start_dt=f"{year}-03-15", end_dt=f"{year}-10-05")
    # Keep only regular season
    if "game_type" in df.columns:
        df = df[df["game_type"] == "R"].copy()
    df.to_parquet(cache)
    print(f"  [{year}] saved {len(df):,} rows to {cache}")
    return df


def build_features(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """For each (batter, game_date), compute:
        - as-of season stats (barrel%, FB%, ISO, EV, HR/BIP) using rows BEFORE this date
        - whether they hit a HR in this game
        - pitcher HR/9 to-date (for the starting pitcher they faced most PAs vs)

    Returns per-game-per-batter feature rows.
    """
    print(f"  [{year}] building features...")

    # Only BIP rows
    df = df.dropna(subset=["launch_speed", "launch_angle"]).copy()
    df["game_date"] = pd.to_datetime(df["game_date"])
    df["launch_speed"] = pd.to_numeric(df["launch_speed"], errors="coerce").fillna(0)
    df["launch_angle"] = pd.to_numeric(df["launch_angle"], errors="coerce").fillna(0)
    df["launch_speed_angle"] = pd.to_numeric(df["launch_speed_angle"], errors="coerce").fillna(0)
    df["is_hr"] = (df["events"].astype(str) == "home_run").astype(int)
    df["is_barrel"] = (df["launch_speed_angle"] == 6).astype(int)
    df["is_fb"] = ((df["launch_angle"] >= 25) & (df["launch_angle"] <= 50)).astype(int)
    df["is_hard"] = (df["launch_speed"] >= 95).astype(int)

    # Sort so cumulative sums are chronological
    df = df.sort_values(["batter", "game_date"]).reset_index(drop=True)

    # Per-batter running stats BEFORE the current row
    grp = df.groupby("batter", group_keys=False)
    df["cum_bip"] = grp.cumcount()  # number of prior BIPs
    df["cum_hr"] = grp["is_hr"].cumsum() - df["is_hr"]
    df["cum_barrel"] = grp["is_barrel"].cumsum() - df["is_barrel"]
    df["cum_fb"] = grp["is_fb"].cumsum() - df["is_fb"]
    df["cum_hard"] = grp["is_hard"].cumsum() - df["is_hard"]
    df["cum_ev_sum"] = grp["launch_speed"].cumsum() - df["launch_speed"]

    # Collapse to one row per (batter, game_date): did they HR that day?
    per_game = df.groupby(["batter", "game_date"]).agg(
        hit_hr=("is_hr", "max"),
        cum_bip=("cum_bip", "min"),
        cum_hr=("cum_hr", "min"),
        cum_barrel=("cum_barrel", "min"),
        cum_fb=("cum_fb", "min"),
        cum_hard=("cum_hard", "min"),
        cum_ev_sum=("cum_ev_sum", "min"),
        pitcher_id=("pitcher", "first"),
    ).reset_index()

    # Filter: need at least 40 BIPs of history (match MIN_BIP_FOR_MATCHUP)
    per_game = per_game[per_game["cum_bip"] >= 40].copy()

    # Season-to-date batter features
    per_game["barrel_pct"] = per_game["cum_barrel"] / per_game["cum_bip"]
    per_game["fb_pct"] = per_game["cum_fb"] / per_game["cum_bip"]
    per_game["hard_pct"] = per_game["cum_hard"] / per_game["cum_bip"]
    per_game["hr_per_bip"] = per_game["cum_hr"] / per_game["cum_bip"]
    per_game["avg_ev"] = per_game["cum_ev_sum"] / per_game["cum_bip"]
    # ISO proxy: HR/BIP × 3 (crude; real ISO needs XBH counts)
    per_game["iso_proxy"] = per_game["hr_per_bip"] * 3

    # Pitcher-to-date HR rate
    # Per-pitcher running HR allowed per BIP
    df_p = df.sort_values(["pitcher", "game_date"]).reset_index(drop=True)
    pgrp = df_p.groupby("pitcher", group_keys=False)
    df_p["p_cum_bip"] = pgrp.cumcount()
    df_p["p_cum_hr"] = pgrp["is_hr"].cumsum() - df_p["is_hr"]
    p_per_game = df_p.groupby(["pitcher", "game_date"]).agg(
        p_cum_bip=("p_cum_bip", "min"),
        p_cum_hr=("p_cum_hr", "min"),
    ).reset_index()
    p_per_game["p_hr_rate"] = np.where(
        p_per_game["p_cum_bip"] > 0,
        p_per_game["p_cum_hr"] / p_per_game["p_cum_bip"],
        0,
    )

    per_game = per_game.merge(
        p_per_game[["pitcher", "game_date", "p_hr_rate", "p_cum_bip"]],
        left_on=["pitcher_id", "game_date"],
        right_on=["pitcher", "game_date"],
        how="left",
    )
    per_game["p_hr_rate"] = per_game["p_hr_rate"].fillna(0.025)  # league avg fallback
    per_game["p_cum_bip"] = per_game["p_cum_bip"].fillna(0)
    per_game = per_game[per_game["p_cum_bip"] >= 20].copy()  # need pitcher history too

    print(f"  [{year}] feature rows: {len(per_game):,}  HRs: {per_game['hit_hr'].sum():,}  "
          f"rate: {100*per_game['hit_hr'].mean():.2f}%")
    return per_game


def train(per_game: pd.DataFrame, year: int) -> dict:
    """Logistic regression on season features. Returns coefficients + AUC."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler

    FEATURES = [
        "barrel_pct",
        "fb_pct",
        "hard_pct",
        "hr_per_bip",
        "avg_ev",
        "iso_proxy",
        "p_hr_rate",
    ]
    X = per_game[FEATURES].values
    y = per_game["hit_hr"].values

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    clf = LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)
    auc = cross_val_score(clf, Xs, y, cv=5, scoring="roc_auc").mean()
    clf.fit(Xs, y)

    coefs = {f: float(c) for f, c in zip(FEATURES, clf.coef_[0])}
    # Normalized category weights (batter vs pitcher)
    batter_total = sum(abs(coefs[f]) for f in FEATURES if f != "p_hr_rate")
    pitcher_total = abs(coefs["p_hr_rate"])
    total = batter_total + pitcher_total
    cat = {
        "batter": batter_total / total,
        "pitcher": pitcher_total / total,
    }

    print(f"  [{year}] AUC: {auc:.3f}  batter: {100*cat['batter']:.1f}%  pitcher: {100*cat['pitcher']:.1f}%")
    return {
        "year": year,
        "n_samples": int(len(X)),
        "n_hrs": int(y.sum()),
        "hr_rate": float(y.mean()),
        "auc": float(auc),
        "coefficients": coefs,
        "category_weights": cat,
    }


def main():
    results = {}
    for year in (2023, 2024, 2025):
        print(f"\n=== {year} ===")
        df = fetch_season(year)
        per_game = build_features(df, year)
        results[str(year)] = train(per_game, year)

    out = Path("results/backtest_weights.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    print(f"\nSaved: {out}")

    # Side-by-side summary
    print("\n" + "=" * 72)
    print("COEFFICIENT COMPARISON (side-by-side)")
    print("=" * 72)
    features = list(results["2023"]["coefficients"].keys())
    print(f"{'Feature':<20} {'2023':>10} {'2024':>10} {'2025':>10}  Range")
    for f in features:
        c23 = results["2023"]["coefficients"][f]
        c24 = results["2024"]["coefficients"][f]
        c25 = results["2025"]["coefficients"][f]
        rng = max(c23, c24, c25) - min(c23, c24, c25)
        print(f"{f:<20} {c23:>+10.3f} {c24:>+10.3f} {c25:>+10.3f}  {rng:.3f}")

    print(f"\n{'Category':<20} {'2023':>10} {'2024':>10} {'2025':>10}")
    for cat in ("batter", "pitcher"):
        b23 = results["2023"]["category_weights"][cat]
        b24 = results["2024"]["category_weights"][cat]
        b25 = results["2025"]["category_weights"][cat]
        print(f"{cat:<20} {100*b23:>9.1f}% {100*b24:>9.1f}% {100*b25:>9.1f}%")


if __name__ == "__main__":
    main()
