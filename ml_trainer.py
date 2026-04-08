#!/usr/bin/env python3
"""
ML Training Pipeline — learns optimal weights from historical results.

Reads all backfilled model predictions + actual HR outcomes,
builds a training dataset, and trains a logistic regression model
to predict HR probability from the feature set.

Usage:
    python ml_trainer.py           # train and report
    python ml_trainer.py --save    # train and save weights to config
"""

import argparse
import json
import numpy as np
from pathlib import Path
from datetime import date


def load_training_data() -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Build training dataset from historical predictions + results.

    For each player-day, extract features and whether they hit a HR.
    Returns (X features, y labels, feature_names).
    """
    results_dir = Path("results")
    data_dir = Path("frontend/public/data")

    X_rows = []
    y_rows = []

    # Get all dates with results
    cum_file = results_dir / "cumulative.json"
    if not cum_file.exists():
        print("No cumulative results found. Run results_tracker.py first.")
        return np.array([]), np.array([]), []

    with open(cum_file) as f:
        all_results = json.load(f)

    for day_result in all_results:
        game_date = day_result["date"]

        # Load the model predictions for this date
        pred_file = data_dir / f"{game_date}.json"
        if not pred_file.exists():
            continue

        with open(pred_file) as f:
            predictions = json.load(f)

        # Get HR hitter names for this date
        hr_names = {h["name"] for h in day_result.get("hr_hitters", [])}
        # Also add surprise HRs
        for hr in day_result.get("surprise_hrs", []):
            hr_names.add(hr.get("name", ""))

        # Extract features for each player
        for game in predictions.get("games", []):
            env = game.get("environment", {})
            env_score = env.get("env_score", 0.5)
            park_factor = env.get("park_factor", 100)

            for player in game.get("players", []):
                scores = player.get("scores", {}).get("L5", {})
                if not scores:
                    continue

                # Features
                barrel_pct = scores.get("barrel_pct", 0) / 100
                fb_pct = scores.get("fb_pct", 0) / 100
                hard_hit_pct = scores.get("hard_hit_pct", 0) / 100
                exit_velo = scores.get("exit_velo", 0)
                batter_score = scores.get("batter_score", 0)
                pitcher_score = scores.get("pitcher_score", 0)
                matchup_score = scores.get("matchup_score", 0) if "matchup_score" in scores else 0

                # Pitcher stats
                p_stats = player.get("pitcher_stats", {})
                p_hr_fb = p_stats.get("hr_fb_rate", 0) / 100
                p_hr_9 = p_stats.get("hr_per_9", 0)
                p_fb_rate = p_stats.get("fb_rate", 0) / 100

                # Pitcher quality metrics
                p_velo = p_stats.get("avg_velo", 0)
                p_spin = p_stats.get("avg_spin", 0)
                p_vert_break = p_stats.get("avg_vert_break", 0)
                p_horiz_break = p_stats.get("avg_horiz_break", 0)

                # Platoon
                platoon = player.get("platoon", 0)

                # Normalize
                ev_norm = (exit_velo - 80) / 20 if exit_velo > 0 else 0
                ev_norm = max(0, min(1, ev_norm))
                park_norm = (park_factor - 80) / 40
                park_norm = max(0, min(1, park_norm))
                velo_norm = (p_velo - 85) / 15 if p_velo > 0 else 0.5  # 85-100 range
                spin_norm = (p_spin - 2000) / 500 if p_spin > 0 else 0.5  # 2000-2500 range

                # Per-pitch-type features: dominant pitch vs secondary pitches
                pitch_detail = player.get("pitch_detail", {})
                pitch_types_list = player.get("pitch_types", [])

                # Find dominant pitch (highest usage)
                dominant_pt = ""
                dominant_usage = 0
                for pt, detail in pitch_detail.items():
                    usage = detail.get("usage_pct", 0)
                    if usage > dominant_usage:
                        dominant_usage = usage
                        dominant_pt = pt

                # Dominant pitch metrics
                dom_detail = pitch_detail.get(dominant_pt, {})
                dom_ev = dom_detail.get("avg_exit_velo", 0)
                dom_barrel = dom_detail.get("barrel_rate", 0) / 100 if dom_detail.get("barrel_rate", 0) else 0
                dom_fb = dom_detail.get("fb_rate", 0) / 100 if dom_detail.get("fb_rate", 0) else 0
                dom_ev_norm = (dom_ev - 80) / 20 if dom_ev > 0 else 0
                dom_usage_norm = dominant_usage / 100 if dominant_usage > 0 else 0

                # Secondary pitches average
                sec_ev_total = 0
                sec_barrel_total = 0
                sec_count = 0
                for pt, detail in pitch_detail.items():
                    if pt != dominant_pt and detail.get("avg_exit_velo", 0) > 0:
                        sec_ev_total += detail.get("avg_exit_velo", 0)
                        sec_barrel_total += detail.get("barrel_rate", 0) / 100
                        sec_count += 1
                sec_ev = sec_ev_total / sec_count if sec_count > 0 else 0
                sec_barrel = sec_barrel_total / sec_count if sec_count > 0 else 0
                sec_ev_norm = (sec_ev - 80) / 20 if sec_ev > 0 else 0

                features = [
                    barrel_pct,
                    fb_pct,
                    hard_hit_pct,
                    ev_norm,
                    batter_score,
                    pitcher_score,
                    matchup_score,
                    p_hr_fb,
                    p_hr_9 / 3.0,
                    p_fb_rate,
                    env_score,
                    park_norm,
                    velo_norm,
                    spin_norm,
                    p_vert_break,
                    p_horiz_break,
                    platoon,
                    # New: per-pitch-type features
                    dom_ev_norm,
                    dom_barrel,
                    dom_fb,
                    dom_usage_norm,
                    sec_ev_norm,
                    sec_barrel,
                ]

                # Label: did this player hit a HR?
                hit_hr = 1 if any(player["name"] in n or n in player["name"] for n in hr_names) else 0

                X_rows.append(features)
                y_rows.append(hit_hr)

    feature_names = [
        "barrel_pct", "fb_pct", "hard_hit_pct", "exit_velo_norm",
        "batter_score", "pitcher_score", "matchup_score",
        "pitcher_hr_fb", "pitcher_hr_9", "pitcher_fb_rate",
        "env_score", "park_factor_norm",
        "pitcher_velo", "pitcher_spin", "pitcher_vert_break", "pitcher_horiz_break",
        "platoon",
        # Per-pitch-type features
        "dom_pitch_ev", "dom_pitch_barrel", "dom_pitch_fb",
        "dom_pitch_usage", "sec_pitch_ev", "sec_pitch_barrel",
    ]

    return np.array(X_rows), np.array(y_rows), feature_names


def train_model(X: np.ndarray, y: np.ndarray, feature_names: list[str]):
    """Train logistic regression and report feature importance."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import classification_report

    print(f"\nTraining data: {len(X)} samples, {int(y.sum())} HRs ({y.mean()*100:.1f}% hit rate)")
    print(f"Features: {len(feature_names)}")

    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train logistic regression
    model = LogisticRegression(max_iter=1000, class_weight="balanced")
    model.fit(X_scaled, y)

    # Cross-validation
    cv_scores = cross_val_score(model, X_scaled, y, cv=5, scoring="roc_auc")
    print(f"\nCross-validation AUC: {cv_scores.mean():.3f} (+/- {cv_scores.std():.3f})")

    # Feature importance (coefficients)
    print(f"\n{'Feature':<25s} {'Coefficient':>12s} {'Direction':>10s}")
    print("-" * 50)

    coefs = model.coef_[0]
    sorted_idx = np.argsort(np.abs(coefs))[::-1]

    for idx in sorted_idx:
        name = feature_names[idx]
        coef = coefs[idx]
        direction = "+" if coef > 0 else "-"
        bar = "|" * int(min(abs(coef) * 10, 30))
        print(f"  {name:<23s} {coef:>+10.4f}   {bar}")

    # What the model thinks matters most
    print(f"\n{'='*50}")
    print("ML RECOMMENDED WEIGHTS (normalized):")
    print(f"{'='*50}")

    abs_coefs = np.abs(coefs)
    total = abs_coefs.sum()
    weights = abs_coefs / total

    for idx in sorted_idx:
        name = feature_names[idx]
        w = weights[idx]
        print(f"  {name:<23s} {w*100:>6.1f}%")

    # Group into composite categories
    batter_features = ["barrel_pct", "fb_pct", "hard_hit_pct", "exit_velo_norm", "batter_score"]
    pitcher_features = ["pitcher_hr_fb", "pitcher_hr_9", "pitcher_fb_rate", "pitcher_score",
                        "pitcher_velo", "pitcher_spin", "pitcher_vert_break", "pitcher_horiz_break"]
    matchup_features = ["matchup_score", "platoon"]
    env_features = ["env_score", "park_factor_norm"]

    batter_w = sum(weights[feature_names.index(f)] for f in batter_features if f in feature_names)
    pitcher_w = sum(weights[feature_names.index(f)] for f in pitcher_features if f in feature_names)
    matchup_w = sum(weights[feature_names.index(f)] for f in matchup_features if f in feature_names)
    env_w = sum(weights[feature_names.index(f)] for f in env_features if f in feature_names)

    total_cat = batter_w + pitcher_w + matchup_w + env_w

    # Normalize category weights to sum to 1.0
    # Set minimum floors — matchup quality conceptually matters even if ML
    # hasn't found the signal yet (early season). As data grows the ML
    # will learn the real weight.
    MIN_FLOORS = {"batter": 0.30, "matchup": 0.10, "pitcher": 0.15, "environment": 0.05}

    raw = {
        "batter": batter_w / total_cat,
        "matchup": matchup_w / total_cat,
        "pitcher": pitcher_w / total_cat,
        "environment": env_w / total_cat,
    }
    # Apply floors
    cat_weights = {k: max(raw[k], MIN_FLOORS[k]) for k in raw}
    # Re-normalize to sum to 1.0
    total_w = sum(cat_weights.values())
    cat_weights = {k: round(v / total_w, 3) for k, v in cat_weights.items()}
    remainder = 1.0 - sum(cat_weights.values())
    cat_weights["batter"] += remainder

    print(f"\nCOMPOSITE CATEGORY WEIGHTS (auto-learned):")
    print(f"  Batter (recent BIP):    {cat_weights['batter']*100:.1f}%")
    print(f"  Matchup quality:        {cat_weights['matchup']*100:.1f}%")
    print(f"  Pitcher vulnerability:  {cat_weights['pitcher']*100:.1f}%")
    print(f"  Environment:            {cat_weights['environment']*100:.1f}%")

    # DO NOT auto-save weights — user decides when to apply
    print(f"\n  Weights NOT auto-applied. User must manually update results/ml_weights.json.")

    return model, scaler, coefs, weights


