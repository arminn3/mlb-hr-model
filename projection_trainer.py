#!/usr/bin/env python3
"""
Projection Trainer — learns per-game HR projections from historical data.

Collects actual HR counts per game, maps them to game features
(pitcher HR/9, park factor, weather, batter quality), and trains
a regression model to predict expected HRs per game.

Saves learned weights to results/projection_model.json for the frontend.
"""

import json
import numpy as np
import pandas as pd
import requests
from datetime import date, timedelta
from pathlib import Path


def get_game_hr_counts(game_date: date) -> dict[int, int]:
    """Get actual HR count per game_pk for a date from MLB API."""
    url = (
        f"https://statsapi.mlb.com/api/v1/schedule"
        f"?date={game_date.isoformat()}&sportId=1&hydrate=scoringplays"
    )
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return {}

    counts = {}
    for date_entry in data.get("dates", []):
        for game in date_entry.get("games", []):
            gpk = game["gamePk"]
            status = game.get("status", {}).get("detailedState", "")
            if status not in ("Final", "Game Over", "Completed Early"):
                continue

            hr_count = 0
            for play in game.get("scoringPlays", []):
                if play.get("result", {}).get("event") == "Home Run":
                    hr_count += 1
            counts[gpk] = hr_count

    return counts


def build_training_data() -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Build training data: for each completed game, extract features
    and the actual HR count.
    """
    data_dir = Path("frontend/public/data")
    X_rows = []
    y_rows = []

    # Get all dates we have model data for
    dates = []
    for f in sorted(data_dir.glob("2026-*.json")):
        if f.name == "latest.json" or "results" in str(f):
            continue
        dates.append(f.stem)

    print(f"Found {len(dates)} dates with model data")

    for date_str in dates:
        game_date = date.fromisoformat(date_str)

        # Load our model predictions
        with open(data_dir / f"{date_str}.json") as f:
            predictions = json.load(f)

        # Get actual HRs per game
        hr_counts = get_game_hr_counts(game_date)
        if not hr_counts:
            continue

        for game in predictions.get("games", []):
            gpk = game["game_pk"]
            if gpk not in hr_counts:
                continue

            actual_hrs = hr_counts[gpk]
            env = game.get("environment", {})
            players = game.get("players", [])

            if not players:
                continue

            # Features
            park_factor = (env.get("park_factor", 100)) / 100
            temp = env.get("temperature_f") or 70
            temp_norm = (temp - 50) / 40  # normalize ~50-90 to 0-1
            wind_score = env.get("wind_score", 0)
            wind_norm = (wind_score + 15) / 30  # normalize -15 to 15 -> 0-1
            humidity = (env.get("humidity") or 50) / 100
            pressure = env.get("pressure_hpa") or 1013
            pressure_norm = (1030 - pressure) / 50  # lower pressure = higher

            # Pitcher stats (average of both sides)
            home_players = [p for p in players if p.get("batter_side") == "home"]
            away_players = [p for p in players if p.get("batter_side") == "away"]

            away_p = home_players[0].get("pitcher_stats", {}) if home_players else {}
            home_p = away_players[0].get("pitcher_stats", {}) if away_players else {}

            avg_pitcher_hr9 = (
                (away_p.get("hr_per_9", 1.25) + home_p.get("hr_per_9", 1.25)) / 2
            )
            avg_pitcher_fb = (
                (away_p.get("fb_rate", 30) + home_p.get("fb_rate", 30)) / 2
            ) / 100
            avg_pitcher_hrfb = (
                (away_p.get("hr_fb_rate", 10) + home_p.get("hr_fb_rate", 10)) / 2
            ) / 100

            # Batter quality (average composite of all batters)
            composites = [
                p.get("scores", {}).get("L5", {}).get("composite", 0.3)
                for p in players
            ]
            avg_composite = sum(composites) / len(composites) if composites else 0.3
            max_composite = max(composites) if composites else 0.3

            num_batters = len(players)

            features = [
                park_factor,
                temp_norm,
                wind_norm,
                humidity,
                pressure_norm,
                avg_pitcher_hr9 / 2.0,  # normalize
                avg_pitcher_fb,
                avg_pitcher_hrfb,
                avg_composite,
                max_composite,
                num_batters / 30,  # normalize
            ]

            X_rows.append(features)
            y_rows.append(actual_hrs)

    feature_names = [
        "park_factor", "temperature", "wind", "humidity", "pressure",
        "pitcher_hr9", "pitcher_fb_rate", "pitcher_hr_fb",
        "avg_batter_composite", "max_batter_composite", "num_batters",
    ]

    return np.array(X_rows), np.array(y_rows), feature_names


def train_projection_model(X, y, feature_names):
    """Train a regression model to predict HRs per game."""
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler

    print(f"\nTraining on {len(X)} games")
    print(f"Average HRs/game: {y.mean():.2f}")
    print(f"HR range: {y.min()}-{y.max()}")

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Ridge regression (better than linear for small datasets)
    model = Ridge(alpha=1.0)
    model.fit(X_scaled, y)

    # Cross-validation
    cv_scores = cross_val_score(model, X_scaled, y, cv=min(5, len(X)), scoring="neg_mean_absolute_error")
    print(f"Cross-validation MAE: {-cv_scores.mean():.2f} HRs/game")

    # Feature importance
    print(f"\n{'Feature':<30s} {'Coefficient':>12s}")
    print("-" * 45)
    coefs = model.coef_
    sorted_idx = np.argsort(np.abs(coefs))[::-1]
    for idx in sorted_idx:
        print(f"  {feature_names[idx]:<28s} {coefs[idx]:>+10.4f}")

    print(f"\n  Intercept: {model.intercept_:.4f}")

    # Save model parameters for the frontend
    model_params = {
        "intercept": round(float(model.intercept_), 4),
        "coefficients": {
            feature_names[i]: round(float(coefs[i]), 4)
            for i in range(len(feature_names))
        },
        "scaler_mean": {
            feature_names[i]: round(float(scaler.mean_[i]), 6)
            for i in range(len(feature_names))
        },
        "scaler_scale": {
            feature_names[i]: round(float(scaler.scale_[i]), 6)
            for i in range(len(feature_names))
        },
        "training_games": len(X),
        "avg_hrs_per_game": round(float(y.mean()), 2),
        "mae": round(float(-cv_scores.mean()), 2),
    }

    Path("results").mkdir(exist_ok=True)
    with open("results/projection_model.json", "w") as f:
        json.dump(model_params, f, indent=2)

    # Also copy to frontend
    fe_dir = Path("frontend/public/data/results")
    fe_dir.mkdir(parents=True, exist_ok=True)
    with open(fe_dir / "projection_model.json", "w") as f:
        json.dump(model_params, f, indent=2)

    print(f"\nProjection model saved to results/projection_model.json")


def main():
    print("Building per-game training data...")
    X, y, feature_names = build_training_data()

    if len(X) < 5:
        print(f"Only {len(X)} games — need more data for projection training.")
        return

    train_projection_model(X, y, feature_names)


if __name__ == "__main__":
    main()
