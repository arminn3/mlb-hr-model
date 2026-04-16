#!/usr/bin/env python3
"""
Matchup Analysis v2 — learn the formula for what produces HRs from
2023+2024+2025 Statcast data (time-weighted), export weights.

Trout's grade on the site then = his 2026 features plugged into this
league-learned formula. Weights = baseball physics (stable year-to-year).
Features on the page = this season's player performance (dynamic).

Output: results/matchup_v2_weights.json
  - coefficients per normalized feature
  - category weights (batter / pitcher / env)
  - grade band thresholds (calibrated from 2025 composite distribution)
  - AUC + training metadata

Does not touch HR Rankings (L5 model) or existing ml_weights.json.
"""
import json
import warnings
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
pd.options.mode.chained_assignment = None


# ── Park HR factors (multiplier, 100 = neutral). Rough Fangraphs-style. ───────
PARK_HR_FACTOR: dict[int, float] = {
    # Home team ID -> park HR factor
    108: 108,  # LAA
    109: 112,  # ARI
    110: 98,   # BAL
    111: 96,   # BOS (Fenway, LF wall kills LHH HRs)
    112: 108,  # CHC (Wrigley, wind-dependent but trends HR+)
    113: 118,  # CIN (GABP, best HR park)
    114: 96,   # CLE
    115: 117,  # COL (Coors, extreme)
    116: 95,   # DET
    117: 103,  # HOU
    118: 106,  # KC
    119: 89,   # LAD (big, pitcher-friendly at night)
    120: 92,   # WSH
    121: 107,  # NYM
    133: 95,   # OAK
    134: 93,   # PIT
    135: 94,   # SD (Petco, big)
    136: 83,   # SEA (T-Mobile, pitcher's park)
    137: 89,   # SF (Oracle, LH HR-suppressing)
    138: 99,   # STL
    139: 105,  # TB
    140: 115,  # TEX (Globe Life, HR-friendly)
    141: 94,   # TOR
    142: 106,  # MIN
    143: 109,  # PHI
    144: 100,  # ATL
    145: 104,  # CWS
    146: 92,   # MIA (LoanDepot, pitcher-friendly)
    147: 112,  # NYY (short RF porch)
    158: 109,  # MIL
}


# ── Config ────────────────────────────────────────────────────────────────────
YEAR_WEIGHTS = {2023: 0.5, 2024: 1.0, 2025: 1.5}
MIN_BATTER_BIP = 40
MIN_PITCHER_BIP = 20


def load_year(year: int) -> pd.DataFrame:
    path = Path(f"cache/statcast_{year}.parquet")
    if not path.exists():
        raise SystemExit(f"Missing cache: {path}. Run backtest_hr_weights.py first.")
    print(f"  [{year}] loading {path}")
    return pd.read_parquet(path)