def save_ml_report(feature_names, coefs, weights, X, y):
    """Save the ML analysis to a JSON file for the frontend."""
    report = {
        "trained_on": len(X),
        "hr_count": int(y.sum()),
        "hr_rate": round(float(y.mean()) * 100, 2),
        "features": [
            {"name": feature_names[i], "coefficient": round(float(coefs[i]), 4), "weight_pct": round(float(weights[i]) * 100, 1)}
            for i in range(len(feature_names))
        ],
    }

    Path("results").mkdir(exist_ok=True)
    with open("results/ml_analysis.json", "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nML report saved to results/ml_analysis.json")


def main():
    parser = argparse.ArgumentParser(description="ML Training Pipeline")
    parser.add_argument("--save", action="store_true", help="Save learned weights")
    args = parser.parse_args()

    print("Loading training data from all backfilled dates...")
    X, y, feature_names = load_training_data()

    if len(X) == 0:
        print("No training data found!")
        return

    # Check if sklearn is available
    try:
        import sklearn
    except ImportError:
        print("Installing scikit-learn...")
        import subprocess
        subprocess.run(["pip3", "install", "--user", "scikit-learn"], check=True)

    model, scaler, coefs, weights = train_model(X, y, feature_names)
    save_ml_report(feature_names, coefs, weights, X, y)


if __name__ == "__main__":
    main()