def build_features(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """Build per-(batter, game) feature rows with season-to-date stats.

    Each row = one game for one batter. Features describe that batter's
    season profile and the starting pitcher they most-likely faced, as
    of BEFORE that game started.
    """
    print(f"  [{year}] building features...")
    df = df.dropna(subset=["launch_speed", "launch_angle"]).copy()
    df["game_date"] = pd.to_datetime(df["game_date"])
    df["launch_speed"] = pd.to_numeric(df["launch_speed"], errors="coerce").fillna(0)
    df["launch_angle"] = pd.to_numeric(df["launch_angle"], errors="coerce").fillna(0)
    df["launch_speed_angle"] = pd.to_numeric(df["launch_speed_angle"], errors="coerce").fillna(0)

    df["is_hr"] = (df["events"].astype(str) == "home_run").astype(int)
    df["is_barrel"] = (df["launch_speed_angle"] == 6).astype(int)
    df["is_fb"] = ((df["launch_angle"] >= 25) & (df["launch_angle"] <= 50)).astype(int)
    df["is_hard"] = (df["launch_speed"] >= 95).astype(int)
    df["is_xbh"] = df["events"].astype(str).isin(["double", "triple", "home_run"]).astype(int)

    # ── Batter running stats (before this row) ──────────────────────────────
    df = df.sort_values(["batter", "game_date"]).reset_index(drop=True)
    grp = df.groupby("batter", group_keys=False)
    df["b_cum_bip"] = grp.cumcount()
    df["b_cum_hr"] = grp["is_hr"].cumsum() - df["is_hr"]
    df["b_cum_barrel"] = grp["is_barrel"].cumsum() - df["is_barrel"]
    df["b_cum_fb"] = grp["is_fb"].cumsum() - df["is_fb"]
    df["b_cum_hard"] = grp["is_hard"].cumsum() - df["is_hard"]
    df["b_cum_xbh"] = grp["is_xbh"].cumsum() - df["is_xbh"]
    df["b_cum_ev_sum"] = grp["launch_speed"].cumsum() - df["launch_speed"]

    # ── Collapse to (batter, game_date) level ──────────────────────────────
    per_game = df.groupby(["batter", "game_date"]).agg(
        hit_hr=("is_hr", "max"),
        cum_bip=("b_cum_bip", "min"),
        cum_hr=("b_cum_hr", "min"),
        cum_barrel=("b_cum_barrel", "min"),
        cum_fb=("b_cum_fb", "min"),
        cum_hard=("b_cum_hard", "min"),
        cum_xbh=("b_cum_xbh", "min"),
        cum_ev_sum=("b_cum_ev_sum", "min"),
        pitcher_id=("pitcher", "first"),
        home_team_id=("home_team", "first"),
        batter_side=("stand", "first"),   # L/R
        pitcher_side=("p_throws", "first"),
    ).reset_index()
    per_game = per_game[per_game["cum_bip"] >= MIN_BATTER_BIP].copy()

    # Batter features
    per_game["barrel_pct"] = per_game["cum_barrel"] / per_game["cum_bip"]
    per_game["fb_pct"] = per_game["cum_fb"] / per_game["cum_bip"]
    per_game["hard_pct"] = per_game["cum_hard"] / per_game["cum_bip"]
    per_game["hr_per_bip"] = per_game["cum_hr"] / per_game["cum_bip"]
    per_game["iso"] = (per_game["cum_xbh"] + per_game["cum_hr"] * 2) / per_game["cum_bip"]
    per_game["avg_ev"] = per_game["cum_ev_sum"] / per_game["cum_bip"]

    # Platoon (1 = opposite-hand matchup = favorable for HR)
    per_game["platoon"] = (per_game["batter_side"] != per_game["pitcher_side"]).astype(int)

    # Park HR factor (home team). Map team abbr. Statcast home_team is abbr.
    # Build reverse from our id table via team abbr in the cache.
    # Actually, "home_team" in statcast is abbr string (e.g. "NYY").
    ABBR_TO_ID = {
        "LAA":108,"ARI":109,"AZ":109,"BAL":110,"BOS":111,"CHC":112,"CIN":113,
        "CLE":114,"COL":115,"DET":116,"HOU":117,"KC":118,"LAD":119,"WSH":120,
        "NYM":121,"OAK":133,"ATH":133,"PIT":134,"SD":135,"SDP":135,"SEA":136,
        "SF":137,"STL":138,"TB":139,"TBR":139,"TEX":140,"TOR":141,"MIN":142,
        "PHI":143,"ATL":144,"CWS":145,"CHW":145,"MIA":146,"NYY":147,"MIL":158,
    }
    per_game["park_hr_factor"] = per_game["home_team_id"].map(
        lambda x: PARK_HR_FACTOR.get(ABBR_TO_ID.get(x, 0), 100) if isinstance(x, str) else 100
    )

    # ── Pitcher running stats (as of game_date, before it) ──────────────────
    df_p = df.sort_values(["pitcher", "game_date"]).reset_index(drop=True)
    pgrp = df_p.groupby("pitcher", group_keys=False)
    df_p["p_cum_bip"] = pgrp.cumcount()
    df_p["p_cum_hr"] = pgrp["is_hr"].cumsum() - df_p["is_hr"]
    df_p["p_cum_fb"] = pgrp["is_fb"].cumsum() - df_p["is_fb"]
    p_per_game = df_p.groupby(["pitcher", "game_date"]).agg(
        p_cum_bip=("p_cum_bip", "min"),
        p_cum_hr=("p_cum_hr", "min"),
        p_cum_fb=("p_cum_fb", "min"),
    ).reset_index()
    p_per_game = p_per_game[p_per_game["p_cum_bip"] >= MIN_PITCHER_BIP].copy()
    p_per_game["p_hr_rate"] = p_per_game["p_cum_hr"] / p_per_game["p_cum_bip"]
    p_per_game["p_fb_rate"] = p_per_game["p_cum_fb"] / p_per_game["p_cum_bip"]
    p_per_game["p_hr_fb_rate"] = np.where(
        p_per_game["p_cum_fb"] > 0,
        p_per_game["p_cum_hr"] / p_per_game["p_cum_fb"],
        0.10,
    )

    per_game = per_game.merge(
        p_per_game[["pitcher", "game_date", "p_hr_rate", "p_fb_rate", "p_hr_fb_rate"]],
        left_on=["pitcher_id", "game_date"],
        right_on=["pitcher", "game_date"],
        how="left",
    )
    # Fill missing pitcher stats with league medians
    per_game["p_hr_rate"] = per_game["p_hr_rate"].fillna(0.028)
    per_game["p_fb_rate"] = per_game["p_fb_rate"].fillna(0.12)
    per_game["p_hr_fb_rate"] = per_game["p_hr_fb_rate"].fillna(0.12)

    per_game["year"] = year
    print(f"  [{year}] rows={len(per_game):,}  HRs={per_game['hit_hr'].sum():,}  "
          f"rate={100*per_game['hit_hr'].mean():.2f}%")
    return per_game


def train(all_data: pd.DataFrame) -> dict:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler

    FEATURES = [
        # Batter category
        "barrel_pct",
        "iso",
        "hr_per_bip",
        "avg_ev",
        "fb_pct",
        "hard_pct",
        # Pitcher category
        "p_hr_rate",
        "p_fb_rate",
        "p_hr_fb_rate",
        # Environment/matchup category
        "park_hr_factor",
        "platoon",
    ]
    CATEGORY: dict[str, str] = {
        "barrel_pct": "batter", "iso": "batter", "hr_per_bip": "batter",
        "avg_ev": "batter", "fb_pct": "batter", "hard_pct": "batter",
        "p_hr_rate": "pitcher", "p_fb_rate": "pitcher", "p_hr_fb_rate": "pitcher",
        "park_hr_factor": "environment", "platoon": "environment",
    }

    X = all_data[FEATURES].values
    y = all_data["hit_hr"].values
    w = all_data["year"].map(YEAR_WEIGHTS).values

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=1.0)
    # Separate AUC check (unweighted for honest metric)
    auc = cross_val_score(clf, Xs, y, cv=5, scoring="roc_auc").mean()

    clf.fit(Xs, y, sample_weight=w)

    coefs = {f: float(c) for f, c in zip(FEATURES, clf.coef_[0])}

    # Category totals (abs coefficients)
    cat_totals: dict[str, float] = {}
    for f, c in coefs.items():
        cat_totals.setdefault(CATEGORY[f], 0.0)
        cat_totals[CATEGORY[f]] += abs(c)
    total = sum(cat_totals.values()) or 1
    category_weights = {k: v / total for k, v in cat_totals.items()}

    # Within-category normalized weights (for detailed display)
    subweights: dict[str, dict[str, float]] = {c: {} for c in set(CATEGORY.values())}
    for f, c in coefs.items():
        subweights[CATEGORY[f]][f] = abs(c) / cat_totals[CATEGORY[f]]

    # Calibrate grade bands from 2025-only composite distribution
    cal = all_data[all_data["year"] == 2025].copy()
    Xcal = scaler.transform(cal[FEATURES].values)
    cal_scores = clf.decision_function(Xcal)
    # Normalize to [0, 1] using empirical min/max
    cal_min, cal_max = float(cal_scores.min()), float(cal_scores.max())

    # Save the normalization bounds so the frontend can normalize 2026
    # composites to the same 0-1 scale.
    # Then pick grade cutoffs at empirical percentiles to match HRP's
    # rough distribution (A+ ~3%, A ~15%, B ~30%, C ~30%, D ~15%, F ~7%)
    def pct(p): return float(np.quantile(cal_scores, p))
    cutoffs = {
        "A+": pct(0.97),
        "A": pct(0.85),
        "B": pct(0.55),
        "C": pct(0.25),
        "D": pct(0.10),
    }
    # Convert cutoffs to normalized 0-1 scale
    def norm(x): return max(0.0, min(1.0, (x - cal_min) / (cal_max - cal_min))) if cal_max > cal_min else 0.5
    cutoffs_norm = {k: norm(v) for k, v in cutoffs.items()}

    # Also save normalization mean/std per feature for frontend
    feature_means = {f: float(scaler.mean_[i]) for i, f in enumerate(FEATURES)}
    feature_scales = {f: float(scaler.scale_[i]) for i, f in enumerate(FEATURES)}

    intercept = float(clf.intercept_[0])
    return {
        "trained_at": date.today().isoformat(),
        "training_years": list(YEAR_WEIGHTS.keys()),
        "year_weights": YEAR_WEIGHTS,
        "n_samples": int(len(X)),
        "n_hrs": int(y.sum()),
        "hr_rate": float(y.mean()),
        "auc": float(auc),
        "intercept": intercept,
        "coefficients": coefs,
        "feature_means": feature_means,
        "feature_scales": feature_scales,
        "score_min": cal_min,
        "score_max": cal_max,
        "grade_cutoffs_norm": cutoffs_norm,
        "category_weights": category_weights,
        "subweights": subweights,
        "feature_category": CATEGORY,
    }


def main():
    frames = []
    for year in (2023, 2024, 2025):
        print(f"\n=== {year} ===")
        df = load_year(year)
        per_game = build_features(df, year)
        frames.append(per_game)
    all_data = pd.concat(frames, ignore_index=True)
    print(f"\nTotal: {len(all_data):,} rows across {len(frames)} years")

    result = train(all_data)

    out = Path("results/matchup_v2_weights.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f"\nSaved: {out}")

    # Also copy to frontend public
    frontend = Path("frontend/public/data/results/matchup_v2_weights.json")
    frontend.parent.mkdir(parents=True, exist_ok=True)
    frontend.write_text(json.dumps(result, indent=2))
    print(f"Saved: {frontend}")

    # Pretty-print summary
    print("\n" + "=" * 70)
    print(f"CV AUC: {result['auc']:.3f}  (samples {result['n_samples']:,}, HRs {result['n_hrs']:,})")
    print("=" * 70)
    print("\nCATEGORY WEIGHTS:")
    for k, v in result["category_weights"].items():
        print(f"  {k:14s} {100*v:5.1f}%")
    print("\nCOEFFICIENTS (signed, standardized):")
    for f, c in sorted(result["coefficients"].items(), key=lambda x: -abs(x[1])):
        print(f"  {f:18s} {c:+.4f}   [{result['feature_category'][f]}]")
    print("\nGRADE CUTOFFS (normalized 0-1):")
    for g, c in result["grade_cutoffs_norm"].items():
        print(f"  {g}: {c:.3f}")


if __name__ == "__main__":
    main()
